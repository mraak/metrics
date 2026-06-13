// knowledge.ts — TypeScript port of knowledge.py: the Knowledge Definitions
// accessors and the signal mathematics (strength, relevance, compiled SQL).
// knowledge_definitions.json stays the single source of truth; this module is
// the single implementation of its semantics now that the Python app is merged
// into the Studio. Section meanings are documented in ANALYSIS_FRAMEWORK.md.
import { loadKnowledge } from './knowledge-store'

export type Json = Record<string, unknown>

// Templates may target another grain by declaring source_table/entity_dimension;
// absent = region level. Same convention the signal engine + Python side used.
export const DEFAULT_TABLE = 'region_metrics'
export const DEFAULT_ENTITY = 'region_name'

export interface SignalTemplate {
  metric: string
  period_type: string
  lags: number[]
  readout: 'series' | 'delta' | 'slope'
  delta_lag?: number
  delta_lags?: number[]
  direction: 'higher_is_better' | 'lower_is_better'
  strength_kind?: string
  materiality_from?: string
  source_table?: string
  entity_dimension?: string
  interpretation?: string
  cached_as?: string
  label?: string
}

export interface SignalStrengthResult {
  magnitude: number
  net: number
  coherence: number
  direction: 'improving' | 'deteriorating' | 'flat'
  signed_strength: number
  shape: 'quiet' | 'trend' | 'unstable' | 'mixed'
}

export interface RelevanceResult {
  materiality: number
  loudness: number
  horizon: number
  score: number
  band: 'critical' | 'high' | 'moderate' | 'low'
}

export function knowledgeDefs(): Json {
  return loadKnowledge()
}

export function signalTemplates(defs: Json): Record<string, SignalTemplate> {
  const all = (defs.signal_templates as Record<string, unknown>) ?? {}
  const out: Record<string, SignalTemplate> = {}
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('_')) out[k] = v as SignalTemplate
  }
  return out
}

/** Resolve a signal_roles name (e.g. 'ui_default') to its template id. */
export function role(defs: Json, name: string): string {
  const roles = (defs.signal_roles as Record<string, string>) ?? {}
  if (!(name in roles)) {
    const known = Object.keys(roles).filter(k => !k.startsWith('_'))
    throw new Error(`signal role '${name}' not defined in signal_roles (have: ${known.join(', ')})`)
  }
  return roles[name]
}

export function sourceTable(sig: SignalTemplate): string {
  return sig.source_table ?? DEFAULT_TABLE
}

export function entityDim(sig: SignalTemplate): string {
  return sig.entity_dimension ?? DEFAULT_ENTITY
}

/** Human label for the signal's grain: 'region', 'territory', ... */
export function level(sig: SignalTemplate): string {
  return entityDim(sig).replace(/_name$/, '')
}

/** A delta signal may specify a list (delta_lags) or a single (delta_lag). */
export function deltaLags(sig: SignalTemplate): number[] {
  if (Array.isArray(sig.delta_lags)) return [...sig.delta_lags]
  if (sig.delta_lag != null) return [sig.delta_lag]
  return []
}

// Python-compatible round. Neither Math.round(x * 10**dp) (the shift drifts:
// 23.15 * 10 lands above the midpoint) nor toFixed (half-away-from-zero on
// exact midpoints) matches Python, which rounds the float's EXACT decimal
// expansion half-to-even. A double's fraction has <= 52 decimal digits, so
// toFixed(55) gives the exact expansion; round it by string arithmetic.
// Normalizes -0 to 0.
export function round(x: number, dp = 2): number {
  if (!Number.isFinite(x)) return x
  const sign = x < 0 ? -1 : 1
  const s = Math.abs(x).toFixed(55)
  const dot = s.indexOf('.')
  let digits = (s.slice(0, dot) + s.slice(dot + 1)).split('')
  const keepLen = dot + dp
  const rest = digits.slice(keepLen)
  digits = digits.slice(0, keepLen)
  const first = rest[0] ?? '0'
  let up = false
  if (first > '5') up = true
  else if (first === '5') {
    if (rest.slice(1).some(c => c !== '0')) up = true
    else up = (digits.length ? Number(digits[digits.length - 1]) : 0) % 2 === 1   // half-even
  }
  if (up) {
    let i = digits.length - 1
    for (;;) {
      if (i < 0) { digits.unshift('1'); break }
      if (digits[i] === '9') { digits[i] = '0'; i-- }
      else { digits[i] = String(Number(digits[i]) + 1); break }
    }
  }
  const intLen = digits.length - dp
  const intStr = intLen > 0 ? digits.slice(0, intLen).join('') : '0'
  const fracStr = digits.slice(Math.max(0, intLen)).join('').padStart(dp, '0')
  const r = sign * Number(intStr + (dp ? '.' + fracStr : ''))
  return r === 0 ? 0 : r
}

function loudnessBands(defs: Json, kind: string): { very_loud: number; loud: number; moderate: number } {
  const ss = defs.signal_strength as Json
  const bands = (ss.loudness_bands_pp as Json)[kind] as { very_loud: number; loud: number; moderate: number } | undefined
  if (!bands) throw new Error(`no loudness_bands_pp ladder for strength_kind '${kind}'`)
  return bands
}

/**
 * INTRINSIC strength of a signal's trajectory — a property of the signal
 * itself, independent of business materiality. `series` is the metric's values
 * oldest -> newest (>= 2 points). Thresholds (loudness ladder per kind,
 * coherence bands) come from knowledge_definitions.json — never hardcoded.
 */
export function signalStrength(
  series: number[],
  direction: 'higher_is_better' | 'lower_is_better' = 'higher_is_better',
  defs: Json = knowledgeDefs(),
  kind = 'position'
): SignalStrengthResult {
  let V = 0
  for (let i = 1; i < series.length; i++) V += Math.abs(series[i] - series[i - 1])
  const D = series[series.length - 1] - series[0]
  const rho = V ? D / V : 0
  const improving = direction === 'higher_is_better' ? D > 0 : D < 0
  const label = D === 0 ? 'flat' : improving ? 'improving' : 'deteriorating'

  const bands = loudnessBands(defs, kind)
  const cb = (defs.signal_strength as Json).coherence_bands as { trend: number; oscillation: number }
  let shape: SignalStrengthResult['shape']
  if (V < bands.moderate) shape = 'quiet'
  else if (V >= bands.loud && Math.abs(rho) >= cb.trend) shape = 'trend'
  else if (V >= bands.loud && Math.abs(rho) < cb.oscillation) shape = 'unstable'
  else shape = 'mixed'

  return {
    magnitude: round(V, 3),
    net: round(D, 3),
    coherence: round(rho, 3),
    direction: label,
    signed_strength: round(D * Math.abs(rho), 3),
    shape,
  }
}

/**
 * EXTRINSIC relevance — does a (loud) signal land somewhere that matters?
 * relevance = materiality * loudness * horizon. Coherence does NOT enter here
 * (it selects the finding archetype, not the relevance score).
 */
export function relevanceScore(
  defs: Json,
  opts: { materialityRank: number; magnitudeV: number; periodType: string; kind?: string }
): RelevanceResult {
  const rel = defs.relevance as Json
  const bands = loudnessBands(defs, opts.kind ?? 'position')

  const rank = opts.materialityRank
  const m = rank >= 90 ? 4 : rank >= 75 ? 3 : rank >= 50 ? 2 : 1
  const a = Math.abs(opts.magnitudeV)
  const l = a >= bands.very_loud ? 4 : a >= bands.loud ? 3 : a >= bands.moderate ? 2 : 1
  const horizon = ((rel.horizon_by_period_type as Record<string, number>))[opts.periodType]
  const score = m * l * horizon
  const band = score >= 48 ? 'critical' : score >= 24 ? 'high' : score >= 8 ? 'moderate' : 'low'
  return { materiality: m, loudness: l, horizon, score, band }
}

/** Human label for the coherence value (server.py _persistence_label). */
export function persistenceLabel(strength: { coherence: number }): string {
  const rho = Math.abs(strength.coherence)
  if (rho >= 0.6) return 'consistent'
  if (rho >= 0.3) return 'mixed'
  return 'oscillating'
}

/**
 * Render the LAG/OVER window query a signal template compiles to — table and
 * entity dimension come from the template. partitionByEntity=true scores every
 * entity at once (how a finding pass scans the whole brand).
 */
export function compileSignalSql(
  sig: SignalTemplate,
  brand = ':brand',
  entity = ':entity',
  partitionByEntity = false
): string {
  const metric = sig.metric
  const period = sig.period_type
  const table = sourceTable(sig)
  const ent = entityDim(sig)
  const cols = [`${metric} AS now`]
  for (const lag of sig.lags) {
    if (lag === 0) continue
    cols.push(`LAG(${metric}, ${lag}) OVER w AS m${lag}`)
  }
  if (sig.readout === 'delta') {
    for (const dl of deltaLags(sig)) {
      cols.push(`${metric} - LAG(${metric}, ${dl}) OVER w AS delta_${dl}m`)
    }
  }
  const select = cols.join(',\n       ')
  let where: string, window: string, colsPrefix: string
  if (partitionByEntity) {
    where = `brand_name = ${brand} AND period_type = '${period}'`
    window = `WINDOW w AS (PARTITION BY ${ent} ORDER BY year_month)`
    colsPrefix = `year_month, ${ent}`
  } else {
    where = `brand_name = ${brand} AND period_type = '${period}' AND ${ent} = ${entity}`
    window = 'WINDOW w AS (ORDER BY year_month)'
    colsPrefix = 'year_month'
  }
  return `SELECT ${colsPrefix},\n       ${select}\nFROM ${table}\nWHERE ${where}\n${window};`
}

/** Validate the store against the live metrics.db schema (knowledge.py validate). */
export function validateKnowledge(defs: Json, colsByTable: Record<string, Set<string>>): string[] {
  const problems: string[] = []
  const enums = defs.enums as Json
  const periods = new Set(enums.period_type as string[])
  const readouts = new Set(enums.readout as string[])
  const signals = signalTemplates(defs)

  for (const [name, s] of Object.entries(signals)) {
    const table = sourceTable(s)
    const columns = colsByTable[table] ?? new Set<string>()
    if (Object.keys(colsByTable).length && !columns.size) {
      problems.push(`signal '${name}': source_table '${table}' not found in metrics.db`)
    }
    if (columns.size && !columns.has(s.metric)) {
      problems.push(`signal '${name}': metric '${s.metric}' is not a ${table} column`)
    }
    if (columns.size && !columns.has(entityDim(s))) {
      problems.push(`signal '${name}': entity_dimension '${entityDim(s)}' is not a ${table} column`)
    }
    if (!periods.has(s.period_type)) {
      problems.push(`signal '${name}': period_type '${s.period_type}' not in enum`)
    }
    if (!readouts.has(s.readout)) {
      problems.push(`signal '${name}': readout '${s.readout}' not in enum`)
    }
    if (s.readout === 'delta') {
      const dls = deltaLags(s)
      if (!dls.length) problems.push(`signal '${name}': readout 'delta' requires 'delta_lag' or 'delta_lags'`)
      for (const dl of dls) {
        if (!s.lags.includes(dl)) {
          problems.push(`signal '${name}': delta lag ${dl} not present in lags [${s.lags}]`)
        }
      }
    }
  }

  const roles = (defs.signal_roles as Record<string, string>) ?? {}
  for (const [rname, target] of Object.entries(roles)) {
    if (rname.startsWith('_')) continue
    if (!(target in signals)) {
      problems.push(`signal role '${rname}': points at undefined signal '${target}'`)
    }
  }

  const recipes = (defs.finding_recipes as Record<string, Json>) ?? {}
  for (const [name, r] of Object.entries(recipes)) {
    if (name.startsWith('_')) continue
    for (const sig of (r.requires_signals as string[]) ?? []) {
      if (!(sig in signals)) problems.push(`recipe '${name}': requires undefined signal '${sig}'`)
    }
  }
  return problems
}
