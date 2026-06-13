// report.ts — TypeScript port of server.py's reporting API functions (the
// endpoints schema.html consumes). Payload shapes are kept byte-compatible
// with the Python originals; schema.html is served unchanged from /public.
import { metricsDb } from './db'
import {
  knowledgeDefs, signalTemplates, role, sourceTable, entityDim, level,
  deltaLags, signalStrength, relevanceScore, persistenceLabel,
  compileSignalSql, round, type Json, type SignalTemplate,
} from './knowledge'

type Params = Record<string, string | undefined>

function firstBrand(): string {
  const r = metricsDb().prepare(
    'SELECT DISTINCT brand_name FROM region_metrics ORDER BY brand_name LIMIT 1'
  ).get() as { brand_name: string }
  return r.brand_name
}

function latestYm(): string {
  const r = metricsDb().prepare('SELECT MAX(year_month) AS ym FROM region_metrics').get() as { ym: string }
  return r.ym
}

// ── /api/report/meta ──────────────────────────────────────────────────────────
export function apiMeta(): Json {
  const defs = knowledgeDefs()
  const db = metricsDb()
  const brands = (db.prepare('SELECT DISTINCT brand_name FROM region_metrics ORDER BY brand_name').all() as { brand_name: string }[])
    .map(r => r.brand_name)
  const periods = (db.prepare('SELECT DISTINCT period_type FROM region_metrics').all() as { period_type: string }[])
    .map(r => r.period_type)
  const latest = latestYm()
  const franchises: Record<string, string> = {}
  for (const r of db.prepare('SELECT DISTINCT brand_name, franchise FROM region_metrics').all() as { brand_name: string; franchise: string }[]) {
    franchises[r.brand_name] = r.franchise
  }
  const signals = Object.entries(signalTemplates(defs)).map(([k, v]) => ({
    id: k, metric: v.metric, period_type: v.period_type,
    level: level(v),
    interpretation: v.interpretation ?? '',
  }))
  const roles: Record<string, string> = {}
  for (const [k, v] of Object.entries((defs.signal_roles as Record<string, string>) ?? {})) {
    if (!k.startsWith('_')) roles[k] = v
  }
  return { brands, periods, franchises, signals, signal_roles: roles, latest_ym: latest }
}

// ── /api/report/signals ───────────────────────────────────────────────────────
export function apiSignals(params: Params): Json {
  const defs = knowledgeDefs()
  const sigId = params.signal ?? role(defs, 'ui_default')
  const sig = signalTemplates(defs)[sigId]
  if (!sig) return { error: `unknown signal '${sigId}'` }
  const db = metricsDb()
  const brand = params.brand || firstBrand()
  const asof = params.asof || latestYm()
  const period = params.period || sig.period_type
  const fr = db.prepare('SELECT franchise FROM region_metrics WHERE brand_name=? LIMIT 1').get(brand) as { franchise: string } | undefined
  const franchise = fr ? fr.franchise : null
  const matCol = sig.materiality_from ?? 'rank_sales_eur'
  const table = sourceTable(sig)
  const ent = entityDim(sig)
  const bound: SignalTemplate = { ...sig, period_type: period }

  const sql = compileSignalSql(bound, '?', ':entity', true)
  const lags = [...sig.lags].sort((a, b) => b - a)   // oldest -> now
  const rows = db.prepare(`
    WITH sig AS (${sql.replace(/;\s*$/, '')})
    SELECT s.*, r.${matCol} AS mat
    FROM sig s
    JOIN ${table} r
      ON r.${ent}=s.${ent} AND r.year_month=s.year_month
     AND r.brand_name=? AND r.period_type=?
    WHERE s.year_month=? AND s.m${lags[0]} IS NOT NULL
    ORDER BY r.${matCol} DESC
  `).all(brand, brand, period, asof) as Record<string, number | string>[]

  const kind = sig.strength_kind ?? 'position'
  const out = rows.map(r => {
    const series = lags.map(lag => (lag === 0 ? r.now : r[`m${lag}`]) as number)
    const st = signalStrength(series, sig.direction, defs, kind)
    const rel = relevanceScore(defs, {
      materialityRank: r.mat as number, magnitudeV: st.magnitude,
      periodType: period, kind,
    })
    const readout: Record<string, number> = {}
    for (const dl of deltaLags(sig)) readout[`delta_${dl}m`] = round(r[`delta_${dl}m`] as number, 2)
    return {
      region: r[ent],   // entity name; key kept as 'region' for UI compat
      now: round(r.now as number, 2),
      series: series.map(x => round(x, 2)),
      readout,
      mat_rank: r.mat,
      strength: st,
      consistency: persistenceLabel(st),
      relevance: rel,
    }
  })
  const displaySql = compileSignalSql(bound, `'${brand}'`, ':entity', true)
  return {
    signal: sigId, metric: sig.metric, period, brand, franchise, asof,
    level: level(sig),
    interpretation: sig.interpretation ?? '',
    sql: displaySql, rows: out,
  }
}

// ── /api/report/scatter ───────────────────────────────────────────────────────
export function apiScatter(params: Params): Json {
  const db = metricsDb()
  const brand = params.brand || firstBrand()
  const period = params.period || 'MAT'
  const asof = params.asof || latestYm()
  const rows = db.prepare(`
    SELECT region_name, territory_name, mshare_deviation, growth_deviation, rank_sales_eur
    FROM region_metrics
    WHERE brand_name=? AND period_type=? AND year_month=?
      AND mshare_deviation IS NOT NULL AND growth_deviation IS NOT NULL
  `).all(brand, period, asof) as Record<string, never>[]
  const points = rows.map(r => ({
    region: r['region_name'], territory: r['territory_name'],
    x: round(r['mshare_deviation'], 2), y: round(r['growth_deviation'], 2),
    rank: r['rank_sales_eur'],
  }))
  return { brand, period, asof, points }
}

// ── /api/report/trails ────────────────────────────────────────────────────────
export function apiTrails(params: Params): Json {
  const db = metricsDb()
  const brand = params.brand || firstBrand()
  const asof = params.asof || latestYm()
  const rows = db.prepare(`
    WITH s AS (
      SELECT region_name, territory_name, year_month, rank_sales_eur AS rk,
        mshare_deviation AS x0, LAG(mshare_deviation,1) OVER w AS x1,
        LAG(mshare_deviation,2) OVER w AS x2, LAG(mshare_deviation,3) OVER w AS x3,
        growth_deviation AS y0, LAG(growth_deviation,1) OVER w AS y1,
        LAG(growth_deviation,2) OVER w AS y2, LAG(growth_deviation,3) OVER w AS y3,
        sales_eur AS s0, LAG(sales_eur,1) OVER w AS s1,
        LAG(sales_eur,2) OVER w AS s2, LAG(sales_eur,3) OVER w AS s3,
        rank_sales_eur AS rk0, LAG(rank_sales_eur,1) OVER w AS rk1,
        LAG(rank_sales_eur,2) OVER w AS rk2, LAG(rank_sales_eur,3) OVER w AS rk3,
        market_share AS m0, LAG(market_share,1) OVER w AS m1,
        LAG(market_share,2) OVER w AS m2, LAG(market_share,3) OVER w AS m3,
        units AS u0, LAG(units,1) OVER w AS u1,
        LAG(units,2) OVER w AS u2, LAG(units,3) OVER w AS u3,
        growth_py_sales AS g0, LAG(growth_py_sales,1) OVER w AS g1,
        LAG(growth_py_sales,2) OVER w AS g2, LAG(growth_py_sales,3) OVER w AS g3
      FROM region_metrics WHERE brand_name=? AND period_type='MAT'
      WINDOW w AS (PARTITION BY region_name ORDER BY year_month)
    ) SELECT * FROM s WHERE year_month=? AND x3 IS NOT NULL AND y3 IS NOT NULL
  `).all(brand, asof) as Record<string, never>[]

  const rnd = (v: number) => round(v, 2)
  const opt = (v: number | null, f: (x: number) => number) => (v == null ? null : f(v))
  const points = rows.map(r => ({
    region: r['region_name'], territory: r['territory_name'], rank: r['rk'],
    z: {
      rank: [r['rk3'], r['rk2'], r['rk1'], r['rk0']],
      share: [3, 2, 1, 0].map(k => opt(r[`m${k}`], rnd)),
      units: [3, 2, 1, 0].map(k => opt(r[`u${k}`], v => round(v, 0))),
      growth: [3, 2, 1, 0].map(k => opt(r[`g${k}`], rnd)),
    },
    trail: [
      [rnd(r['x3']), rnd(r['y3']), round(r['s3'], 0)],
      [rnd(r['x2']), rnd(r['y2']), round(r['s2'], 0)],
      [rnd(r['x1']), rnd(r['y1']), round(r['s1'], 0)],
      [rnd(r['x0']), rnd(r['y0']), round(r['s0'], 0)],
    ],
  }))
  return { brand, asof, period: 'MAT', points }
}

// ── /api/report/knowledge ─────────────────────────────────────────────────────
export function apiKnowledge(): Json {
  const defs = knowledgeDefs()
  const sig: Record<string, Json> = {}
  for (const [k, v] of Object.entries(signalTemplates(defs))) {
    sig[k] = { metric: v.metric, period_type: v.period_type, interpretation: v.interpretation ?? '' }
  }
  const rec: Record<string, Json> = {}
  for (const [k, v] of Object.entries((defs.finding_recipes as Record<string, Json>) ?? {})) {
    if (k.startsWith('_')) continue
    rec[k] = {
      label: (v.label as string) ?? k, rule: (v.rule as string) ?? '',
      description: (v.description as string) ?? '',
      default_action: (v.default_action as string) ?? '',
    }
  }
  const frm: Record<string, Json> = {}
  for (const [k, v] of Object.entries((defs.insight_framings as Record<string, Json>) ?? {})) {
    if (k.startsWith('_')) continue
    frm[k] = {
      label: (v.label as string) ?? k, scope: (v.scope as string) ?? '',
      cadence: (v.cadence as string) ?? '', decision: (v.decision as string) ?? '',
      surface_when: (v.surface_when as string) ?? '',
      suppress_when: (v.suppress_when as string) ?? '', tone: (v.tone as string) ?? '',
    }
  }
  return { signals: sig, finding_recipes: rec, insight_framings: frm }
}
