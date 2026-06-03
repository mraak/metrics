"""
Compute region_metrics: per-region × per-brand × per-period analytical metrics.

Grain: year_month × period_type × brand_name (+ franchise, region_name, territory)

Period types
  Month  – calendar month
  RollQ  – rolling 3-month window
  YTD    – year-to-date (Jan → current month)
  MAT    – moving annual total (last 12 full months, min 12 months required)

Metrics per period
  units, sales_eur       – own brand volume
  market_share           – brand sales / total franchise market (own + competitors) %
  growth_py              – vs same period prior year %
  growth_pp              – vs prior period %
  fcst_deviation         – actual growth_py minus national brand FCST growth_py (pp)

Ranks (NTILE 1-100, 100=best) per year_month × period_type × brand_name.

rank_trend_3m  – rank_sales_eur delta vs 3 months ago (+ = improving)
"""

import sqlite3
import pandas as pd
import numpy as np
from itertools import product as iprod

DB = "metrics.db"

# ── 1. Load ───────────────────────────────────────────────────────────────────

con = sqlite3.connect(DB)

# Own-brand sales: keep brand_name in the grain
own_raw = pd.read_sql("""
    SELECT year_month, brand_name, franchise, region_name, territory_id, territory_name,
           SUM(units) AS units, SUM(sales_eur) AS sales_eur
    FROM sales
    WHERE is_own_brand = 1
    GROUP BY year_month, brand_name, franchise, region_name, territory_id, territory_name
""", con)

# Total market per franchise-region (own + competitors) — denominator for market share
tot_raw = pd.read_sql("""
    SELECT year_month, franchise, region_name,
           SUM(units) AS tot_u, SUM(sales_eur) AS tot_s
    FROM sales
    GROUP BY year_month, franchise, region_name
""", con)

# Forecast at brand level (aggregate SKUs → brand)
fcst_raw = pd.read_sql("""
    SELECT f.year_month, b.brand_id, b.brand_name, b.franchise,
           SUM(f.units) AS units, SUM(f.sales_eur) AS sales_eur
    FROM forecast f
    JOIN skus s USING(sku_id)
    JOIN brands b ON s.brand_id = b.brand_id
    GROUP BY f.year_month, b.brand_id, b.brand_name, b.franchise
""", con)

regions_ref = pd.read_sql(
    "SELECT region_name, territory_id, territory_name FROM regions", con
)
con.close()

# ── 2. Build full month × brand × region grid ─────────────────────────────────

months   = sorted(own_raw.year_month.unique())
rnames   = regions_ref.region_name.tolist()

# One row per (brand, franchise) — 6 pairs
brand_franchise = (
    own_raw[["brand_name", "franchise"]]
    .drop_duplicates()
    .sort_values("brand_name")
    .reset_index(drop=True)
)

grid_rows = [
    (m, row.brand_name, row.franchise, r)
    for m in months
    for _, row in brand_franchise.iterrows()
    for r in rnames
]
grid = pd.DataFrame(grid_rows, columns=["year_month", "brand_name", "franchise", "region_name"])
grid = grid.merge(regions_ref, on="region_name", how="left")

# Merge own-brand sales onto grid (0 where brand not yet launched / no sales)
base = grid.merge(
    own_raw.rename(columns={"units": "own_u", "sales_eur": "own_s"})
           [["year_month", "brand_name", "region_name", "own_u", "own_s"]],
    on=["year_month", "brand_name", "region_name"],
    how="left",
)

# Merge total market (franchise level)
base = base.merge(tot_raw, on=["year_month", "franchise", "region_name"], how="left")

base[["own_u", "own_s", "tot_u", "tot_s"]] = (
    base[["own_u", "own_s", "tot_u", "tot_s"]].fillna(0)
)

base["year"] = base["year_month"].str[:4]
base = base.sort_values(["brand_name", "region_name", "year_month"]).reset_index(drop=True)

# ── 3. Period aggregates ──────────────────────────────────────────────────────

grp    = base.groupby(["brand_name", "region_name"])
grp_yr = base.groupby(["brand_name", "region_name", "year"])

def roll3(s):  return s.rolling(3,  min_periods=3).sum()
def roll12(s): return s.rolling(12, min_periods=12).sum()

# Month
base["m_u"]  = base["own_u"];  base["m_s"]  = base["own_s"]
base["m_tu"] = base["tot_u"];  base["m_ts"] = base["tot_s"]

# RollQ
base["rq_u"]  = grp["own_u"].transform(roll3)
base["rq_s"]  = grp["own_s"].transform(roll3)
base["rq_tu"] = grp["tot_u"].transform(roll3)
base["rq_ts"] = grp["tot_s"].transform(roll3)

# YTD
base["ytd_u"]  = grp_yr["own_u"].transform("cumsum")
base["ytd_s"]  = grp_yr["own_s"].transform("cumsum")
base["ytd_tu"] = grp_yr["tot_u"].transform("cumsum")
base["ytd_ts"] = grp_yr["tot_s"].transform("cumsum")

# MAT
base["mat_u"]  = grp["own_u"].transform(roll12)
base["mat_s"]  = grp["own_s"].transform(roll12)
base["mat_tu"] = grp["tot_u"].transform(roll12)
base["mat_ts"] = grp["tot_s"].transform(roll12)

# ── 4. Growth helpers ─────────────────────────────────────────────────────────

def pct_change(curr, prev):
    denom = prev.where(prev != 0, other=np.nan)
    return ((curr - denom) / denom * 100).round(2)

# PY: shift 12 within brand-region
for col in ["m_s", "rq_s", "ytd_s", "mat_s", "m_u", "rq_u", "ytd_u", "mat_u"]:
    base[f"{col}_py"] = grp[col].transform(lambda x: x.shift(12))

# PP: Month→1, RollQ→3, YTD→12, MAT→1
for col, sh in [("m_s", 1), ("rq_s", 3), ("ytd_s", 12), ("mat_s", 1),
                ("m_u", 1), ("rq_u", 3), ("ytd_u", 12), ("mat_u", 1)]:
    base[f"{col}_pp"] = grp[col].transform(lambda x, s=sh: x.shift(s))

# ── 5. Brand-level national FCST growth_py ───────────────────────────────────

fcst = fcst_raw.sort_values(["brand_name", "year_month"]).reset_index(drop=True)
fcst["year"] = fcst["year_month"].str[:4]
fg = fcst.groupby("brand_name")

fcst["m_fcst"]   = fcst["sales_eur"]
fcst["rq_fcst"]  = fg["sales_eur"].transform(lambda x: x.rolling(3,  min_periods=3).sum())
fcst["ytd_fcst"] = fcst.groupby(["brand_name", "year"])["sales_eur"].transform("cumsum")
fcst["mat_fcst"] = fg["sales_eur"].transform(lambda x: x.rolling(12, min_periods=12).sum())

# Same for units
fcst["m_fcst_u"]   = fcst["units"]
fcst["rq_fcst_u"]  = fg["units"].transform(lambda x: x.rolling(3,  min_periods=3).sum())
fcst["ytd_fcst_u"] = fcst.groupby(["brand_name", "year"])["units"].transform("cumsum")
fcst["mat_fcst_u"] = fg["units"].transform(lambda x: x.rolling(12, min_periods=12).sum())

for p in ["m", "rq", "ytd", "mat"]:
    c = f"{p}_fcst"
    cu = f"{p}_fcst_u"
    fcst[f"{c}_py"]           = fg[c].transform(lambda x: x.shift(12))
    fcst[f"{cu}_py"]          = fg[cu].transform(lambda x: x.shift(12))
    fcst[f"{p}_fcst_growth_py"] = pct_change(fcst[c], fcst[f"{c}_py"])
    fcst[f"{p}_fcst_growth_py_u"] = pct_change(fcst[cu], fcst[f"{cu}_py"])

fcst_growth = fcst[["year_month", "brand_name",
                     "m_fcst_growth_py", "rq_fcst_growth_py",
                     "ytd_fcst_growth_py", "mat_fcst_growth_py",
                     "m_fcst_growth_py_u", "rq_fcst_growth_py_u",
                     "ytd_fcst_growth_py_u", "mat_fcst_growth_py_u"]].copy()

base = base.merge(fcst_growth, on=["year_month", "brand_name"], how="left")

# ── 6. Assemble long-form per period type ────────────────────────────────────

ID = ["year_month", "brand_name", "franchise", "region_name", "territory_id", "territory_name"]

PERIODS = {
    "Month": ("m_u",   "m_s",   "m_tu",   "m_ts",   "m_s_py",   "m_s_pp",   "m_u_py",   "m_u_pp",   "m_fcst_growth_py", "m_fcst_growth_py_u"),
    "RollQ": ("rq_u",  "rq_s",  "rq_tu",  "rq_ts",  "rq_s_py",  "rq_s_pp",  "rq_u_py",  "rq_u_pp",  "rq_fcst_growth_py", "rq_fcst_growth_py_u"),
    "YTD":   ("ytd_u", "ytd_s", "ytd_tu", "ytd_ts", "ytd_s_py", "ytd_s_pp", "ytd_u_py", "ytd_u_pp", "ytd_fcst_growth_py", "ytd_fcst_growth_py_u"),
    "MAT":   ("mat_u", "mat_s", "mat_tu", "mat_ts", "mat_s_py", "mat_s_pp", "mat_u_py", "mat_u_pp", "mat_fcst_growth_py", "mat_fcst_growth_py_u"),
}

chunks = []
for period_type, (cu, cs, ctu, cts, cspy, cspp, cupy, cupp, cfg, cfg_u) in PERIODS.items():
    sub = base[ID + [cu, cs, ctu, cts, cspy, cspp, cupy, cupp, cfg, cfg_u]].copy()
    sub.columns = ID + ["units", "sales_eur", "tot_units", "tot_sales_eur",
                        "prev_s_py", "prev_s_pp", "prev_u_py", "prev_u_pp", "fcst_growth_py", "fcst_growth_py_u"]
    sub["period_type"] = period_type

    sub["market_share"]    = (sub["sales_eur"] / sub["tot_sales_eur"].where(sub["tot_sales_eur"] > 0) * 100).round(2)
    sub["growth_py_sales"] = pct_change(sub["sales_eur"], sub["prev_s_py"])
    sub["growth_pp_sales"] = pct_change(sub["sales_eur"], sub["prev_s_pp"])
    sub["growth_py_units"] = pct_change(sub["units"],     sub["prev_u_py"])
    sub["growth_pp_units"] = pct_change(sub["units"],     sub["prev_u_pp"])
    sub["growth_vs_fcst_eur"]  = (sub["growth_py_sales"] - sub["fcst_growth_py"]).round(2)
    sub["growth_vs_fcst_units"] = (sub["growth_py_units"] - sub["fcst_growth_py_u"]).round(2)

    # Market share deviation: actual market_share minus national average (per brand × year_month)
    national_mshare = sub.groupby(["year_month", "brand_name"])["market_share"].transform("mean")
    sub["mshare_deviation"] = (sub["market_share"] - national_mshare).round(2)

    # Market share deviation growth: year-over-year and period-over-period changes in deviation
    # Need to track prior values to compute growth
    # We'll do this by creating a temporary expanded dataset with all needed shifts
    sub = sub.sort_values(["brand_name", "region_name", "year_month"]).reset_index(drop=True)
    grp_br = sub.groupby(["brand_name", "region_name"])

    # Shift for py (12 months) and pp (depends on period type, but we'll do logical shift)
    shift_pp = {"Month": 1, "RollQ": 3, "YTD": 12, "MAT": 1}[period_type]
    sub["mshare_dev_py"] = grp_br["mshare_deviation"].transform(lambda x: x.shift(12))
    sub["mshare_dev_pp"] = grp_br["mshare_deviation"].transform(lambda x: x.shift(shift_pp))

    sub["growth_py_mshare_dev"] = (sub["mshare_deviation"] - sub["mshare_dev_py"]).round(2)
    sub["growth_pp_mshare_dev"] = (sub["mshare_deviation"] - sub["mshare_dev_pp"]).round(2)

    keep = ID + ["period_type", "units", "sales_eur", "market_share", "mshare_deviation",
                 "growth_py_sales", "growth_pp_sales",
                 "growth_py_units", "growth_pp_units",
                 "growth_vs_fcst_eur", "growth_vs_fcst_units",
                 "growth_py_mshare_dev", "growth_pp_mshare_dev"]
    chunks.append(sub[keep])

metrics = pd.concat(chunks, ignore_index=True)

# ── 7. Ranks: NTILE(100), ranked within year_month × period_type × brand ─────

def ntile100(s):
    return (s.rank(pct=True, na_option="keep") * 100).clip(1, 100).round().astype("Int64")

RANK_COLS = {
    "rank_units":           "units",
    "rank_sales_eur":       "sales_eur",
    "rank_mshare_dev":      "mshare_deviation",
    "rank_growth_py":       "growth_py_sales",
    "rank_growth_pp":       "growth_pp_sales",
    "rank_growth_vs_fcst_eur": "growth_vs_fcst_eur",
    "rank_growth_vs_fcst_units": "growth_vs_fcst_units",
    "rank_growth_py_mshare_dev": "growth_py_mshare_dev",
    "rank_growth_pp_mshare_dev": "growth_pp_mshare_dev",
}

rk_grp = ["year_month", "period_type", "brand_name"]
for rank_col, src_col in RANK_COLS.items():
    metrics[rank_col] = metrics.groupby(rk_grp)[src_col].transform(ntile100)

# ── 8. Rank trend ─────────────────────────────────────────────────────────────

metrics = metrics.sort_values(["brand_name", "region_name", "period_type", "year_month"]) \
                 .reset_index(drop=True)

metrics["rank_trend_3m"] = (
    metrics
    .groupby(["brand_name", "region_name", "period_type"])["rank_sales_eur"]
    .transform(lambda x: x.astype(float).diff(3).round().astype("Int64"))
)

# ── 9. Write to DB ────────────────────────────────────────────────────────────

con = sqlite3.connect(DB)
cur = con.cursor()
cur.execute("DROP TABLE IF EXISTS region_metrics")
con.commit()

metrics.to_sql("region_metrics", con, index=False, if_exists="replace", chunksize=10_000)

for col in ["year_month", "period_type", "franchise", "brand_name", "region_name", "territory_id"]:
    cur.execute(f"CREATE INDEX idx_rm_{col.replace('_','')} ON region_metrics({col})")
con.commit()
con.close()

# ── 10. Validation ────────────────────────────────────────────────────────────

print(f"region_metrics: {len(metrics):,} rows")
print(f"Grain: {len(months)} months × {len(brand_franchise)} brands × 4 periods × {len(rnames)} regions\n")

con2 = sqlite3.connect(DB)

print("── Top 10 Oncleris regions by sales, Month 2026-05 ──")
print(pd.read_sql("""
    SELECT brand_name, region_name, territory_name,
           units, ROUND(sales_eur) AS sales_eur,
           ROUND(market_share,1) AS mshare_pct,
           ROUND(growth_py_sales,1) AS gpy,
           rank_sales_eur AS rank, rank_trend_3m AS trend
    FROM region_metrics
    WHERE year_month='2026-05' AND period_type='Month' AND brand_name='Oncleris'
    ORDER BY rank_sales_eur DESC LIMIT 10
""", con2).to_string(index=False))

print("\n── Cardolux (declining) vs Veratenz (launch), Month view, national aggregate ──")
print(pd.read_sql("""
    SELECT brand_name, year_month,
           SUM(units) AS units, ROUND(SUM(sales_eur)) AS sales_eur,
           ROUND(AVG(growth_py_sales),1) AS avg_gpy,
           ROUND(AVG(growth_vs_fcst_eur),1) AS avg_growth_vs_fcst_eur
    FROM region_metrics
    WHERE period_type='Month'
      AND brand_name IN ('Cardolux','Veratenz')
      AND year_month IN ('2025-08','2025-11','2026-02','2026-05')
    GROUP BY brand_name, year_month
    ORDER BY brand_name, year_month
""", con2).to_string(index=False))

con2.close()
