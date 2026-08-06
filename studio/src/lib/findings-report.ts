// findings-report.ts — TypeScript port of findings.py: the Tier-4 Finding
// classifier on the SHARE × GROWTH quadrant, powering the report app's
// Findings/Insights tabs.
//
// Two peer-relative axes, both read as level + trajectory over the same MAT
// window: position = mshare_deviation, momentum = growth_deviation. A region's
// finding is its quadrant (by current level); severity rises with how bad /
// deteriorating each axis is. Materiality (rank) is NOT a trigger — it
// re-enters per persona at the Insight layer. See ANALYSIS_FRAMEWORK.md.
//
// CATALOG: rows persist in studio.db findings_catalog (metrics.db is opened
// read-only) under finding_def_id 'fnd_share_growth' — the same generic
// catalog the Finding Composer writes to, extended with the report columns
// (months_red / escalate / improved / mat_rank / …). One catalog, two writers.
import { metricsDb, toolDb, toolDbReady, dbDriver } from './db'
import { knowledgeDefs, role, signalStrength, round, type Json } from './knowledge'
import { apiSignals } from './report'

export const SHARE_GROWTH_DEF_ID = 'fnd_share_growth'

export const FINDINGS: Record<string, [string, number]> = {
  losing_both: ['Losing on both', 3],
  slipping: ['Slipping', 2],
  catching_up: ['Catching up', 1],
  star: ['Star', 0],
}
export const ORDER = ['losing_both', 'slipping', 'catching_up', 'star']
const RED = new Set(['losing_both'])   // what counts as "red" for month-over-month memory

/** Quadrant by current level: below peers (<0) vs ahead (>=0) on each axis. */
export function classify(msNow: number, grNow: number): string {
  const msBad = msNow < 0
  const grBad = grNow < 0
  if (msBad && grBad) return 'losing_both'
  if (!msBad && grBad) return 'slipping'
  if (msBad && !grBad) return 'catching_up'
  return 'star'
}

interface StrengthLike { net: number; magnitude: number }

/** 0=fine · 1=below OR deteriorating · 2=below AND deteriorating · 3=+loud. */
function axisSev(now: number, sig: StrengthLike, kind: string, defs: Json): number {
  const ss = defs.signal_strength as Json
  const loud = ((ss.loudness_bands_pp as Json)[kind] as { loud: number }).loud
  const below = now < 0
  const deteriorating = sig.net < -0.3
  let s = (below ? 1 : 0) + (deteriorating ? 1 : 0)
  if (below && deteriorating && sig.magnitude >= loud) s += 1
  return Math.min(3, s)
}

export function severity(msNow: number, msSig: StrengthLike, grNow: number, grSig: StrengthLike, defs: Json) {
  const msv = axisSev(msNow, msSig, 'position', defs)
  const grv = axisSev(grNow, grSig, 'growth', defs)
  const score = msv + grv                       // 0..6
  const band = score >= 5 ? 'critical' : score >= 3 ? 'high' : score >= 2 ? 'moderate' : 'low'
  return { ms: msv, growth: grv, score, band }
}

// ── Catalog (persistent store in studio.db) ──────────────────────────────────

interface FindingRow extends Json {
  region: string
  territory: string
  finding: string
  now: number
  series: number[]
  strength: Json
  growth_now: number
  growth_series: number[]
  growth_strength: Json
  market_share: number | null
  mat_rank: number
  severity: { ms: number; growth: number; score: number; band: string }
  months_red?: number
  escalate?: boolean
  improved?: boolean
}

async function saveFindings(rows: FindingRow[], brand: string, asof: string, force: boolean): Promise<[number, number]> {
  await toolDbReady()
  const db = toolDb()
  // Postgres: one INSERT verb + an ON CONFLICT suffix does either mode.
  // SQLite: the verb itself picks IGNORE vs REPLACE; no suffix needed (and
  // REPLACE already refreshes recorded_at via its column default, since it's
  // implemented as delete+insert).
  const insertSql = dbDriver() === 'postgres'
    ? `INSERT INTO findings_catalog
         (finding_def_id, brand_name, region_name, territory_name, year_month,
          finding_key, severity_band, severity_score,
          ms_now, ms_sev, growth_now, growth_sev,
          mat_rank, market_share, months_red, escalate, improved,
          axes_snapshot)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ${force
      ? `ON CONFLICT (finding_def_id, brand_name, region_name, year_month) DO UPDATE SET
           territory_name=EXCLUDED.territory_name, recorded_at=now()::text,
           finding_key=EXCLUDED.finding_key, severity_band=EXCLUDED.severity_band,
           severity_score=EXCLUDED.severity_score,
           ms_now=EXCLUDED.ms_now, ms_sev=EXCLUDED.ms_sev,
           growth_now=EXCLUDED.growth_now, growth_sev=EXCLUDED.growth_sev,
           mat_rank=EXCLUDED.mat_rank, market_share=EXCLUDED.market_share,
           months_red=EXCLUDED.months_red, escalate=EXCLUDED.escalate, improved=EXCLUDED.improved,
           axes_snapshot=EXCLUDED.axes_snapshot`
      : `ON CONFLICT (finding_def_id, brand_name, region_name, year_month) DO NOTHING`}`
    : `INSERT ${force ? 'OR REPLACE' : 'OR IGNORE'} INTO findings_catalog
         (finding_def_id, brand_name, region_name, territory_name, year_month,
          finding_key, severity_band, severity_score,
          ms_now, ms_sev, growth_now, growth_sev,
          mat_rank, market_share, months_red, escalate, improved,
          axes_snapshot)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  const stmt = db.prepare(insertSql)
  let inserted = 0
  let skipped = 0
  const tx = db.transaction(async () => {
    for (const r of rows) {
      const prov = JSON.stringify({
        ms_series: r.series,
        ms_strength: r.strength,
        growth_series: r.growth_series,
        growth_strength: r.growth_strength,
      })
      const info = await stmt.run(
        SHARE_GROWTH_DEF_ID, brand, r.region, r.territory, asof,
        r.finding, r.severity.band, r.severity.score,
        r.now, r.severity.ms, r.growth_now, r.severity.growth,
        r.mat_rank, r.market_share, r.months_red ?? 0,
        r.escalate ? 1 : 0, r.improved ? 1 : 0,
        prov)
      if (info.changes) inserted++
      else skipped++
    }
  })
  await tx()
  return [inserted, skipped]
}

export async function catalogStats(): Promise<{ total_rows: number; periods: number }> {
  await toolDbReady()
  const r = await toolDb().prepare(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT brand_name||'|'||year_month) AS periods
    FROM findings_catalog WHERE finding_def_id=?
  `).get(SHARE_GROWTH_DEF_ID) as { n: number; periods: number }
  return { total_rows: r.n, periods: r.periods }
}

/** Finding history for one region, oldest-first (key names match schema.html). */
export async function regionHistory(brand: string, region: string): Promise<Json[]> {
  await toolDbReady()
  return toolDb().prepare(`
    SELECT year_month, finding_key AS finding, severity_band, severity_score,
           ms_now, growth_now, mat_rank, months_red, escalate, improved,
           axes_snapshot AS provenance
    FROM findings_catalog
    WHERE finding_def_id=? AND brand_name=? AND region_name=?
    ORDER BY year_month
  `).all(SHARE_GROWTH_DEF_ID, brand, region) as Promise<Json[]>
}

// ── Month-over-month memory ──────────────────────────────────────────────────

interface HistEntry {
  months_red: number
  improved: boolean
  escalate: boolean
  red_now: boolean
  rank: number
  territory: string
}

/** Per region: is it 'red' (losing_both, band >= high) now / -1m / -2m? */
async function history(brand: string, asof: string, defs: Json): Promise<Record<string, HistEntry>> {
  const mlags = Array.from({ length: 5 }, (_, j) => `LAG(mshare_deviation,${j + 1}) OVER w AS mx${j + 1}`).join(', ')
  const glags = Array.from({ length: 5 }, (_, j) => `LAG(growth_deviation,${j + 1}) OVER w AS gx${j + 1}`).join(', ')
  const rows = await metricsDb().prepare(`
    WITH s AS (
      SELECT region_name, territory_name, year_month, rank_sales_eur AS rk,
             mshare_deviation AS mx0, ${mlags},
             growth_deviation AS gx0, ${glags}
      FROM region_metrics WHERE brand_name=? AND period_type='MAT'
      WINDOW w AS (PARTITION BY region_name ORDER BY year_month)
    ) SELECT * FROM s WHERE year_month=?
  `).all(brand, asof) as Record<string, never>[]

  const hist: Record<string, HistEntry> = {}
  for (const r of rows) {
    const mx = [0, 1, 2, 3, 4, 5].map(j => r[`mx${j}`] as number | null)
    const gx = [0, 1, 2, 3, 4, 5].map(j => r[`gx${j}`] as number | null)
    const reds: (boolean | null)[] = []
    for (let k = 0; k < 3; k++) {                              // now, -1m, -2m
      const mwin = mx.slice(k, k + 4)                          // now..oldest
      const gwin = gx.slice(k, k + 4)
      if (mwin.some(v => v == null) || gwin.some(v => v == null)) {
        reds.push(null)
        continue
      }
      const msSer = [...mwin].reverse().map(v => round(v as number, 2))   // oldest -> now
      const grSer = [...gwin].reverse().map(v => round(v as number, 2))
      const msSt = signalStrength(msSer, 'higher_is_better', defs, 'position')
      const grSt = signalStrength(grSer, 'higher_is_better', defs, 'growth')
      const sev = severity(msSer[msSer.length - 1], msSt, grSer[grSer.length - 1], grSt, defs)
      // "red" = losing_both AND deteriorating (band >= high)
      reds.push(RED.has(classify(msSer[msSer.length - 1], grSer[grSer.length - 1])) && sev.score >= 3)
    }
    let monthsRed = 0
    for (const v of reds) {
      if (v === true) monthsRed++
      else break
    }
    hist[r['region_name'] as string] = {
      months_red: monthsRed,
      improved: reds[1] === true && reds[0] !== true,
      escalate: monthsRed >= 3,
      red_now: reds[0] === true,
      rank: r['rk'],
      territory: r['territory_name'],
    }
  }
  return hist
}

// ── The finding pass ─────────────────────────────────────────────────────────

export async function findFindings(brand: string, asofParam?: string, force = false): Promise<Json> {
  const defs = knowledgeDefs()
  const pMs: Record<string, string | undefined> = { brand, signal: role(defs, 'region_position') }
  const pGr: Record<string, string | undefined> = { brand, signal: role(defs, 'region_growth') }
  if (asofParam) {
    pMs.asof = asofParam
    pGr.asof = asofParam
  }
  const ms = await apiSignals(pMs) as { asof: string; rows: Json[] }
  const gr = await apiSignals(pGr) as { rows: Json[] }
  const asof = ms.asof
  const grby: Record<string, Json> = {}
  for (const r of gr.rows) grby[r.region as string] = r

  const db = metricsDb()
  const terr: Record<string, string> = {}
  for (const r of await db.prepare('SELECT DISTINCT region_name, territory_name FROM region_metrics WHERE brand_name=?').all(brand) as { region_name: string; territory_name: string }[]) {
    terr[r.region_name] = r.territory_name
  }
  const mshare: Record<string, number | null> = {}
  for (const r of await db.prepare('SELECT region_name, market_share FROM region_metrics WHERE brand_name=? AND period_type=\'MAT\' AND year_month=?').all(brand, asof) as { region_name: string; market_share: number | null }[]) {
    mshare[r.region_name] = r.market_share
  }

  const rows: FindingRow[] = []
  for (const r of ms.rows) {
    const g = grby[r.region as string]
    if (!g) continue
    const fid = classify(r.now as number, g.now as number)
    const sev = severity(r.now as number, r.strength as StrengthLike, g.now as number, g.strength as StrengthLike, defs)
    const msv = mshare[r.region as string]
    rows.push({
      region: r.region as string,
      territory: terr[r.region as string] ?? '—',
      finding: fid, label: FINDINGS[fid][0],
      now: r.now as number, series: r.series as number[], strength: r.strength as Json,
      growth_now: g.now as number, growth_series: g.series as number[], growth_strength: g.strength as Json,
      market_share: msv == null ? null : round(msv, 1),
      mat_rank: r.mat_rank as number,
      severity: sev,
    })
  }
  rows.sort((a, b) =>
    (b.severity.score - a.severity.score) ||
    (ORDER.indexOf(a.finding) - ORDER.indexOf(b.finding)) ||
    (b.mat_rank - a.mat_rank))

  const hist = await history(brand, asof, defs)
  const flagged = new Set(rows.map(r => r.region))
  for (const r of rows) {
    const h = hist[r.region]
    r.months_red = h ? h.months_red : (RED.has(r.finding) ? 1 : 0)
    r.improved = h ? h.improved : false
    r.escalate = h ? h.escalate : false
  }
  const recovered = Object.entries(hist)
    .filter(([rg, h]) => h.improved && !flagged.has(rg))
    .map(([rg, h]) => ({ region: rg, territory: h.territory, rank: h.rank }))
    .sort((a, b) => b.rank - a.rank)

  const counts: Record<string, number> = Object.fromEntries(ORDER.map(f => [f, 0]))
  for (const x of rows) counts[x.finding]++
  const summary = ORDER.map(f => ({ finding: f, label: FINDINGS[f][0], count: counts[f] }))
  const territories = [...new Set(rows.map(x => x.territory))].sort()

  // persist to catalog (ON CONFLICT DO NOTHING = first write wins; force=true overwrites)
  const [inserted, skipped] = await saveFindings(rows, brand, asof, force)
  const stats = await catalogStats()

  return {
    brand, asof, count: rows.length,
    summary, territories, rows,
    recovered,
    catalog: {
      inserted, skipped,
      total_rows: stats.total_rows,
      periods: stats.periods,
    },
  }
}
