#!/usr/bin/env python3
"""
server.py — local web-app server for the SQL-Metrics reporting app.

Serves schema.html (and other static files) AND a small live JSON API that
computes signals + strength on demand from metrics.db and the Knowledge
Definitions. No third-party deps; stdlib http.server only.

Endpoints:
  GET /                      -> schema.html
  GET /api/meta              -> brands, period types, signal templates, latest month
  GET /api/signals?...       -> per-region signal readout + strength + relevance
        params: signal (template id), brand, asof (year_month), period (override)

Run:  python3 server.py [port]   (default 8765)
"""

import json
import sqlite3
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import knowledge

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "metrics.db"
DEFAULT_SIGNAL = "mshare_dev_mat_step_1m_3m"


def _conn():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def _persistence_label(strength):
    """Human label for the coherence value."""
    rho = abs(strength["coherence"])
    if rho >= 0.6:
        return "consistent"
    if rho >= 0.3:
        return "mixed"
    return "oscillating"


def api_meta():
    defs = knowledge.load()
    con = _conn()
    try:
        brands = [r[0] for r in con.execute(
            "SELECT DISTINCT brand_name FROM region_metrics ORDER BY brand_name")]
        periods = [r[0] for r in con.execute(
            "SELECT DISTINCT period_type FROM region_metrics")]
        latest = con.execute(
            "SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
        franchises = {r["brand_name"]: r["franchise"] for r in con.execute(
            "SELECT DISTINCT brand_name, franchise FROM region_metrics")}
    finally:
        con.close()
    signals = [
        {"id": k, "metric": v["metric"], "period_type": v["period_type"],
         "interpretation": v.get("interpretation", "")}
        for k, v in defs["signal_templates"].items() if not k.startswith("_")
    ]
    return {"brands": brands, "periods": periods, "franchises": franchises,
            "signals": signals, "latest_ym": latest}


def api_signals(params):
    defs = knowledge.load()
    sig_id = params.get("signal", [DEFAULT_SIGNAL])[0]
    sig = defs["signal_templates"].get(sig_id)
    if not sig:
        return {"error": f"unknown signal '{sig_id}'"}
    con = _conn()
    try:
        brand = params.get("brand", [None])[0]
        if not brand:
            brand = con.execute("SELECT DISTINCT brand_name FROM region_metrics "
                                "ORDER BY brand_name LIMIT 1").fetchone()[0]
        asof = params.get("asof", [None])[0] or con.execute(
            "SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
        period = params.get("period", [sig["period_type"]])[0]
        franchise = con.execute(
            "SELECT franchise FROM region_metrics WHERE brand_name=? LIMIT 1",
            (brand,)).fetchone()
        franchise = franchise[0] if franchise else None
        mat_col = sig.get("materiality_from", "rank_sales_eur")

        sql = knowledge.compile_signal_sql(
            dict(sig, period_type=period), brand="?", partition_by_region=True)
        lags = sorted(sig["lags"], reverse=True)   # oldest -> now
        rows = con.execute(f"""
            WITH sig AS ({sql.rstrip(';')})
            SELECT s.*, r.{mat_col} AS mat
            FROM sig s
            JOIN region_metrics r
              ON r.region_name=s.region_name AND r.year_month=s.year_month
             AND r.brand_name=? AND r.period_type=?
            WHERE s.year_month=? AND s.m{lags[0]} IS NOT NULL
            ORDER BY r.{mat_col} DESC
        """, (brand, brand, period, asof)).fetchall()
    finally:
        con.close()

    out = []
    for r in rows:
        series = [r["now"] if lag == 0 else r[f"m{lag}"] for lag in lags]
        st = knowledge.signal_strength(series, direction=sig["direction"],
                                       defs=defs, kind=sig.get("strength_kind", "position"))
        rel = knowledge.relevance_score(
            defs, materiality_rank=r["mat"], magnitude_V=st["magnitude"],
            period_type=period, kind=sig.get("strength_kind", "position"))
        readout = {f"delta_{dl}m": round(r[f"delta_{dl}m"], 2)
                   for dl in knowledge._delta_lags(sig)}
        out.append({
            "region": r["region_name"],
            "now": round(r["now"], 2),
            "series": [round(x, 2) for x in series],
            "readout": readout,
            "mat_rank": r["mat"],
            "strength": st,
            "consistency": _persistence_label(st),
            "relevance": rel,
        })
    display_sql = knowledge.compile_signal_sql(
        dict(sig, period_type=period), brand=f"'{brand}'", partition_by_region=True)
    return {"signal": sig_id, "metric": sig["metric"], "period": period,
            "brand": brand, "franchise": franchise, "asof": asof,
            "interpretation": sig.get("interpretation", ""),
            "sql": display_sql, "rows": out}


def api_scatter(params):
    """Per-region snapshot of the two peer-relative deviations (MAT, current)
    for the share x growth quadrant plot."""
    con = _conn()
    try:
        brand = params.get("brand", [None])[0]
        if not brand:
            brand = con.execute("SELECT DISTINCT brand_name FROM region_metrics "
                                "ORDER BY brand_name LIMIT 1").fetchone()[0]
        period = params.get("period", ["MAT"])[0]
        asof = params.get("asof", [None])[0] or con.execute(
            "SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
        rows = con.execute("""
            SELECT region_name, territory_name, mshare_deviation, growth_deviation, rank_sales_eur
            FROM region_metrics
            WHERE brand_name=? AND period_type=? AND year_month=?
              AND mshare_deviation IS NOT NULL AND growth_deviation IS NOT NULL
        """, (brand, period, asof)).fetchall()
    finally:
        con.close()
    pts = [{"region": r["region_name"], "territory": r["territory_name"],
            "x": round(r["mshare_deviation"], 2), "y": round(r["growth_deviation"], 2),
            "rank": r["rank_sales_eur"]} for r in rows]
    return {"brand": brand, "period": period, "asof": asof, "points": pts}


def api_trails(params):
    """Per-region 4-month path in the share x growth plane (MAT m3..now)."""
    con = _conn()
    try:
        brand = params.get("brand", [None])[0]
        if not brand:
            brand = con.execute("SELECT DISTINCT brand_name FROM region_metrics "
                                "ORDER BY brand_name LIMIT 1").fetchone()[0]
        asof = params.get("asof", [None])[0] or con.execute(
            "SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
        rows = con.execute("""
            WITH s AS (
              SELECT region_name, territory_name, year_month, rank_sales_eur AS rk,
                mshare_deviation AS x0, LAG(mshare_deviation,1) OVER w AS x1,
                LAG(mshare_deviation,2) OVER w AS x2, LAG(mshare_deviation,3) OVER w AS x3,
                growth_deviation AS y0, LAG(growth_deviation,1) OVER w AS y1,
                LAG(growth_deviation,2) OVER w AS y2, LAG(growth_deviation,3) OVER w AS y3
              FROM region_metrics WHERE brand_name=? AND period_type='MAT'
              WINDOW w AS (PARTITION BY region_name ORDER BY year_month)
            ) SELECT * FROM s WHERE year_month=? AND x3 IS NOT NULL AND y3 IS NOT NULL
        """, (brand, asof)).fetchall()
    finally:
        con.close()
    rnd = lambda v: round(v, 2)
    out = [{"region": r["region_name"], "territory": r["territory_name"], "rank": r["rk"],
            "trail": [[rnd(r["x3"]), rnd(r["y3"])], [rnd(r["x2"]), rnd(r["y2"])],
                      [rnd(r["x1"]), rnd(r["y1"])], [rnd(r["x0"]), rnd(r["y0"])]]}
           for r in rows]
    return {"brand": brand, "asof": asof, "period": "MAT", "points": out}


def api_knowledge():
    """Expose the relevant Knowledge Definitions for the app's 'behind the
    scenes' views: signal interpretations, finding recipes, insight framings."""
    defs = knowledge.load()
    sig = {k: {"metric": v["metric"], "period_type": v["period_type"],
               "interpretation": v.get("interpretation", "")}
           for k, v in defs["signal_templates"].items() if not k.startswith("_")}
    rec = {k: {"label": v.get("label", k), "rule": v.get("rule", ""),
               "description": v.get("description", ""),
               "default_action": v.get("default_action", "")}
           for k, v in defs["finding_recipes"].items() if not k.startswith("_")}
    frm = {k: {"label": v.get("label", k), "scope": v.get("scope", ""),
               "cadence": v.get("cadence", ""), "decision": v.get("decision", ""),
               "surface_when": v.get("surface_when", ""),
               "suppress_when": v.get("suppress_when", ""), "tone": v.get("tone", "")}
           for k, v in defs["insight_framings"].items() if not k.startswith("_")}
    return {"signals": sig, "finding_recipes": rec, "insight_framings": frm}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.path = "/schema.html"
            return super().do_GET()
        if parsed.path.startswith("/api/"):
            params = parse_qs(parsed.query)
            try:
                if parsed.path == "/api/meta":
                    return self._send_json(api_meta())
                if parsed.path == "/api/signals":
                    return self._send_json(api_signals(params))
                if parsed.path == "/api/knowledge":
                    return self._send_json(api_knowledge())
                if parsed.path == "/api/scatter":
                    return self._send_json(api_scatter(params))
                if parsed.path == "/api/trails":
                    return self._send_json(api_trails(params))
                if parsed.path == "/api/findings":
                    import findings  # lazy: findings.py imports server
                    brand = params.get("brand", ["Oncleris"])[0]
                    return self._send_json(findings.find_findings(brand))
                if parsed.path == "/api/territory":
                    import territory  # lazy: imports server
                    brand = params.get("brand", ["Oncleris"])[0]
                    return self._send_json(territory.territory_metrics(brand))
                return self._send_json({"error": "unknown endpoint"}, 404)
            except Exception as e:  # surface errors as JSON for the app
                return self._send_json({"error": f"{type(e).__name__}: {e}"}, 500)
        return super().do_GET()

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"SQL-Metrics app on http://localhost:{port}  (Ctrl-C to stop)")
    ThreadingHTTPServer(("", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
