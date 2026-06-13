// territory.ts — TypeScript port of territory.py: the TERRITORY-level readout
// for the report app's territory blocks (national summary + per-territory table).
//
// Reads the materialized territory_metrics table (Tier 1-2 at the territory
// grain) and runs the same signal machinery as regions, with the signal
// resolved from the Knowledge Definitions by ROLE (signal_roles.territory_position).
// National references are recovered from the stored deviations (any territory
// row): nat_ms = market_share − mshare_deviation, nat_growth = growth_py_sales −
// growth_deviation, nat fcst growth = growth_py_sales − growth_vs_fcst_eur.
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
  // national series recovered from sums + stored deviations (identical across rows)
  const nat: Record<string, { own: number; units: number; ms: number | null; growth_py: number | null }> = {}
  for (const ym of yms) {
    const per = Object.values(byT).map(s => s[ym]).filter(Boolean)
    if (!per.length) continue
    const ref = per.find(p => p.mshare_deviation != null)
    const gref = per.find(p => p.growth_py_sales != null && p.growth_deviation != null)
    nat[ym] = {
      own: per.reduce((a, p) => a + (p.sales_eur ?? 0), 0),
      units: per.reduce((a, p) => a + (p.units ?? 0), 0),
      ms: ref ? (ref.market_share as number) - (ref.mshare_deviation as number) : null,
      growth_py: gref ? (gref.growth_py_sales as number) - (gref.growth_deviation as number) : null,
    }
  }
  let natFcstGrowth: number | null = null
  for (const s of Object.values(byT)) {
    const p = s[asof]
    if (p && p.growth_py_sales != null && p.growth_vs_fcst_eur != null) {
      natFcstGrowth = p.growth_py_sales - p.growth_vs_fcst_eur
      break
    }
  }

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
  const natAt = (off: number) => (i - off >= 0 && i - off < yms.length ? nat[yms[i - off]] : undefined)
  const ncur = nat[asof]
  let national: Json | null = null
  if (ncur) {
    const npp = natAt(1)
    const ngPp = npp && npp.own ? (ncur.own - npp.own) / npp.own * 100 : null
    const ngvf = ncur.growth_py != null && natFcstGrowth != null ? ncur.growth_py - natFcstGrowth : null
    let sh: (number | null)[] = sigOffsets.map(off => natAt(off)?.ms ?? null)
    let nsig: Json | null = null
    if (sh.every(x => x != null)) {
      sh = sh.map(x => round(x as number, 2))
      nsig = signalStrength(sh as number[], sigTpl.direction, defs, sigKind) as unknown as Json
    }
    national = {
      mat_sales: round(ncur.own, 0), units: round(ncur.units, 0),
      growth_py: rnd1(ncur.growth_py),
      growth_pp: rnd1(ngPp),
      market_share: rnd1(ncur.ms),
      growth_vs_fcst: rnd1(ngvf),
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
