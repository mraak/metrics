# SQL-Metrics: Pharmaceutical Regional Sales Analysis System

A comprehensive SQLite database and analytics framework for identifying problematic pharmaceutical regions through multi-dimensional analysis.

---

## 📖 Start Here

**Complete Documentation:** [`ANALYSIS_FRAMEWORK.md`](ANALYSIS_FRAMEWORK.md)

Contains everything: how to run, file structure, complete data flow, all system tiers, all generation methods.

---

## 🚀 Quick Start: Running the System

### 1. Generate Database & Metrics

```bash
cd /Users/alenbalja/projects/SQL-Metrics
python3 compute_metrics.py
```

**Creates:** `metrics.db` with 136,200 computed metrics (25 months × 6 brands × 227 regions × 4 period types)

### 2. Generate Problem Report

```bash
python3 generate_report.py
```

**Creates:** `problem_report.html` (franchise-tabbed report identifying problematic regions)

### 3. View the Schema

```bash
open http://localhost:8765/schema.html
```

**Features:** Interactive 3-column diagram, metric definitions, light/dark theme, expandable framework

---

## 📁 What Is Where

```
metrics.db (SQLite Database)
├── Dimensions
│   ├── brands (6 rows)
│   ├── skus (9 rows)
│   ├── regions (227 rows)
│   └── competitors (16 rows)
├── Facts
│   ├── sales (110,291 rows) — raw transactional data
│   └── forecast (186 rows) — national baseline
└── Computed Metrics
    └── region_metrics (136,200 rows)
        └─ Tiers 1-2: metrics + comparative metrics (growth, ranks, deviations)

Python
├── compute_metrics.py  → Generates region_metrics table
├── generate_report.py  → Creates problem_report.html
└── knowledge.py        → Loads/validates Knowledge Definitions, compiles signals to SQL

Knowledge Definitions
└── knowledge_definitions.json → Signal templates · finding recipes · insight framings · relevance

HTML Reports
├── schema.html         → Database diagram + metrics + framework
├── problem_report.html → Problem regions by franchise/territory
└── signals_findings.html → Example signals & findings

Documentation
└── ANALYSIS_FRAMEWORK.md → Complete system (811 lines)
```

---

## 🔄 From Metric to Insight: Raw Data → Decisions

Five tiers — each adds **exactly one** thing to the tier below.

```
Raw Data
(sales, forecast)
    ↓
Tier 1: METRIC — a single number, one point in time
└─ units, sales_eur, market_share   (e.g. MAT Sales = €4.2M)
    ↓  + compare to ONE reference
Tier 2: COMPARATIVE METRIC — value vs a reference (still one number)
├─ vs last year:   growth_py_*       (e.g. MAT Sales Growth = -10%)
├─ vs last period: growth_pp_*
├─ vs national:    mshare_deviation
├─ vs forecast:    growth_vs_fcst_*
└─ vs peers:       rank_* (percentile)
    ↓  + watch the SAME comparison over time
Tier 3: SIGNAL — a comparative metric's trajectory
└─ "Growth is -10% now, but -30% last month, -40% six months ago"
   → recovering. That's the whole signal.
    ↓  + compose with other facts
Tier 4: FINDING — open-ended composition of any lower facts
├─ "Growth recovering AND competition vanishing AND meeting forecast"
├─ Method-agnostic: rules / KNN / clustering / ML / LLM / just signals
└─ Archetypes: Star, Turnaround, Slowing Giant, Deteriorating, etc.
    ↓  + business context
Tier 5: INSIGHT — who, when, what, & why it matters (or silence)
├─ Sales Manager → "Rep on track to recover an important region"
├─ Sales Rep     → "Turnaround possible — keep pushing, check accounts"
└─ CEO           → (nothing — region is improving, not a problem)
    ↓
User-Facing Reports
```

Tiers 1–2 are stored columns in `region_metrics` (single source of truth);
Tiers 3–5 are generated on demand. **Signal strength** (loud + clean: magnitude ·
net · coherence) is intrinsic to a signal; **relevance** (Materiality × Loudness ×
Horizon) is the separate cross-cutting filter — neither is a tier.

---

## 🎯 Core Concepts

### 1. Each Tier Adds Exactly One Thing

A growth % is *not* a signal until you watch it move over time; a signal is *not* a finding until you combine it with other facts. Don't collapse the tiers.

### 2. Signal Strength ≠ Relevance

**Strength is intrinsic** to the signal — three measures over its step-deltas: magnitude `V` (loudness), net `D` (direction), coherence `ρ = D/V` (trend vs oscillation). Never one scalar: `−10 +10` → `V=20, D=0, ρ=0` = *unstable*, not zero.

**Relevance is the separate filter** — does that loud signal matter? `Relevance = Materiality × Loudness × Horizon`. A clean −4pp slide in a top-10% region (relevance critical) beats a −40% blip in a tiny one (relevance kills it on materiality).

### 3. Findings Are Structured Facts, Composed However You Like

- Open-ended: rules, statistics, ML, LLM — or just a bundle of signals
- Stored without user context, recontextualized later as Insights
- No "best" generation method — choose what works

### 4. Context Decides Framing — and Whether It Surfaces At All

**Same Finding:** A declining region is recovering (-40% → -30% → -10%), competition vanishing, now meeting forecast.

**Sales Manager Insight:** Rep on track to recover an important region

**Sales Rep Insight:** Turnaround possible — keep pushing, check all account orders

**CEO Insight:** *(nothing)* — an improving region never enters the "most problematic" view. Suppression is a valid output.

---

## 📊 Tiers 1–2: Metric & Comparative Metric (Database)

**Single source of truth.** Both are stored columns in `region_metrics` — the split is conceptual: *a number* vs *a number relative to something*.

**Tier 1 — Metric** (a level, no comparison): units, sales_eur, market_share. A bare metric can't be "-10%"; MAT Sales is just €4.2M.

**Tier 2 — Comparative Metric** (value vs one reference):
- **vs time** → growth_py_*, growth_pp_* (e.g. MAT Sales Growth = -10%)
- **vs baseline** → mshare_deviation, growth_vs_fcst_eur/units
- **vs peer distribution** → rank_units, rank_sales_eur, rank_mshare_dev, rank_growth_py, rank_growth_vs_fcst_eur, rank_trend_3m

### Period Types

- **Month** → 1-month snapshot
- **RollQ** → 3-month rolling
- **YTD** → Year-to-date
- **MAT** → Moving annual total (12-month, strongest for trends)

---

## 📈 Tier 3: Signal

**What:** a single comparative metric **watched over time** — its trajectory, nothing more.

> "MAT Sales Growth is -10% now — but -30% last month, -40% six months ago." → recovering.

A couple of columns are signals by construction (a comparison's own change): `rank_trend_3m`, `growth_pp_mshare_dev`. Most are read on demand by laying a comparative metric across `period_type` history.

**Signals are derived, not stored.** `region_metrics` is already a time series (25 consecutive months per slice), so a signal is just a **window function** (`LAG`/`LEAD`/`OVER`) over an existing column — described by four parameters: *metric · period_type (window width) · LAG(n) (step back) · read-out (raw or delta)*. We don't precompute signal columns (combinatorial explosion); the two that exist are just a **cache** of the most-used ones. Materialize only for performance.

```sql
-- "mshare_deviation on MAT: Now, -1M, -2M, plus a 3-month delta"
SELECT year_month, mshare_deviation AS now,
       LAG(mshare_deviation,1) OVER w AS m1,
       LAG(mshare_deviation,2) OVER w AS m2,
       mshare_deviation - LAG(mshare_deviation,3) OVER w AS delta_3m
FROM region_metrics
WHERE brand_name=:brand AND period_type=:period AND region_name=:region
WINDOW w AS (ORDER BY year_month);
```

### Signal strength (intrinsic) — three measures, never one scalar

Computed over the consecutive **step-deltas** of the trajectory (`knowledge.py → signal_strength()`):

| Measure | Formula | Question |
|---------|---------|----------|
| **Magnitude** `V` | `Σ \|step δ\|` (total variation) | how *loud*? (≥0) |
| **Net** `D` | `now − start` (signed Σδ) | which *way*, how far net? |
| **Coherence** `ρ` | `D / V` ∈ [−1,1] | *trend* (\|ρ\|→1) or *oscillation* (ρ→0)? |

Why all three: unsigned `V` alone is "neither good nor bad"; signed `D` alone hides oscillation (`−10 +10 = 0`). Keeping both + the ratio `ρ` (signed Kaufman Efficiency Ratio) separates loudness, direction, and trend-vs-noise. `−10/+10` → `V=20, D=0, ρ=0` = **unstable**, not strength-zero. Convenience scalar: `signed_strength = D·|ρ|`.

### Relevance (extrinsic filter — does the loud signal matter?)

Separate from strength: `relevance = materiality × loudness × horizon` (`relevance_score()`). Coherence does *not* enter — it picks the archetype, not the importance.

| Factor | Levels | Source |
|--------|--------|--------|
| **Materiality** | rank ≥90→4 · ≥75→3 · ≥50→2 · <50→1 | `rank_sales_eur` |
| **Loudness** | `V` very_loud→4 · loud→3 · moderate→2 · quiet→1 | magnitude `V` |
| **Horizon** | MAT 4 · YTD 3 · RollQ 2 · Month 1 | period_type |

---

## 🧩 Tier 4: Finding

Open-ended composition of any lower facts — usually several signals. Compose with whatever helps, **or nothing**:

1. **IF/THEN Rules** → `IF rank>=80 AND growth < median-10pp THEN crisis`
2. **K-Nearest Neighbors** → Compare to 5 nearest peers' metrics
3. **Clustering** → Detect behavioral groupings; flag cluster changes
4. **Classification** → ML model trained on labeled regions
5. **LLM Synthesis** → AI reads the stored facts + Signal definitions
6. **Just a bundle of signals** → valid if you have no better composition

### Finding Archetypes

| Type | Pattern | Example | Action |
|------|---------|---------|--------|
| **Star** | Growth ↑↑, Pos ↑, Momentum ↑ | +27.7% growth, improving position | Monitor sustainability |
| **Slowing Giant** | Growth ↑ BUT shrinking, Momentum ↓ | +18.2% BUT gap narrowing | Investigate slowdown |
| **Turnaround** | Was below, now in line, Gap ↑ | MS improved from -5.5pp to -3.5pp | Support momentum |
| **Deteriorating** | Growth ↓, Pos ↓, Momentum ↓ | -4.2% miss, 3Q decline | Diagnose & intervene |
| **Riding Wave** | Growth ↑↑ BUT Pos stable | +24% growth, +14pp vs FCST, no MS gain | Commodity/market-driven |
| **Weak Foundation** | Growth ↑ BUT Pos not improving | +14.6% growth, -3.2pp below peers | Secondary market |
| **Dangerous Stability** | Growth → BUT Pos ↓ | +7.8% steady, -0.7pp to -1.5pp | Competitive response needed |
| **Unstable / Erratic** | Loud `V` BUT `\|ρ\|`→0 | −10pp then +10pp: V=20, net=0 | Check data/volatility, don't read a trend |

---

## 🎓 Tier 5: Insight

**Finding + business context** for a specific persona's decision.

All Insights answer: WHO? WHEN? WHAT? HOW MUCH? WHY? — and may resolve to **silence** when the Finding is irrelevant to that persona.

The three personas in this system:
- **Sales Manager** → all territories, monthly; plans with each rep
- **Sales Rep** → only their own territory, every region in detail
- **CEO** → only the *most problematic* regions and territories

Same Finding (a recovering region) → Manager sees a recovery on track, Rep gets a "keep pushing, check accounts" nudge, CEO sees nothing.

---

## 🗄️ Storage: Three Stores

| Store | Holds | Tiers |
|-------|-------|-------|
| **`region_metrics`** (SQL) | metrics + comparative metrics — the source of truth | 1–2 |
| **Knowledge Definitions** | *definitions*: signal templates, finding recipes, insight framings | the "how" for 3–5 |
| **Finding catalog** ("book of facts") | composed findings, each with a JSON provenance snapshot of its signals | 4 |

**Do we collect Signals as JSON in a separate store, next to Findings?** No separate store of signal *values* — they regenerate from `region_metrics`. JSON appears in exactly one place: **inside each Finding**, as the snapshot of the signals + values that produced it. So a Finding carries its own evidence, with no parallel signal table that could drift.

The Finding catalog is **append-only immutable history**: a Finding is never expired or edited — it records what was true and material *then*, anchored to its data snapshot. A changed reality is a *new* Finding, so the catalog accumulates into a time series of facts (and a run of Findings is itself a signal). How business context maps onto these facts is worked through in [`ANALYSIS_FRAMEWORK.md`](ANALYSIS_FRAMEWORK.md) → *Design: Mapping Business Context to Findings* (context-free facts · deterministic read-time framings · LLM phrasing on survivors only).

## 📚 Knowledge Definitions

The curated library of **definitions, not values** — institutional memory of *what's worth looking at and how to read it*. A concrete artifact in the repo:

- **`knowledge_definitions.json`** — the store (signal templates · finding recipes · insight framings · relevance weights)
- **`knowledge.py`** — loads + validates it against the live schema and compiles signals to SQL

```bash
python3 knowledge.py                      # summary + validation
python3 knowledge.py --signal mshare_dev_mat_trend_3m   # show the LAG/OVER SQL it compiles to
```

Three kinds of entries:

1. **Signal templates** — a named binding of the four signal parameters + an interpretation (e.g. `mshare_dev_mat_trend_3m`); compiles to a window query on demand.
2. **Finding recipes** — the rules / clustering configs / model prompts that compose signals into a Finding archetype (declares `requires_signals`).
3. **Insight framings** — per-persona `surface_when` / `suppress_when` rules: what to surface, how to phrase, and when to stay silent.

It is **authored by analysts** (an Option-1 custom SQL signal becomes a saved, named entry), **version-controlled and auditable** like code, and stores the *how* — never the *what*. Update the metric table once → every entry re-derives. Hot entries get promoted to cached columns purely for speed.

---

## 🔗 Interactive Reports

### schema.html
- 3-column diagram: Dimensions | Facts | Metrics
- Clickable metric definitions (formulas + plain English)
- Light 💡 / Dark 🌙 theme toggle
- Expandable Framework section with all tiers

### problem_report.html
- Franchise tabs (one per brand)
- Territory summaries (2-3 bolded sentences per region)
- Volume-weighted scoring (rank-based importance)
- Tags: whale_declining, long_slide, sudden_drop, missing_plan

---

## 🎬 Example Workflow

```
User: "What's wrong with Zürich 8051 in Oncleris?"

System:
1. Fetches stored metrics + comparative metrics (Tiers 1-2) for Zürich 8051
   + Oncleris brand median
2. Reads each comparative metric over time → Signals (growth_py, growth_vs_fcst,
   mshare_dev, rank_trend, each as a trajectory)
3. Filters by relevance (materiality, persistence — drops one-off noise)
4. Composes the surviving signals into a Finding (Tier 4)
   → Archetype: "Deteriorating" (growth ↓, pos ↓, momentum ↓)
5. [If a persona is given] Reframes as an Insight (Tier 5)
   → Sales Rep: "Region trending negative 3 quarters — check accounts and
     push for orders this week."
   → CEO: surfaced (it's a problem region); Sales Manager: folds into the plan.
```

---

## 📚 Complete Documentation

**Everything is in** [`ANALYSIS_FRAMEWORK.md`](ANALYSIS_FRAMEWORK.md):

- How to run (both scripts, both servers)
- File structure (directory layout, grain, row counts)
- Data flow (the five tiers, detailed)
- Tiers 1–2: metrics & comparative metrics (definitions, formulas, examples)
- Tier 3: signals (trajectory reading + relevance filter, interpretation tables)
- Tier 4: findings (7 archetypes, composition methods, schema)
- Tier 5: insights (personas, context dimensions, suppression)
- Reference tables (gap categories, lookup tables)

---

## ✨ Key Principles

1. **Each tier adds exactly one thing** (don't collapse metric/comparison/signal/finding)
2. **Strength (loud + clean) ≠ relevance (does it matter)** — strength is magnitude·net·coherence; relevance is Materiality × Loudness × Horizon
3. **Findings ≠ LLM-only** (rules, stats, ML, or just signals all work)
4. **One source of truth** (Tiers 1–2 stored; signals/findings/insights on-demand)
5. **Context decides framing and whether it surfaces** (same Finding → different insight, or silence)

---

## Questions?

This system is **five tiers**, each adding one thing:
- **Metric** → a number
- **Comparative Metric** → vs a reference
- **Signal** → watched over time
- **Finding** → composed with other facts
- **Insight** → who it matters to & why (or silence)

👉 **Start with [ANALYSIS_FRAMEWORK.md](ANALYSIS_FRAMEWORK.md)** to understand how they fit together.
