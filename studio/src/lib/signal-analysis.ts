// signal-analysis.ts — TypeScript port of signal_analysis.py: cross-metric
// loudness analysis for the Signal Analysis tab.
//
// Intrinsic loudness (V = total variation of a signal's 4-point window) stays
// raw and per-metric. To compare loudness ACROSS differently-scaled metrics:
//   vs_peers — cross-sectional percentile of V among all entities this month
//   vs_self  — robust z of current V against this entity's OWN past V (median+MAD)
// The 2x2 of those axes tags each (signal, entity):
//   Eruption / Chronic / Stirring / Quiet.
// Composites standardize each signal's steps by that metric's step-scale (MAD
// of one-month deltas, computed at the signal's own grain), then take the total
// variation of the standardized N-D path. Levels never mix in a composite — a
// region path and a territory path share no entities.
import { metricsDb } from './db'
import {
  knowledgeDefs, signalTemplates, sourceTable, entityDim, level as sigLevel,
  signalStrength, round, type Json, type SignalTemplate,
} from './knowledge'

const LOUD_PCTL = 0.90                     // vs_peers >= this  => "loud now"
const UNUSUAL_Z = 2.0                      // vs_self  >= this  => "unusual for itself"
const scaleCache = new Map<string, number>()

const DEFS = () => knowledgeDefs()

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

function pstdev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

// ── Interpretation (plain-language read of a loud signal / composite) ─────────
const SHAPE_PHRASE: Record<string, string> = {
  trend: 'a clean directional move',
  unstable: 'a loud, directionless swing',
  mixed: 'a partial-direction move',
  quiet: 'little net movement',
}
const TAG_PHRASE: Record<string, string> = {
  eruption: 'loud vs peers and a break from its own calm history',
  chronic: 'loud vs peers but typical for this region',
  stirring: 'unusual for this region, not yet loud vs peers',
  quiet: '',
}

function dirWord(net: number, higherIsBetter = true): string {
  if (net === 0) return 'flat'
  const good = higherIsBetter ? net > 0 : net < 0
  return good ? 'improving' : 'deteriorating'
}

function interpretSingle(direction: string, shape: string, tag: string, vsSelf: number | null): string {
  let base: string
  if (shape === 'unstable') base = 'Swinging hard with no clear net direction'
  else if (shape === 'quiet') base = 'Little net movement'
  else base = `${direction[0].toUpperCase()}${direction.slice(1)} on ${SHAPE_PHRASE[shape] ?? 'a move'}`
  const ctx = TAG_PHRASE[tag] ?? ''
  let s = ctx ? `${base} — ${ctx}` : base
  if (vsSelf != null && vsSelf >= UNUSUAL_Z && (tag === 'eruption' || tag === 'stirring')) {
    s += ` (≈${fixed0HalfEven(vsSelf)}σ above its own normal)`
  }
  return s + '.'
}

// Python's f"{x:.0f}" rounds exact halves to even (10.5 -> '10'); toFixed
// rounds them away from zero. vs_self is a 2dp value, so exact halves happen.
function fixed0HalfEven(x: number): string {
  const fl = Math.floor(x)
  if (x - fl === 0.5) return String(fl % 2 === 0 ? fl : fl + 1)
  return String(Math.round(x))
}

function interpretComposite(compV: number, contrib: Record<string, { loudness: number; dir: string }>): string {
  const dirs = new Set(Object.values(contrib).map(c => c.dir).filter(d => d !== 'flat'))
  const top = Object.entries(contrib).reduce((a, b) => (b[1].loudness > a[1].loudness ? b : a))
  const agree = dirs.size <= 1
    ? 'reinforcing — components move the same way'
    : 'divergent — components pull opposite ways'
  return `Loud composite (${compV.toFixed(1)}σ), ${agree}; driven mainly by ${top[0]} (${top[1].dir}).`
}

function totalVariation(series: number[]): number {
  let v = 0
  for (let i = 1; i < series.length; i++) v += Math.abs(series[i] - series[i - 1])
  return v
}

/** Robust scale (MAD) of one-month deltas, pooled over all brands/entities at
 *  this grain. Cached per (table, metric, period_type). */
export async function stepScale(metric: string, periodType: string, table = 'region_metrics', ent = 'region_name'): Promise<number> {
  const key = `${table}|${metric}|${periodType}`
  const hit = scaleCache.get(key)
  if (hit != null) return hit
  const rows = await metricsDb().prepare(
    `SELECT ${ent} AS e, brand_name, ${metric} AS v FROM ${table}
     WHERE period_type=? AND ${metric} IS NOT NULL
     ORDER BY brand_name, e, year_month`
  ).all(periodType) as { e: string; brand_name: string; v: number }[]
  const deltas: number[] = []
  let pk: string | null = null
  let pv: number | null = null
  for (const r of rows) {
    const k = `${r.brand_name}|${r.e}`
    if (k === pk && pv != null) deltas.push(r.v - pv)
    pk = k; pv = r.v
  }
  let scale: number
  if (!deltas.length) scale = 1.0
  else {
    const med = median(deltas)
    const mad = median(deltas.map(d => Math.abs(d - med)))
    scale = mad || (deltas.length > 1 ? pstdev(deltas) : 0) || 1.0
  }
  scaleCache.set(key, scale)
  return scale
}

type WindowHist = [string, number[], number][]   // (year_month, [m3..m0], rank)

async function windows(metric: string, brand: string, period: string, table: string, ent: string): Promise<Record<string, WindowHist>> {
  const rows = await metricsDb().prepare(`
    WITH s AS (
      SELECT ${ent} AS e, year_month, rank_sales_eur AS rk,
             ${metric} AS m0,
             LAG(${metric},1) OVER w AS m1,
             LAG(${metric},2) OVER w AS m2,
             LAG(${metric},3) OVER w AS m3
      FROM ${table}
      WHERE brand_name=? AND period_type=?
      WINDOW w AS (PARTITION BY ${ent} ORDER BY year_month)
    ) SELECT * FROM s
      WHERE m0 IS NOT NULL AND m1 IS NOT NULL AND m2 IS NOT NULL AND m3 IS NOT NULL
      ORDER BY e, year_month
  `).all(brand, period) as Record<string, never>[]
  const out: Record<string, WindowHist> = {}
  for (const r of rows) {
    ;(out[r['e']] = out[r['e']] ?? []).push([r['year_month'], [r['m3'], r['m2'], r['m1'], r['m0']], r['rk']])
  }
  return out
}

interface AnalysisRow extends Json {
  region: string
  vs_peers: number
  vs_self: number | null
}

export async function analyzeSignal(sigId: string, sig: SignalTemplate, brand: string, asof: string): Promise<Json> {
  const wins = await windows(sig.metric, brand, sig.period_type, sourceTable(sig), entityDim(sig))
  const kind = sig.strength_kind ?? 'position'
  const defs = DEFS()
  const rows: AnalysisRow[] = []
  const vNow: number[] = []
  const rawV = new Map<AnalysisRow, number>()
  for (const [region, hist] of Object.entries(wins)) {
    const cur = hist.find(h => h[0] === asof)
    if (!cur) continue
    const [, series, rk] = cur
    const Vnow = totalVariation(series)
    const past = hist.filter(h => h[0] < asof).map(h => totalVariation(h[1]))
    let vsSelf: number | null = null
    if (past.length >= 4) {
      const med = median(past)
      const mad = median(past.map(x => Math.abs(x - med)))
      vsSelf = mad > 0 ? (Vnow - med) / mad : (Vnow <= med ? 0.0 : 6.0)
    }
    const st = signalStrength(series, sig.direction, defs, kind)
    const row: AnalysisRow = {
      region, rank: rk, series: series.map(x => round(x, 2)),
      loudness: round(Vnow, 3), net_change: st.net,
      ker: st.coherence, shape: st.shape,
      direction: st.direction,
      vs_self: vsSelf == null ? null : round(vsSelf, 2),
      vs_peers: 0,
    }
    rows.push(row)
    rawV.set(row, Vnow)
    vNow.push(Vnow)
  }
  const srt = [...vNow].sort((a, b) => a - b)
  const n = srt.length || 1
  for (const r of rows) {
    const v = rawV.get(r) as number
    r.vs_peers = round(srt.filter(x => x <= v).length / n, 3)
    r.tag = tagFor(r.vs_peers, r.vs_self)
    r.read = interpretSingle(r.direction as string, r.shape as string, r.tag as string, r.vs_self)
  }
  rows.sort((a, b) => (b.vs_peers - a.vs_peers) || ((b.vs_self || -9) - (a.vs_self || -9)))
  return {
    signal: sigId, metric: sig.metric, period: sig.period_type,
    kind, level: sigLevel(sig), rows,
  }
}

function tagFor(vsPeers: number, vsSelf: number | null): string {
  const loudNow = vsPeers >= LOUD_PCTL
  const unusual = vsSelf != null && vsSelf >= UNUSUAL_Z
  if (loudNow && unusual) return 'eruption'
  if (loudNow) return 'chronic'
  if (unusual) return 'stirring'
  return 'quiet'
}

async function defaultBrandAsof(brand?: string, asof?: string): Promise<{ brand: string; asof: string }> {
  const db = metricsDb()
  if (!brand) {
    brand = (await db.prepare('SELECT DISTINCT brand_name FROM region_metrics ORDER BY brand_name LIMIT 1').get() as { brand_name: string }).brand_name
  }
  if (!asof) {
    asof = (await db.prepare('SELECT MAX(year_month) AS ym FROM region_metrics').get() as { ym: string }).ym
  }
  return { brand, asof }
}

export async function analyzeAll(brandParam?: string, asofParam?: string): Promise<Json> {
  const { brand, asof } = await defaultBrandAsof(brandParam, asofParam)
  const defs = DEFS()
  const perSignal = await Promise.all(Object.entries(signalTemplates(defs)).map(([sid, s]) => analyzeSignal(sid, s, brand, asof)))
  const flat: Json[] = []
  for (const blk of perSignal) {
    for (const r of blk.rows as Json[]) {
      flat.push({ ...r, signal: blk.signal, metric: blk.metric, period: blk.period, level: blk.level })
    }
  }
  flat.sort((a, b) =>
    ((b.vs_peers as number) - (a.vs_peers as number)) ||
    (((b.vs_self as number) || -9) - ((a.vs_self as number) || -9)))
  return {
    brand, asof, total: flat.length, ranked: flat,
    tag_legend: {
      eruption: 'loud now AND unusual vs own history',
      chronic: 'loud now but normal for this region',
      stirring: 'rising vs its own baseline, not yet loud vs peers',
      quiet: 'nothing to surface',
    },
  }
}

// ── Composites ───────────────────────────────────────────────────────────────

// Per entity at every month: the signal's standardized step vector (z-steps,
// for composite loudness) AND its raw series (oldest→now, for charting).
interface StdEntry { steps: number[]; series: number[] }

async function stdSteps(sig: SignalTemplate, brand: string): Promise<Record<string, Record<string, StdEntry>>> {
  const table = sourceTable(sig)
  const ent = entityDim(sig)
  const scale = await stepScale(sig.metric, sig.period_type, table, ent)
  const wins = await windows(sig.metric, brand, sig.period_type, table, ent)
  const out: Record<string, Record<string, StdEntry>> = {}
  for (const [region, hist] of Object.entries(wins)) {
    const byYm: Record<string, StdEntry> = {}
    for (const [ym, series] of hist) {
      const steps: number[] = []
      for (let i = 1; i < series.length; i++) steps.push((series[i] - series[i - 1]) / scale)
      byYm[ym] = { steps, series }
    }
    out[region] = byYm
  }
  return out
}

// Optional per-signal weights (parallel to sigIds, summing to 1). Each signal's standardized
// steps are scaled by weight × N before the axes are combined, so equal weights (1/N each)
// reproduce the unweighted composite exactly; a weight of 0 drops a signal, a heavier weight
// amplifies that metric. Weights touch only the standardized geometry — the raw `net`/`series`
// shown in the per-signal cards stay in their own metric units.
async function compositeRows(sigIds: string[], brand: string, asof: string, weights?: number[]): Promise<Json[]> {
  const sigs = signalTemplates(DEFS())
  const wf = (i: number) =>
    (weights && weights.length === sigIds.length ? weights[i] * sigIds.length : 1)
  const stepsBySig: Record<string, Record<string, Record<string, StdEntry>>> = {}
  for (const sid of sigIds) stepsBySig[sid] = await stdSteps(sigs[sid], brand)
  // entities present in every selected signal at asof
  const sets: Set<string>[] = sigIds.map(sid =>
    new Set(Object.keys(stepsBySig[sid]).filter(rg => asof in stepsBySig[sid][rg])))
  const common: Set<string> = sets.length
    ? sets.reduce((a, b) => new Set([...a].filter(x => b.has(x))))
    : new Set<string>()
  const rows: Json[] = []
  for (const rg of common) {
    let perStep: number[][] | null = null
    const contrib: Record<string, { loudness: number; dir: string; net: number; znet: number; series: number[] }> = {}
    for (let idx = 0; idx < sigIds.length; idx++) {
      const sid = sigIds[idx]
      const raw = stepsBySig[sid][rg][asof]
      const z = raw.steps.map(s => s * wf(idx))   // standardized steps, scaled by this signal's weight
      const series = raw.series
      const hib = sigs[sid].direction === 'higher_is_better'
      contrib[sid] = {
        loudness: round(z.reduce((a, s) => a + Math.abs(s), 0), 3),
        dir: dirWord(z.reduce((a, s) => a + s, 0), hib),
        net: round(series[series.length - 1] - series[0], 2),   // raw net (metric units), oldest→now
        znet: 0,                                                // signed σ net, filled in below (sums to composite_net)
        series: series.map(v => round(v, 2)),                   // raw trajectory for charting
      }
      if (perStep == null) perStep = z.map(s => [s])
      else z.forEach((s, i) => (perStep as number[][])[i].push(s))
    }
    const compV = (perStep ?? []).reduce((a, vec) => a + Math.sqrt(vec.reduce((x, s) => x + s * s, 0)), 0)
    // Per-signal net displacement, projected onto each signal's "good" direction (z units):
    // positive = improved, negative = deteriorated.
    const netVec = (perStep ?? []).reduce<number[]>((acc, vec) =>
      acc.length ? acc.map((v, j) => v + vec[j]) : [...vec], [])
    const goodNet = sigIds.map((sid, j) =>
      (sigs[sid].direction === 'higher_is_better' ? 1 : -1) * (netVec[j] ?? 0))
    // Surface each signal's signed σ contribution so the per-signal cards reconcile with the
    // total: Σ znet == composite_net exactly (raw `net` is in metric units and does NOT sum).
    sigIds.forEach((sid, j) => { contrib[sid].znet = round(goodNet[j], 2) })
    // Total net: the additive tally across signals. Reinforcing moves pile on (−5 and −2 → −7),
    // opposing moves cancel (−5 and +5 → 0). This is the business "bottom line" of the composite.
    // NOTE: not bounded by loudness — an L1-style sum across axes can exceed the Euclidean path
    // length, so it can't drive KER without breaking KER's [−1,+1] range.
    const compNet = round(goodNet.reduce((a, s) => a + s, 0), 3)
    // KER directionality uses the Euclidean displacement magnitude ‖Σ steps‖ (always ≤ loudness),
    // signed by the net tally. Range −1…+1: +1 = clean improving trend, −1 = clean deteriorating,
    // 0 = loud movement that nets to nothing.
    const netMag = Math.sqrt(goodNet.reduce((x, s) => x + s * s, 0))
    const compKer = round(compV > 0 ? Math.sign(compNet) * netMag / compV : 0, 3)
    rows.push({
      region: rg, composite_loudness: round(compV, 3),
      composite_net: compNet, composite_ker: compKer,
      contrib, read: interpretComposite(compV, contrib),
    })
  }
  // tie-break by entity name (code-point order) so equal-loudness rows are stable
  rows.sort((a, b) =>
    ((b.composite_loudness as number) - (a.composite_loudness as number)) ||
    ((a.region as string) < (b.region as string) ? -1 : (a.region as string) > (b.region as string) ? 1 : 0))
  return rows
}

// Percentile at fraction f (0 = min, 1 = max), over a copy sorted ascending.
function pctAt(arr: number[], f: number): number {
  const s = [...arr].sort((a, b) => a - b)
  return round(s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * f)))], 3)
}

// The bundle-level scorecard for a set of composite rows. This is the single source of truth
// for both Compose (one hand-picked bundle) and Auto-search (every bundle) — by sharing it, a
// composed bundle and its auto-search row are identical by construction. `rows` must come from
// compositeRows (sorted loudest-first).
function scoreCombo(rows: Json[], sigIds: string[], summaryPctl: number): Json {
  const nets = rows.map(r => r.composite_net as number)
  const kers = rows.map(r => r.composite_ker as number)
  // Synergy: how much deeper the combo's worst entity sinks than its worst single signal alone.
  const soloWorst = sigIds.map(sid =>
    Math.min(...rows.map(r => ((r.contrib as Record<string, { znet: number }>)[sid]?.znet ?? 0))))
  return {
    synergy: round(Math.min(...soloWorst) - Math.min(...nets), 3),
    loudness_p95: pctAt(rows.map(r => r.composite_loudness as number), summaryPctl),
    net_total: round(nets.reduce((a, n) => a + n, 0), 3),
    net_best: pctAt(nets, summaryPctl),
    net_worst: pctAt(nets, 1 - summaryPctl),
    ker_best: pctAt(kers, summaryPctl),
    ker_worst: pctAt(kers, 1 - summaryPctl),
    max_loudness: rows[0].composite_loudness,
  }
}

export async function composite(sigIds: string[], brandParam?: string, asofParam?: string,
  topPct = 0.05, weights?: number[]): Promise<Json> {
  const sigs = signalTemplates(DEFS())
  const levels = new Set(sigIds.filter(sid => sid in sigs).map(sid => sigLevel(sigs[sid])))
  if (levels.size > 1) {
    return {
      error: `composite mixes signal levels ${JSON.stringify([...levels].sort()).replace(/"/g, "'")} — ` +
        'signals must share one grain (their entities never overlap)',
    }
  }
  const { brand, asof } = await defaultBrandAsof(brandParam, asofParam)
  const rows = await compositeRows(sigIds, brand, asof, weights)
  const k = Math.max(1, Math.floor(rows.length * topPct))
  return {
    brand, asof, signals: sigIds, weights: weights ?? null, rows,
    top_loudest: rows.slice(0, k),
    summary: rows.length ? scoreCombo(rows, sigIds, 0.95) : null,
  }
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k > arr.length) return
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield idx.map(i => arr[i])
    let i = k - 1
    while (i >= 0 && idx[i] === i + arr.length - k) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

export async function search(brandParam?: string, asofParam?: string, maxK = 3, summaryPctl = 0.95): Promise<Json> {
  const { brand, asof } = await defaultBrandAsof(brandParam, asofParam)
  // combos only make sense within one grain: a region path and a territory
  // path share no entities, so mixed-level composites are always empty
  const byLevel: Record<string, string[]> = {}
  for (const [sid, s] of Object.entries(signalTemplates(DEFS()))) {
    ;(byLevel[sigLevel(s)] = byLevel[sigLevel(s)] ?? []).push(sid)
  }
  const combos: Json[] = []
  for (let k = 2; k <= maxK; k++) {
    for (const ids of Object.values(byLevel)) {
      for (const combo of combinations(ids, k)) {
        const rows = await compositeRows(combo, brand, asof)
        if (!rows.length) continue
        combos.push({
          signals: combo, size: k,
          ...scoreCombo(rows, combo, summaryPctl),
          top_regions: rows.slice(0, 3).map(r => r.region),
        })
      }
    }
  }
  combos.sort((a, b) => (b.loudness_p95 as number) - (a.loudness_p95 as number))
  return { brand, asof, max_k: maxK, combos }
}
