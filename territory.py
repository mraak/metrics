#!/usr/bin/env python3
"""
territory.py — aggregate region metrics up to the TERRITORY grain and run the
same signal machinery on the territory-level market-share trajectory.

Why a separate layer: region_metrics is per region. The Sales Manager works at
the territory level, where total sales / growth / market-share deviation / FCST
attainment for the *whole* territory matter — and market share is NOT additive,
so it must be recomputed from summed own-vs-total franchise sales, not averaged.

Aggregation (per brand, MAT period, per year_month):
  own   = SUM(region sales_eur)
  total = SUM(region sales_eur * 100 / market_share)   # reconstruct franchise total
  territory MS        = own / total * 100
  mshare_deviation    = territory MS − national MS (same month)
  growth_py / growth_pp = from the territory MAT own-sales series
  growth_vs_fcst      = territory growth_py − national forecast growth
                        (forecast is national-only; recovered as a region's
                         growth_py_sales − growth_vs_fcst_eur)
The territory mshare_deviation series (asof-3..asof) feeds knowledge.signal_strength
and findings.classify, exactly like a region.
"""

from collections import defaultdict

import server
import knowledge
import findings


def _yms(con):
    return [r[0] for r in con.execute(
        "SELECT DISTINCT year_month FROM region_metrics ORDER BY year_month")]


def territory_metrics(brand, asof=None):
    defs = knowledge.load()
    con = server._conn()
    yms = _yms(con)
    if not asof:
        asof = yms[-1]
    i = yms.index(asof)

    rows = con.execute("""
        SELECT territory_name AS t, year_month AS ym,
               SUM(sales_eur) AS own, SUM(units) AS units,
               SUM(CASE WHEN market_share > 0 THEN sales_eur * 100.0 / market_share ELSE 0 END) AS total
        FROM region_metrics
        WHERE brand_name = ? AND period_type = 'MAT'
        GROUP BY territory_name, year_month
    """, (brand,)).fetchall()
    natrows = con.execute("""
        SELECT year_month AS ym, SUM(sales_eur) AS own,
               SUM(CASE WHEN market_share > 0 THEN sales_eur * 100.0 / market_share ELSE 0 END) AS total
        FROM region_metrics WHERE brand_name = ? AND period_type = 'MAT' GROUP BY year_month
    """, (brand,)).fetchall()
    nat_ms = {r['ym']: (r['own'] / r['total'] * 100 if r['total'] else 0) for r in natrows}
    # national forecast growth (same for every region of the brand) at asof
    fr = con.execute("""
        SELECT growth_py_sales, growth_vs_fcst_eur FROM region_metrics
        WHERE brand_name = ? AND period_type = 'MAT' AND year_month = ?
          AND growth_py_sales IS NOT NULL AND growth_vs_fcst_eur IS NOT NULL LIMIT 1
    """, (brand, asof)).fetchone()
    nat_fcst_growth = (fr['growth_py_sales'] - fr['growth_vs_fcst_eur']) if fr else None
    con.close()

    byT = defaultdict(dict)
    for r in rows:
        ms = (r['own'] / r['total'] * 100) if r['total'] else 0
        byT[r['t']][r['ym']] = {'own': r['own'], 'units': r['units'], 'ms': ms,
                                'dev': ms - nat_ms.get(r['ym'], 0)}

    out = []
    for t, series in byT.items():
        if asof not in series:
            continue
        cur = series[asof]
        at = lambda off: series.get(yms[i - off]) if 0 <= i - off < len(yms) else None
        py, pp = at(12), at(1)
        g_py = ((cur['own'] - py['own']) / py['own'] * 100) if py and py['own'] else None
        g_pp = ((cur['own'] - pp['own']) / pp['own'] * 100) if pp and pp['own'] else None
        gvf = (g_py - nat_fcst_growth) if (g_py is not None and nat_fcst_growth is not None) else None
        devser = [at(off)['dev'] if at(off) else None for off in (3, 2, 1, 0)]
        sig = fin = sev = None
        if all(x is not None for x in devser):
            devser = [round(x, 2) for x in devser]
            sig = knowledge.signal_strength(devser, direction='higher_is_better',
                                            defs=defs, kind='position')
            fid, _ = findings.classify(devser, sig)
            if fid:
                fin = fid
                sev = findings.severity(fid, sig, gvf)
        out.append({
            'territory': t,
            'mat_sales': round(cur['own']),
            'units': round(cur['units']),
            'growth_py': None if g_py is None else round(g_py, 1),
            'growth_pp': None if g_pp is None else round(g_pp, 1),
            'market_share': round(cur['ms'], 1),
            'mshare_deviation': round(cur['dev'], 2),
            'growth_vs_fcst': None if gvf is None else round(gvf, 1),
            'dev_series': devser if all(x is not None for x in devser) else None,
            'signal': sig,
            'finding': fin, 'finding_label': findings.FINDINGS[fin][0] if fin else None,
            'severity': sev,
        })
    out.sort(key=lambda x: -x['mat_sales'])
    return {'brand': brand, 'asof': asof,
            'national_fcst_growth': None if nat_fcst_growth is None else round(nat_fcst_growth, 1),
            'territories': out}


if __name__ == "__main__":
    import sys
    d = territory_metrics(sys.argv[1] if len(sys.argv) > 1 else "Oncleris")
    print(f"{d['brand']} @ {d['asof']}  (national fcst growth {d['national_fcst_growth']}pp)\n")
    print(f"{'territory':16}{'MAT sales':>12}{'YoY%':>7}{'PoP%':>7}{'MS%':>7}{'dev':>7}{'vsFCST':>8}  {'signal':>10}")
    for r in d['territories']:
        sh = f"{r['signal']['shape']}/{r['signal']['net']:+.1f}" if r['signal'] else '—'
        print(f"{r['territory'][:16]:16}{r['mat_sales']:>12,}{r['growth_py']:>7}{r['growth_pp']:>7}"
              f"{r['market_share']:>7}{r['mshare_deviation']:>7}{r['growth_vs_fcst']:>8}  {sh:>10}")
