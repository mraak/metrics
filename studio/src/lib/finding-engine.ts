import { computeSignal, computeStrength } from './signal-engine'
import { toolDb } from './db'
import type { FindingDefinition, FindingRow, FindingAxisResult, SignalDefinition } from './types'

function getSignalDef(signalId: string): SignalDefinition {
  const db = toolDb()
  const row = db.prepare('SELECT * FROM signal_definitions WHERE id = ?').get(signalId) as {
    id: string; name: string; label: string; metric: string; period_type: string
    lags: string; delta_lags: string; direction: string; strength_kind: string
    loud_threshold: number; created_at: string; updated_at: string
  } | undefined

  if (!row) {
    throw new Error(`Signal definition not found: ${signalId}`)
  }

  return {
    ...row,
    lags: JSON.parse(row.lags),
    delta_lags: JSON.parse(row.delta_lags),
    direction: row.direction as SignalDefinition['direction'],
    strength_kind: row.strength_kind as SignalDefinition['strength_kind'],
  }
}

export function classifyFindings(
  def: FindingDefinition,
  brand: string,
  asof: string
): FindingRow[] {
  // Step 1: For each axis, compute signal rows
  const axisSignalDefs: Map<string, SignalDefinition> = new Map()
  const axisSignalMaps: Map<string, Map<string, import('./types').SignalRow>> = new Map()

  for (const axis of def.axes) {
    const signalDef = getSignalDef(axis.signal_id)
    axisSignalDefs.set(axis.name, signalDef)

    const signalRows = computeSignal(signalDef, brand, asof)
    const regionMap = new Map<string, import('./types').SignalRow>()
    for (const row of signalRows) {
      regionMap.set(row.region, row)
    }
    axisSignalMaps.set(axis.name, regionMap)
  }

  // Step 2: Find regions present in ALL axes (inner join)
  if (def.axes.length === 0) return []

  const firstAxisMap = axisSignalMaps.get(def.axes[0].name)!
  const allRegions = Array.from(firstAxisMap.keys()).filter(region =>
    def.axes.every(axis => axisSignalMaps.get(axis.name)!.has(region))
  )

  // Step 3: Classify each region
  const results: FindingRow[] = []

  for (const region of allRegions) {
    const firstRow = firstAxisMap.get(region)!

    // Determine side for each axis
    const axisSides: Record<string, 'good' | 'bad'> = {}
    const axisResults: Record<string, FindingAxisResult> = {}

    for (const axis of def.axes) {
      const signalRow = axisSignalMaps.get(axis.name)!.get(region)!
      const signalDef = axisSignalDefs.get(axis.name)!
      const value = signalRow.now
      const isGood = axis.good_direction === 'positive'
        ? value >= axis.threshold
        : value <= axis.threshold

      axisSides[axis.name] = isGood ? 'good' : 'bad'

      // Compute per-axis severity
      let sev = 0
      // +1 if bad
      if (!isGood) sev += 1
      // +1 if deteriorating
      if (signalRow.strength.net < -def.severity.deterioration_delta) sev += 1
      // +1 if loud
      if (signalRow.strength.magnitude >= signalDef.loud_threshold) sev += 1
      // cap at 3
      sev = Math.min(3, sev)

      axisResults[axis.name] = {
        now: signalRow.now,
        series: signalRow.series,
        strength: signalRow.strength,
        sev,
      }
    }

    // Step 3b: Find first matching classification rule
    let matchedKey = 'unclassified'
    let matchedLabel = 'Unclassified'

    for (const rule of def.classifications) {
      const allMatch = rule.conditions.every(cond => axisSides[cond.axis] === cond.side)
      if (allMatch) {
        matchedKey = rule.key
        matchedLabel = rule.label
        break
      }
    }

    // Step 3d: Total severity score and band
    const perAxisSev: Record<string, number> = {}
    let totalScore = 0
    for (const axis of def.axes) {
      perAxisSev[axis.name] = axisResults[axis.name].sev
      totalScore += axisResults[axis.name].sev
    }

    const bands = def.severity.bands
    let band: string
    if (totalScore >= bands.critical) {
      band = 'critical'
    } else if (totalScore >= bands.high) {
      band = 'high'
    } else if (totalScore >= bands.moderate) {
      band = 'moderate'
    } else {
      band = 'low'
    }

    results.push({
      region,
      territory: firstRow.territory,
      finding_key: matchedKey,
      finding_label: matchedLabel,
      severity: {
        score: totalScore,
        band,
        per_axis: perAxisSev,
      },
      axes: axisResults,
      mat_rank: firstRow.mat_rank,
    })
  }

  // Sort by severity score desc, then mat_rank desc
  results.sort((a, b) => {
    if (b.severity.score !== a.severity.score) return b.severity.score - a.severity.score
    return b.mat_rank - a.mat_rank
  })

  return results
}
