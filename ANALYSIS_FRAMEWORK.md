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

## Data Flow Overview: From Raw Data to Insights

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
│ TIER 1: METRICS (Database)                         │
├─────────────────────────────────────────────────────┤
│ region_metrics (136,200 rows)                       │
│                                                     │
│ Pure Metrics:                                       │
│ • units, sales_eur, market_share                   │
│ • mshare_deviation = MS - national_avg             │
│                                                     │
│ Temporal Comparisons:                              │
│ • growth_py_sales, growth_pp_sales (YoY, sequential)│
│ • growth_py_units, growth_pp_units                 │
│ • growth_py_mshare_dev, growth_pp_mshare_dev      │
│                                                     │
│ Peer Comparisons:                                  │
│ • growth_vs_fcst_eur = actual_growth - fcst_growth │
│ • growth_vs_fcst_units (parallel for units)        │
│                                                     │
│ Ranks & Scores:                                    │
│ • rank_units, rank_sales_eur (1-100 NTILE)        │
│ • rank_mshare_dev, rank_growth_py, rank_growth_vs_fcst_eur │
│ • rank_trend_3m (rank change over 3 periods)      │
│                                                     │
│ Period Types: Month, RollQ (3m), YTD, MAT (12m)  │
│                                                     │
│ ➜ SINGLE SOURCE OF TRUTH for all analysis         │
└─────────────────────────────────────────────────────┘
                    ↓ [LLM or Rules or Stats]
┌─────────────────────────────────────────────────────┐
│ TIER 2a: SIGNAL GENERATION (Multiple Methods)      │
├─────────────────────────────────────────────────────┤
│ Input: Tier 1 metrics for region + brand median    │
│                                                     │
│ Calculates for EACH metric:                        │
│ • current_gap = current_value - brand_median       │
│ • previous_gap = previous_value - previous_median  │
│ • delta = current_gap - previous_gap (momentum)    │
│ • momentum = WIDENING/STABLE/SHRINKING             │
│                                                     │
│ Output: Signal                                      │
│ • [Metric] in [Period Type]                        │
│ • Current: [Value] vs median [Median] = [Gap]     │
│ • Previous: [Value] vs median [Median] = [Gap]    │
│ • Momentum: [Gap]prev → [Gap]current               │
│ • Status: [Icon] [Interpretation]                 │
│                                                     │
│ Methods:                                            │
│ 1. IF/THEN Rules (deterministic)                   │
│ 2. K-Nearest Neighbors (peer cluster compare)      │
│ 3. Clustering (behavioral detection)               │
│ 4. Classification (ML-based risk)                  │
│ 5. LLM Synthesis (narrative understanding)         │
│                                                     │
│ Signal Strength = Materiality × Magnitude ×        │
│                   Persistence × TimeHorizon        │
└─────────────────────────────────────────────────────┘
                    ↓ [Combine Multiple Signals]
┌─────────────────────────────────────────────────────┐
│ TIER 2b: FINDING CATALOG ("Book of Facts")        │
├─────────────────────────────────────────────────────┤
│ Input: 2+ signals combined                          │
│ Storage: findings table (method-agnostic)          │
│                                                     │
│ Output: Finding                                     │
│ • type: Star / Slowing Giant / Turnaround /        │
│         Deteriorating / Riding Wave / Weak         │
│         Foundation / Dangerous Stability           │
│ • region, brand, metrics, current/previous values  │
│ • strength: critical/high/moderate/low             │
│ • confidence: 0-1 (if from ML)                     │
│ • description: factual narrative (no context)      │
│ • generation_method: rule/knn/clustering/ml/llm   │
│                                                     │
│ ➜ NO USER CONTEXT YET (just structured facts)     │
└─────────────────────────────────────────────────────┘
           ↓ [Add User/Decision Context]
┌─────────────────────────────────────────────────────┐
│ TIER 3: INSIGHTS (User & Context-Specific)        │
├─────────────────────────────────────────────────────┤
│ Input: Finding + Context Dimensions                 │
│                                                     │
│ Context (mandatory):                               │
│ • WHO: User type (CEO, Sales VP, Analyst, Finance)│
│ • WHEN: Timing (Real-time, Weekly, Monthly, Q)    │
│ • WHAT: Use case (Target tracking, Allocation)    │
│ • HOW MUCH: Materiality (€M revenue, %)           │
│ • WHY: Business consequence (Missing targets)     │
│                                                     │
│ Output: Insight                                     │
│ • Finding reframed for specific user's decision    │
│ • Actionable narrative tailored to role            │
│ • Business impact contextualized                   │
│                                                     │
│ Example:                                            │
│ Same Finding (rank 92, -4.2% vs FCST, 3Q decline) │
│                                                     │
│ ➜ CEO Insight: €2M shortfall, need contingency    │
│ ➜ Sales VP Insight: Investigate root cause this week │
│ ➜ Analyst Insight: Competitor entry impact analysis │
│ ➜ Finance Insight: Revise forecast, reallocate    │
│                                                     │
│ ➜ CONTEXT CHANGES EVERYTHING                      │
└─────────────────────────────────────────────────────┘
                         ↓
                   USER-FACING REPORTS
```

---

## Tier 1: Metrics (Database Layer)

### What It Is

Raw measurements and first-order computations stored in `region_metrics` SQLite table. Single source of truth for all analysis.

### Four Metric Categories

#### 1a. Pure Metrics (Datapoints)

Direct measurements with no transformations.

| Metric | Definition | Example |
|--------|-----------|---------|
| `units` | Total units sold | 1,250 |
| `sales_eur` | Total sales value | €125,000 |
| `market_share` | Brand % of franchise market | 45.2% |
| `mshare_deviation` | MS deviation from national | -2.6pp |

#### 1b. Temporal Comparisons (Growth & Changes)

Metric changes over time, period-over-period.

| Metric | Formula | Example |
|--------|---------|---------|
| `growth_py_sales` | (Sales_t - Sales_t-12) / Sales_t-12 × 100 | +15.3% |
| `growth_pp_sales` | (Sales_t - Sales_t-shift) / Sales_t-shift × 100 | -2.1% |
| `growth_py_units` | (Units_t - Units_t-12) / Units_t-12 × 100 | +8.7% |
| `growth_pp_units` | (Units_t - Units_t-shift) / Units_t-shift × 100 | -1.5% |
| `growth_py_mshare_dev` | MSDev_t - MSDev_t-12 | +0.8pp |
| `growth_pp_mshare_dev` | MSDev_t - MSDev_t-shift | +0.3pp |

#### 1c. Peer Comparisons (Deviation from Baseline)

How region performs vs national/brand median.

| Metric | Definition | Example |
|--------|-----------|---------|
| `growth_vs_fcst_eur` | Actual growth - National forecast growth (EUR) | +8.5pp |
| `growth_vs_fcst_units` | Actual growth - National forecast growth (units) | +3.2pp |
| `mshare_deviation` | Region MS - National avg MS | -2.6pp |

#### 1d. Ranks & Scores

Percentile rankings within peer groups.

| Metric | Definition | Range |
|--------|-----------|-------|
| `rank_units` | Unit volume percentile | 1-100 |
| `rank_sales_eur` | Sales value percentile | 1-100 |
| `rank_mshare_dev` | Market share deviation percentile | 1-100 |
| `rank_growth_py_sales` | YoY growth percentile | 1-100 |
| `rank_growth_vs_fcst_eur` | Forecast beat percentile | 1-100 |
| `rank_trend_3m` | Rank change over 3 periods | -100 to +100 |

**Key Principle**: Ranks only meaningful within group ranked (brand × period type × timeframe).

---

## Tier 2a: Signal Generation

### What Is a Signal?

A Signal shows **how a region's performance on one metric has changed over time relative to its peers**.

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

### Signal Strength: The Critical Filter

**Not all signals matter equally.** Signal strength depends on:

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

## Tier 2b: Finding Generation Methods

### What Is a Finding?

A **Finding is a structured fact** that can be generated via multiple methods. Findings are **not inherently narrative** — they are stored in a catalog and later recontextualized as Insights.

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

## Tier 2c: Finding Catalog Storage

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

## Tier 3: Insights (Context Layer)

### What Is an Insight?

An **Insight is a Finding recontextualized for a specific user, decision, and timeframe.**

### Mandatory Context Dimensions

Every Insight must answer:

| Dimension | Meaning | Examples |
|-----------|---------|----------|
| **WHO** | User type | CEO, Regional Sales VP, Market Analyst, Finance |
| **WHEN** | Timing | Real-time, Weekly, Monthly, Quarterly |
| **WHAT** | Use case | Sales target tracking, Resource allocation, Competitive response |
| **HOW MUCH** | Materiality | €2M revenue, 3% market share, customer count |
| **WHY** | Business consequence | Missing targets, Losing competitor battle, Opportunity |

### Same Finding, Different Insights

**Finding**: Region rank 92, -4.2% FCST miss on MAT, worsening 3 quarters

**Insight for CEO (Board Review):**
```
Our premium market region (top 8%) is deteriorating structurally. Growth has 
missed forecast by 4.2pp on a moving 12-month basis and has worsened for 
three consecutive quarters. This represents €2M in unplanned shortfall 
against annual targets. Corporate contingency planning needed if trend continues.
```

**Insight for Sales VP (Weekly Accountability):**
```
Your #1 performing region is trending negatively over 3 quarters. This isn't 
a one-month blip—it's persistent. Recommend: (1) Root cause analysis this 
week, (2) Competitive field audit, (3) Sales team coaching review. If 
execution-driven, we can recover quickly.
```

**Insight for Market Analyst (Quarterly Competitive Review):**
```
Our premium region's three-quarter deterioration aligns with known competitor 
entry in Q2. The -4.2pp forecast miss suggests competitor is winning share 
in high-value segment. Recommend: (1) Win/loss analysis, (2) Pricing/ 
positioning review, (3) Customer satisfaction audit.
```

**Insight for Finance (Budget Planning):**
```
Region forecast miss (-€2M vs budget) now appears structural (3 quarters 
deterioration). Recommend: (1) Revise annual forecast down by €2M, (2) 
Reallocate contingency to stronger regions, (3) Decide invest-to-win or 
optimize-for-efficiency.
```

---

## Key Principles

### 1. Signal Strength Matters More Than Magnitude

A small magnitude in a big region over 3 months > large magnitude in tiny region for 1 month.

**Why**: Materiality (who cares) + Persistence (is it real trend) > absolute size of number

### 2. Context Changes Everything

The same Finding generates completely different Insights for:
- **CEO**: Strategic impact, contingency planning
- **Sales VP**: Operational accountability, team coaching
- **Analyst**: Competitive dynamics, positioning
- **Finance**: Budget implications, resource allocation

### 3. One Source of Truth (Tier 1)

Database stores only raw metrics and computations. All narratives (Signals, Findings, Insights) are generated on-demand from Tier 1 using documented rules.

**Benefit**: Update Tier 1 once, infinite interpretations without data duplication.

### 4. Findings Are Structured Facts, Not Narratives

- Can be generated via rules, statistics, ML, or LLM
- Stored in catalog without user context
- Later recontextualized as Insights

### 5. Multiple Generation Methods for Findings

IF/THEN rules, KNN, clustering, classification, or LLM synthesis—pick what works best for each situation.

---

## Implementation Responsibility

| Tier | Responsibility | Technology | When to Update |
|------|---|---|---|
| **Tier 1** | Metrics | Database + SQL | compute_metrics.py (monthly or on schedule) |
| **Tier 2a** | Signal Generation | Algorithm/LLM | On-demand (per user query) |
| **Tier 2b** | Finding Catalog | Database + any method | On-demand or scheduled |
| **Tier 3** | Insights | LLM + User Context | On-demand (per specific decision) |

---

## Example Workflow

```
User asks: "What's wrong with Zürich 8051 in Oncleris?"
       ↓
Database fetches Tier 1 metrics for Zürich 8051 + brand median
       ↓
LLM generates Signals using Signal Strength rules
  - Filter out weak signals (low materiality, one-off anomalies)
  - Prioritize signals with high strength
       ↓
LLM combines Signals into Findings
  - Check coherence: do signals tell consistent story?
  - Assign Finding type (Star, Turnaround, Deteriorating, etc.)
  - Write narrative: what's happening and why
       ↓
[IF user provides context] LLM reframes as Insight
  - WHO: Sales VP, WHEN: weekly, WHAT: accountability, HOW MUCH: €2M, WHY: missing target
  - Write action-specific insight for that user
       ↓
Present: Signals → Findings → [Insight if context provided]
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
