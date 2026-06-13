import { metricsDb } from './db'
import { readSignalByName } from './knowledge-store'
import { knowledgeDefs, signalStrength } from './knowledge'
import type { SignalDefinition, SignalRow, SignalStrength, FilterCondition, SegmentValues } from './types'

// ── Column validation ─────────────────────────────────────────────────────────
// Returns the set of column names for the given table in metrics.db.
function getTableColumns(table: string): Set<string> {
  const db = metricsDb()
  const rows = db.pragma(`table_info(${table})`) as { name: string }[]
  return new Set(rows.map(r => r.name))
}

function assertColumn(col: string, validCols: Set<string>, fieldName: string) {
  if (!validCols.has(col)) {
    throw new Error(
      `Invalid column "${col}" for ${fieldName}. Available: ${Array.from(validCols).join(', ')}`
    )
  }
}

// ── Filter SQL builder ────────────────────────────────────────────────────────
function buildFilterSQL(
  filters: FilterCondition[],
  segmentValues: Record<string, string | number>
): { clause: string; params: (string | number)[] } {
  const conditions: string[] = []
  const params: (string | number)[] = []

  for (const f of filters) {
    if (f.operator === 'IN') {
      const vals = Array.isArray(f.value) ? f.value : [String(f.value)]
      conditions.push(`${f.column} IN (${vals.map(() => '?').join(',')})`)
      params.push(...vals)
    } else {
      conditions.push(`${f.column} ${f.operator} ?`)
      params.push(f.value as string | number)
    }
  }

  for (const [col, val] of Object.entries(segmentValues)) {
    conditions.push(`${col} = ?`)
    params.push(val)
  }

  return {
    clause: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
    params,
  }
}

// ── Strength computation ──────────────────────────────────────────────────────
// Thresholds come from knowledge_definitions.json (loudness ladder per
// strength_kind + coherence bands) — the same rules the report APIs use, so a
// signal gets one shape label everywhere.
export function computeStrength(series: number[], def: SignalDefinition): SignalStrength {
  if (series.length < 2) {
    return { magnitude: 0, net: 0, coherence: 0, shape: 'quiet' }
  }
  const st = signalStrength(series, def.direction, knowledgeDefs(), def.strength_kind)
  return { magnitude: st.magnitude, net: st.net, coherence: st.coherence, shape: st.shape }
}

// ── Core generic signal computation ──────────────────────────────────────────
// segmentValues: e.g. { brand_name: 'Oncleris' } — one value per segment_by column.
// asof: optional — defaults to MAX(time_dimension) matching the filters+segment.
export function computeSignal(
  def: SignalDefinition,
  segmentValues: Record<string, string | number> = {},
  asof?: string
): SignalRow[] {
  const db = metricsDb()
  const cols = getTableColumns(def.source_table)

  // Validate all referenced columns exist in the source table
  assertColumn(def.entity_dimension, cols, 'entity_dimension')
  assertColumn(def.time_dimension, cols, 'time_dimension')
  assertColumn(def.metric, cols, 'metric')
  for (const f of def.filters) assertColumn(f.column, cols, `filter column "${f.column}"`)
  for (const s of def.segment_by) assertColumn(s, cols, `segment_by column "${s}"`)
  for (const s of Object.keys(segmentValues)) assertColumn(s, cols, `segment value column "${s}"`)

  const { clause: filterClause, params: filterParams } = buildFilterSQL(def.filters, segmentValues)

  // Resolve asof if not provided
  if (!asof) {
    const row = db.prepare(
      `SELECT MAX(${def.time_dimension}) AS t FROM ${def.source_table} ${filterClause}`
    ).get(...filterParams) as { t: string } | undefined
    asof = row?.t
    if (!asof) return []
  }

  // Build LAG columns 0..maxLag (consecutive — needed for a gapless series)
  const maxLag = Math.max(...def.lags.filter(l => l > 0), 0)
  const lagSelects: string[] = []
  for (let i = 0; i <= maxLag; i++) {
    lagSelects.push(
      i === 0
        ? `${def.metric} AS v0`
        : `LAG(${def.metric}, ${i}) OVER w AS v${i}`
    )
  }

  const sql = `
    WITH s AS (
      SELECT
        ${def.entity_dimension} AS _entity,
        ${def.time_dimension}   AS _time,
        ${lagSelects.join(',\n        ')}
      FROM ${def.source_table}
      ${filterClause}
      WINDOW w AS (PARTITION BY ${def.entity_dimension} ORDER BY ${def.time_dimension})
    )
    SELECT * FROM s
    WHERE _time = ? ${maxLag > 0 ? `AND v${maxLag} IS NOT NULL` : ''}
  `

  const rawRows = db.prepare(sql).all(...filterParams, asof) as Record<string, unknown>[]

  return rawRows.map(row => {
    // Series: oldest (v_maxLag) → now (v0)
    const series: number[] = []
    for (let i = maxLag; i >= 0; i--) {
      series.push(row[`v${i}`] as number)
    }
    const now = row['v0'] as number

    const deltas: Record<string, number> = {}
    for (const lag of def.delta_lags) {
      if (lag > 0 && lag <= maxLag) {
        const lagVal = row[`v${lag}`] as number | null
        if (lagVal != null) {
          deltas[`delta_${lag}m`] = Math.round((now - lagVal) * 1000) / 1000
        }
      }
    }

    const entityVal = row['_entity'] as string

    return {
      entity: entityVal,
      entity_label: entityVal,
      // legacy aliases — kept so FindingComposer / InsightFramer still work
      region: entityVal,
      territory: '',
      mat_rank: 0,
      series,
      now,
      deltas,
      strength: computeStrength(series, def),
    } satisfies SignalRow
  })
}

// ── Distinct segment values (for the preview UI checkboxes) ──────────────────
export function getSegmentValues(def: SignalDefinition): SegmentValues[] {
  if (!def.segment_by.length) return []
  const db = metricsDb()
  const { clause, params } = buildFilterSQL(def.filters, {})
  return def.segment_by.map(col => {
    const rows = db.prepare(
      `SELECT DISTINCT ${col} AS v FROM ${def.source_table} ${clause} ORDER BY ${col}`
    ).all(...params) as { v: string }[]
    return { column: col, values: rows.map(r => r.v) }
  })
}

// ── Load a saved signal definition from knowledge_definitions.json ───────────
export function getSignalById(id: string): SignalDefinition | null {
  return readSignalByName(id)
}
