"""
generate_report.py
Produces problem_report.html — franchise-tabbed regional problem report.

Layout per franchise tab:
  • Composite problem summary (tag combinations, not individual counts)
  • Territory heatmap strip (T01-T12 coloured by max severity)
  • Per-territory sections with full region cards
"""

import sqlite3, pandas as pd, numpy as np
from collections import defaultdict, Counter

DB     = "metrics.db"
OUTPUT = "problem_report.html"

# ── Reference data ────────────────────────────────────────────────────────────

ALL_TERRITORIES = [
    ("T01","Genève"),("T02","Vaud-Léman"),("T03","Vaud-Nord"),
    ("T04","Valais"),("T05","Arc Jurassien"),("T06","Bern"),
    ("T07","Nordwestschweiz"),("T08","Zürich-Stadt"),("T09","Zürich-Region"),
    ("T10","Ticino"),("T11","Aargau-Luzern"),("T12","Ostschweiz"),
]
FRANCHISES = ["Antiviral","Cardiovascular","Neurology","Oncology","Respiratory"]

FC = {   # accent colour (works on white bg)
    "Antiviral":      "#2980b9",
    "Cardiovascular": "#c0392b",
    "Neurology":      "#7d3c98",
    "Oncology":       "#b7950b",
    "Respiratory":    "#1e8449",
}

# tag: (icon, label, text-colour, bg-colour, border-colour)
TAG = {
    "whale_declining": ("🐋","Vol+Decline", "#92400e","#fef3c7","#f59e0b"),
    "long_slide":      ("📉","Long Slide",  "#991b1b","#fef2f2","#f87171"),
    "sudden_drop":     ("⚡","Sudden Drop", "#5b21b6","#f5f3ff","#a78bfa"),
    "missing_plan":    ("🎯","Miss FCST",   "#1e3a8a","#eff6ff","#60a5fa"),
}

# ── Load ──────────────────────────────────────────────────────────────────────

con = sqlite3.connect(DB)
df = pd.read_sql("""
    SELECT year_month, brand_name, franchise, region_name,
           territory_name, territory_id,
           sales_eur, units, market_share, mshare_deviation,
           growth_py_sales, growth_vs_fcst_eur,
           rank_sales_eur, rank_trend_3m
    FROM region_metrics
    WHERE period_type='RollQ' AND year_month >= '2025-05'
    ORDER BY brand_name, region_name, year_month
""", con)
con.close()

MONTHS = sorted(df.year_month.unique())
LATEST = MONTHS[-1]

# ── Score & tag every (brand, region) ────────────────────────────────────────

def safe(v, d=0):
    return d if (v is None or (isinstance(v, float) and np.isnan(v))) else v

MAX_PER_FRANCHISE = 15   # show at most this many per franchise tab

# ── Brand-level baseline: median growth_py per brand in latest month ─────────
# Used to make "long_slide" relative: is this region worse than brand average?

brand_medians = (
    df[df.year_month == LATEST]
    .groupby("brand_name")["growth_py_sales"]
    .median()
    .to_dict()
)

ALL_RECORDS = []

for (brand, region), grp in df.groupby(["brand_name","region_name"]):
    grp = grp.sort_values("year_month").reset_index(drop=True)
    lat_r = grp[grp.year_month == LATEST]
    if lat_r.empty or lat_r.iloc[0].sales_eur == 0: continue
    lat = lat_r.iloc[0]

    g_series = grp.growth_py_sales.tolist()

    consec = 0
    for v in reversed(g_series):
        if pd.isna(v) or v >= 0: break
        consec += 1

    avg_g3   = grp.tail(3).growth_py_sales.mean()
    avg_g6   = grp.tail(6).growth_py_sales.mean()
    avg_gvf3  = grp.tail(3).growth_vs_fcst_eur.mean()
    worst_sw = grp.rank_trend_3m.min()

    lat_rank  = safe(lat.rank_sales_eur)
    avg_g3v   = safe(avg_g3)
    avg_gvf3v  = safe(avg_gvf3)
    worst_swv = safe(worst_sw)

    # Brand median growth — used to distinguish "structurally bad brand" vs
    # "this specific region is worse than peers"
    brand_median = safe(brand_medians.get(brand, 0))
    # How much worse is this region vs the brand median? (negative = worse)
    relative_g3 = avg_g3v - brand_median   # negative means below-average for brand

    # Volume is the primary lens — small regions simply don't matter much.
    # Score is quadratic in rank so rank-90 gets 4× the weight of rank-45.
    vol_factor = (lat_rank / 100) ** 1.5   # 0.0 – 1.0, strongly non-linear

    score = (
        vol_factor * 60                           # volume importance (dominant term)
        + max(0, -avg_g3v)   * 0.5 * (0.3 + vol_factor)   # growth penalty ∝ volume
        + max(0, -relative_g3) * 0.5 * (0.3 + vol_factor)  # vs-brand penalty ∝ volume
        + consec * 2.0 * (0.4 + vol_factor)      # persistence ∝ volume
        + max(0, -worst_swv) * 0.3
        + max(0, -avg_gvf3v)  * 0.2
    )

    # Hard floor: skip regions too small to matter (bottom third of volume)
    if lat_rank < 35: continue

    tags = []
    # Whale declining: top-volume region AND worse than brand peers AND absolutely negative
    if lat_rank >= 75 and avg_g3v < -2 and relative_g3 < -3:
        tags.append("whale_declining")
    # Long slide: 5+ consecutive months AND clearly below brand median
    if consec >= 5 and relative_g3 < -4:
        tags.append("long_slide")
    # Sudden drop: sharp rank collapse (rank-based, already relative per brand)
    if worst_swv <= -18:
        tags.append("sudden_drop")
    # Missing plan: well below forecast, more stringent threshold
    if avg_gvf3v <= -12:
        tags.append("missing_plan")

    if not tags: continue

    def fmt(v): return round(float(v),1) if not pd.isna(v) else None

    ALL_RECORDS.append(dict(
        brand=brand, franchise=str(lat.franchise),
        region=region, territory=str(lat.territory_name),
        territory_id=str(lat.territory_id),
        score=round(score, 1),
        latest_sales=round(float(lat.sales_eur), 0),
        latest_rank=int(lat_rank) if lat_rank else None,
        latest_growth=fmt(lat.growth_py_sales),
        latest_mshare_dev=fmt(lat.mshare_deviation),
        latest_growth_vs_fcst=fmt(lat.growth_vs_fcst_eur),
        avg_g3=fmt(avg_g3), avg_g6=fmt(avg_g6), avg_gvf3=fmt(avg_gvf3),
        consec_neg=consec,
        worst_swing=int(worst_swv) if worst_swv else 0,
        tags=tags,
        g_series=[fmt(v) for v in g_series],
        months=MONTHS,
    ))

ALL_RECORDS.sort(key=lambda x: -x["score"])
GLOBAL_RANK = {id(r): i+1 for i, r in enumerate(ALL_RECORDS)}

# Cap per franchise — keep the worst MAX_PER_FRANCHISE regions per franchise
_seen = defaultdict(int)
_capped = []
for r in ALL_RECORDS:
    if _seen[r["franchise"]] < MAX_PER_FRANCHISE:
        _capped.append(r)
        _seen[r["franchise"]] += 1
ALL_RECORDS = _capped

# ── Narrative ─────────────────────────────────────────────────────────────────

def narrative(r):
    brand=r["brand"]; region=r["region"]; g3=r["avg_g3"]; g6=r["avg_g6"]
    consec=r["consec_neg"]; swing=r["worst_swing"]; rank=r["latest_rank"]
    gvf3=r["avg_gvf3"]; tags=r["tags"]; sales=r["latest_sales"]
    s = []
    vol = "top-tier" if rank and rank>=85 else ("significant" if rank and rank>=65 else "mid-tier")
    s.append(f"{region} is a {vol} {brand} region (rank {rank}/100, €{sales:,.0f}/mo as of {LATEST}).")
    if "long_slide" in tags and consec >= 8:
        s.append(f"Negative growth for {consec} straight months with no recovery attempt visible.")
    elif "long_slide" in tags:
        s.append(f"Negative growth for {consec} consecutive months — decline appears structural.")
    if "whale_declining" in tags:
        s.append(f"At this volume, the {g3}% rolling-quarter average causes disproportionate absolute revenue loss.")
    if "sudden_drop" in tags and swing and abs(swing) >= 20:
        s.append(f"Sharpest rank collapse in its brand portfolio: −{abs(swing)} positions — acute event, not gradual erosion.")
    elif "sudden_drop" in tags:
        s.append(f"Rank dropped {abs(swing) if swing else '?'} positions recently — watch for further deterioration.")
    if "missing_plan" in tags and gvf3 is not None:
        s.append(f"{abs(gvf3):.1f}pp below national forecast growth on rolling-quarter average — plan signal was there but region isn't responding.")
    if g6 and g6 < -8:
        s.append(f"6-quarter rolling average of {g6}% confirms this is structural, not noise.")
    if "long_slide" in tags and "whale_declining" in tags: s.append("Priority intervention recommended.")
    elif "sudden_drop" in tags and "long_slide" not in tags: s.append("Monitor closely — potential early warning of a longer slide.")
    elif "long_slide" in tags: s.append("Root-cause needed: why no correction over this many months?")
    return " ".join(s)

for r in ALL_RECORDS:
    r["narrative"] = narrative(r)

# ── HTML primitives ───────────────────────────────────────────────────────────

def gc(v):
    return "#9ca3af" if v is None else ("#dc2626" if v < 0 else "#16a34a")

def tag_badge(tag, small=False):
    ic, lb, tcol, bg, border = TAG[tag]
    fs = "10px" if small else "11px"
    return (f'<span class="badge" style="background:{bg};color:{tcol};border:1px solid {border};'
            f'font-size:{fs}">{ic} {lb}</span>')

def sparkline(g_series, W=220, H=56):
    vals = [(i,v) for i,v in enumerate(g_series) if v is not None]
    if len(vals) < 2: return ""
    ys = [v for _,v in vals]; n = len(g_series)
    mn, mx = min(ys+[0]), max(ys+[0]); rng = mx-mn or 1
    p = 6
    def px(i): return p + i/(n-1)*(W-2*p)
    def py(v): return H-p-(v-mn)/rng*(H-2*p)
    y0 = py(0)
    pts = [(px(i), py(v)) for i,v in vals]
    area = "M"+" L".join(f"{x:.1f},{y:.1f}" for x,y in pts)
    area += f" L{pts[-1][0]:.1f},{y0:.1f} L{pts[0][0]:.1f},{y0:.1f} Z"
    line = "M"+" L".join(f"{x:.1f},{y:.1f}" for x,y in pts)
    neg_r = sum(1 for v in ys if v<0)/len(ys)
    fc2, lc = ("#fee2e2","#dc2626") if neg_r>0.5 else ("#dcfce7","#16a34a")
    lx,ly = pts[-1]; dc = "#dc2626" if ys[-1]<0 else "#16a34a"
    return (f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" style="display:block">'
            f'<line x1="{p}" y1="{y0:.1f}" x2="{W-p}" y2="{y0:.1f}" stroke="#e5e7eb" stroke-width="1"/>'
            f'<path d="{area}" fill="{fc2}" opacity="0.7"/>'
            f'<path d="{line}" fill="none" stroke="{lc}" stroke-width="2"/>'
            f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="3" fill="{dc}"/>'
            f'<text x="{p}" y="{H}" font-size="8" fill="#9ca3af" text-anchor="middle">{MONTHS[0][2:]}</text>'
            f'<text x="{W-p}" y="{H}" font-size="8" fill="#9ca3af" text-anchor="middle">{MONTHS[-1][2:]}</text>'
            f'</svg>')

def severity(tags):
    n = len(tags)
    if n >= 3: return "CRITICAL",  "#dc2626", "#fff5f5"
    if n == 2: return "HIGH RISK", "#d97706", "#fffbeb"
    return             "WATCH",    "#6b7280", "#f9fafb"

# ── Franchise-level intro ─────────────────────────────────────────────────────

def franchise_intro(franchise, regions, by_terr):
    if not regions: return ""
    n      = len(regions)
    n_terr = len([t for t,rs in by_terr.items() if rs])
    multi  = sum(1 for r in regions if len(r["tags"]) >= 2)
    best   = regions[0]   # highest score

    # Dominant tag across all regions
    all_tags  = [t for r in regions for t in r["tags"]]
    tag_counts = Counter(all_tags)
    dom_tag    = tag_counts.most_common(1)[0][0] if tag_counts else None
    dom_label  = TAG[dom_tag][0] + " " + TAG[dom_tag][1] if dom_tag else ""

    # Worst territory by cumulative score
    terr_scores = {t: sum(r["score"] for r in rs) for t, rs in by_terr.items() if rs}
    worst_tid   = max(terr_scores, key=terr_scores.get) if terr_scores else None
    worst_tname = dict(ALL_TERRITORIES).get(worst_tid, worst_tid) if worst_tid else None
    worst_cnt   = len(by_terr.get(worst_tid, []))

    avg_vol_rank = sum(r["latest_rank"] or 0 for r in regions) / n

    # Sentence 1 — scope
    s1 = (f"<b>{n_terr} of 12 territories</b> carry performance concerns in {franchise}, "
          f"covering <b>{n} high-volume regions</b> (average sales rank {avg_vol_rank:.0f}/100). ")
    if multi > 0:
        s1 += (f"<b>{multi} of those regions carry multiple combined risk flags</b>, "
               f"signalling compounding problems rather than isolated dips.")
    else:
        s1 += "Problems are single-flag so far, but merit attention before they compound."

    # Sentence 2 — dominant pattern + worst territory
    s2 = ""
    if dom_label and worst_tname:
        s2 = (f"The dominant risk pattern franchise-wide is <b>{dom_label}</b>. "
              f"<b>{worst_tname}</b> is the highest-priority territory with "
              f"<b>{worst_cnt} flagged region{'s' if worst_cnt != 1 else ''}</b> "
              f"and the largest share of total problem score.")

    # Sentence 3 — worst single region
    s3 = (f"The most urgent individual case is <b>{best['region']}</b> "
          f"(brand: {best['brand']}, score {best['score']:.0f}): "
          f"rank <b>{best['latest_rank']}/100</b> by volume, "
          f"averaging <b>{best['avg_g3']:+.1f}%</b> RollQ growth over the last 3 periods."
          if best.get("avg_g3") is not None else "")

    # Sentence 4 — month-over-month comparison (uses g_series index -1 vs -2)
    # g_series[-1] = LATEST month, g_series[-2] = previous month
    prev_month = MONTHS[-2]

    pairs = [
        (r["g_series"][-1], r["g_series"][-2])
        for r in regions
        if r.get("g_series") and len(r["g_series"]) >= 2
        and r["g_series"][-1] is not None and r["g_series"][-2] is not None
    ]
    rank_pairs = [
        (r["r_series"][-1], r["r_series"][-2])
        for r in regions
        if r.get("r_series") and len(r["r_series"]) >= 2
        and r["r_series"][-1] is not None and r["r_series"][-2] is not None
    ]

    s4 = ""
    if pairs:
        avg_curr  = sum(c for c,_ in pairs) / len(pairs)
        avg_prev  = sum(p for _,p in pairs) / len(pairs)
        delta_g   = avg_curr - avg_prev
        n_worse   = sum(1 for c,p in pairs if c < p)
        n_total   = len(pairs)

        avg_rank_curr = sum(c for c,_ in rank_pairs) / len(rank_pairs) if rank_pairs else None
        avg_rank_prev = sum(p for _,p in rank_pairs) / len(rank_pairs) if rank_pairs else None
        rank_dir = ""
        if avg_rank_curr is not None and avg_rank_prev is not None:
            rd = avg_rank_curr - avg_rank_prev
            rank_dir = (f" Average volume rank <b>{'fell' if rd < -1 else 'rose' if rd > 1 else 'held steady'}</b>"
                        f" ({avg_rank_prev:.0f} → {avg_rank_curr:.0f}).")

        if delta_g < -2:
            direction = "<b>worsened</b>"
        elif delta_g > 2:
            direction = "<b>improved</b>"
        else:
            direction = "<b>remained broadly stable</b>"

        s4 = (f"Compared to the rolling quarter ending {prev_month}, the franchise picture has {direction}: "
              f"average RollQ growth PY moved from "
              f"<b>{avg_prev:+.1f}%</b> to <b>{avg_curr:+.1f}%</b> "
              f"(Δ{delta_g:+.1f}pp)."
              f" <b>{n_worse} of {n_total} regions</b> posted weaker rolling-quarter growth vs the prior period."
              f"{rank_dir}")

    body = "  ".join(p for p in [s1, s2, s3] if p)
    if s4:
        body += f'<br><br><span class="fh-intro-compare">{s4}</span>'
    return body

# ── Territory-level intro ─────────────────────────────────────────────────────

def territory_intro(territory_name, terr_regs):
    if not terr_regs: return ""
    n        = len(terr_regs)
    worst    = terr_regs[0]
    total_s  = sum(r["latest_sales"] for r in terr_regs)
    avg_g3   = sum(r["avg_g3"] or 0 for r in terr_regs) / n
    multi    = sum(1 for r in terr_regs if len(r["tags"]) >= 2)

    all_tags   = [t for r in terr_regs for t in r["tags"]]
    tag_counts = Counter(all_tags)
    dom_tag    = tag_counts.most_common(1)[0][0] if tag_counts else None
    dom_label  = TAG[dom_tag][0] + " " + TAG[dom_tag][1] if dom_tag else ""

    consec_max = max(r["consec_neg"] for r in terr_regs)

    # Sentence 1 — volume at risk
    s1 = (f"<b>{'One' if n==1 else n} region{'s' if n>1 else ''}</b> flagged in {territory_name}, "
          f"putting <b>€{total_s:,.0f}/month</b> of revenue under risk. ")
    if n > 1:
        s1 += (f"<b>{multi} region{'s' if multi!=1 else ''}</b> carry two or more combined flags."
               if multi else "All flags are single-type so far.")

    # Sentence 2 — dominant problem type
    s2 = ""
    if dom_label:
        s2 = f"The prevailing issue is <b>{dom_label}</b>"
        if consec_max >= 6:
            s2 += f", with the longest slide running <b>{consec_max} consecutive negative rolling quarters</b> — a pattern that rarely self-corrects."
        elif consec_max >= 3:
            s2 += f", with up to <b>{consec_max} consecutive negative rolling quarters</b> signalling an entrenched trend."
        else:
            s2 += ", still in early stages but deteriorating."
        s2 += "  "

    # Sentence 3 — focal region
    g3_str = f"<b>{worst['avg_g3']:+.1f}%</b>" if worst.get("avg_g3") is not None else ""
    s3 = (f"Focus first on <b>{worst['region']}</b> (rank {worst['latest_rank']}/100, "
          f"€{worst['latest_sales']:,.0f}/RollQ"
          f"{', ' + g3_str + ' avg RollQ growth' if g3_str else ''}): "
          f"highest combined problem score in the territory.")

    return s1 + "  " + s2 + s3

# ── Region card ───────────────────────────────────────────────────────────────

def region_card(r, show_territory=True):
    fc_col = FC.get(r["franchise"], "#555")
    sev_lbl, sev_col, sev_bg = severity(r["tags"])
    gr = r["latest_rank"] or 0
    rk_col = "#d97706" if gr>=80 else ("#374151" if gr>=50 else "#9ca3af")
    pct = min(100, r["score"]/110*100)
    bar_c = "#dc2626" if pct>65 else ("#d97706" if pct>35 else "#ca8a04")
    gn = r.get("latest_growth"); g3 = r.get("avg_g3"); gvf = r.get("latest_growth_vs_fcst")
    sw = r.get("worst_swing"); g6 = r.get("avg_g6")
    terr_span = f'<span class="terr-tag">{r["territory"]}</span>' if show_territory else ""
    tags_html = " ".join(tag_badge(t) for t in r["tags"])
    grank = GLOBAL_RANK.get(id(r),"?")
    return f"""
<div class="rcard" style="border-left-color:{fc_col}">
  <div class="rcard-top">
    <div class="rcard-title">
      <div class="rcard-name-row">
        <span class="rname">{r['region']}</span>
        <span class="brand-tag" style="background:{fc_col}18;color:{fc_col};border-color:{fc_col}55">{r['brand']}</span>
        {terr_span}
      </div>
      <div class="tag-row">{tags_html}</div>
    </div>
    <div class="rcard-score" style="background:{sev_bg}">
      <span class="sev-lbl" style="color:{sev_col}">{sev_lbl}</span>
      <span class="sev-num" style="color:{sev_col}">#{grank} · {r['score']}</span>
      <div class="score-bar"><div style="width:{pct:.0f}%;background:{bar_c}"></div></div>
    </div>
  </div>

  <div class="rcard-body">
    <div class="metrics-row">
      <div class="metric">
        <div class="mlbl">Sales RollQ</div>
        <div class="mval" style="color:#111827">€{r['latest_sales']:,.0f}</div>
      </div>
      <div class="metric">
        <div class="mlbl">Vol rank</div>
        <div class="mval" style="color:{rk_col}">{r['latest_rank'] or '—'}</div>
        <div class="msub">of 100</div>
      </div>
      <div class="metric">
        <div class="mlbl">Growth PY</div>
        <div class="mval" style="color:{gc(gn)}">{f'{gn:+.1f}%' if gn is not None else '—'}</div>
        <div class="msub">latest RollQ</div>
      </div>
      <div class="metric">
        <div class="mlbl">Avg 3 RollQ</div>
        <div class="mval" style="color:{gc(g3)}">{f'{g3:+.1f}%' if g3 is not None else '—'}</div>
        <div class="msub">growth PY</div>
      </div>
      <div class="metric">
        <div class="mlbl">Growth vs Fcst</div>
        <div class="mval" style="color:{gc(gvf)}">{f'{gvf:+.1f}pp' if gvf is not None else '—'}</div>
        <div class="msub">growth delta</div>
      </div>
    </div>
    <div class="spark-wrap">
      <div class="spark-lbl">Growth PY · 13 RollQ periods</div>
      {sparkline(r['g_series'])}
    </div>
  </div>

  <div class="rcard-narr">{r['narrative']}</div>

  <div class="rcard-footer">
    <span>Consec. neg RollQ: <b style="color:{'#dc2626' if r['consec_neg']>=4 else '#374151'}">{r['consec_neg']}</b></span>
    <span>Worst rank swing: <b style="color:{gc(sw)}">{f'{sw:+d}' if sw else '—'}</b></span>
    <span>6-RollQ avg: <b style="color:{gc(g6)}">{f'{g6:+.1f}%' if g6 is not None else '—'}</b></span>
    <span>Share vs national: <b style="color:{gc(r.get('latest_mshare_dev'))}">{f'{r["latest_mshare_dev"]:+.2f}pp' if r.get("latest_mshare_dev") is not None else '—'}</b></span>
  </div>
</div>"""

# ── Composite problem summary ─────────────────────────────────────────────────

def composite_summary(regions):
    if not regions:
        return '<div class="clean-note">✓ No problematic regions flagged for this franchise.</div>'
    counts = Counter(tuple(sorted(r["tags"])) for r in regions)
    crit  = {k:v for k,v in counts.items() if len(k)>=3}
    high  = {k:v for k,v in counts.items() if len(k)==2}
    watch = {k:v for k,v in counts.items() if len(k)==1}

    def box(combos, lbl, lbl_col, box_bg, border_col):
        if not combos: return ""
        rows = "".join(
            f'<div class="combo-row">'
            f'<span class="combo-icons">{"".join(TAG[t][0] for t in k)}</span>'
            f'<span class="combo-name">{"  +  ".join(TAG[t][1] for t in k)}</span>'
            f'<span class="combo-cnt" style="color:{lbl_col}">{v}</span>'
            f'</div>'
            for k,v in sorted(combos.items(), key=lambda x:-x[1])
        )
        return (f'<div class="combo-box" style="background:{box_bg};border-color:{border_col}">'
                f'<div class="combo-box-lbl" style="color:{lbl_col}">{lbl}</div>{rows}</div>')

    return (f'<div class="combo-grid">'
            f'{box(crit,  "⚠  CRITICAL — 3 or more flags combined", "#dc2626","#fff5f5","#fca5a5")}'
            f'{box(high,  "▲  HIGH RISK — 2 flags combined",         "#d97706","#fffbeb","#fcd34d")}'
            f'{box(watch, "·  WATCH — single flag",                  "#6b7280","#f9fafb","#d1d5db")}'
            f'</div>')

# ── Territory heatmap ─────────────────────────────────────────────────────────

def territory_heatmap(franchise_regions):
    terr_info = {}
    for r in franchise_regions:
        tid = r["territory_id"]
        if tid not in terr_info:
            terr_info[tid] = {"score": 0, "count": 0}
        terr_info[tid]["score"] = max(terr_info[tid]["score"], r["score"])
        terr_info[tid]["count"] += 1
    chips = ""
    for tid, tname in ALL_TERRITORIES:
        info = terr_info.get(tid, {"score": 0, "count": 0})
        sc, cnt = info["score"], info["count"]
        if sc > 70:   bg,brd,tc,dot = "#fff1f2","#fca5a5","#b91c1c","🔴"
        elif sc > 35: bg,brd,tc,dot = "#fffbeb","#fcd34d","#b45309","🟠"
        elif sc > 0:  bg,brd,tc,dot = "#fefce8","#fde047","#854d0e","🟡"
        else:         bg,brd,tc,dot = "#f0fdf4","#86efac","#15803d","🟢"
        sub = f"{cnt} flagged" if cnt else "Clean"
        chips += (f'<div class="terr-chip" style="background:{bg};border-color:{brd}">'
                  f'<div class="terr-id" style="color:{tc}">{tid}</div>'
                  f'<div class="terr-nm" style="color:#6b7280">{tname[:13]}</div>'
                  f'<div class="terr-st" style="color:{tc}">{dot} {sub}</div>'
                  f'</div>')
    return f'<div class="terr-heatmap">{chips}</div>'

# ── Franchise panel ───────────────────────────────────────────────────────────

def franchise_panel(franchise):
    color = FC[franchise]; bg = color  # bg unused in light mode
    regions = [r for r in ALL_RECORDS if r["franchise"] == franchise]
    by_terr = defaultdict(list)
    for r in regions:
        by_terr[r["territory_id"]].append(r)

    n = len(regions)
    n_crit = sum(1 for r in regions if len(r["tags"]) >= 3)
    n_high = sum(1 for r in regions if len(r["tags"]) == 2)
    n_wtch = sum(1 for r in regions if len(r["tags"]) == 1)
    terr_affected = len(set(r["territory_id"] for r in regions))

    if n == 0:
        return (f'<div class="franchise-header" style="border-color:#e5e7eb">'
                f'<h2 style="color:{color}">{franchise} Franchise</h2>'
                f'<p class="clean-note" style="margin-top:10px">✓ No problematic regions flagged for this franchise.</p>'
                f'</div>')

    sub = (f'<span style="color:#e06b6b"><b>{n_crit}</b> critical</span>, '
           f'<span style="color:#e0a04a"><b>{n_high}</b> high risk</span>, '
           f'<span style="color:#a0a060"><b>{n_wtch}</b> watch</span> — '
           f'<b>{n}</b> regions across <b>{terr_affected}</b> of 12 territories')

    comp_html = composite_summary(regions)
    hmap_html = territory_heatmap(regions)

    terr_sects = ""
    for tid, tname in ALL_TERRITORIES:
        terr_regs = sorted(by_terr.get(tid, []), key=lambda x: -x["score"])
        if not terr_regs:
            terr_sects += (f'<div class="terr-clean">'
                           f'<span class="terr-clean-id" style="color:{color}">{tid}</span>'
                           f'<span class="terr-clean-nm">{tname}</span>'
                           f'<span class="terr-clean-ok">✓ Clean</span>'
                           f'</div>')
        else:
            cards  = "".join(region_card(r, show_territory=False) for r in terr_regs)
            t_intro = territory_intro(tname, terr_regs)
            terr_sects += (f'<div class="terr-section">'
                           f'<div class="terr-header" style="border-left-color:{color}">'
                           f'<span class="terr-hid" style="color:{color}">{tid}</span>'
                           f'<span class="terr-hnm">{tname}</span>'
                           f'<span class="terr-hcnt">{len(terr_regs)} region{"s" if len(terr_regs)!=1 else ""} flagged</span>'
                           f'</div>'
                           f'<p class="terr-intro">{t_intro}</p>'
                           f'<div class="terr-cards">{cards}</div>'
                           f'</div>')

    intro_html = franchise_intro(franchise, regions, by_terr)

    return f"""
<div class="franchise-header" style="border-color:{color}44">
  <div class="fh-row">
    <h2 class="fh-title" style="color:{color}">{franchise} Franchise</h2>
    <span class="fh-sub">{sub}</span>
  </div>
  <p class="fh-intro">{intro_html}</p>
</div>

<div class="section-block">
  <div class="section-lbl">PROBLEM COMBINATIONS</div>
  {comp_html}
</div>

<div class="section-block">
  <div class="section-lbl">TERRITORY OVERVIEW</div>
  {hmap_html}
</div>

<div class="section-block">
  <div class="section-lbl">BY TERRITORY</div>
  {terr_sects}
</div>"""

# ── Assemble HTML ─────────────────────────────────────────────────────────────

tab_btns  = ""
tab_panls = ""
default_f = next((f for f in FRANCHISES if len([r for r in ALL_RECORDS if r["franchise"]==f])>0),
                  FRANCHISES[0])

for franchise in FRANCHISES:
    col = FC[franchise][0]
    n   = len([r for r in ALL_RECORDS if r["franchise"] == franchise])
    is_active = franchise == default_f
    badge = (f'<span class="tab-badge" style="background:{col}18;color:{col}">{n}</span>'
             if n > 0 else
             f'<span class="tab-badge clean">✓</span>')
    tab_btns  += (f'<button class="tab-btn{"  active" if is_active else ""}" '
                  f'data-f="{franchise}" style="--fc:{col}">'
                  f'{franchise}{badge}</button>\n')
    tab_panls += (f'<div class="tab-panel{"  active" if is_active else ""}" '
                  f'id="pnl-{franchise.replace(" ","_")}">'
                  f'{franchise_panel(franchise)}</div>\n')

n_total = len(ALL_RECORDS)
n_crit  = sum(1 for r in ALL_RECORDS if len(r["tags"]) >= 3)

HTML = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Regional Problem Report</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
      background:#f1f4f9;color:#111827;min-height:100vh;font-size:14px;line-height:1.5}}

/* ── Page header ── */
.page-hdr{{padding:24px 36px 0;background:#fff;border-bottom:1px solid #e5e7eb}}
.page-hdr h1{{font-size:20px;font-weight:700;color:#111827}}
.page-hdr .sub{{font-size:13px;color:#9ca3af;margin-top:4px;padding-bottom:18px}}

/* ── Tab nav ── */
.tab-nav{{display:flex;gap:0;overflow-x:auto;background:#fff;
          border-bottom:1px solid #e5e7eb;position:sticky;top:0;z-index:20;
          padding:0 36px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
.tab-btn{{background:none;border:none;cursor:pointer;font-family:inherit;font-size:13.5px;
           color:#9ca3af;padding:14px 18px 12px;border-bottom:2.5px solid transparent;
           white-space:nowrap;display:flex;align-items:center;gap:6px;
           font-weight:500;transition:color .15s}}
.tab-btn:hover{{color:#374151}}
.tab-btn.active{{color:var(--fc,#374151);border-bottom-color:var(--fc,#374151);font-weight:600}}
.tab-badge{{font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px}}
.tab-badge.clean{{background:#f0fdf4;color:#16a34a}}

/* ── Tab panels ── */
.tab-panel{{display:none;padding:28px 36px 80px;max-width:1240px}}
.tab-panel.active{{display:block}}

/* ── Franchise header ── */
.franchise-header{{border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:26px}}
.fh-row{{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}}
.fh-title{{font-size:18px;font-weight:700}}
.fh-sub{{font-size:13px;color:#6b7280}}
.fh-intro{{font-size:13.5px;color:#374151;line-height:1.75;margin-top:14px;
           max-width:960px;padding:14px 18px;background:#f8fafc;
           border-left:3px solid #e5e7eb;border-radius:0 8px 8px 0}}
.fh-intro-compare{{color:#6b7280;font-size:13px;font-style:italic}}

/* ── Section ── */
.section-block{{margin-bottom:28px}}
.section-lbl{{font-size:10.5px;font-weight:700;color:#9ca3af;letter-spacing:1.2px;
              text-transform:uppercase;margin-bottom:12px}}

/* ── Combo grid ── */
.combo-grid{{display:flex;gap:14px;flex-wrap:wrap}}
.combo-box{{flex:1;min-width:190px;border:1px solid;border-radius:10px;padding:14px 16px;
            box-shadow:0 1px 3px rgba(0,0,0,.04)}}
.combo-box-lbl{{font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;
                margin-bottom:10px}}
.combo-row{{display:flex;align-items:center;gap:10px;padding:7px 0;
            border-bottom:1px solid #f3f4f6}}
.combo-row:last-child{{border-bottom:none}}
.combo-icons{{font-size:18px;width:36px;flex-shrink:0}}
.combo-name{{flex:1;font-size:12px;color:#4b5563;font-weight:500}}
.combo-cnt{{font-size:20px;font-weight:700;font-family:'SF Mono',Menlo,monospace;
            min-width:22px;text-align:right}}

/* ── Territory heatmap ── */
.terr-heatmap{{display:flex;flex-wrap:wrap;gap:8px}}
.terr-chip{{border:1px solid;border-radius:8px;padding:8px 12px;text-align:center;
            min-width:90px;box-shadow:0 1px 2px rgba(0,0,0,.04)}}
.terr-id{{font-size:11px;font-weight:700;margin-bottom:2px}}
.terr-nm{{font-size:10.5px;white-space:nowrap}}
.terr-st{{font-size:10px;margin-top:3px;font-weight:500}}

/* ── Territory sections ── */
.terr-clean{{display:flex;align-items:center;gap:12px;padding:10px 16px;
             background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
             margin-bottom:8px}}
.terr-clean-id{{font-size:11px;font-weight:700}}
.terr-clean-nm{{font-size:12px;color:#374151}}
.terr-clean-ok{{font-size:11px;color:#16a34a;margin-left:auto;font-weight:600}}
.terr-section{{margin-bottom:24px}}
.terr-header{{display:flex;align-items:center;gap:12px;padding:11px 16px;
              background:#fff;border-radius:8px;border-left:4px solid;
              margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
.terr-hid{{font-weight:700;font-size:13px}}
.terr-hnm{{font-size:14px;font-weight:600;color:#374151}}
.terr-hcnt{{font-size:12px;color:#dc2626;margin-left:auto;font-weight:600}}
.terr-intro{{font-size:12.5px;color:#4b5563;line-height:1.7;margin-bottom:14px;
             padding:12px 16px;background:#fafafa;border:1px solid #f3f4f6;
             border-radius:8px;max-width:960px}}
.terr-cards{{display:flex;flex-direction:column;gap:12px}}

/* ── Region card ── */
.rcard{{background:#fff;border:1px solid #e5e7eb;border-left:4px solid;
        border-radius:10px;padding:18px 20px;display:flex;flex-direction:column;gap:14px;
        box-shadow:0 1px 4px rgba(0,0,0,.06)}}
.rcard-top{{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}}
.rcard-title{{flex:1;min-width:0}}
.rcard-name-row{{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px}}
.rname{{font-size:15px;font-weight:700;color:#111827}}
.brand-tag{{font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;border:1px solid}}
.terr-tag{{font-size:11px;color:#9ca3af;font-weight:500}}
.tag-row{{display:flex;gap:6px;flex-wrap:wrap}}
.badge{{font-weight:600;padding:3px 9px;border-radius:5px;border:1px solid;
        white-space:nowrap;letter-spacing:.2px}}
.rcard-score{{text-align:right;flex-shrink:0;padding:10px 14px;border-radius:8px;min-width:110px}}
.sev-lbl{{display:block;font-size:10px;font-weight:700;text-transform:uppercase;
           letter-spacing:.6px;margin-bottom:3px}}
.sev-num{{display:block;font-size:16px;font-weight:700;
           font-family:'SF Mono',Menlo,monospace}}
.score-bar{{height:3px;background:#e5e7eb;border-radius:2px;margin-top:5px}}
.score-bar div{{height:100%;border-radius:2px}}

.rcard-body{{display:flex;gap:16px;align-items:center}}
.metrics-row{{flex:1;display:grid;grid-template-columns:repeat(5,1fr);gap:10px}}
.metric{{text-align:center;background:#f9fafb;border-radius:8px;padding:10px 6px}}
.mlbl{{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;
       margin-bottom:4px;font-weight:600}}
.mval{{font-size:17px;font-weight:700;font-family:'SF Mono',Menlo,monospace}}
.msub{{font-size:10px;color:#9ca3af;margin-top:2px}}
.spark-wrap{{flex-shrink:0;background:#f9fafb;border:1px solid #e5e7eb;
             border-radius:8px;padding:8px 10px}}
.spark-lbl{{font-size:10px;color:#9ca3af;text-align:center;margin-bottom:4px;font-weight:500}}

.rcard-narr{{font-size:12.5px;color:#4b5563;line-height:1.7;
             border-top:1px solid #f3f4f6;padding-top:12px}}
.rcard-footer{{display:flex;gap:20px;font-size:11.5px;color:#9ca3af;
               font-family:'SF Mono',Menlo,monospace;flex-wrap:wrap}}
.rcard-footer b{{font-weight:600}}

.clean-note{{font-size:13px;color:#16a34a;padding:10px 0;font-weight:500}}

/* ── Metrics documentation ── */
.metrics-doc{{margin:24px 36px;max-width:1240px}}
.metrics-doc details{{border:1px solid #e5e7eb;border-radius:10px;padding:18px;background:#fff;
                       box-shadow:0 1px 3px rgba(0,0,0,.04)}}
.metrics-doc summary{{cursor:pointer;font-size:14px;font-weight:600;color:#374151;
                      user-select:none}}
.metrics-doc summary:hover{{color:#111827}}
.doc-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
           gap:16px;margin-top:16px}}
.doc-card{{border:1px solid #f3f4f6;border-radius:8px;padding:14px;background:#f9fafb}}
.doc-card h4{{font-size:13px;font-weight:700;color:#111827;margin-bottom:8px}}
.doc-card p{{font-size:12px;color:#4b5563;line-height:1.6}}
.doc-card code{{background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #e5e7eb;
                 font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#dc2626}}
</style>
</head>
<body>

<div class="page-hdr">
  <h1>⚠ Regional Problem Report</h1>
  <p class="sub">metrics.db · {LATEST} · {n_total} flagged regions · {n_crit} critical · Rolling Quarter (RollQ) analysis</p>
</div>

<nav class="tab-nav">
{tab_btns}
</nav>

<div class="metrics-doc">
  <details open>
    <summary>📊 Metric Definitions</summary>
    <div class="doc-grid">
      <div class="doc-card">
        <h4>Sales RollQ</h4>
        <p>Sum of own-brand sales over the rolling 3-quarter window (latest 3 consecutive calendar quarters), in EUR.</p>
      </div>
      <div class="doc-card">
        <h4>Vol Rank</h4>
        <p>Percentile rank 1–100 of <code>sales_eur</code> within brand × quarter, ranked per <code>period_type</code>. 100 = highest-volume region.</p>
      </div>
      <div class="doc-card">
        <h4>Growth PY</h4>
        <p><code>((Current RollQ sales − Prior year same RollQ sales) / Prior year sales) × 100%</code>. Year-over-year growth rate, latest quarter.</p>
      </div>
      <div class="doc-card">
        <h4>Avg 3-RollQ</h4>
        <p>Mean of <code>growth_py_sales</code> over the last 3 rolling-quarter periods. Smooths recent volatility.</p>
      </div>
      <div class="doc-card">
        <h4>Growth vs Forecast</h4>
        <p><code>Actual growth_py_sales − National brand FCST growth_py (in percentage points)</code>. Positive = growth beat forecast; negative = actual growth was below forecast.</p>
      </div>
      <div class="doc-card">
        <h4>Share vs National</h4>
        <p><code>Region market_share − National avg market_share (per brand)</code>. Signed deviation in percentage points. +0.5pp = 0.5pp above national average.</p>
      </div>
      <div class="doc-card">
        <h4>Consec. neg RollQ</h4>
        <p>Count of consecutive rolling quarters with negative year-over-year growth. Signals structural decline, not temporary dip.</p>
      </div>
      <div class="doc-card">
        <h4>Worst Rank Swing</h4>
        <p>Maximum negative change in <code>rank_sales_eur</code> over any 3-quarter window. Δ−23 = lost 23 rank positions in 3 months.</p>
      </div>
    </div>
  </details>
</div>

{tab_panls}

<script>
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {{
  document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'));
  b.classList.add('active');
  document.getElementById('pnl-' + b.dataset.f.replace(/ /g,'_')).classList.add('active');
}}));
</script>
</body></html>"""

with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write(HTML)

print(f"Written {OUTPUT}")
for fn in FRANCHISES:
    n = len([r for r in ALL_RECORDS if r["franchise"]==fn])
    print(f"  {fn}: {n} problematic regions")
