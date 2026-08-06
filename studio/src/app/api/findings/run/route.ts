import { NextRequest, NextResponse } from 'next/server'
import { metricsDb, toolDb, toolDbReady, dbDriver } from '@/lib/db'
import { readFindingDefById } from '@/lib/knowledge-store'
import { classifyFindings } from '@/lib/finding-engine'
import type { FindingDefinition, FindingRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      definition_id?: string
      definition?: FindingDefinition
      // segmentValues: e.g. { brand_name: 'Oncleris' } — forwarded to signal engine
      segmentValues?: Record<string, string | number>
      // Legacy: accept brand as shorthand for { brand_name: brand }
      brand?: string
      asof?: string
      save?: boolean
    }

    const db = toolDb()
    const mdb = metricsDb()
    await toolDbReady()

    let def: FindingDefinition
    if (body.definition_id) {
      const found = readFindingDefById(body.definition_id)
      if (!found) return NextResponse.json({ error: `Finding definition not found: ${body.definition_id}` }, { status: 404 })
      def = found
    } else if (body.definition) {
      def = body.definition
    } else {
      return NextResponse.json({ error: 'Either definition_id or definition must be provided' }, { status: 400 })
    }

    // Support both legacy { brand } and new { segmentValues }
    const segmentValues: Record<string, string | number> =
      body.segmentValues ?? (body.brand ? { brand_name: body.brand } : {})

    const asof = body.asof ?? (await mdb.prepare('SELECT MAX(year_month) AS latest FROM region_metrics').get() as { latest: string }).latest

    const rows: FindingRow[] = await classifyFindings(def, segmentValues, asof)

    const summaryMap = new Map<string, { key: string; label: string; count: number }>()
    for (const row of rows) {
      if (!summaryMap.has(row.finding_key)) {
        summaryMap.set(row.finding_key, { key: row.finding_key, label: row.finding_label, count: 0 })
      }
      summaryMap.get(row.finding_key)!.count++
    }
    const summary = Array.from(summaryMap.values())

    let saved = 0
    if (body.save) {
      const brandName = String(segmentValues.brand_name ?? body.brand ?? 'unknown')
      const insertSql = dbDriver() === 'postgres'
        ? `INSERT INTO findings_catalog
             (finding_def_id, brand_name, region_name, territory_name, year_month,
              finding_key, severity_band, severity_score, axes_snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (finding_def_id, brand_name, region_name, year_month) DO NOTHING`
        : `INSERT OR IGNORE INTO findings_catalog
             (finding_def_id, brand_name, region_name, territory_name, year_month,
              finding_key, severity_band, severity_score, axes_snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      const insert = db.prepare(insertSql)
      await db.transaction(async (frows: FindingRow[]) => {
        for (const frow of frows) {
          const result = await insert.run(
            def.id, brandName, frow.region, frow.territory ?? '', asof,
            frow.finding_key, frow.severity.band, frow.severity.score,
            JSON.stringify(frow.axes)
          )
          saved += result.changes
        }
      })(rows)
    }

    return NextResponse.json({
      data: { rows, segmentValues, asof, summary, saved },
    })
  } catch (err) {
    console.error('[POST /api/findings/run]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
