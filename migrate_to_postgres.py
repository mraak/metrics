"""
migrate_to_postgres.py — one-time copy of the existing SQLite data
(metrics.db + studio/studio.db) into a Postgres database (RDS).

This does NOT regenerate anything (seed.py / compute_metrics.py are not
invoked) — it copies the rows that are already sitting in the two SQLite
files today, so the deployed app comes up with the exact same data it has
locally.

Usage:
    DATABASE_URL=postgres://user:pass@host:5432/dbname python3 migrate_to_postgres.py

    (or rely on PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — psycopg2 reads
    the standard libpq env vars if DATABASE_URL isn't set)

Safe to re-run: every table is created with IF NOT EXISTS and TRUNCATEd
before reload, so re-running against the same target just re-copies the
current SQLite contents.
"""
import csv
import io
import os
import sqlite3
import sys

import psycopg2

ROOT = os.path.dirname(os.path.abspath(__file__))
METRICS_DB = os.path.join(ROOT, "metrics.db")
STUDIO_DB = os.path.join(ROOT, "studio", "studio.db")

# ── Schema: mirrors the SQLite column types 1:1 (see seed.py / compute_metrics.py) ──

METRICS_TABLES = {
    "brands": """
        CREATE TABLE IF NOT EXISTS brands (
            brand_id TEXT PRIMARY KEY,
            brand_name TEXT NOT NULL,
            franchise TEXT NOT NULL
        )""",
    "skus": """
        CREATE TABLE IF NOT EXISTS skus (
            sku_id TEXT PRIMARY KEY,
            brand_id TEXT NOT NULL,
            sku_name TEXT NOT NULL,
            strength TEXT NOT NULL,
            form TEXT NOT NULL,
            pack_size INTEGER NOT NULL,
            list_price_usd DOUBLE PRECISION NOT NULL
        )""",
    "regions": """
        CREATE TABLE IF NOT EXISTS regions (
            region_name TEXT PRIMARY KEY,
            territory_id TEXT NOT NULL,
            territory_name TEXT NOT NULL
        )""",
    "competitors": """
        CREATE TABLE IF NOT EXISTS competitors (
            competitor_id TEXT PRIMARY KEY,
            competitor_name TEXT NOT NULL,
            franchise TEXT NOT NULL
        )""",
    "sales": """
        CREATE TABLE IF NOT EXISTS sales (
            year_month TEXT NOT NULL,
            brand_name TEXT NOT NULL,
            franchise TEXT NOT NULL,
            is_own_brand INTEGER NOT NULL,
            region_name TEXT NOT NULL,
            territory_id TEXT NOT NULL,
            territory_name TEXT NOT NULL,
            units INTEGER NOT NULL,
            sales_eur DOUBLE PRECISION NOT NULL
        )""",
    "forecast": """
        CREATE TABLE IF NOT EXISTS forecast (
            year_month TEXT NOT NULL,
            sku_id TEXT NOT NULL,
            units INTEGER NOT NULL,
            sales_eur DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (year_month, sku_id)
        )""",
    # region_metrics / territory_metrics / national_metrics: same analytical
    # column set at 3 grains, all nullable (compute_metrics.py leaves early
    # periods NULL until enough history accrues for MAT/YTD/etc.)
    "region_metrics": """
        CREATE TABLE IF NOT EXISTS region_metrics (
            year_month TEXT, brand_name TEXT, franchise TEXT,
            region_name TEXT, territory_id TEXT, territory_name TEXT,
            period_type TEXT,
            units DOUBLE PRECISION, sales_eur DOUBLE PRECISION,
            market_share DOUBLE PRECISION, mshare_deviation DOUBLE PRECISION,
            growth_py_sales DOUBLE PRECISION, growth_pp_sales DOUBLE PRECISION,
            growth_py_units DOUBLE PRECISION, growth_pp_units DOUBLE PRECISION,
            growth_vs_fcst_eur DOUBLE PRECISION, growth_vs_fcst_units DOUBLE PRECISION,
            growth_deviation DOUBLE PRECISION,
            growth_py_mshare_dev DOUBLE PRECISION, growth_pp_mshare_dev DOUBLE PRECISION,
            rank_units INTEGER, rank_sales_eur INTEGER, rank_mshare_dev INTEGER,
            rank_growth_py INTEGER, rank_growth_pp INTEGER,
            rank_growth_vs_fcst_eur INTEGER, rank_growth_vs_fcst_units INTEGER,
            rank_growth_py_mshare_dev INTEGER, rank_growth_pp_mshare_dev INTEGER,
            rank_trend_3m INTEGER
        )""",
    "territory_metrics": """
        CREATE TABLE IF NOT EXISTS territory_metrics (
            year_month TEXT, brand_name TEXT, franchise TEXT,
            territory_id TEXT, territory_name TEXT,
            period_type TEXT,
            units DOUBLE PRECISION, sales_eur DOUBLE PRECISION,
            market_share DOUBLE PRECISION, mshare_deviation DOUBLE PRECISION,
            growth_py_sales DOUBLE PRECISION, growth_pp_sales DOUBLE PRECISION,
            growth_py_units DOUBLE PRECISION, growth_pp_units DOUBLE PRECISION,
            growth_vs_fcst_eur DOUBLE PRECISION, growth_vs_fcst_units DOUBLE PRECISION,
            growth_deviation DOUBLE PRECISION,
            growth_py_mshare_dev DOUBLE PRECISION, growth_pp_mshare_dev DOUBLE PRECISION,
            rank_units INTEGER, rank_sales_eur INTEGER, rank_mshare_dev INTEGER,
            rank_growth_py INTEGER, rank_growth_pp INTEGER,
            rank_growth_vs_fcst_eur INTEGER, rank_growth_vs_fcst_units INTEGER,
            rank_growth_py_mshare_dev INTEGER, rank_growth_pp_mshare_dev INTEGER,
            rank_trend_3m INTEGER
        )""",
    "national_metrics": """
        CREATE TABLE IF NOT EXISTS national_metrics (
            year_month TEXT, brand_name TEXT, franchise TEXT,
            period_type TEXT,
            units DOUBLE PRECISION, sales_eur DOUBLE PRECISION,
            market_share DOUBLE PRECISION, mshare_deviation DOUBLE PRECISION,
            growth_py_sales DOUBLE PRECISION, growth_pp_sales DOUBLE PRECISION,
            growth_py_units DOUBLE PRECISION, growth_pp_units DOUBLE PRECISION,
            growth_vs_fcst_eur DOUBLE PRECISION, growth_vs_fcst_units DOUBLE PRECISION,
            growth_deviation DOUBLE PRECISION,
            growth_py_mshare_dev DOUBLE PRECISION, growth_pp_mshare_dev DOUBLE PRECISION,
            rank_units INTEGER, rank_sales_eur INTEGER, rank_mshare_dev INTEGER,
            rank_growth_py INTEGER, rank_growth_pp INTEGER,
            rank_growth_vs_fcst_eur INTEGER, rank_growth_vs_fcst_units INTEGER,
            rank_growth_py_mshare_dev INTEGER, rank_growth_pp_mshare_dev INTEGER,
            rank_trend_3m INTEGER
        )""",
}

# Keep in sync with studio/src/lib/db.ts's initToolDb().
FINDINGS_CATALOG_DDL = """
    CREATE TABLE IF NOT EXISTS findings_catalog (
        id SERIAL PRIMARY KEY,
        finding_def_id TEXT NOT NULL,
        brand_name TEXT NOT NULL,
        region_name TEXT NOT NULL,
        territory_name TEXT NOT NULL,
        year_month TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (now()::text),
        finding_key TEXT NOT NULL,
        severity_band TEXT NOT NULL,
        severity_score INTEGER NOT NULL,
        axes_snapshot TEXT NOT NULL,
        ms_now REAL, ms_sev INTEGER,
        growth_now REAL, growth_sev INTEGER,
        mat_rank INTEGER, market_share REAL,
        months_red INTEGER DEFAULT 0,
        escalate INTEGER DEFAULT 0, improved INTEGER DEFAULT 0,
        UNIQUE(finding_def_id, brand_name, region_name, year_month)
    )"""

NULL_MARKER = r"\N"


def copy_table(sqlite_conn, pg_conn, table, ddl, columns, id_column=None):
    """Create `table` in Postgres (if needed), then TRUNCATE + COPY all rows
    from the SQLite side. `id_column` (if the table has one) is excluded from
    the copied column list so Postgres' own SERIAL sequence assigns fresh ids."""
    cols = [c for c in columns if c != id_column]
    cur = sqlite_conn.execute(f'SELECT {", ".join(cols)} FROM "{table}"')

    buf = io.StringIO()
    writer = csv.writer(buf)
    n = 0
    for row in cur:
        writer.writerow([NULL_MARKER if v is None else v for v in row])
        n += 1
    buf.seek(0)

    with pg_conn.cursor() as pg_cur:
        pg_cur.execute(ddl)
        pg_cur.execute(f'TRUNCATE TABLE "{table}"')
        if n:
            col_list = ", ".join(f'"{c}"' for c in cols)
            pg_cur.copy_expert(
                f'COPY "{table}" ({col_list}) FROM STDIN WITH (FORMAT csv, NULL \'{NULL_MARKER}\')',
                buf,
            )
    pg_conn.commit()
    print(f"  {table}: {n} rows")


def main():
    if not os.path.exists(METRICS_DB):
        sys.exit(f"metrics.db not found at {METRICS_DB}")

    pg_conn = psycopg2.connect(os.environ.get("DATABASE_URL") or "")

    print(f"Copying metrics tables from {METRICS_DB} ...")
    metrics_conn = sqlite3.connect(METRICS_DB)
    for table, ddl in METRICS_TABLES.items():
        cols = [r[1] for r in metrics_conn.execute(f'PRAGMA table_info("{table}")')]
        copy_table(metrics_conn, pg_conn, table, ddl, cols)
    metrics_conn.close()

    if os.path.exists(STUDIO_DB):
        print(f"Copying findings_catalog from {STUDIO_DB} ...")
        studio_conn = sqlite3.connect(STUDIO_DB)
        tables = studio_conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='findings_catalog'"
        ).fetchall()
        if tables:
            cols = [r[1] for r in studio_conn.execute('PRAGMA table_info("findings_catalog")')]
            copy_table(studio_conn, pg_conn, "findings_catalog", FINDINGS_CATALOG_DDL, cols, id_column="id")
        else:
            print("  (no findings_catalog table in studio.db yet — nothing to copy)")
        studio_conn.close()
    else:
        print(f"No studio.db at {STUDIO_DB} — creating an empty findings_catalog table only.")
        with pg_conn.cursor() as pg_cur:
            pg_cur.execute(FINDINGS_CATALOG_DDL)
        pg_conn.commit()

    pg_conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
