export interface SignalDefinition {
  id: string
  name: string
  label: string
  metric: string              // exact column name in region_metrics
  period_type: string         // MAT | RollQ | YTD | Month
  lags: number[]              // e.g. [0,1,2,3] or [0,1,3,6,12]
  delta_lags: number[]        // subset of lags to emit as deltas, e.g. [1,3]
  direction: 'higher_is_better' | 'lower_is_better'
  strength_kind: 'position' | 'growth'
  loud_threshold: number      // magnitude threshold for "loud" in severity
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
  region: string
  territory: string
  series: number[]            // oldest → now
  now: number
  deltas: Record<string, number>  // e.g. { delta_1m: -0.36, delta_3m: -1.89 }
  strength: SignalStrength
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
