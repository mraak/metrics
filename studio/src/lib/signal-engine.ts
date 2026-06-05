import { metricsDb, toolDb } from './db'
import type { SignalDefinition, SignalRow, SignalStrength } from './types'

function getValidMetricColumns(): Set<string> {
  const db = metricsDb()
  const rows = db.pragma('table_info(region_metrics)') as { name: string; type: string }[]
  return new Set(rows.map(r => r.name))
}

export function computeStrength(series: number[], def: SignalDefinition): SignalStrength {
  if (series.length < 2) {
    return { magnitude: 0, net: 0, coherence: 0, shape: 'quiet' }
  }

  let magnitude = 0
  for (let i = 1; i < series.length; i++) {
    magnitude += Math.abs(series[i] - series[i - 1])
  }

  const net = series[series.length - 1] - series[0]
  const coherence = magnitude > 0 ? net / magnitude : 0

  let shape: SignalStrength['shape']
  if (magnitude < 0.3) {
    shape = 'quiet'
  } else if (Math.abs(coherence) >= 0.8) {
    shape = 'trend'
  } else if (Math.abs(coherence) <= 0.2 && magnitude >= def.loud_threshold * 0.5) {
    shape = 'unstable'
  } else {
    // Check if all steps same sign as net
    const allSameSign = net !== 0 && series.slice(1).every((v, i) => {
      const step = v - series[i]
      return net > 0 ? step >= 0 : step <= 0
    })
    shape = allSameSign ? 'trend' : 'mixed'
  }

  return {
    magnitude: Math.round(magnitude * 1000) / 1000,
    net: Math.round(net * 1000) / 1000,
    coherence: Math.round(coherence * 1000) / 1000,
    shape,
  }
}

export function computeSignal(
  def: SignalDefinition,
  brand: string,
  asof: string
): SignalRow[] {
  const validCols = getValidMetricColumns()
  if (!validCols.has(def.metric)) {
    throw new Error(`Invalid metric column: "${def.metric}". Valid columns: ${Array.from(validCols).join(', ')}`)
  }

  const db = metricsDb()
  const sortedLags = [...def.lags].sort((a, b) => a - b)
  const maxLag = sortedLags[sortedLags.length - 1]

  // Build LAG columns — always build lags 0..maxLag for consecutive series
  // (we only emit delta_lags in deltas, but need all lags for the series)
  const lagSelects: string[] = []
  for (let i = 0; i <= maxLag; i++) {
    if (i === 0) {
      lagSelects.push(`${def.metric} AS v0`)
    } else {
      lagSelects.push(`LAG(${def.metric}, ${i}) OVER w AS v${i}`)
    }
  }

  const sql = `
    WITH s AS (
      SELECT
        year_month,
        region_name,
        territory_name,
        rank_sales_eur AS mat_rank,
        ${lagSelects.join(',\n        ')}
      FROM region_metrics
      WHERE brand_name = ? AND period_type = ?
      WINDOW w AS (PARTITION BY region_name ORDER BY year_month)
    )
    SELECT * FROM s
    WHERE year_month = ? AND v${maxLag} IS NOT NULL
    ORDER BY mat_rank DESC
  `

  const rawRows = db.prepare(sql).all(brand, def.period_type, asof) as Record<string, unknown>[]

  const result: SignalRow[] = rawRows.map(row => {
    // Build series: oldest (v_maxLag) → now (v0)
    const series: number[] = []
    for (let i = maxLag; i >= 0; i--) {
      series.push(row[`v${i}`] as number)
    }

    const now = row['v0'] as number

    // Build deltas only for the requested delta_lags
    const deltas: Record<string, number> = {}
    for (const lag of def.delta_lags) {
      if (lag > 0 && lag <= maxLag) {
        const lagVal = row[`v${lag}`] as number
        if (lagVal !== null && lagVal !== undefined) {
          deltas[`delta_${lag}m`] = Math.round((now - lagVal) * 1000) / 1000
        }
      }
    }

    const strength = computeStrength(series, def)

    return {
      region: row['region_name'] as string,
      territory: row['territory_name'] as string,
      series,
      now,
      deltas,
      strength,
      mat_rank: row['mat_rank'] as number,
    }
  })

  return result.sort((a, b) => b.mat_rank - a.mat_rank)
}

export function getSignalById(id: string): SignalDefinition | null {
  const db = toolDb()
  const row = db.prepare('SELECT * FROM signal_definitions WHERE id = ?').get(id)
  if (!row) return null
  const r = row as { id: string; name: string; label: string; metric: string; period_type: string; lags: string; delta_lags: string; direction: string; strength_kind: string; loud_threshold: number; created_at: string; updated_at: string }
  return {
    ...r,
    lags: JSON.parse(r.lags),
    delta_lags: JSON.parse(r.delta_lags),
    direction: r.direction as SignalDefinition['direction'],
    strength_kind: r.strength_kind as SignalDefinition['strength_kind'],
  }
}
