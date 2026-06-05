import { NextRequest, NextResponse } from 'next/server'
import { metricsDb, toolDb, parseFindingRow } from '@/lib/db'
import { classifyFindings } from '@/lib/finding-engine'
import type { FindingDefinition, FindingRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      definition_id?: string
      definition?: FindingDefinition
      brand: string
      asof?: string
      save?: boolean
    }

    const db = toolDb()
    const mdb = metricsDb()

    // Resolve definition
    let def: FindingDefinition
    if (body.definition_id) {
      const row = db.prepare('SELECT * FROM finding_definitions WHERE id = ?').get(body.definition_id)
      if (!row) return NextResponse.json({ error: `Finding definition not found: ${body.definition_id}` }, { status: 404 })
      def = parseFindingRow(row as Parameters<typeof parseFindingRow>[0])
    } else if (body.definition) {
      def = body.definition
    } else {
      return NextResponse.json({ error: 'Either definition_id or definition must be provided' }, { status: 400 })
    }

    const asof = body.asof ?? (mdb.prepare('SELECT MAX(year_month) AS latest FROM region_metrics').get() as { latest: string }).latest

    const rows: FindingRow[] = classifyFindings(def, body.brand, asof)

    // Build summary
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
      const insert = db.prepare(`
        INSERT OR IGNORE INTO findings_catalog
          (finding_def_id, brand_name, region_name, territory_name, year_month, finding_key, severity_band, severity_score, axes_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertMany = db.transaction((frows: FindingRow[]) => {
        for (const frow of frows) {
          const result = insert.run(
            def.id,
            body.brand,
            frow.region,
            frow.territory,
            asof,
            frow.finding_key,
            frow.severity.band,
            frow.severity.score,
            JSON.stringify(frow.axes)
          )
          saved += result.changes
        }
      })
      insertMany(rows)
    }

    return NextResponse.json({
      data: { rows, brand: body.brand, asof, summary, saved },
    })
  } catch (err) {
    console.error('[POST /api/findings/run]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
