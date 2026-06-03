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
        └─ Tier 1: All metrics (growth, ranks, deviations)

Python
├── compute_metrics.py  → Generates region_metrics table
└── generate_report.py  → Creates problem_report.html

HTML Reports
├── schema.html         → Database diagram + metrics + framework
├── problem_report.html → Problem regions by franchise/territory
└── signals_findings.html → Example signals & findings

Documentation
└── ANALYSIS_FRAMEWORK.md → Complete system (811 lines)
```

---

## 🔄 Data Flow: Raw Data → Insights

```
Raw Data
(sales, forecast)
    ↓
Tier 1: METRICS (Database)
├─ Pure: units, sales_eur, market_share, mshare_deviation
├─ Temporal: growth_py_sales, growth_pp_sales, growth_py_units, growth_pp_units
├─ Peer: growth_vs_fcst_eur, growth_vs_fcst_units, mshare_deviation
└─ Ranks: rank_units, rank_sales_eur, rank_mshare_dev, rank_growth_py, rank_trend_3m
    ↓
Tier 2a: SIGNAL GENERATION (5 Methods)
├─ IF/THEN Rules (deterministic)
├─ K-Nearest Neighbors (peer comparison)
├─ Clustering (behavioral detection)
├─ Classification (ML-based)
└─ LLM Synthesis (narrative)
    ↓
Tier 2b: FINDING CATALOG
├─ 7 types: Stars, Slowing Giants, Turnarounds, Deteriorating, etc.
├─ Storage: findings table (method-agnostic, no context)
└─ Schema: type, region, metrics, strength, generation_method
    ↓
Tier 3: INSIGHTS (Context Layer)
├─ WHO: User type (CEO, Sales VP, Analyst, Finance)
├─ WHEN: Timing (Real-time, Weekly, Monthly, Quarterly)
├─ WHAT: Use case (Target tracking, Allocation, Competitive)
├─ HOW MUCH: Materiality (€M revenue, market share %, volume)
└─ WHY: Business consequence (Missing targets, Losing battle)
    ↓
User-Facing Reports
(CEO brief, Sales VP accountability, Analyst deck, Finance plan)
```

---

## 🎯 Core Concepts

### 1. Signal Strength Formula

```
Signal Strength = Materiality × Magnitude × Persistence × TimeHorizon

STRONG: -4% decline in big region (rank 92) over 3 quarters = 4×3×3×4 = 144
WEAK:   -40% drop in tiny region (rank 25) in 1 month = 1×4×1×2 = 8
```

Key insight: **Materiality + Persistence >> absolute magnitude**

### 2. Findings Are Structured Facts

- Can be generated via rules, statistics, ML, or LLM
- Stored without user context
- Later recontextualized as Insights
- No "best" generation method—choose what works

### 3. Context Changes Everything

**Same Finding:** Region rank 92, -4.2% vs FCST, 3Q decline, -€2M impact

**CEO Insight:** €2M shortfall = contingency planning needed

**Sales VP Insight:** Investigate root cause this week; if execution, recoverable

**Analyst Insight:** Aligns with competitor entry; recommend win/loss analysis

**Finance Insight:** Structural problem; revise forecast, reallocate resources

---

## 📊 Tier 1: Metrics (Database)

**Single source of truth.** All pure computations stored in `region_metrics`.

### Four Categories

1. **Pure Metrics** → units, sales_eur, market_share, mshare_deviation
2. **Temporal** → growth_py_sales, growth_pp_sales, growth_py_units, growth_pp_units, growth_py_mshare_dev, growth_pp_mshare_dev
3. **Peer Comparisons** → growth_vs_fcst_eur, growth_vs_fcst_units, mshare_deviation
4. **Ranks** → rank_units, rank_sales_eur, rank_mshare_dev, rank_growth_py, rank_growth_vs_fcst_eur, rank_trend_3m

### Period Types

- **Month** → 1-month snapshot
- **RollQ** → 3-month rolling
- **YTD** → Year-to-date
- **MAT** → Moving annual total (12-month, strongest for trends)

---

## 📋 Tier 2a: Signal Generation

**What:** Single metric + temporal momentum + strength rating

**Signal = current_gap vs peers → previous_gap vs peers → momentum → status**

### Signal Strength Dimensions

| Dimension | Levels | Impact |
|-----------|--------|--------|
| **Materiality** (rank) | 90+ (4) → 50-75 (2) → <50 (1) | Who cares? |
| **Magnitude** | ±15pp+ (4) → ±10-15pp (3) → ±5-10pp (2) → <5pp (1) | How big? |
| **Persistence** | 3+ periods (3) → 2 periods (2) → 1 period (1) | How real? |
| **TimeHorizon** | MAT (4) → YTD (3) → RollQ (2) → Month (1) | How durable? |

### Five Generation Methods

1. **IF/THEN Rules** → Pattern: `IF rank>=80 AND growth < median-10pp THEN crisis`
2. **K-Nearest Neighbors** → Compare to 5 nearest peers' metrics
3. **Clustering** → Detect behavioral groupings; flag cluster changes
4. **Classification** → ML model trained on labeled regions
5. **LLM Synthesis** → AI reads Tier 1 data + Signal definitions

---

## 💡 Tier 2b: Finding Types

| Type | Pattern | Example | Action |
|------|---------|---------|--------|
| **Star** | Growth ↑↑, Pos ↑, Momentum ↑ | +27.7% growth, improving position | Monitor sustainability |
| **Slowing Giant** | Growth ↑ BUT shrinking, Momentum ↓ | +18.2% BUT gap narrowing | Investigate slowdown |
| **Turnaround** | Was below, now in line, Gap ↑ | MS improved from -5.5pp to -3.5pp | Support momentum |
| **Deteriorating** | Growth ↓, Pos ↓, Momentum ↓ | -4.2% miss, 3Q decline | Diagnose & intervene |
| **Riding Wave** | Growth ↑↑ BUT Pos stable | +24% growth, +14pp vs FCST, no MS gain | Commodity/market-driven |
| **Weak Foundation** | Growth ↑ BUT Pos not improving | +14.6% growth, -3.2pp below peers | Secondary market |
| **Dangerous Stability** | Growth → BUT Pos ↓ | +7.8% steady, -0.7pp to -1.5pp | Competitive response needed |

---

## 🎓 Tier 3: Insights

**Context recontextualizes Findings for specific decisions.**

All Insights answer: WHO? WHEN? WHAT? HOW MUCH? WHY?

Example: Same Finding generates 4 different Insights
- CEO: Strategic impact, need board update
- Sales VP: Weekly accountability, team action items
- Analyst: Competitive intelligence, positioning review
- Finance: Budget revision, resource reallocation

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
1. Fetches Tier 1 metrics for Zürich 8051 + Oncleris brand median
2. Calculates Signals (4 metrics: growth_py, growth_vs_fcst, mshare_dev, rank_trend)
3. Filters weak signals (materiality, anomalies)
4. Combines high-strength signals into Finding
   → Type: "Deteriorating" (growth ↓, pos ↓, momentum ↓)
5. [If user provides context: CEO, weekly, accountability, €2M, missing target]
   → Reframes Finding as Sales VP Insight:
   "Your #1 region is trending negative 3 quarters. Root cause analysis 
    this week; if execution-driven, recoverable; if market-driven, 
    need strategy shift."
```

---

## 📚 Complete Documentation

**Everything is in** [`ANALYSIS_FRAMEWORK.md`](ANALYSIS_FRAMEWORK.md):

- How to run (both scripts, both servers)
- File structure (directory layout, grain, row counts)
- Data flow (detailed diagram with all tiers)
- Tier 1 metrics (all definitions, formulas, examples)
- Tier 2a signals (generation, strength formula, interpretation tables)
- Tier 2b findings (7 types, 5 generation methods, schema)
- Tier 3 insights (context dimensions, examples)
- Reference tables (gap categories, lookup tables)

---

## ✨ Key Principles

1. **Materiality + Persistence >> Magnitude** (signal strength)
2. **Findings ≠ LLM-only** (rules, stats, ML also work)
3. **One source of truth** (Tier 1 database; narratives on-demand)
4. **Context-driven** (same Finding, different Insights per user)
5. **Relative analysis** (compare to brand median, not absolutes)

---

## Questions?

This system has **three layers**:
- **Tier 1 (Database)** → The data
- **Tier 2 (Synthesis)** → Signals & Findings (multiple methods)
- **Tier 3 (Context)** → Insights (user-specific actions)

👉 **Start with [ANALYSIS_FRAMEWORK.md](ANALYSIS_FRAMEWORK.md)** to understand how they fit together.
