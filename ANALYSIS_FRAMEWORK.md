# SQL-Metrics Analysis Framework

Complete guide to pharmaceutical regional sales analysis: from raw data through advanced insights generation.

---

## Quick Start: How to Run

### 1. Generate the Database & Metrics

```bash
cd /Users/alenbalja/projects/SQL-Metrics
python3 compute_metrics.py
```

**What it does:**
- Creates `metrics.db` (SQLite database)
- Populates dimension tables: brands, skus, regions, competitors
- Populates fact tables: sales, forecast (synthesized data)
- Computes `region_metrics` table with 136,200 rows (25 months × 4 period types × 6 brands × 227 regions)
- Calculates all Tier 1 metrics: growth, market share deviation, NTILE ranks, etc.

**Output:** `metrics.db` ready for analysis

### 2. Generate Reports

```bash
python3 generate_report.py
```

**What it does:**
- Reads `metrics.db`
- Applies volume weighting to identify problematic regions
- Generates `problem_report.html` with franchise-tabbed interface
- Shows regions with: whales declining, long slides, sudden drops, missing forecasts

**Output:** `problem_report.html` (open in browser)

### 3. View the Schema

```bash
# Server already running on port 8765
open http://localhost:8765/schema.html
```

**Features:**
- Interactive 3-column diagram: Dimensions | Facts | Computed Metrics
- Clickable metric definitions with formulas
- Light/dark theme toggle
- Expandable Analysis Framework section

---

## What Is Where: File Structure

```
/Users/alenbalja/projects/SQL-Metrics/
├── README.md
│   └─ Quick overview, links to full documentation
│
├── ANALYSIS_FRAMEWORK.md (THIS FILE)
│   └─ Complete system design, all tiers, all methods
│
├── metrics.db
│   ├── brands (6 rows) — Brand names, franchises
│   ├── skus (9 rows) — SKU details, pricing
│   ├── regions (227 rows) — Postal code regions
│   ├── competitors (16 rows) — Competitor products
│   ├── sales (110,291 rows) — Raw sales facts, own & competitors
│   ├── forecast (186 rows) — National forecast baseline
│   └── region_metrics (136,200 rows) — Computed metrics (Tier 1)
│
├── Python Scripts:
│   ├── compute_metrics.py
│   │   └─ Generates region_metrics table + all Tier 1-2 metrics
│   ├── generate_report.py
│   │   └─ Creates problem_report.html with volume-weighted scoring
│   └── knowledge.py
│       └─ Loads/validates Knowledge Definitions; compiles signals to SQL
│
├── Knowledge Definitions:
│   └── knowledge_definitions.json
│       └─ Signal templates · finding recipes · insight framings · relevance (Tiers 3-5 "how")
│
├── HTML Reports:
│   ├── schema.html
│   │   └─ Interactive database diagram + metrics reference + framework
│   ├── problem_report.html
│   │   └─ Franchise-level report with problem regions
│   └── signals_findings.html
│       └─ Example signals & findings (reference)
│
└── Data Model Grain (region_metrics):
    25 months × 4 period_types × 6 brands × 227 regions = 136,200 rows
```

---

## Data Flow Overview: From Metric to Insight

Each tier adds **exactly one** thing to the tier below:

**Metric** (a number) → **Comparative Metric** (…vs a reference) → **Signal** (…watched over time) → **Finding** (…composed with other facts) → **Insight** (…who it matters to & why).

```
┌─────────────────────────────────────────────────────┐
│ RAW DATA (Tier 0)                                   │
├─────────────────────────────────────────────────────┤
│ sales (110K rows)           Dimensions:
│ ├─ units, sales_eur         ├─ brands
│ ├─ region, territory         ├─ skus
│ └─ year_month               ├─ regions
│                              └─ competitors
│ forecast (186 rows)
│ └─ national by SKU/month
└─────────────────────────────────────────────────────┘
                    ↓ [compute_metrics.py]
┌─────────────────────────────────────────────────────┐
│ TIER 1: METRIC — a single number, one point in time │
├─────────────────────────────────────────────────────┤
│ A Sum or level. No comparison yet.                  │
│ • units, sales_eur, market_share                   │
│ • e.g. MAT Sales = €4.2M  (not "-10%" — just €4.2M) │
└─────────────────────────────────────────────────────┘
                    ↓ [compare to ONE reference]
┌─────────────────────────────────────────────────────┐
│ TIER 2: COMPARATIVE METRIC — value vs one reference │
├─────────────────────────────────────────────────────┤
│ Still ONE number — but now it means something.      │
│ • vs last year:    growth_py_*                     │
│ • vs last period:  growth_pp_*                     │
│ • vs national avg: mshare_deviation                │
│ • vs forecast:     growth_vs_fcst_*                │
│ • e.g. MAT Sales Growth = now vs last year = -10%  │
│                                                     │
│ Tiers 1+2 are stored columns in region_metrics —    │
│ the SINGLE SOURCE OF TRUTH.                          │
└─────────────────────────────────────────────────────┘
                    ↓ [watch the SAME comparison over time]
┌─────────────────────────────────────────────────────┐
│ TIER 3: SIGNAL — a comparative metric's trajectory  │
├─────────────────────────────────────────────────────┤
│ The same comparative metric tracked across periods. │
│ Nothing more. The signal IS the direction.          │
│                                                     │
│ "MAT Sales Growth is -10% now — but last month it   │
│  was -30%, and 6 months ago -40%."                  │
│ → Read: not as bad as -10% looks alone; RECOVERING. │
│                                                     │
│ Stored shape: rank_trend_3m, growth_pp_mshare_dev   │
│ (a comparison's own change = growth-of-growth)      │
└─────────────────────────────────────────────────────┘
                    ↓ [compose with other facts]
┌─────────────────────────────────────────────────────┐
│ TIER 4: FINDING — open-ended composition of facts   │
├─────────────────────────────────────────────────────┤
│ Combine ANY lower facts: metrics, comparative        │
│ metrics, and (usually several) signals. Rarely one   │
│ fact; in theory it could be.                         │
│                                                     │
│ "Sales Growth recovering (-40→-30→-10) AND          │
│  competition vanishing AND now meeting forecast."   │
│                                                     │
│ Compose however you like — or not: IF/THEN rules,    │
│ KNN, clustering, classification, LLM, or just a      │
│ bundle of signals. Optional, method-agnostic.        │
│ Archetypes: Star / Turnaround / Slowing Giant /     │
│ Deteriorating / Riding Wave / Weak Foundation /     │
│ Dangerous Stability                                 │
│                                                     │
│ ➜ NO USER CONTEXT YET (just a structured fact)     │
└─────────────────────────────────────────────────────┘
           ↓ [add business context]
┌─────────────────────────────────────────────────────┐
│ TIER 5: INSIGHT — who, when, what, & why it matters │
├─────────────────────────────────────────────────────┤
│ Finding + business context. The SAME finding yields │
│ a different insight — OR NONE AT ALL — per persona.  │
│                                                     │
│ From the recovering-region finding:                 │
│ ➜ Sales Manager (all territories, monthly):         │
│    "Rep seems on track to recover an important       │
│     region."                                        │
│ ➜ Sales Rep (own territory in detail):              │
│    "Turnaround looks possible — keep pushing. Check  │
│     all accounts for order status."                 │
│ ➜ CEO (only the most problematic):                  │
│    nothing surfaced — region is improving.          │
│                                                     │
│ ➜ CONTEXT DECIDES BOTH FRAMING AND WHETHER IT       │
│   SURFACES AT ALL                                   │
└─────────────────────────────────────────────────────┘
                         ↓
                   USER-FACING REPORTS
```

---

## Tier 1: Metric (Database Layer)

### What It Is

A **single value at one point in time** — a Sum or a level, with no comparison baked in. Stored in `region_metrics`.

| Metric | Definition | Example |
|--------|-----------|---------|
| `units` | Total units sold | 1,250 |
| `sales_eur` | Total sales value | €125,000 |
| `market_share` | Brand % of franchise market | 45.2% |

**The test:** "Is MAT Sales −10%?" No — MAT Sales is just €4.2M. A bare metric can't be "−10%"; that already implies a comparison, which is the next tier.

---

## Tier 2: Comparative Metric (Database Layer)

### What It Is

**One value measured against exactly one reference.** Still a single number — but now it carries meaning. `MAT Sales Growth = MAT Sales now vs last year = −10%`.

Tiers 1 and 2 are both stored columns in `region_metrics` — the **single source of truth**. The split is conceptual, not physical: it's the difference between *a number* and *a number relative to something*.

#### 2a. vs Time (Growth)

| Metric | Formula | Example |
|--------|---------|---------|
| `growth_py_sales` | (Sales_t - Sales_t-12) / Sales_t-12 × 100 | +15.3% |
| `growth_pp_sales` | (Sales_t - Sales_t-shift) / Sales_t-shift × 100 | -2.1% |
| `growth_py_units` | (Units_t - Units_t-12) / Units_t-12 × 100 | +8.7% |
| `growth_pp_units` | (Units_t - Units_t-shift) / Units_t-shift × 100 | -1.5% |
| `growth_py_mshare_dev` | MSDev_t - MSDev_t-12 | +0.8pp |
| `growth_pp_mshare_dev` | MSDev_t - MSDev_t-shift | +0.3pp |

#### 2b. vs Baseline (Peer / National / Forecast)

| Metric | Definition | Example |
|--------|-----------|---------|
| `mshare_deviation` | Region MS - National avg MS | -2.6pp |
| `growth_vs_fcst_eur` | Actual growth - National forecast growth (EUR) | +8.5pp |
| `growth_vs_fcst_units` | Actual growth - National forecast growth (units) | +3.2pp |

#### 2c. Ranks (vs Peer Distribution)

A rank is a comparative metric too — value vs the whole peer distribution, expressed as a percentile.

| Metric | Definition | Range |
|--------|-----------|-------|
| `rank_units` | Unit volume percentile | 1-100 |
| `rank_sales_eur` | Sales value percentile | 1-100 |
| `rank_mshare_dev` | Market share deviation percentile | 1-100 |
| `rank_growth_py_sales` | YoY growth percentile | 1-100 |
| `rank_growth_vs_fcst_eur` | Forecast beat percentile | 1-100 |

**Key Principle**: Ranks only meaningful within group ranked (brand × period type × timeframe).

---

## Tier 3: Signal

### What Is a Signal?

A Signal is **a single comparative metric watched over time** — its own trajectory. That's the whole definition. It takes one Tier-2 number and asks: which way is it moving?

> "MAT Sales Growth is **−10%** now — but last month it was **−30%**, and 6 months ago **−40%**."

Looking at the −10% alone, the region looks like it's losing. The signal reframes it: the comparison itself is **recovering**. The signal definition ends right here — it adds the time axis to one comparative metric and nothing else.

Two stored columns are signals by construction — a comparison's own change over time:

| Stored Signal | Definition |
|---------------|-----------|
| `rank_trend_3m` | rank_sales_eur[t] − rank_sales_eur[t−3] (rank moving over time) |
| `growth_pp_mshare_dev` | how the market-share-deviation comparison itself shifts period-over-period |

Most signals, though, are read on demand by laying a comparative metric out across `period_type` history.

### Signals Are Derived, Not Stored

The `region_metrics` table is **already a time series** — for every (region, brand, period_type) there are 25 consecutive monthly rows. The full history of every comparative metric is therefore already sitting in adjacent rows. A Signal is not new data to store; it is a **window read** over a column that already exists, via SQL window functions (`LAG` / `LEAD` / `OVER`).

This means we do **not** precompute signals as columns. Doing so would be a combinatorial explosion (≈8 comparative metrics × 4 period_types × ~12 lookbacks × {raw, delta} ≈ thousands of columns) and would still hard-code which lookbacks an analyst wants. The two signal-shaped columns that *do* exist (`rank_trend_3m`, `growth_pp_*`) are not a modeling decision — they are a **cache** of the two most-used signals.

A Signal is fully described by four parameters:

| Parameter | Maps to | Example |
|-----------|---------|---------|
| which comparative metric | a column | `mshare_deviation` |
| aggregation window | `period_type` | MAT vs RollQ |
| how far back to step | `LAG(n)` | −1M, −2M, −3M |
| what to read out | raw lag, or a delta | `now − LAG(3)` |

**The two axes are orthogonal:** `period_type` is the *window width* (MAT = 12-month, RollQ = 3-month), and `LAG(n)` is the *step back in time*. "mshare_deviation on RollQ −3Month" = `LAG(3)` within `period_type='RollQ'`. Because the series is monthly-grained, `n` is always counted in calendar-month rows regardless of period_type — that uniformity is what lets one template cover every signal.

#### The Signal Template (the "magic method")

A single parameterized window query generates any signal — the example the analyst runs for Option-1-style custom signals:

```sql
-- mshare_deviation on MAT: Now, −1M, −2M, plus a 3-month delta
SELECT year_month,
       mshare_deviation                          AS now,
       LAG(mshare_deviation, 1) OVER w           AS m1,
       LAG(mshare_deviation, 2) OVER w           AS m2,
       mshare_deviation - LAG(mshare_deviation, 3) OVER w AS delta_3m
FROM region_metrics
WHERE brand_name = :brand
  AND period_type = :period          -- the aggregation window
  AND region_name = :region
WINDOW w AS (ORDER BY year_month);   -- LAG(n) = the step back
```

Sensible defaults (Now and −1M for every comparative metric) fall out for free as the most common parameter binding — never stored, just generated. Materialize a signal as a column **only** for performance, when one is queried so often that the window scan over 136K rows becomes a bottleneck. That is a caching decision, not a modeling one — and it is exactly the justification behind `rank_trend_3m` today.

### Signal Structure (vs-peer variant)

A common, useful framing tracks the comparative metric as a **gap to peer median** and watches that gap move:

### Signal Structure

```
[Metric] in [Period Type]
├─ Current: [Value] vs peer median [Median] = [Gap] vs peers
├─ Previous: [Value] vs peer median [Median] = [Gap] vs peers
├─ Momentum: [Gap]prev → [Gap]current = [Δ Change]
└─ Status: [Icon] [Interpretation]
```

### Example Signal

```
Growth YoY (RollQ)
Current: 27.7% vs median 0.0% = +27.7pp vs peers
Previous: 16.2% vs median 0.0% = +16.2pp vs peers
Momentum: +16.2pp → +27.7pp = +11.5pp WIDENING
Status: 🚀 Exceptionally strong and accelerating
```

## Signal Strength (Intrinsic) vs Relevance (Extrinsic)

These are **two different questions**, and conflating them is a mistake:

- **Signal strength** — *how loud and how clean is this trajectory?* A property of the signal itself. A small region can throw a very strong signal that simply doesn't matter for business.
- **Relevance** — *does this loud signal land somewhere worth acting on?* Region size, € at stake, durability. Applied downstream, at the Finding/Insight gate.

Keep them apart. Strength is computed from the trajectory; relevance multiplies that by business context.

### Signal Strength — three measures, never collapsed to one

Computed over the **consecutive step-deltas** of the metric across the signal's window (values oldest → now). A single scalar cannot hold a trajectory, so we keep three measures (definitions in `knowledge_definitions.json → signal_strength`; computed by `knowledge.py → signal_strength()`):

| Measure | Formula | Question it answers |
|---------|---------|---------------------|
| **Magnitude** `V` | `Σ \|step δ\|` — total variation / path length | *How loud?* (≥ 0, in pp) |
| **Net** `D` | `value_now − value_start` (= signed `Σδ`, it telescopes) | *Which way, and how far net?* sign(D) = good/bad |
| **Coherence** `ρ` | `D / V` ∈ [−1, +1] | *Trend or oscillation?* |

`ρ` is the signed **Kaufman Efficiency Ratio** (net displacement ÷ distance travelled). It is exactly what resolves the two classic failure modes:

- **Unsigned `V` alone** is "neither good nor bad" — it has no direction. → fixed by `sign(D)`.
- **Signed `D` alone** hides oscillation: `−10` then `+10` nets to `0` and *looks* like no signal. → `V` catches it: `V = 20` (very loud), `D = 0`, `ρ = 0`. Not strength-zero — a loud **oscillation**.

Convenience scalar (for sorting, never a replacement): **`signed_strength = D · |ρ|`** — net discounted by incoherence; equals `D` for a perfectly clean trend, → 0 for a pure oscillation.

#### Shapes (V × ρ)

| Shape | Condition | Meaning | Feeds |
|-------|-----------|---------|-------|
| **quiet** | `V < moderate` | nothing to report | — |
| **trend** | `V ≥ loud` and `\|ρ\| ≥ 0.6` | clean directional move | Turnaround (ρ>0) / Deteriorating (ρ<0) |
| **unstable** | `V ≥ loud` and `\|ρ\| < 0.3` | loud but going nowhere net | **Unstable / Erratic** |
| **mixed** | otherwise | some movement, partial direction | — |

(`loud`/`moderate` pp thresholds and the coherence cut-offs are tunable knobs in `signal_strength.loudness_bands_pp` / `coherence_bands`.)

#### Worked examples — real `mshare_deviation` on MAT, Oncleris (franchise Oncology), as-of 2026-05

```
region                     series (m3→now)        V     D     ρ    direction      shape
ZH Zürich 8002/38/41/45  [-5.60,-4.92,-4.71,-4.36] 1.24 +1.24 +1.00 improving      trend     ← clean recovery
ZH Zürich 8006/44        [-5.23,-5.41,-4.79,-4.55] 1.04 +0.68 +0.65 improving      trend     ← dipped then recovered
BE Bern 3018/19/20/27    [-4.39,-4.45,-5.11,-5.39] 1.00 -1.00 -1.00 deteriorating  trend     ← clean decline
(synthetic)              [ 0.00,+10.0, 0.00]       20.0  0.00  0.00 flat           unstable  ← the −10+10 case
```

The top region: below national average (−4.36pp) but the gap is **closing cleanly** — `V = D = 1.24`, `ρ = +1.0`. The synthetic oscillation is loud (`V = 20`) yet directionless (`ρ = 0`) → classified **unstable**, not ignored.

### Relevance — does the loud signal matter?

`relevance = materiality × loudness × horizon` (`knowledge.py → relevance_score()`). Coherence does **not** enter relevance — it selects *which archetype*, not *how much it matters*.

| Factor | Levels | Source |
|--------|--------|--------|
| **Materiality** | rank ≥90 → 4 · ≥75 → 3 · ≥50 → 2 · <50 → 1 | `rank_sales_eur` |
| **Loudness** | `V` very_loud → 4 · loud → 3 · moderate → 2 · quiet → 1 | magnitude `V` |
| **Horizon** | MAT 4 · YTD 3 · RollQ 2 · Month 1 | period_type |

Band: critical ≥48 · high ≥24 · moderate ≥8 · low <8. The top Oncleris region scores materiality 4 × loudness 3 × horizon 4 = **48 → critical** — a loud, clean signal *and* in the most material region, so it earns attention.

**Key insight (unchanged, now precise):** a clean −4pp slide in a top-10% region (loud `V`, `ρ ≈ −1`, materiality 4) outranks a −40% one-month blip in a tiny region (relevance kills it on materiality), and a `−10/+10` swing is no longer invisible — it surfaces as *unstable*, not *nothing*.

### Signal Interpretation Lookup Tables

#### For GROWTH Metrics (Higher = Better)

| Current Gap | Momentum | Status | Meaning |
|------------|----------|--------|---------|
| **+10pp+** | WIDENING | 🚀 Exceptional & accelerating | Star: crushing peers and pulling away |
| **+10pp+** | STABLE | ✅ Exceptional & holding | Elite: sustained strong execution |
| **+10pp+** | SHRINKING | ⚠️ Exceptional but losing steam | Weakening; still ahead but turning |
| **+5 to +10pp** | WIDENING | 📈 Strong & accelerating | Gaining on peers; positive trajectory |
| **+5 to +10pp** | STABLE | ✓ Consistently strong | Solid performer at peer level |
| **+5 to +10pp** | SHRINKING | ⚠️ Strong but slowing | Still above peers but losing ground |
| **-5 to +5pp** | WIDENING | → Turning positive | Catching up; momentum shift up |
| **-5 to +5pp** | STABLE | → Neutral | In line with peers; no relative change |
| **-5 to +5pp** | SHRINKING | → Turning negative | Losing relative ground; momentum down |
| **-5 to -10pp** | WIDENING | ⚠️ Weak but improving | Below peers but catching up |
| **-5 to -10pp** | STABLE | ❌ Consistently below | Underperforming vs peers |
| **-5 to -10pp** | SHRINKING | 📉 Weak & worsening | Falling further behind |
| **-10pp+** | WIDENING | ⚠️ Far behind but recovering | Struggled but showing improvement |
| **-10pp+** | STABLE | ❌ Critically weak | Significant laggard |
| **-10pp+** | SHRINKING | 🔴 Crisis: worsening rapidly | Needs urgent intervention |

#### For POSITION Metrics (Higher = Better)

| Current Gap | Momentum | Status | Meaning |
|------------|----------|--------|---------|
| **+1.0pp+** | IMPROVING | ✅ Strong position & gaining | Has advantage and increasing it |
| **+1.0pp+** | STABLE | ✅ Strong position maintained | Holds structural advantage |
| **+1.0pp+** | DECLINING | ⚠️ Strong but slipping | Losing market share advantage |
| **+0.5 to +1.0pp** | IMPROVING | ⚪ Improving position | Gaining relative market share |
| **+0.5 to +1.0pp** | STABLE | ⚪ Above peer average | Better than typical peer |
| **+0.5 to +1.0pp** | DECLINING | ⚠️ Losing edge | Relative advantage eroding |
| **-0.5 to +0.5pp** | IMPROVING | → Moving toward advantage | Improving relative to peers |
| **-0.5 to +0.5pp** | STABLE | → Aligned with peers | MS in line with national |
| **-0.5 to +0.5pp** | DECLINING | → Moving toward disadvantage | Losing relative position |
| **-0.5 to -1.0pp** | IMPROVING | ⚠️ Below avg but gaining | Catching up from disadvantage |
| **-0.5 to -1.0pp** | STABLE | ❌ Below peer average | Underperforms typical peer |
| **-0.5 to -1.0pp** | DECLINING | 📉 Below & worsening | Losing market share ground |
| **-1.0pp+** | IMPROVING | ⚠️ Significant gap but closing | Recovering from disadvantage |
| **-1.0pp+** | STABLE | ❌ Severely disadvantaged | Structural market share deficit |
| **-1.0pp+** | DECLINING | 🔴 Worsening crisis | Position deteriorating |

---

## Tier 4: Finding

### What Is a Finding?

A Finding is an **open-ended composition of any lower-tier facts** — simple metrics, comparative metrics, and (most often) several signals. It rarely reduces to a single data point, though in theory it could.

> "Sales Growth is recovering (−40 → −30 → −10) **AND** competition is vanishing **AND** the region is now meeting forecast."

Each clause above is a lower-tier fact; the Finding is the useful combination of them. This is where you may bring in whatever machinery helps — IF/THEN rules, KNN, clustering, classification, LLM synthesis — **or nothing at all**: a Finding can simply be a bundle of signals if you have no better way to compose them. It is a **structured fact, not yet narrative for a user**, stored in a catalog and later recontextualized as Insights.

The methods below are *options* for composing Findings, not requirements.

### Method 1: IF/THEN Rules (Deterministic)

Simple rule-based pattern detection.

```
Rule 1: Consistent Forecast Miss
IF region_MAT_CurrentMonth < FCST AND region_MAT_PreviousMonth < FCST
THEN Finding.type = "ConsecutiveForecastMiss"
     Finding.duration = "2+ periods"
     Finding.strength = "moderate" (if 2) or "high" (if 3+)

Rule 2: Deteriorating Trajectory
IF rank_t0 - rank_t1 < -10 AND rank_t1 - rank_t2 < -10
THEN Finding.type = "RapidDeteriorationTrend"
     Finding.duration = "2+ periods"
     Finding.strength = "high"

Rule 3: Volume-Weighted Crisis
IF rank_sales_eur >= 80 AND 
   growth_py_sales < (brand_median_growth - 10pp) AND
   persists 2+ periods
THEN Finding.type = "BigRegionUnderperformance"
     Finding.strength = "critical"
     Finding.materiality = "high"
```

### Method 2: K-Nearest Neighbors (Pattern-Based)

Compare region to its K nearest neighbors.

```python
For each region R:
  1. Find K=5 nearest regions (by growth, MS deviation, rank profile)
  2. Compare R's metrics to neighbors' median
  3. If R deviates on 2+ metrics:
     Finding.type = "OutlierProfile"
     Finding.strength = distance_to_KNN_cluster
```

### Method 3: Clustering (Macro Behavior)

Group regions into behavioral clusters, flag cluster changes.

```python
For each period:
  1. Cluster all regions on (growth, MS deviation, rank)
  2. Assign regions to clusters (e.g., "HighGrowthHighRank")
  3. Track cluster membership period-over-period
  4. If region changes cluster:
     Finding.type = "ClusterChange"
     Finding.strength = "high"
```

### Method 4: Classification (ML-Based)

Train classifier on labeled regions (healthy/at-risk/exceptional).

```python
For each region:
  1. Compute features (growth, growth_vs_fcst, MS dev, rank trend)
  2. Run through trained classifier
  3. Get prediction + confidence
  
If confidence > threshold:
   Finding.type = "RiskClassification"
   Finding.predicted_class = "at_risk" | "healthy" | "exceptional"
   Finding.confidence = 0.92
```

### Method 5: LLM Synthesis (Narrative AI)

Use LLM to read Tier 1 data and generate Finding narratives with Signal definitions.

### Decision Tree: Choosing a Method

```
Do you need explainability to non-technical stakeholders?
  YES → Use IF/THEN Rules or LLM Synthesis
  NO  → Can use Statistical Methods

Do you have labeled training data?
  YES → Use Classification
  NO  → Use Clustering or IF/THEN Rules

Do you need fast, deterministic execution?
  YES → Use IF/THEN Rules
  NO  → Can use Statistical Methods or LLM

Do you need to capture nuance and business context?
  YES → Use LLM Synthesis
  NO  → Use IF/THEN Rules or Statistical Methods
```

### Eight Finding Types

#### 1. Stars - High Performers with Positive Momentum

**Pattern**: Growth well above brand median + WIDENING gap + Market position above peers + IMPROVING

**Example**: Region growing at +27.7% vs median 0.0%, gap widened from +16.2pp to +27.7pp

**Narrative**: Exceptional growth, pulling further ahead of peers, gaining market share

**Action**: Monitor for sustainability; replicate practices across similar regions

---

#### 2. Slowing Giants - Strong but Losing Momentum

**Pattern**: Growth still above brand median BUT gap SHRINKING + Market position worsening

**Example**: Region growing at +18.2% (strong) but gap narrowed from +10.9pp to +7.3pp

**Narrative**: Still strong but momentum turning negative; execution needs focus

**Action**: Investigate cause of slowdown before position deteriorates further

---

#### 3. Turnarounds - Recovering from Weakness

**Pattern**: Was below/far below median, now in line or above + Gap IMPROVING significantly

**Example**: Was -5.5pp below national MS, now -3.5pp, showing consistent 6-month recovery

**Narrative**: Clear recovery trajectory; structural improvements evident

**Action**: Support what's working; continue momentum-building actions

---

#### 4. Deteriorating - Regions in Decline

**Pattern**: Growth below brand median AND gap SHRINKING further + Market position declining + momentum negative

**Example**: -4.2% FCST miss on MAT, worsening 3 consecutive quarters, MS deviation declining

**Narrative**: Dual problem—structural underperformance + trend worsening + execution miss

**Action**: Diagnose root cause (execution, market, staffing); consider intervention

---

#### 5. Riding the Wave - Strong Absolute, Stable Relative

**Pattern**: Absolute growth high (beating forecast significantly) BUT relative gap STABLE

**Example**: +24.1% growth, +14pp vs FCST, but market position gap unchanged at -4.6pp

**Narrative**: Strong absolute numbers but not outpacing peers; national market booming

**Action**: Good for revenue; if share growth is goal, need differentiation strategy

---

#### 6. Weak Foundation - Solid Growth on Low Base

**Pattern**: Growth above brand median BUT market position not improving OR gap still large

**Example**: +14.6% growth (above median), on-forecast, but -3.2pp below peers and recovering slowly

**Narrative**: Growing at healthy rate, not catching up to peers; secondary market

**Action**: Viable if efficiency goal; requires major investment to elevate to strategic status

---

#### 7. Dangerous Stability - Flat Performance, Declining Position

**Pattern**: Growth STABLE at modest levels BUT market position DECLINING

**Example**: +7.8% growth (steady) but MS deviation worsening from -0.7pp to -1.5pp

**Narrative**: No alarm bells but slowly losing market edge to competitors

**Action**: Proactive competitive response needed to reverse trend

---

#### 8. Unstable / Erratic - Loud but Going Nowhere

**Pattern**: High signal magnitude `V` (loud) BUT coherence `\|ρ\| < 0.3` (near-zero net) — the trajectory swings hard and ends roughly where it began

**Example**: mshare_deviation steps of −10pp then +10pp → `V = 20`, `D = 0`, `ρ = 0`

**Narrative**: Volatility *is* the finding. There is no trend to read; the position is oscillating, not moving.

**Action**: Investigate data quality, demand spikiness, or stocking/ordering noise before treating any single point as a trend. This is the archetype that the old "sum of deltas = 0" definition would have silently dropped.

---

## Storage Architecture: Three Stores

The framework persists in exactly three places. Tiers 1–2 are the source of truth; Tiers 3–5 are derived, and only *some* of what's derived is worth persisting.

| Store | Holds | Tiers | Lifecycle |
|-------|-------|-------|-----------|
| **`region_metrics`** (SQL) | metrics + comparative metrics | 1–2 | refreshed each period by `compute_metrics.py` — the single source of truth |
| **Knowledge Definitions** | *definitions*: signal templates, finding recipes, insight framings | the "how" for 3–5 | curated by analysts, version-controlled |
| **Finding catalog** ("book of facts") | composed findings, each embedding a JSON snapshot of the signals + values that produced it | 4 | generated on demand or scheduled |

### Do we collect Signals as JSON in a separate store, alongside Findings?

**No separate signal store of *values*.** Signal values regenerate from `region_metrics` on demand — the same one-source-of-truth rule that stops us precomputing signal columns. JSON appears in exactly one place: **inside a Finding**, as a provenance snapshot of the signals and metric values that composed it. A Finding is therefore self-explaining — you can read *why* it fired without re-running the queries — while you never maintain a parallel signal table that could drift from the metric table.

To be precise about where each thing lives:

- **Signal *definitions*** (the four parameters + interpretation) → Knowledge Definitions.
- **Signal *values*** → transient in query results; durable only as JSON embedded in the Findings they fed.
- **Findings** → the catalog (with that JSON provenance).
- **Insights** (Tier 5) → generated per persona at read time; optionally cached, never a source of truth.

### The Finding Catalog (the "Book of Facts")

Once generated (via any method), Findings are stored in a **structured catalog** — the durable record of Tier-4 facts. Each finding embeds the JSON snapshot described above, so it carries its own evidence.

**The catalog is append-only, immutable history.** A Finding is never expired, edited, or deleted — it is a record of *what was true and material at the moment it was produced*. A region that was "Deteriorating" in 2026-03 stays "Deteriorating in 2026-03" forever, even after it recovers; the recovery is simply a *new* Finding in a later period. Two consequences:

- Each Finding is **anchored to the data snapshot it was computed from** (`year_month` + a `data_version` stamp), so it is always reproducible and self-consistent — "produced how it mattered then."
- Because the catalog accumulates over time, **the Findings themselves form a time series** — and can become inputs to higher-order analysis ("this region has produced a Deteriorating finding four periods running"). A Finding is a fact; a sequence of Findings is, itself, a signal.

### Finding Schema

```
Finding {
  finding_id: UUID
  
  -- What
  type: string  // "ConsecutiveForecastMiss", "RapidDeteriorationTrend", etc.
  subtype: string?  // Optional: "outlier_high", etc.
  
  -- Where
  region_name: string
  brand_name: string
  territory_id: string
  franchise: string
  
  -- When
  year_month: string
  period_type: string  // Month, RollQ, YTD, MAT
  
  -- How strong
  strength: enum {critical, high, moderate, low}
  confidence: float (0-1)  // If from ML model
  materiality: float  // Region importance (rank-based)
  
  -- What changed (provenance snapshot — the evidence, as JSON)
  metric_names: [string]  // Which metrics triggered this
  current_values: {metric: value}
  previous_values: {metric: value}
  delta: {metric: change}
  signals: [{ metric, period_type, lag, readout, value }]  // the Tier-3 signals that fed this finding
  
  -- Why (no context)
  description: string  // Factual, no user context
  generation_method: enum {rule, knn, clustering, classification, llm}
  
  -- Metadata (immutable; append-only history)
  created_at: timestamp     // when this row was written
  data_version: string      // the region_metrics snapshot it was computed from — anchors it to "then"
  // no expiry, no updates: a Finding is never edited or deleted; a changed reality is a NEW Finding
}
```

### Storage Options

**Option A: SQLite Table (Recommended)**
```sql
CREATE TABLE findings (
  finding_id TEXT PRIMARY KEY,
  year_month TEXT,
  period_type TEXT,
  region_name TEXT,
  brand_name TEXT,
  type TEXT,
  subtype TEXT,
  strength TEXT,
  confidence REAL,
  materiality REAL,
  description TEXT,
  generation_method TEXT,
  metric_names TEXT,  -- JSON
  current_values TEXT,  -- JSON
  previous_values TEXT,  -- JSON
  signals TEXT,  -- JSON: the Tier-3 signals (params + values) that produced this finding
  created_at TIMESTAMP,
  data_version TEXT,  -- region_metrics snapshot this finding was rooted in (append-only; never updated)
  FOREIGN KEY (region_name, year_month) REFERENCES region_metrics
);
-- Append-only: INSERT only. No UPDATE/DELETE — a changed reality produces a new row.

CREATE INDEX idx_findings_region_time ON findings(region_name, year_month);
CREATE INDEX idx_findings_type ON findings(type, strength);
CREATE INDEX idx_findings_brand ON findings(brand_name, year_month);
```

---

## Knowledge Definitions

The **Knowledge Definitions** store is the curated library of **definitions, not values** — the institutional memory of *what the organization has learned is worth looking at, and how to read it.* It stores the *how* of Tiers 3–5; the *what* is always re-derived from `region_metrics`.

It is a concrete, version-controlled artifact in the repo:

- **`knowledge_definitions.json`** — the store itself (signal templates, finding recipes, insight framings, relevance weights).
- **`knowledge.py`** — loads + validates it against the live `region_metrics` schema, and compiles any signal template to its `LAG`/`OVER` SQL. Run `python3 knowledge.py` for a summary + validation, or `python3 knowledge.py --signal <id>` to see the SQL a template produces.

### Three Kinds of Entries

1. **Signal templates** — a named binding of the four signal parameters (`metric`, `period_type`, `lags`, `readout`) plus an interpretation of what the trajectory *means*. Example: `mshare_dev_mat_trend_3m` = "is our relative market-share position widening or closing over the last quarter, on a 12-month base?" Each compiles to a window query on demand.
2. **Finding recipes** — the rules / compositions / clustering configs / model prompts that combine signals (and other facts) into a Finding archetype. Method-agnostic: an IF/THEN rule and an LLM prompt are both just entries here. Each declares the signal templates it `requires_signals`.
3. **Insight framings** — per-persona rules for *what to surface, how to phrase it, and when to stay silent* (e.g. CEO sees only problem regions). Encoded as `surface_when` / `suppress_when` predicates.

### Properties

- **Authored by analysts.** An Option-1 custom SQL signal isn't bespoke throwaway code — it becomes a saved, named entry here, reusable by everyone.
- **Version-controlled and auditable.** It is "how we analyze," reviewable like source code. You can diff it, roll it back, and see who added which rule and why.
- **Stores the *how*, never the *what*.** Every entry regenerates fresh values whenever the data refreshes. Update the metric table once → every signal, finding, and insight re-derives. No duplicated data to fall out of sync.
- **Grows over time.** Sensible defaults seed it (Now + −1M for each comparative metric); analysts add custom signals and recipes; the most valuable get promoted, and the hottest get cached as columns in `region_metrics` purely for performance.

### How the Stores Connect

```
Knowledge Definitions (definitions: templates · recipes · framings)
        │  applied to
        ▼
region_metrics (source of truth — Tiers 1-2)
        │  window functions →
        ▼
Signals (Tier 3 — transient, regenerated)
        │  composed by recipes →
        ▼
Finding catalog (Tier 4 — persisted, with JSON provenance of its signals)
        │  framed per persona →
        ▼
Insights (Tier 5 — per persona at read time, or silence)
```

---

## Tier 5: Insight

### What Is an Insight?

An **Insight is a Finding plus business context** — *to whom, when, for what, and how it matters*. The same Finding produces a **different insight for each persona — or none at all** when the Finding is irrelevant to that person's job. Context decides both the framing and whether the Finding surfaces at all.

### Mandatory Context Dimensions

Every Insight must answer:

| Dimension | Meaning | Examples |
|-----------|---------|----------|
| **WHO** | The persona and what they look at | Sales Manager, Sales Rep, CEO |
| **WHEN** | Timing / cadence | Monthly planning, daily field work, board review |
| **WHAT** | The decision it feeds | Territory plan, account follow-up, escalation |
| **HOW MUCH** | Materiality | Region importance, € at stake |
| **WHY** | Business consequence | On track / needs a push / not their problem |

### Personas (this system)

| Persona | What they look at |
|---------|-------------------|
| **Sales Manager** | All territories, every month; builds the plan with each rep |
| **Sales Rep** | Only their own territory — but every region in detail |
| **CEO** | A picture of the *most problematic* regions and territories |

### Same Finding, Different Insights — or Silence

**Finding**: A previously declining region is recovering — MAT Sales Growth −40% → −30% → −10%, competition vanishing, now meeting forecast.

**Insight for the Sales Manager (monthly territory review):**
```
Your rep seems on track to recover an important region. Keep it on the plan
and confirm the trajectory holds next month.
```

**Insight for the Sales Rep (their own territory):**
```
Turnaround of this region looks possible — but keep pushing, it isn't won yet.
Check all accounts for the status of their orders.
```

**Insight for the CEO (most-problematic view):**
```
(nothing surfaced)
```
The region is *improving*, so it never enters the CEO's "most problematic" view. The same Finding correctly yields **no insight** for this persona — suppression is a valid, intended output.

---

## Design: Mapping Business Context to Findings

> Status: agreed design direction, not yet implemented. Captured here so the build doesn't re-litigate it.

**The question.** A context-free Finding ("region X is Deteriorating, 2026-03") has to become a per-persona Insight. Where does the business context — *who cares, what matters this month, who owns what* — get applied?

**The rejected option: bake context metadata into the Finding.** Tempting (it makes the LLM's job easy), but wrong on two axes:

- **Wrong *time*.** A Finding is written when the data refreshes; context ("who's asking," "this month's priorities") is a property of *read time*. Baking it in freezes a read-time decision into a write-time record — and since the catalog is append-only immutable history, that frozen context can never be corrected, only rot.
- **Wrong *cardinality*.** One Finding × N personas × shifting priorities is a cross product. Storing N lenses inside the 1 fact is an inversion: the Finding is the fact, the framings are the lenses. Keep them separate.

**The design: a three-layer split.**

1. **Findings Catalogue stays strictly context-free** (as specified above) — *what is true*, never *who cares*. This is exactly why it's safe to keep forever: facts anchored to their data snapshot don't rot the way opinions do.
2. **The mapping lives in Knowledge Definitions** — the `insight_framings` (`surface_when` / `suppress_when` / phrasing), evaluated **at read time** against the Finding's structured fields. When priorities change you edit a *definition* (version-controlled, diffable), never re-tag millions of stored facts. The CEO's "only deteriorating + critical + high-materiality" rule is one line that re-decides every Finding on every read.
3. **The LLM sits *on top of* the deterministic filter, not in place of it.** Selection is cheap, high-volume, and must be consistent and auditable → that's the `surface_when` predicates. Synthesis and phrasing of the few survivors → that's the LLM. So the LLM only ever runs on Findings that already passed a transparent gate: cheap, consistent, and you can always answer "why did the CEO see this / not that" without asking a model.

```
Finding (context-free fact, immutable)
   → insight_framing.surface_when?  ── no ─→ silence        [deterministic · auditable · cheap]
                                    └─ yes ↓
   → LLM renders it in the persona's voice, grounded in the JSON provenance   [expensive · survivors only]
```

**The one genuinely dynamic input** — *this month's priorities, which territories a rep owns, what was already escalated last cycle* — belongs in neither the Finding nor the static framing. It is a thin **read-time context object** passed in as the third argument alongside `Finding` + `framing`. Ephemeral by nature; never persisted into the fact.

**Net:** Findings Catalogue = append-only, context-free, provenance-carrying facts · routing = deterministic predicates in Knowledge Definitions · LLM = phrasing layer on survivors only · live priorities = a thin read-time context object, never stored.

---

## Key Principles

### 1. Each Tier Adds Exactly One Thing

Metric (a number) → Comparative Metric (vs a reference) → Signal (watched over time) → Finding (composed with other facts) → Insight (who & why it matters). Don't collapse tiers: a growth % is *not* a signal until you watch it move; a signal is *not* a finding until you combine it with something.

### 2. Signal Strength (Intrinsic) Is Not Relevance (Extrinsic)

Strength is a property of the trajectory — magnitude `V` (loudness), net `D` (direction), coherence `ρ = D/V` (trend vs oscillation), kept as three measures so `−10/+10` reads as *unstable* (`V=20, ρ=0`), not zero. Relevance is the separate filter — `Materiality × Loudness × Horizon` — deciding whether a loud signal lands somewhere worth acting on. A clean −4pp slide in a top-10% region beats a −40% blip in a tiny one.

### 3. Context Decides Framing AND Whether It Surfaces

The same Finding yields a different insight per persona — or **none at all**. Suppression is a valid output: a recovering region is invisible to a CEO who only wants the most problematic ones.

### 4. One Source of Truth (Tiers 1–2)

The database stores only metrics and comparative metrics. Signals, Findings, and Insights are generated on-demand from those columns using documented rules.

**Benefit**: Update the stored metrics once, infinite interpretations without data duplication.

### 5. Findings Are Structured Facts, Composed However You Like

Open-ended composition: IF/THEN rules, KNN, clustering, classification, LLM synthesis — or simply a bundle of signals. Stored without user context, recontextualized later as Insights.

---

## Implementation Responsibility

| Tier | Responsibility | Technology | When to Update |
|------|---|---|---|
| **Tier 1** | Metric (levels) | Database + SQL | compute_metrics.py (monthly or on schedule) |
| **Tier 2** | Comparative Metric | Database + SQL | compute_metrics.py (monthly or on schedule) |
| **Tier 3** | Signal (over time) | Algorithm/LLM over stored columns | On-demand (per user query) |
| **Tier 4** | Finding (composition) | Any method — rules/stats/ML/LLM | On-demand or scheduled |
| **Tier 5** | Insight (context) | LLM + persona context | On-demand (per specific decision) |

---

## Example Workflow

```
User asks: "What's wrong with Zürich 8051 in Oncleris?"
       ↓
Database fetches stored metrics + comparative metrics (Tiers 1-2)
for Zürich 8051 + brand median
       ↓
Read each comparative metric over time → Signals (Tier 3)
  - Filter by relevance (materiality, persistence — drop one-off noise)
       ↓
Compose Signals (+ any other facts) into a Finding (Tier 4)
  - Check coherence: do the facts tell a consistent story?
  - Assign archetype (Star, Turnaround, Deteriorating, etc.)
       ↓
[IF a persona is given] Reframe as an Insight (Tier 5)
  - WHO: Sales Rep, WHEN: daily field work, WHAT: account follow-up
  - ...or suppress entirely if irrelevant to that persona (e.g. CEO
    on an improving region)
       ↓
Present: Signals → Finding → [Insight or silence, per persona]
```

---

## Reference Data

### Data Model Grain

- **25 months** of history
- **6 brands** across 5 franchises
- **227 postal code regions** grouped into 12 territories
- **4 period types**: Month, RollQ, YTD, MAT
- **Total**: 136,200 rows

### Gap Size Categories

**For Growth Metrics:**
- |Gap| >= 15pp → Exceptional
- 10pp <= |Gap| < 15pp → Strong
- 5pp <= |Gap| < 10pp → Moderate
- |Gap| < 5pp → Weak

**For Position Metrics:**
- |Gap| >= 1.0pp → Significant
- 0.5pp <= |Gap| < 1.0pp → Moderate
- |Gap| < 0.5pp → Aligned
