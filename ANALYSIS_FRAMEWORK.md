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
│   │   └─ Generates region_metrics table + all Tier 1 metrics
│   └── generate_report.py
│       └─ Creates problem_report.html with volume-weighted scoring
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

## Data Flow Overview: The Five-Rung Ladder

Each rung adds **exactly one** thing to the rung below:

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

**The test:** "Is MAT Sales −10%?" No — MAT Sales is just €4.2M. A bare metric can't be "−10%"; that already implies a comparison, which is the next rung.

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

### Relevance (Cross-cutting Filter — NOT part of the Signal definition)

Strength is **not a tier and not what makes something a Signal**. It's a filter applied *across* the ladder to decide which signals are worth composing into Findings, and which Findings are worth surfacing as Insights. A signal is still a signal whether it's strong or noise — strength just gates attention. It depends on:

#### Dimension 1: Materiality (Region Size/Rank)
```
Rank >= 90 (top 10%)     → Maximum weight (4)
Rank 75-90 (top 25%)     → High weight (3)
Rank 50-75 (top 50%)     → Medium weight (2)
Rank < 50                → Low weight (1)
```

#### Dimension 2: Metric Magnitude

For **Growth metrics** (growth_py_sales, growth_vs_fcst_eur):
```
|Gap| >= 15pp            → Exceptional (4)
10pp <= |Gap| < 15pp     → Strong (3)
5pp <= |Gap| < 10pp      → Moderate (2)
|Gap| < 5pp              → Weak (1)
```

For **Position metrics** (mshare_deviation, changes):
```
|Gap| >= 2.0pp           → Exceptional (4)
1.0pp <= |Gap| < 2.0pp   → Strong (3)
0.5pp <= |Gap| < 1.0pp   → Moderate (2)
|Gap| < 0.5pp            → Weak (1)
```

#### Dimension 3: Persistence (Trend Consistency)
```
Consistent 3+ periods    → Strong (3)
Consistent 2 periods     → Moderate (2)
Single period anomaly    → Weak (1)
```

#### Dimension 4: Time Horizon
```
MAT (12-month)           → Strongest (4)
YTD (year-to-date)       → Strong (3)
RollQ (3-month)          → Moderate (2)
Month (1-month)          → Weakest (1)
```

#### Signal Strength Formula

```
Signal Strength = Materiality × Magnitude × Persistence × TimeHorizon

STRONG Signal Example:
- Region rank 92 (top 8%, materiality = 4)
- Gap = -4.2pp vs FCST (magnitude = 3)
- Worsening 3 consecutive quarters (persistence = 3)
- On MAT level (time horizon = 4)
→ Strength = 4 × 3 × 3 × 4 = 144 → CRITICAL

WEAK Signal Example:
- Region rank 25 (small, materiality = 1)
- Sales drop -40% (magnitude = 4)
- RollQ level (time horizon = 2)
- Single quarter (persistence = 1)
→ Strength = 1 × 4 × 1 × 2 = 8 → NOISE
```

**Key Insight**: A -4% decline in a big region over 3 quarters is MUCH stronger than a -40% drop in a tiny region in a single month.

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

Each clause above is a lower-rung fact; the Finding is the useful combination of them. This is where you may bring in whatever machinery helps — IF/THEN rules, KNN, clustering, classification, LLM synthesis — **or nothing at all**: a Finding can simply be a bundle of signals if you have no better way to compose them. It is a **structured fact, not yet narrative for a user**, stored in a catalog and later recontextualized as Insights.

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

### Seven Finding Types

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

## Finding Catalog Storage

### The "Book of Facts"

Once generated (via any method), Findings are stored in a **structured catalog**. This is the single source of truth for all findings.

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
  
  -- What changed
  metric_names: [string]  // Which metrics triggered this
  current_values: {metric: value}
  previous_values: {metric: value}
  delta: {metric: change}
  
  -- Why (no context)
  description: string  // Factual, no user context
  generation_method: enum {rule, knn, clustering, classification, llm}
  
  -- Metadata
  created_at: timestamp
  expires_at: timestamp?  // If temporary
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
  created_at TIMESTAMP,
  FOREIGN KEY (region_name, year_month) REFERENCES region_metrics
);

CREATE INDEX idx_findings_region_time ON findings(region_name, year_month);
CREATE INDEX idx_findings_type ON findings(type, strength);
CREATE INDEX idx_findings_brand ON findings(brand_name, year_month);
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

## Key Principles

### 1. Each Rung Adds Exactly One Thing

Metric (a number) → Comparative Metric (vs a reference) → Signal (watched over time) → Finding (composed with other facts) → Insight (who & why it matters). Don't collapse rungs: a growth % is *not* a signal until you watch it move; a signal is *not* a finding until you combine it with something.

### 2. Relevance Is a Filter, Not a Rung

Strength = Materiality × Magnitude × Persistence × Horizon gates *which* signals and findings deserve attention. A −4% slide in a top-10% region over 3 quarters beats a −40% blip in a tiny region for one month. Materiality + Persistence >> Magnitude.

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
