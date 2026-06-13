// A condition applied to narrow the source table before computing a signal.
// Multiple conditions are AND-ed together.
export interface FilterCondition {
  column: string
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'IN'
  value: string | number | string[]   // string[] only for IN operator
}

export interface SignalDefinition {
  id: string
  name: string
  label: string

  // Generic source — no schema assumptions
  source_table: string        // which table in metrics.db (e.g. "region_metrics")
  entity_dimension: string    // PARTITION BY this column (e.g. "region_name")
  time_dimension: string      // ORDER BY this column (e.g. "year_month")
  filters: FilterCondition[]  // fixed WHERE conditions applied to every run
  segment_by: string[]        // run once per distinct value of these columns (e.g. ["brand_name"])

  // Signal parameters
  metric: string              // the numeric column to track over time
  lags: number[]              // e.g. [0,1,2,3] or [0,1,3,6,12]
  delta_lags: number[]        // subset of lags to emit as step-deltas
  direction: 'higher_is_better' | 'lower_is_better'
  // keys into knowledge signal_strength.loudness_bands_pp — per metric kind AND grain
  strength_kind: 'position' | 'growth' | 'territory_position' | 'territory_growth'
  loud_threshold: number      // V threshold for the "loud" severity bonus

  created_at: string
  updated_at: string
}

export interface AxisDefinition {
  name: string                // e.g. "share", "growth"
  signal_id: string           // references SignalDefinition.id
  good_direction: 'positive' | 'negative'  // positive = above threshold is good
  threshold: number           // default 0 — dividing line
}

export interface ClassificationRule {
  key: string                 // e.g. "losing_both"
  label: string               // e.g. "Losing on both"
  conditions: { axis: string; side: 'good' | 'bad' }[]
}

export interface SeverityConfig {
  deterioration_delta: number // net < -this → "deteriorating"
  bands: { critical: number; high: number; moderate: number }
}

export interface FindingDefinition {
  id: string
  name: string
  label: string
  axes: AxisDefinition[]
  classifications: ClassificationRule[]
  severity: SeverityConfig
  created_at: string
  updated_at: string
}

export interface InsightFraming {
  id: string
  persona: string             // sales_manager | sales_rep | ceo (free text)
  finding_key: string
  mode: 'template' | 'llm'
  template: string            // {{variable}} substitution
  llm_system: string          // system prompt with {{variables}}
  llm_user: string            // user message with {{variables}}
  model: string               // e.g. claude-haiku-4-5
  surface_conditions: string[]
  suppress_conditions: string[]
  created_at: string
  updated_at: string
}

// Engine outputs
export interface SignalStrength {
  magnitude: number   // V = Σ|δ|
  net: number         // D = now − start
  coherence: number   // ρ = D/V ∈ [−1,1]
  shape: 'trend' | 'unstable' | 'mixed' | 'quiet'
}

export interface SignalRow {
  entity: string              // value of entity_dimension column
  entity_label: string        // same as entity (display alias)
  series: number[]            // oldest → now
  now: number
  deltas: Record<string, number>  // e.g. { delta_1m: -0.36, delta_3m: -1.89 }
  strength: SignalStrength
  // legacy aliases kept for backward compatibility with FindingComposer/InsightFramer
  region: string
  territory: string
  mat_rank: number
}

export interface FindingAxisResult {
  now: number
  series: number[]
  strength: SignalStrength
  sev: number               // 0–3 per-axis severity
}

export interface FindingRow {
  region: string
  territory: string
  finding_key: string
  finding_label: string
  severity: {
    score: number           // sum of per-axis sevs
    band: string            // critical / high / moderate / low
    per_axis: Record<string, number>
  }
  axes: Record<string, FindingAxisResult>
  mat_rank: number
}

export interface MetaInfo {
  brands: string[]
  period_types: string[]
  metrics: string[]           // available numeric columns in region_metrics
  latest_month: string
}

// Distinct values for a segment_by column (used in preview UI)
export interface SegmentValues {
  column: string
  values: string[]
}
