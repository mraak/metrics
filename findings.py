#!/usr/bin/env python3
"""
findings.py — Tier-4 Finding classifier on the SHARE × GROWTH quadrant.

Two peer-relative axes, both read as level + trajectory over the same MAT window:
  • position  = mshare_deviation  (region market share − volume-weighted national)
  • momentum  = growth_deviation  (region YoY growth − volume-weighted national YoY)

A region's finding is its quadrant (by current level); severity rises with how
bad / deteriorating each axis is (ms_sev + growth_sev). No FCST at region level
(there is no regional forecast). Materiality (rank) is NOT a trigger — it
re-enters per persona at the Insight layer. See ANALYSIS_FRAMEWORK.md.

  losing_both — below peers on BOTH share and growth        (the red cell)
  slipping    — ahead on share BUT under-growing             (momentum risk)
  catching_up — below on share BUT out-growing               (recovering)
  star        — ahead on both                                (fine)
"""

import json
import server
import knowledge

# ── Findings catalog (persistent store) ─────────────────────────────────────
_DDL = """
CREATE TABLE IF NOT EXISTS findings_catalog (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_name    TEXT    NOT NULL,
    region_name   TEXT    NOT NULL,
    territory_name TEXT   NOT NULL,
    year_month    TEXT    NOT NULL,   -- the asof period this finding describes
    recorded_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    finding       TEXT    NOT NULL,   -- losing_both / slipping / catching_up / star
    severity_band TEXT    NOT NULL,   -- critical / high / moderate / low
    severity_score INTEGER NOT NULL,  -- 0-6
    ms_now        REAL,               -- mshare_deviation at asof
    ms_sev        INTEGER,            -- 0-3
    growth_now    REAL,               -- growth_deviation at asof
    growth_sev    INTEGER,            -- 0-3
    mat_rank      INTEGER,
    market_share  REAL,
    months_red    INTEGER DEFAULT 0,
    escalate      INTEGER DEFAULT 0,  -- 0/1
    improved      INTEGER DEFAULT 0,  -- 0/1
    provenance    TEXT                -- JSON: series + strength for both axes
);
CREATE UNIQUE INDEX IF NOT EXISTS findings_catalog_pk
    ON findings_catalog(brand_name, region_name, year_month);
"""

def _ensure_table(con):
    for stmt in _DDL.strip().split(';'):
        s = stmt.strip()
        if s:
            con.execute(s)
    con.commit()


def save_findings(rows, brand, asof, force=False):
    """Write finding rows to the catalog.
    INSERT OR IGNORE by default (first write wins — immutable history).
    Pass force=True to overwrite (development / re-seed).
    Returns (inserted, skipped).
    """
    con = server._conn()
    _ensure_table(con)
    verb = 'INSERT OR REPLACE' if force else 'INSERT OR IGNORE'
    inserted = skipped = 0
    for r in rows:
        prov = json.dumps({
            'ms_series':       r['series'],
            'ms_strength':     r['strength'],
            'growth_series':   r['growth_series'],
            'growth_strength': r['growth_strength'],
        })
        cur = con.execute(f"""
            {verb} INTO findings_catalog
                (brand_name, region_name, territory_name, year_month,
                 finding, severity_band, severity_score,
                 ms_now, ms_sev, growth_now, growth_sev,
                 mat_rank, market_share, months_red, escalate, improved,
                 provenance)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (brand, r['region'], r['territory'], asof,
              r['finding'], r['severity']['band'], r['severity']['score'],
              r['now'], r['severity']['ms'],
              r['growth_now'], r['severity']['growth'],
              r['mat_rank'], r['market_share'],
              r.get('months_red', 0),
              1 if r.get('escalate') else 0,
              1 if r.get('improved') else 0,
              prov))
        if cur.rowcount:
            inserted += 1
        else:
            skipped += 1
    con.commit()
    con.close()
    return inserted, skipped


def catalog_stats():
    """Total rows and distinct brand/asof pairs stored in the catalog."""
    con = server._conn()
    _ensure_table(con)
    r = con.execute(
        "SELECT COUNT(*) AS n, COUNT(DISTINCT brand_name||'|'||year_month) AS periods "
        "FROM findings_catalog").fetchone()
    con.close()
    return {'total_rows': r['n'], 'periods': r['periods']}


def region_history(brand, region):
    """Finding history for one region, oldest-first."""
    con = server._conn()
    _ensure_table(con)
    rows = con.execute("""
        SELECT year_month, finding, severity_band, severity_score,
               ms_now, growth_now, mat_rank, months_red, escalate, improved, provenance
        FROM findings_catalog
        WHERE brand_name=? AND region_name=?
        ORDER BY year_month
    """, (brand, region)).fetchall()
    con.close()
    return [dict(r) for r in rows]

FINDINGS = {
    'losing_both': ('Losing on both', 3),
    'slipping':    ('Slipping', 2),
    'catching_up': ('Catching up', 1),
    'star':        ('Star', 0),
}
ORDER = ['losing_both', 'slipping', 'catching_up', 'star']
RED = {'losing_both'}        # what counts as "red" for the month-over-month memory


def classify(ms_now, gr_now):
    """Quadrant by current level: below peers (<0) vs ahead (>=0) on each axis."""
    ms_bad, gr_bad = ms_now < 0, gr_now < 0
    if ms_bad and gr_bad:
        return 'losing_both'
    if (not ms_bad) and gr_bad:
        return 'slipping'
    if ms_bad and (not gr_bad):
        return 'catching_up'
    return 'star'


def _axis_sev(now, sig, kind, defs):
    """0=fine · 1=below OR deteriorating · 2=below AND deteriorating · 3=+loud."""
    loud = defs['signal_strength']['loudness_bands_pp'][kind]['loud']
    below = now < 0
    deteriorating = sig['net'] < -0.3
    s = (1 if below else 0) + (1 if deteriorating else 0)
    if below and deteriorating and sig['magnitude'] >= loud:
        s += 1
    return min(3, s)


def severity(ms_now, ms_sig, gr_now, gr_sig, defs):
    msv = _axis_sev(ms_now, ms_sig, 'position', defs)
    grv = _axis_sev(gr_now, gr_sig, 'growth', defs)
    score = msv + grv                         # 0..6
    band = ('critical' if score >= 5 else 'high' if score >= 3
            else 'moderate' if score >= 2 else 'low')
    return {'ms': msv, 'growth': grv, 'score': score, 'band': band}


def _history(brand, asof, defs):
    """Per region: is it 'red' (losing_both) this month / -1m / -2m, on both axes?
    months_red (consecutive ending now), improved (was red, not now), escalate (3)."""
    con = server._conn()
    mlags = ", ".join(f"LAG(mshare_deviation,{k}) OVER w AS mx{k}" for k in range(1, 6))
    glags = ", ".join(f"LAG(growth_deviation,{k}) OVER w AS gx{k}" for k in range(1, 6))
    rows = con.execute(f"""
        WITH s AS (
          SELECT region_name, territory_name, year_month, rank_sales_eur AS rk,
                 mshare_deviation AS mx0, {mlags},
                 growth_deviation AS gx0, {glags}
          FROM region_metrics WHERE brand_name=? AND period_type='MAT'
          WINDOW w AS (PARTITION BY region_name ORDER BY year_month)
        ) SELECT * FROM s WHERE year_month=?
    """, (brand, asof)).fetchall()
    con.close()

    hist = {}
    for r in rows:
        mx = [r['mx0'], r['mx1'], r['mx2'], r['mx3'], r['mx4'], r['mx5']]
        gx = [r['gx0'], r['gx1'], r['gx2'], r['gx3'], r['gx4'], r['gx5']]
        reds = []
        for k in range(3):                                  # now, -1m, -2m
            mwin, gwin = mx[k:k + 4], gx[k:k + 4]            # now..oldest
            if any(v is None for v in mwin) or any(v is None for v in gwin):
                reds.append(None); continue
            ms_ser = [round(v, 2) for v in reversed(mwin)]  # oldest -> now
            gr_ser = [round(v, 2) for v in reversed(gwin)]
            ms_st = knowledge.signal_strength(ms_ser, defs=defs, kind='position')
            gr_st = knowledge.signal_strength(gr_ser, defs=defs, kind='growth')
            sev = severity(ms_ser[-1], ms_st, gr_ser[-1], gr_st, defs)
            # "red" = losing_both AND deteriorating (band >= high)
            reds.append(classify(ms_ser[-1], gr_ser[-1]) in RED and sev['score'] >= 3)
        months_red = 0
        for v in reds:
            if v is True:
                months_red += 1
            else:
                break
        hist[r['region_name']] = {
            'months_red': months_red, 'improved': (reds[1] is True) and (reds[0] is not True),
            'escalate': months_red >= 3, 'red_now': reds[0] is True,
            'rank': r['rk'], 'territory': r['territory_name'],
        }
    return hist


def find_findings(brand, asof=None, force=False):
    defs = knowledge.load()
    p_ms = {"brand": [brand], "signal": ["mshare_dev_mat_step_1m_3m"]}
    p_gr = {"brand": [brand], "signal": ["growth_deviation_mat_step_1m_3m"]}
    if asof:
        p_ms["asof"] = [asof]; p_gr["asof"] = [asof]
    ms = server.api_signals(p_ms)
    gr = server.api_signals(p_gr)
    asof = ms['asof']
    grby = {r['region']: r for r in gr['rows']}

    con = server._conn()
    terr = {r['region_name']: r['territory_name'] for r in con.execute(
        "SELECT DISTINCT region_name, territory_name FROM region_metrics WHERE brand_name=?", (brand,))}
    mshare = {r['region_name']: r['market_share'] for r in con.execute(
        "SELECT region_name, market_share FROM region_metrics "
        "WHERE brand_name=? AND period_type='MAT' AND year_month=?", (brand, asof))}
    con.close()

    rows = []
    for r in ms['rows']:
        g = grby.get(r['region'])
        if not g:
            continue
        fid = classify(r['now'], g['now'])
        sev = severity(r['now'], r['strength'], g['now'], g['strength'], defs)
        rows.append({
            'region': r['region'], 'territory': terr.get(r['region'], '—'),
            'finding': fid, 'label': FINDINGS[fid][0],
            'now': r['now'], 'series': r['series'], 'strength': r['strength'],          # share axis
            'growth_now': g['now'], 'growth_series': g['series'], 'growth_strength': g['strength'],  # growth axis
            'market_share': None if mshare.get(r['region']) is None else round(mshare[r['region']], 1),
            'mat_rank': r['mat_rank'],
            'severity': sev,
        })
    rows.sort(key=lambda x: (-x['severity']['score'], ORDER.index(x['finding']), -x['mat_rank']))

    hist = _history(brand, asof, defs)
    flagged = {r['region'] for r in rows}
    for r in rows:
        h = hist.get(r['region'], {})
        r['months_red'] = h.get('months_red', 1 if r['finding'] in RED else 0)
        r['improved'] = h.get('improved', False)
        r['escalate'] = h.get('escalate', False)
    recovered = sorted(
        ({'region': rg, 'territory': h['territory'], 'rank': h['rank']}
         for rg, h in hist.items() if h['improved'] and rg not in flagged),
        key=lambda x: -x['rank'])

    counts = {f: 0 for f in ORDER}
    for x in rows:
        counts[x['finding']] += 1
    summary = [{'finding': f, 'label': FINDINGS[f][0], 'count': counts[f]} for f in ORDER]
    territories = sorted(set(x['territory'] for x in rows))

    # persist to catalog (INSERT OR IGNORE = first write wins; pass force=True to overwrite)
    inserted, skipped = save_findings(rows, brand, asof, force=force)
    stats = catalog_stats()

    return {'brand': brand, 'asof': asof, 'count': len(rows),
            'summary': summary, 'territories': territories, 'rows': rows,
            'recovered': recovered,
            'catalog': {'inserted': inserted, 'skipped': skipped,
                        'total_rows': stats['total_rows'],
                        'periods': stats['periods']}}


if __name__ == "__main__":
    import sys
    force = '--force' in sys.argv
    brand = next((a for a in sys.argv[1:] if not a.startswith('--')), "Oncleris")
    res = find_findings(brand, force=force)
    cat = res['catalog']
    print(f"{res['brand']} @ {res['asof']}: {res['count']} regions")
    for s in res['summary']:
        print(f"  {s['label']:16} {s['count']}")
    print(f"\nCatalog: inserted={cat['inserted']} skipped={cat['skipped']} "
          f"total={cat['total_rows']} rows across {cat['periods']} brand/period pairs")
