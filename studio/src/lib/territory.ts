// territory.ts — the TERRITORY-level readout for the report app's territory
// blocks (national summary + per-territory table).
//
// Reads two materialized grains directly (Tier 1-2, built by compute_metrics.py):
//   territory_metrics — per territory; the signal machinery runs on its
//                       mshare_deviation, signal resolved by ROLE
//                       (signal_roles.territory_position).
//   national_metrics  — per brand; the national summary's absolute columns
//                       (sales / share / growth / vs-forecast). Its share signal
//                       is the national share's own trajectory (no peer above
//                       brand, so its deviations are 0 by construction).
// Plan attainment (actual ÷ forecast level) is national-only and computed here
// from the forecast table.
import { metricsDb } from './db'
import {
  knowledgeDefs, signalTemplates, role, signalStrength, round, type Json,
} from './knowledge'

interface TRow {
  t: string
  ym: string
  sales_eur: number
  units: number
  market_share: number | null
  mshare_deviation: number | null
  growth_py_sales: number | null
  growth_pp_sales: number | null
  growth_vs_fcst_eur: number | null
  growth_deviation: number | null
}

// One national_metrics row (per brand × month × period); the brand's national position.
interface NRow {
  ym: string
  sales_eur: number
  units: number
  market_share: number | null
  growth_py_sales: number | null
  growth_pp_sales: number | null
  growth_vs_fcst_eur: number | null
}

const rnd1 = (v: number | null | undefined): number | null => (v == null ? null : round(v, 1))

export function territoryMetrics(brand: string, asofParam?: string): Json {
  const defs = knowledgeDefs()
  const sigTpl = signalTemplates(defs)[role(defs, 'territory_position')]
  const sigKind = sigTpl.strength_kind ?? 'position'
  const sigOffsets = [...sigTpl.lags].sort((a, b) => b - a)   // oldest -> now
  const db = metricsDb()

  const yms = (db.prepare('SELECT DISTINCT year_month FROM territory_metrics ORDER BY year_month').all() as { year_month: string }[])
    .map(r => r.year_month)
  const asof = asofParam || yms[yms.length - 1]
  const i = yms.indexOf(asof)

  const rows = db.prepare(`
    SELECT territory_name AS t, year_month AS ym, sales_eur, units,
           market_share, mshare_deviation, growth_py_sales, growth_pp_sales,
           growth_vs_fcst_eur, growth_deviation
    FROM territory_metrics
    WHERE brand_name = ? AND period_type = 'MAT'
  `).all(brand) as TRow[]
  const rc: Record<string, number> = {}
  for (const r of db.prepare('SELECT territory_name AS t, COUNT(*) AS n FROM regions GROUP BY territory_name').all() as { t: string; n: number }[]) {
    rc[r.t] = r.n
  }
  // national TRUE attainment per period_type: actual ÷ forecast (level, not growth)
  const fcstM: Record<string, number> = {}
  for (const r of db.prepare(`
    SELECT f.year_month AS ym, SUM(f.sales_eur) AS f FROM forecast f
    JOIN skus s USING(sku_id) JOIN brands b ON s.brand_id=b.brand_id
    WHERE b.brand_name=? GROUP BY f.year_month
  `).all(brand) as { ym: string; f: number }[]) {
    fcstM[r.ym] = r.f
  }
  const natActual: Record<string, number> = {}
  for (const r of db.prepare(`
    SELECT period_type AS p, SUM(sales_eur) AS s FROM territory_metrics
    WHERE brand_name=? AND year_month=? GROUP BY period_type
  `).all(brand, asof) as { p: string; s: number }[]) {
    natActual[r.p] = r.s
  }

  const byT: Record<string, Record<string, TRow>> = {}
  for (const r of rows) {
    ;(byT[r.t] = byT[r.t] ?? {})[r.ym] = r
  }
  // National row per month from the materialized national_metrics table (one row
  // per brand = the brand's national position). No longer back-derived from
  // territory sums — the absolute columns are computed correctly by the ETL.
  const natByYm: Record<string, NRow> = {}
  for (const r of db.prepare(`
    SELECT year_month AS ym, sales_eur, units, market_share,
           growth_py_sales, growth_pp_sales, growth_vs_fcst_eur
    FROM national_metrics
    WHERE brand_name = ? AND period_type = 'MAT'
  `).all(brand) as NRow[]) {
    natByYm[r.ym] = r
  }
  const ncur = natByYm[asof]
  const natFcstGrowth = ncur && ncur.growth_py_sales != null && ncur.growth_vs_fcst_eur != null
    ? ncur.growth_py_sales - ncur.growth_vs_fcst_eur
    : null

  const periodFcst = (period: string): number | null => {
    let ms: string[]
    if (period === 'Month') ms = [asof]
    else if (period === 'RollQ') ms = yms.slice(Math.max(0, i - 2), i + 1)
    else if (period === 'MAT') ms = yms.slice(Math.max(0, i - 11), i + 1)
    else ms = yms.filter(m => m.slice(0, 4) === asof.slice(0, 4) && m <= asof)   // YTD
    const vals = ms.map(m => fcstM[m])
    return ms.length && vals.every(v => v != null) ? vals.reduce((a, b) => a + b, 0) : null
  }

  const attainment: Record<string, Json> = {}
  for (const period of ['Month', 'RollQ', 'YTD', 'MAT']) {
    const act = natActual[period]
    const fc = periodFcst(period)
    if (act != null && fc) {
      attainment[period] = { actual: round(act, 0), fcst: round(fc, 0), pct: round(act / fc * 100, 1) }
    }
  }

  // National product summary (no peer level above it yet — franchise comes
  // later — so its market-share "signal" is the national share's own trajectory).
  const natAt = (off: number) => (i - off >= 0 && i - off < yms.length ? natByYm[yms[i - off]] : undefined)
  let national: Json | null = null
  if (ncur) {
    let sh: (number | null)[] = sigOffsets.map(off => natAt(off)?.market_share ?? null)
    let nsig: Json | null = null
    if (sh.every(x => x != null)) {
      sh = sh.map(x => round(x as number, 2))
      nsig = signalStrength(sh as number[], sigTpl.direction, defs, sigKind) as unknown as Json
    }
    national = {
      mat_sales: round(ncur.sales_eur, 0), units: round(ncur.units, 0),
      growth_py: rnd1(ncur.growth_py_sales),
      growth_pp: rnd1(ncur.growth_pp_sales),
      market_share: rnd1(ncur.market_share),
      growth_vs_fcst: rnd1(ncur.growth_vs_fcst_eur),
      share_series: sh.every(x => x != null) ? sh : null,
      signal: nsig,
      attainment,
    }
  }

  const out: Json[] = []
  for (const [t, series] of Object.entries(byT)) {
    const cur = series[asof]
    if (!cur) continue
    const at = (off: number) => (i - off >= 0 && i - off < yms.length ? series[yms[i - off]] : undefined)
    let devser: (number | null)[] = sigOffsets.map(off => at(off)?.mshare_deviation ?? null)
    let sig: Json | null = null
    if (devser.every(x => x != null)) {
      devser = devser.map(x => round(x as number, 2))
      sig = signalStrength(devser as number[], sigTpl.direction, defs, sigKind) as unknown as Json
    }
    out.push({
      territory: t,
      region_count: rc[t] ?? 0,
      mat_sales: round(cur.sales_eur, 0),
      units: round(cur.units, 0),
      growth_py: rnd1(cur.growth_py_sales),
      growth_pp: rnd1(cur.growth_pp_sales),
      market_share: rnd1(cur.market_share),
      mshare_deviation: cur.mshare_deviation == null ? null : round(cur.mshare_deviation, 2),
      growth_vs_fcst: rnd1(cur.growth_vs_fcst_eur),
      dev_series: devser.every(x => x != null) ? devser : null,
      signal: sig,
    })
  }
  out.sort((a, b) => (b.mat_sales as number) - (a.mat_sales as number))
  return {
    brand, asof,
    national_fcst_growth: natFcstGrowth == null ? null : round(natFcstGrowth, 1),
    national, territories: out,
  }
}
