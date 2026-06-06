# SQL-Metrics Backlog

Items worth revisiting. Not urgent — tracked so the thinking isn't lost.

---

## Schema design

### [ ] Consider migrating region_metrics from wide to tall format

**Current:** metrics as columns — one row per region × brand × month × period_type, each metric its own typed column (`sales_eur`, `mshare_deviation`, `growth_deviation`, …).

**Alternative:** EAV (Entity-Attribute-Value) — one row per region × brand × month × period_type × metric_type, with columns `metric_type TEXT`, `value REAL`, `unit TEXT`.

```sql
-- current (wide)
region_name | brand_name | year_month | period_type | sales_eur | mshare_deviation | growth_deviation

-- tall
region_name | brand_name | year_month | period_type | metric_type      | value   | unit
AG Aarau    | Oncleris   | 2026-05    | MAT         | sales_eur        | 4200000 | EUR
AG Aarau    | Oncleris   | 2026-05    | MAT         | mshare_deviation | -2.76   | pp
AG Aarau    | Oncleris   | 2026-05    | MAT         | growth_deviation | -4.82   | pp
```

**Why wide was chosen:**
- Window functions are clean: `LAG(mshare_deviation, 3) OVER w` — one expression, no subquery
- Type safety: each column has its own SQLite type, no mixed scales in a single `value` column
- Simpler read queries across the board

**Why tall is worth reconsidering for the platform vision:**
- **No DDL for new metrics** — adding a metric means inserting rows, not `ALTER TABLE ADD COLUMN`. For a tool where analysts define signals freely, this removes real friction.
- **Metadata lives with the data** — `unit`, `is_derived`, `source` become native columns on every row instead of living in Knowledge Definitions and needing to stay in sync.
- **Signal engine is cleaner** — the engine already takes `metric: string`; in tall format this becomes `WHERE metric_type = ?` (safe, no dynamic column building or whitelist validation needed).
- **Sparse metrics work naturally** — a metric that only exists for one brand doesn't create NULL columns across all others.
- **Self-documenting** — an analyst querying the DB cold can see what the metrics are without reading external docs.

**Hybrid approach (likely right answer):**
Keep dimensions as columns (region, brand, month, period_type — stable, never added). Go tall for metrics only. This is the standard OLAP/warehouse pattern.

Signal engine query becomes:
```sql
WITH s AS (
  SELECT region_name, territory_name, year_month, value,
         LAG(value, 1) OVER w AS v1,
         LAG(value, 3) OVER w AS v3
  FROM region_metrics
  WHERE brand_name = ? AND period_type = ? AND metric_type = ?
  WINDOW w AS (PARTITION BY region_name ORDER BY year_month)
)
SELECT * FROM s WHERE year_month = ? AND v3 IS NOT NULL
```

**Cost of migration:**
- Row count: ~136K → ~1–2M (10–15× increase; still fast for SQLite at this scale)
- `compute_metrics.py` needs rewriting to INSERT rows instead of UPDATE columns
- Signal engine SQL builder simplifies (no dynamic column reference)
- Data tab in Studio becomes more informative (units visible inline)

**Decision trigger:** If/when the tool becomes multi-tenant or analysts need to add their own metrics without a developer touching the schema — do it then. Single-tenant with a fixed metric set: the wide format is fine and the migration cost isn't justified yet.

---
