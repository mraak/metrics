"""
Identify and explain the most problematic regions in region_metrics.
Outputs problem_regions.html — a self-contained dashboard.
"""

import sqlite3, pandas as pd, numpy as np, json, textwrap

DB     = "metrics.db"
OUTPUT = "problem_regions.html"

# ── 1. Load ───────────────────────────────────────────────────────────────────

con = sqlite3.connect(DB)
df = pd.read_sql("""
    SELECT year_month, brand_name, franchise, region_name, territory_name, territory_id,
           sales_eur, units, market_share,
           growth_py_sales, growth_pp_sales, fcst_deviation,
           rank_sales_eur, rank_growth_py, rank_fcst_dev, rank_trend_3m
    FROM region_metrics
    WHERE period_type='Month' AND year_month >= '2025-05'
    ORDER BY brand_name, region_name, year_month
""", con)
con.close()

MONTHS = sorted(df.year_month.unique())
LATEST = MONTHS[-1]

# ── 2. Score every (brand, region) ───────────────────────────────────────────

def safe(v, default=0):
    return default if (v is None or (isinstance(v, float) and np.isnan(v))) else v

records = []
for (brand, region), grp in df.groupby(["brand_name", "region_name"]):
    grp = grp.sort_values("year_month").reset_index(drop=True)
    lat_row = grp[grp.year_month == LATEST]
    if lat_row.empty or lat_row.iloc[0].sales_eur == 0:
        continue
    lat = lat_row.iloc[0]

    g_series  = grp.growth_py_sales.tolist()
    r_series  = grp.rank_sales_eur.tolist()
    fd_series = grp.fcst_deviation.tolist()

    # Consecutive negative growth ending at latest month
    consec = 0
    for v in reversed(g_series):
        if pd.isna(v) or v >= 0:
            break
        consec += 1

    avg_g3   = grp.tail(3).growth_py_sales.mean()
    avg_g6   = grp.tail(6).growth_py_sales.mean()
    avg_fd3  = grp.tail(3).fcst_deviation.mean()
    worst_sw = grp.rank_trend_3m.min()

    lat_rank  = safe(lat.rank_sales_eur)
    avg_g3v   = safe(avg_g3)
    avg_fd3v  = safe(avg_fd3)
    worst_swv = safe(worst_sw)

    # Composite problem score
    score = (
        (lat_rank / 100) * 40            # volume importance
        + max(0, -avg_g3v) * 0.6         # recent decline severity
        + consec * 3                      # persistence
        + max(0, -worst_swv) * 0.35      # sharpest rank drop
        + max(0, -avg_fd3v) * 0.25       # vs forecast
    )

    # Problem type tags (can be multiple)
    tags = []
    if lat_rank >= 80 and avg_g3v < -3:
        tags.append("whale_declining")
    if consec >= 4:
        tags.append("long_slide")
    if worst_swv <= -18:
        tags.append("sudden_drop")
    if avg_fd3v <= -10:
        tags.append("missing_plan")

    if not tags and score < 8:
        continue

    def fmt(v):
        return round(float(v), 1) if not pd.isna(v) else None

    records.append(dict(
        brand=brand,
        franchise=str(lat.franchise),
        region=region,
        territory=str(lat.territory_name),
        territory_id=str(lat.territory_id),
        score=round(score, 1),
        latest_sales=round(float(lat.sales_eur), 0),
        latest_rank=int(lat_rank) if lat_rank else None,
        latest_growth=fmt(lat.growth_py_sales),
        latest_mshare=fmt(lat.market_share),
        latest_fcst_dev=fmt(lat.fcst_deviation),
        avg_g3=fmt(avg_g3),
        avg_g6=fmt(avg_g6),
        avg_fd3=fmt(avg_fd3),
        consec_neg=consec,
        worst_swing=int(worst_swv) if worst_swv != 0 else 0,
        tags=tags,
        g_series=[fmt(v) for v in g_series],
        r_series=[int(v) if not pd.isna(v) else None for v in r_series],
        fd_series=[fmt(v) for v in fd_series],
        months=MONTHS,
    ))

results = sorted(records, key=lambda x: -x["score"])[:12]

# ── 3. Narrative generator ────────────────────────────────────────────────────

TAG_LABELS = {
    "whale_declining": ("🐋", "Volume leader declining", "#e8a44a"),
    "long_slide":      ("📉", "Sustained decline",       "#e06b6b"),
    "sudden_drop":     ("⚡", "Sudden crash",            "#c06ae0"),
    "missing_plan":    ("🎯", "Missing forecast",        "#6a9de0"),
}

def narrative(r):
    brand   = r["brand"]
    region  = r["region"]
    g3      = r["avg_g3"]
    g6      = r["avg_g6"]
    consec  = r["consec_neg"]
    swing   = r["worst_swing"]
    rank    = r["latest_rank"]
    fd      = r["latest_fcst_dev"]
    fd3     = r["avg_fd3"]
    tags    = r["tags"]
    sales   = r["latest_sales"]
    g_now   = r["latest_growth"]

    sentences = []

    # Volume context
    if rank and rank >= 85:
        vol = f"one of the top {100-rank+1}% highest-volume regions"
    elif rank and rank >= 65:
        vol = "a meaningful mid-to-upper-tier region"
    else:
        vol = "a mid-tier region"
    sentences.append(
        f"{region} is {vol} for {brand} (rank {rank}/100, €{sales:,.0f}/month as of {LATEST})."
    )

    # Core problem description
    if "long_slide" in tags and consec >= 8:
        sentences.append(
            f"Growth has been negative for {consec} straight months — an uninterrupted slide "
            f"with no recovery attempt visible in the data."
        )
    elif "long_slide" in tags:
        sentences.append(
            f"Growth has been negative for {consec} consecutive months, suggesting the decline "
            f"is structural rather than a one-off blip."
        )

    if "whale_declining" in tags:
        sentences.append(
            f"At this sales volume, the {g3}% 3-month average growth rate translates to a "
            f"disproportionately large absolute revenue loss compared to smaller regions."
        )

    if "sudden_drop" in tags and abs(swing) >= 20:
        sentences.append(
            f"A rank collapse of {abs(swing)} positions was recorded — the sharpest recent "
            f"swing in this brand's portfolio — indicating an acute event, not gradual erosion."
        )
    elif "sudden_drop" in tags:
        sentences.append(
            f"A rank drop of {abs(swing)} positions signals a recent sharp deterioration."
        )

    if "missing_plan" in tags and fd3 is not None:
        sentences.append(
            f"The region is running {abs(fd3):.1f}pp below the national forecast growth rate "
            f"on a 3-month average — the forecast signal was there but the region is not responding."
        )

    # 6-month context
    if g6 is not None and g6 < -8:
        sentences.append(
            f"The 6-month average of {g6}% confirms this is a persistent structural issue, "
            f"not short-term noise."
        )
    elif g6 is not None and g6 < -3:
        sentences.append(
            f"A 6-month average of {g6}% shows the trend is broadly negative even if not catastrophic."
        )

    # Closing recommendation
    if "long_slide" in tags and "whale_declining" in tags:
        sentences.append("Priority intervention recommended.")
    elif "sudden_drop" in tags and "long_slide" not in tags:
        sentences.append("Monitor closely — this may be an early warning before a longer slide.")
    elif "long_slide" in tags:
        sentences.append("Root-cause analysis needed: why has no correction happened over this many months?")

    return " ".join(sentences)

for r in results:
    r["narrative"] = narrative(r)

# ── 4. SVG sparkline helpers ──────────────────────────────────────────────────

def sparkline_growth(series, months, W=240, H=56):
    """SVG path for growth_py sparkline. Returns full <svg> string."""
    vals = [(i, v) for i, v in enumerate(series) if v is not None]
    if len(vals) < 2:
        return ""
    ys = [v for _, v in vals]
    mn, mx = min(ys + [0]), max(ys + [0])
    rng = mx - mn or 1
    pad = 6

    def px(i, n): return pad + i / (n - 1) * (W - 2*pad)
    def py(v):    return H - pad - (v - mn) / rng * (H - 2*pad)

    n = len(series)
    # Zero line
    y0 = py(0)
    zero_line = f'<line x1="{pad}" y1="{y0:.1f}" x2="{W-pad}" y2="{y0:.1f}" stroke="#2a2d3a" stroke-width="1"/>'

    # Filled area path
    pts = [(px(i, n), py(v)) for i, v in vals]
    area = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area += f" L{pts[-1][0]:.1f},{y0:.1f} L{pts[0][0]:.1f},{y0:.1f} Z"

    # Line path
    line = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)

    # Colour: mostly negative → red, else green
    neg_ratio = sum(1 for v in ys if v < 0) / len(ys)
    fill_col  = "#7b2020" if neg_ratio > 0.5 else "#1a4a2a"
    line_col  = "#e06b6b" if neg_ratio > 0.5 else "#6ec86e"

    # Last value dot
    lx, ly  = pts[-1]
    dot_col = "#e06b6b" if ys[-1] < 0 else "#6ec86e"
    dot     = f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="3" fill="{dot_col}"/>'

    # Month labels (first and last)
    m0_lbl = f'<text x="{pad}" y="{H}" font-size="7" fill="#444" text-anchor="middle">{months[0][2:]}</text>'
    mL_lbl = f'<text x="{W-pad}" y="{H}" font-size="7" fill="#444" text-anchor="middle">{months[-1][2:]}</text>'

    return (f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'{zero_line}'
            f'<path d="{area}" fill="{fill_col}" opacity="0.5"/>'
            f'<path d="{line}" fill="none" stroke="{line_col}" stroke-width="1.5"/>'
            f'{dot}{m0_lbl}{mL_lbl}</svg>')

for r in results:
    r["sparkline_svg"] = sparkline_growth(r["g_series"], r["months"])

# ── 5. Franchise colour map ───────────────────────────────────────────────────

FRANCHISE_COLORS = {
    "Antiviral":      "#4a9ecf",
    "Cardiovascular": "#e07050",
    "Neurology":      "#9b7de0",
    "Oncology":       "#e0c050",
    "Respiratory":    "#5ec87a",
}

for r in results:
    r["franchise_color"] = FRANCHISE_COLORS.get(r["franchise"], "#aaa")

# ── 6. Render HTML ────────────────────────────────────────────────────────────

def tag_badge(tag):
    icon, label, color = TAG_LABELS[tag]
    return (f'<span style="background:{color}22;color:{color};border:1px solid {color}55;'
            f'font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;'
            f'letter-spacing:.4px;text-transform:uppercase;white-space:nowrap">'
            f'{icon} {label}</span>')

def score_bar(score):
    # score roughly 8-110; normalize to 0-100%
    pct = min(100, score / 110 * 100)
    col = "#e06b6b" if pct > 65 else ("#e0a04a" if pct > 35 else "#a0a06b")
    return (f'<div style="height:3px;background:#1e2130;border-radius:2px;margin-top:4px">'
            f'<div style="width:{pct:.0f}%;height:100%;background:{col};border-radius:2px"></div></div>')

def metric_cell(label, value, color="#e0e0e0", sub=""):
    return (f'<div style="text-align:center">'
            f'<div style="font-size:10px;color:#555;letter-spacing:.5px;text-transform:uppercase;margin-bottom:2px">{label}</div>'
            f'<div style="font-size:15px;font-weight:700;color:{color};font-family:Menlo,monospace">{value}</div>'
            f'{"<div style=font-size:9px;color:#555>" + sub + "</div>" if sub else ""}'
            f'</div>')

def growth_color(v):
    if v is None: return "#555"
    return "#e06b6b" if v < 0 else "#6ec86e"

cards_html = ""
for i, r in enumerate(results):
    rank_col  = "#f5a623" if (r["latest_rank"] or 0) >= 80 else ("#e0e0e0" if (r["latest_rank"] or 0) >= 50 else "#888")
    gc        = growth_color(r["latest_growth"])
    g3c       = growth_color(r["avg_g3"])
    g_disp    = f"{r['latest_growth']:+.1f}%" if r["latest_growth"] is not None else "—"
    g3_disp   = f"{r['avg_g3']:+.1f}%" if r["avg_g3"] is not None else "—"
    fd_disp   = f"{r['latest_fcst_dev']:+.1f}pp" if r["latest_fcst_dev"] is not None else "—"
    fd_col    = growth_color(r["latest_fcst_dev"])
    sw_disp   = f"{r['worst_swing']:+d}" if r["worst_swing"] is not None else "—"
    sw_col    = growth_color(r["worst_swing"])

    tags_html = " ".join(tag_badge(t) for t in r["tags"])
    fc        = r["franchise_color"]

    cards_html += f"""
<div style="background:#13151f;border:1px solid #1e2232;border-radius:10px;
            padding:16px;display:flex;flex-direction:column;gap:12px;
            border-left:3px solid {fc}">

  <!-- Header row -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
        <span style="font-size:13px;font-weight:700;color:#e0e0e0">{r['region']}</span>
        <span style="background:{fc}22;color:{fc};border:1px solid {fc}55;
                     font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px">{r['brand']}</span>
        <span style="color:#555;font-size:10px">{r['territory']}</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">{tags_html}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:9px;color:#444;text-transform:uppercase;letter-spacing:.5px">Problem score</div>
      <div style="font-size:16px;font-weight:700;color:#e06b6b;font-family:Menlo,monospace">#{i+1} · {r['score']}</div>
      {score_bar(r['score'])}
    </div>
  </div>

  <!-- Metrics + sparkline -->
  <div style="display:flex;gap:16px;align-items:center">
    <div style="flex:1;display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      {metric_cell("Sales/mo", f"€{r['latest_sales']:,.0f}")}
      {metric_cell("Vol rank", str(r['latest_rank'] or "—"), rank_col, "out of 100")}
      {metric_cell("Growth PY", g_disp, gc, "latest month")}
      {metric_cell("Avg 3m", g3_disp, g3c, "growth PY")}
      {metric_cell("vs FCST", fd_disp, fd_col, "deviation")}
    </div>
    <div style="flex-shrink:0;background:#0d0f14;border-radius:6px;padding:4px 6px">
      <div style="font-size:8px;color:#444;text-align:center;margin-bottom:2px">Growth PY trend · {r['months'][0][2:]} → {r['months'][-1][2:]}</div>
      {r['sparkline_svg']}
    </div>
  </div>

  <!-- Narrative -->
  <div style="font-size:11px;color:#888;line-height:1.65;border-top:1px solid #1a1d2a;padding-top:10px">
    {r['narrative']}
  </div>

  <!-- Footer stats -->
  <div style="display:flex;gap:20px;font-size:10px;font-family:Menlo,monospace">
    <span style="color:#555">Consec. neg months: <span style="color:{'#e06b6b' if r['consec_neg']>=4 else '#aaa'}">{r['consec_neg']}</span></span>
    <span style="color:#555">Worst rank swing: <span style="color:{sw_col}">{sw_disp}</span></span>
    <span style="color:#555">6m avg growth: <span style="color:{growth_color(r['avg_g6'])}">{f"{r['avg_g6']:+.1f}%" if r['avg_g6'] is not None else "—"}</span></span>
    <span style="color:#555">Market share: <span style="color:#aaa">{f"{r['latest_mshare']}%" if r['latest_mshare'] is not None else "—"}</span></span>
  </div>
</div>"""

# Summary stats
n_whale    = sum(1 for r in results if "whale_declining" in r["tags"])
n_slide    = sum(1 for r in results if "long_slide"      in r["tags"])
n_crash    = sum(1 for r in results if "sudden_drop"     in r["tags"])
n_fcst     = sum(1 for r in results if "missing_plan"    in r["tags"])
worst_consec = max(r["consec_neg"] for r in results)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Problematic Regions — metrics.db</title>
<style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{
  font-family:'Segoe UI',system-ui,sans-serif;
  background:#0d0f14; color:#e0e0e0;
  padding:28px 28px 60px;
  max-width:1100px; margin:0 auto;
}}
h1 {{ font-size:17px; font-weight:700; color:#fff; }}
.subtitle {{ font-size:11px; color:#555; margin-top:3px; }}
.summary-bar {{
  display:flex; gap:12px; flex-wrap:wrap; margin:20px 0 24px;
}}
.sum-card {{
  background:#13151f; border:1px solid #1e2232; border-radius:8px;
  padding:10px 16px; display:flex; align-items:center; gap:10px; flex:1 1 160px;
}}
.sum-icon {{ font-size:20px; }}
.sum-label {{ font-size:9px; color:#555; text-transform:uppercase; letter-spacing:.6px; }}
.sum-val {{ font-size:16px; font-weight:700; font-family:Menlo,monospace; }}
.legend {{ display:flex; gap:14px; flex-wrap:wrap; margin-bottom:20px; }}
.leg-item {{ display:flex; align-items:center; gap:5px; font-size:10px; color:#666; }}
.cards {{ display:flex; flex-direction:column; gap:14px; }}
</style>
</head>
<body>

<h1>⚠ Most Problematic Regions</h1>
<p class="subtitle">metrics.db · analysis as of {LATEST} · ranked by composite problem score · Month period</p>

<div class="summary-bar">
  <div class="sum-card">
    <span class="sum-icon">🐋</span>
    <div>
      <div class="sum-label">Whales declining</div>
      <div class="sum-val" style="color:#e8a44a">{n_whale}</div>
    </div>
  </div>
  <div class="sum-card">
    <span class="sum-icon">📉</span>
    <div>
      <div class="sum-label">Sustained slides (4m+)</div>
      <div class="sum-val" style="color:#e06b6b">{n_slide}</div>
    </div>
  </div>
  <div class="sum-card">
    <span class="sum-icon">⚡</span>
    <div>
      <div class="sum-label">Sudden crashes</div>
      <div class="sum-val" style="color:#c06ae0">{n_crash}</div>
    </div>
  </div>
  <div class="sum-card">
    <span class="sum-icon">🎯</span>
    <div>
      <div class="sum-label">Missing forecast</div>
      <div class="sum-val" style="color:#6a9de0">{n_fcst}</div>
    </div>
  </div>
  <div class="sum-card">
    <span class="sum-icon">⏱</span>
    <div>
      <div class="sum-label">Longest slide</div>
      <div class="sum-val" style="color:#e06b6b">{worst_consec}m</div>
    </div>
  </div>
</div>

<div class="legend">
  <div class="leg-item"><span style="color:#e8a44a">🐋</span> High-volume region with negative growth</div>
  <div class="leg-item"><span style="color:#e06b6b">📉</span> 4+ consecutive months decline</div>
  <div class="leg-item"><span style="color:#c06ae0">⚡</span> Sharp rank drop ≥18 positions recently</div>
  <div class="leg-item"><span style="color:#6a9de0">🎯</span> ≥10pp below national forecast growth</div>
</div>

<div class="cards">
{cards_html}
</div>

</body>
</html>"""

with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write(html)

print(f"Written {OUTPUT}")
for r in results:
    print(f"  #{results.index(r)+1:2d}  score={r['score']:5.1f}  {r['brand']:12s}  {r['region']:35s}  {r['tags']}")
