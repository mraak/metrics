#!/usr/bin/env python3
"""
findings.py — Tier-4 Finding classifier (market-share trajectory × FCST attainment).

Composes a market-share-deviation signal (intrinsic: level + trajectory) with
RollQ forecast attainment (the second axis) into five named findings, each
graded by a combined severity that rises when BOTH axes are bad and still
fires on EITHER alone. Materiality (rank) is deliberately NOT a trigger — it
re-enters only at the Insight layer (per persona). See ANALYSIS_FRAMEWORK.md.

The five findings:
  bad_to_worse        — below average AND a clean worsening trend
  bad_not_improving   — below average AND stuck / drifting (no recovery)
  ok_sudden_drop      — near average BUT a sudden recent down-break
  good_sudden_drop    — above average BUT a sudden recent down-break
  bad_getting_better  — below average BUT recovering
"""

import server
import knowledge

# Tunable thresholds (pp on mshare_deviation; live in code so they're auditable).
THRESH = dict(GOOD=1.0, BAD=-3.0, NET_EPS=0.3, SUDDEN=-0.8, PRIOR_OK=-0.5, COH=0.5)

FINDINGS = {
    'bad_to_worse':       ('Bad → worse', 3),
    'bad_not_improving':  ('Bad & not improving', 2),
    'ok_sudden_drop':     ('OK-ish but suddenly deteriorating', 2),
    'good_sudden_drop':   ('Good but suddenly deteriorating', 2),
    'bad_getting_better': ('Bad but getting better', 1),
}
ORDER = ['bad_to_worse', 'bad_not_improving', 'ok_sudden_drop',
         'good_sudden_drop', 'bad_getting_better']


def classify(series, strength, t=THRESH):
    """Return (finding_id | None, level) for one region's mshare trajectory."""
    v3 = series[-1]
    net, rho = strength['net'], strength['coherence']
    last = series[-1] - series[-2]          # most recent monthly step
    prior = series[-2] - series[0]          # movement before that step
    level = 'good' if v3 > t['GOOD'] else 'bad' if v3 < t['BAD'] else 'ok'
    if level == 'bad':
        if net > t['NET_EPS']:
            return 'bad_getting_better', level
        if net < -t['NET_EPS'] and abs(rho) >= t['COH']:
            return 'bad_to_worse', level
        return 'bad_not_improving', level
    # ok / good: only flagged on a sudden recent down-break
    if last <= t['SUDDEN'] and prior >= t['PRIOR_OK']:
        return ('good_sudden_drop' if level == 'good' else 'ok_sudden_drop'), level
    return None, level


def fcst_severity(fc):
    """0 = meeting; 1/2/3 = missing forecast by <15 / 15-25 / >=25 pp."""
    if fc is None or fc >= 0:
        return 0
    a = -fc
    return 3 if a >= 25 else 2 if a >= 15 else 1


def severity(fid, strength, fc):
    """Combine market-share severity (finding base + loudness) with FCST severity."""
    base = FINDINGS[fid][1]
    if fid != 'bad_getting_better' and strength['magnitude'] >= 2.0:
        base += 1                            # a very loud move escalates
    fs = fcst_severity(fc)
    score = base + fs                        # "both or either": either axis adds
    band = ('critical' if score >= 5 else 'high' if score >= 3
            else 'moderate' if score >= 2 else 'low')
    return {'ms': base, 'fcst': fs, 'score': score, 'band': band}


def find_findings(brand, asof=None, signal='mshare_dev_mat_step_1m_3m'):
    con = server._conn()
    if not asof:
        asof = con.execute("SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
    terr = {r['region_name']: r['territory_name'] for r in con.execute(
        "SELECT DISTINCT region_name, territory_name FROM region_metrics WHERE brand_name=?",
        (brand,))}
    fcst = {r['region_name']: r['growth_vs_fcst_eur'] for r in con.execute(
        "SELECT region_name, growth_vs_fcst_eur FROM region_metrics "
        "WHERE brand_name=? AND period_type='RollQ' AND year_month=?", (brand, asof))}
    mshare = {r['region_name']: r['market_share'] for r in con.execute(
        "SELECT region_name, market_share FROM region_metrics "
        "WHERE brand_name=? AND period_type='MAT' AND year_month=?", (brand, asof))}
    con.close()

    sig = server.api_signals({"brand": [brand], "signal": [signal], "asof": [asof]})
    rows = []
    for r in sig['rows']:
        fid, level = classify(r['series'], r['strength'])
        if not fid:
            continue
        fc = fcst.get(r['region'])
        rows.append({
            'region': r['region'], 'territory': terr.get(r['region'], '—'),
            'finding': fid, 'label': FINDINGS[fid][0], 'level': level,
            'series': r['series'], 'now': r['now'], 'strength': r['strength'],
            'market_share': None if mshare.get(r['region']) is None else round(mshare[r['region']], 1),
            'mat_rank': r['mat_rank'],
            'fcst_rollq': None if fc is None else round(fc, 1),
            'fcst_meets': fc is not None and fc >= 0,
            'severity': severity(fid, r['strength'], fc),
        })
    rows.sort(key=lambda x: (-x['severity']['score'], ORDER.index(x['finding']), -x['mat_rank']))

    counts = {f: 0 for f in ORDER}
    for x in rows:
        counts[x['finding']] += 1
    summary = [{'finding': f, 'label': FINDINGS[f][0], 'count': counts[f]} for f in ORDER]
    territories = sorted(set(x['territory'] for x in rows))
    return {'brand': brand, 'asof': asof, 'count': len(rows),
            'summary': summary, 'territories': territories, 'rows': rows}


if __name__ == "__main__":
    import sys
    res = find_findings(sys.argv[1] if len(sys.argv) > 1 else "Oncleris")
    print(f"{res['brand']} @ {res['asof']}: {res['count']} findings")
    for s in res['summary']:
        print(f"  {s['label']:36} {s['count']}")
