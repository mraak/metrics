#!/usr/bin/env python3
"""
signal_analysis.py — cross-metric loudness analysis for the Signal Analysis tab.

Intrinsic loudness (V = total variation of a signal's 4-point window) stays raw
and per-metric — it answers "how loud, in this metric's own terms". To compare
loudness ACROSS differently-scaled metrics we add two derived, comparable scores:

  vs_peers   — cross-sectional percentile of V among all regions this month,
               within (metric, period_type). "Loudest right now vs peers."
  vs_self    — robust z of current V against this region's OWN past V (median+MAD).
               "Unusually loud for this region" — high = it was calm historically.

The 2x2 of those two axes tags each (signal, region):
  Eruption  loud now AND unusual vs own history   (fresh disturbance — headline)
  Chronic   loud now BUT normal for this region    (always-noisy — de-prioritise)
  Stirring  not loud vs peers yet BUT unusual for itself (early/local)
  Quiet     neither

Composites combine several signals into one trajectory. Because you cannot add pp
to rank positions, each signal's steps are first standardized by that metric's
step-scale (MAD of one-month deltas), then composite loudness is the total
variation of the standardized N-D path. Intrinsic single-signal loudness is never
rescaled; standardization only happens for composites.
"""
import bisect
import statistics
from itertools import combinations

import server
import knowledge

DEFS = knowledge.load()
_LAGS = [3, 2, 1, 0]                       # oldest -> now (standardized 4-point basis)
LOUD_PCTL = 0.90                           # vs_peers >= this  => "loud now"
UNUSUAL_Z = 2.0                            # vs_self  >= this  => "unusual for itself"
_scale_cache = {}


def _signals():
    return {k: v for k, v in DEFS["signal_templates"].items() if not k.startswith("_")}


# ── Interpretation (plain-language read of a loud signal / composite) ─────────
_SHAPE_PHRASE = {
    "trend": "a clean directional move",
    "unstable": "a loud, directionless swing",
    "mixed": "a partial-direction move",
    "quiet": "little net movement",
}
_TAG_PHRASE = {
    "eruption": "loud vs peers and a break from its own calm history",
    "chronic": "loud vs peers but typical for this region",
    "stirring": "unusual for this region, not yet loud vs peers",
    "quiet": "",
}


def _dir_word(net, higher_is_better=True):
    if net == 0:
        return "flat"
    good = (net > 0) if higher_is_better else (net < 0)
    return "improving" if good else "deteriorating"


def interpret_single(direction, shape, tag, vs_self):
    if shape == "unstable":                       # oscillation: net direction is not meaningful
        base = "Swinging hard with no clear net direction"
    elif shape == "quiet":
        base = "Little net movement"
    else:                                          # trend / mixed: direction is meaningful
        base = f"{direction.capitalize()} on {_SHAPE_PHRASE.get(shape, 'a move')}"
    ctx = _TAG_PHRASE.get(tag, "")
    s = f"{base} — {ctx}" if ctx else base
    if vs_self is not None and vs_self >= UNUSUAL_Z and tag in ("eruption", "stirring"):
        s += f" (≈{vs_self:.0f}σ above its own normal)"
    return s + "."


def interpret_composite(comp_v, contrib):
    """contrib: {sid: {'loudness': x, 'dir': 'improving'|'deteriorating'|'flat'}}."""
    dirs = {c["dir"] for c in contrib.values() if c["dir"] != "flat"}
    top = max(contrib.items(), key=lambda kv: kv[1]["loudness"])
    if len(dirs) <= 1:
        agree = "reinforcing — components move the same way"
    else:
        agree = "divergent — components pull opposite ways"
    return (f"Loud composite ({comp_v:.1f}σ), {agree}; "
            f"driven mainly by {top[0]} ({top[1]['dir']}).")


def _v(series):
    """Total variation (loudness) of a value series, oldest -> now."""
    return sum(abs(series[i] - series[i - 1]) for i in range(1, len(series)))


def step_scale(con, metric, period_type):
    """Robust scale of the metric's one-month deltas (MAD), pooled over all
    brands/regions for this period_type. The unit that makes steps comparable
    across metrics. Cached per (metric, period_type)."""
    key = (metric, period_type)
    if key in _scale_cache:
        return _scale_cache[key]
    rows = con.execute(
        f"SELECT region_name, brand_name, {metric} AS v FROM region_metrics "
        f"WHERE period_type=? AND {metric} IS NOT NULL "
        f"ORDER BY brand_name, region_name, year_month", (period_type,)).fetchall()
    deltas, pk, pv = [], None, None
    for r in rows:
        k = (r["brand_name"], r["region_name"])
        if k == pk and pv is not None:
            deltas.append(r["v"] - pv)
        pk, pv = k, r["v"]
    if not deltas:
        scale = 1.0
    else:
        med = statistics.median(deltas)
        mad = statistics.median([abs(d - med) for d in deltas])
        scale = mad or (statistics.pstdev(deltas) if len(deltas) > 1 else 0.0) or 1.0
    _scale_cache[key] = scale
    return scale


def _windows(con, metric, brand, period):
    """Per region, every month's 4-point window of `metric` (m3..m0 = oldest..now)
    plus rank. Returns {region: [(year_month, [m3,m2,m1,m0], rank), ...]} sorted."""
    rows = con.execute(f"""
        WITH s AS (
          SELECT region_name, year_month, rank_sales_eur AS rk,
                 {metric} AS m0,
                 LAG({metric},1) OVER w AS m1,
                 LAG({metric},2) OVER w AS m2,
                 LAG({metric},3) OVER w AS m3
          FROM region_metrics
          WHERE brand_name=? AND period_type=?
          WINDOW w AS (PARTITION BY region_name ORDER BY year_month)
        ) SELECT * FROM s WHERE m3 IS NOT NULL ORDER BY region_name, year_month
    """, (brand, period)).fetchall()
    out = {}
    for r in rows:
        out.setdefault(r["region_name"], []).append(
            (r["year_month"], [r["m3"], r["m2"], r["m1"], r["m0"]], r["rk"]))
    return out


def analyze_signal(con, sig_id, sig, brand, asof):
    """Per-region loudness analysis for one signal at `asof`."""
    wins = _windows(con, sig["metric"], brand, sig["period_type"])
    kind = sig.get("strength_kind", "position")
    rows, v_now = [], []
    for region, hist in wins.items():
        cur = [h for h in hist if h[0] == asof]
        if not cur:
            continue
        _, series, rk = cur[0]
        Vnow = _v(series)
        past = [_v(h[1]) for h in hist if h[0] < asof]
        if len(past) >= 4:
            med = statistics.median(past)
            mad = statistics.median([abs(x - med) for x in past])
            vs_self = (Vnow - med) / mad if mad > 0 else (0.0 if Vnow <= med else 6.0)
        else:
            vs_self = None
        st = knowledge.signal_strength(series, direction=sig["direction"], defs=DEFS, kind=kind)
        rows.append({"region": region, "rank": rk, "series": [round(x, 2) for x in series],
                     "loudness": round(Vnow, 3), "net_change": st["net"],
                     "consistency": st["coherence"], "shape": st["shape"],
                     "direction": st["direction"],
                     "_V": Vnow, "vs_self": None if vs_self is None else round(vs_self, 2)})
        v_now.append(Vnow)
    srt = sorted(v_now)
    n = len(srt) or 1
    for r in rows:
        r["vs_peers"] = round(bisect.bisect_right(srt, r["_V"]) / n, 3)
        r["tag"] = _tag(r["vs_peers"], r["vs_self"])
        r["read"] = interpret_single(r["direction"], r["shape"], r["tag"], r["vs_self"])
        del r["_V"]
    rows.sort(key=lambda x: (-x["vs_peers"], -(x["vs_self"] or -9)))
    return {"signal": sig_id, "metric": sig["metric"], "period": sig["period_type"],
            "kind": kind, "rows": rows}


def _tag(vs_peers, vs_self):
    loud_now = vs_peers >= LOUD_PCTL
    unusual = vs_self is not None and vs_self >= UNUSUAL_Z
    if loud_now and unusual:
        return "eruption"
    if loud_now:
        return "chronic"
    if unusual:
        return "stirring"
    return "quiet"


def analyze_all(brand=None, asof=None):
    """All signals x regions at `asof`, returned as one list ranked by the
    metric-comparable vs_peers (then vs_self). The UI slices this to the chosen
    Top-X%, so changing the dropdown needs no refetch."""
    con = server._conn()
    try:
        if not brand:
            brand = con.execute("SELECT DISTINCT brand_name FROM region_metrics "
                                "ORDER BY brand_name LIMIT 1").fetchone()[0]
        if not asof:
            asof = con.execute("SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
        per_signal = [analyze_signal(con, sid, s, brand, asof) for sid, s in _signals().items()]
    finally:
        con.close()
    flat = []
    for blk in per_signal:
        for r in blk["rows"]:
            flat.append({**r, "signal": blk["signal"], "metric": blk["metric"],
                         "period": blk["period"]})
    flat.sort(key=lambda x: (-x["vs_peers"], -(x["vs_self"] or -9)))
    return {"brand": brand, "asof": asof, "total": len(flat), "ranked": flat,
            "tag_legend": {"eruption": "loud now AND unusual vs own history",
                           "chronic": "loud now but normal for this region",
                           "stirring": "rising vs its own baseline, not yet loud vs peers",
                           "quiet": "nothing to surface"}}


# ── Composites ───────────────────────────────────────────────────────────────

def _std_steps(con, sig, brand):
    """Per region: this signal's standardized step vector at `asof` is built
    lazily; here we return {region: {year_month: [z-steps oldest->now]}} for all
    months, so composites can align by month. Steps = deltas / metric step-scale."""
    scale = step_scale(con, sig["metric"], sig["period_type"])
    wins = _windows(con, sig["metric"], brand, sig["period_type"])
    out = {}
    for region, hist in wins.items():
        by_ym = {}
        for ym, series, _ in hist:
            steps = [(series[i] - series[i - 1]) / scale for i in range(1, len(series))]
            by_ym[ym] = steps
        out[region] = by_ym
    return out


def _composite_rows(con, sig_ids, brand, asof):
    """Composite loudness per region for a set of signals at `asof`, with each
    signal's standardized contribution (for interrogation)."""
    sigs = _signals()
    steps_by_sig = {sid: _std_steps(con, sigs[sid], brand) for sid in sig_ids}
    # regions present in every selected signal at asof
    region_sets = []
    for sid in sig_ids:
        region_sets.append({rg for rg, ym in steps_by_sig[sid].items() if asof in ym})
    common = set.intersection(*region_sets) if region_sets else set()
    rows = []
    for rg in common:
        per_step = None
        contrib = {}
        for sid in sig_ids:
            z = steps_by_sig[sid][rg][asof]                    # list of z-steps
            hib = sigs[sid]["direction"] == "higher_is_better"
            contrib[sid] = {"loudness": round(sum(abs(s) for s in z), 3),  # own loudness (z units)
                            "dir": _dir_word(sum(z), hib)}                  # signed net direction
            if per_step is None:
                per_step = [[s] for s in z]
            else:
                for i, s in enumerate(z):
                    per_step[i].append(s)
        comp_V = sum(sum(s * s for s in vec) ** 0.5 for vec in per_step)  # N-D total variation
        rows.append({"region": rg, "composite_loudness": round(comp_V, 3),
                     "contrib": contrib, "read": interpret_composite(comp_V, contrib)})
    rows.sort(key=lambda x: -x["composite_loudness"])
    return rows


def composite(sig_ids, brand=None, asof=None, top_pct=0.05):
    con = server._conn()
    try:
        if not brand:
            brand = con.execute("SELECT DISTINCT brand_name FROM region_metrics "
                                "ORDER BY brand_name LIMIT 1").fetchone()[0]
        if not asof:
            asof = con.execute("SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
        rows = _composite_rows(con, sig_ids, brand, asof)
    finally:
        con.close()
    k = max(1, int(len(rows) * top_pct))
    return {"brand": brand, "asof": asof, "signals": sig_ids,
            "rows": rows, "top_loudest": rows[:k]}


def search(brand=None, asof=None, max_k=3, summary_pctl=0.95):
    """Auto-search: which signal combinations (size 2..max_k) produce the loudest
    composites? Rank combos by how loud their loudest regions get (the
    summary_pctl of composite loudness across regions)."""
    con = server._conn()
    try:
        if not brand:
            brand = con.execute("SELECT DISTINCT brand_name FROM region_metrics "
                                "ORDER BY brand_name LIMIT 1").fetchone()[0]
        if not asof:
            asof = con.execute("SELECT MAX(year_month) FROM region_metrics").fetchone()[0]
        ids = list(_signals().keys())
        combos = []
        for k in range(2, max_k + 1):
            for combo in combinations(ids, k):
                rows = _composite_rows(con, list(combo), brand, asof)
                if not rows:
                    continue
                vals = sorted(r["composite_loudness"] for r in rows)
                idx = min(len(vals) - 1, int(len(vals) * summary_pctl))
                combos.append({"signals": list(combo), "size": k,
                               "loudness_p95": round(vals[idx], 3),
                               "max_loudness": rows[0]["composite_loudness"],
                               "top_regions": [r["region"] for r in rows[:3]]})
    finally:
        con.close()
    combos.sort(key=lambda c: -c["loudness_p95"])
    return {"brand": brand, "asof": asof, "max_k": max_k, "combos": combos}


if __name__ == "__main__":
    import json as _json
    print(_json.dumps(analyze_all(), indent=2)[:2000])
