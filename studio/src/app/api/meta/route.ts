import { NextResponse } from 'next/server'
import { metricsDb } from '@/lib/db'
import type { MetaInfo } from '@/lib/types'

export const dynamic = 'force-dynamic'

const EXCLUDED_TEXT_COLS = new Set(['year_month', 'brand_name', 'franchise', 'region_name', 'territory_id', 'territory_name', 'period_type'])

export async function GET(): Promise<NextResponse> {
  try {
    const db = metricsDb()

    const brands = (db.prepare('SELECT DISTINCT brand_name FROM region_metrics ORDER BY brand_name').all() as { brand_name: string }[])
      .map(r => r.brand_name)

    const periodTypes = (db.prepare('SELECT DISTINCT period_type FROM region_metrics ORDER BY period_type').all() as { period_type: string }[])
      .map(r => r.period_type)

    const latestMonth = (db.prepare('SELECT MAX(year_month) AS latest FROM region_metrics').get() as { latest: string }).latest

    const colInfo = db.pragma('table_info(region_metrics)') as { name: string; type: string }[]
    const metrics = colInfo
      .filter(col => {
        const t = col.type.toUpperCase()
        const isNumeric = t === 'REAL' || t === 'INTEGER'
        const isExcluded = EXCLUDED_TEXT_COLS.has(col.name) || col.name.endsWith('_id') || col.name === 'id'
        return isNumeric && !isExcluded
      })
      .map(col => col.name)

    const meta: MetaInfo = { brands, period_types: periodTypes, metrics, latest_month: latestMonth }
    return NextResponse.json({ data: meta })
  } catch (err) {
    console.error('[/api/meta]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
