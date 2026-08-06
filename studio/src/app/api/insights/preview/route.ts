import { NextRequest, NextResponse } from 'next/server'
import { metricsDb } from '@/lib/db'
import { readFindingDefById } from '@/lib/knowledge-store'
import { classifyFindings } from '@/lib/finding-engine'
import { renderInsight } from '@/lib/insight-engine'
import type { InsightFraming } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      framing: InsightFraming
      brand: string
      finding_def_id: string
      asof?: string
      max_rows?: number
    }

    const mdb = metricsDb()

    const asof = body.asof ?? (await mdb.prepare('SELECT MAX(year_month) AS latest FROM region_metrics').get() as { latest: string }).latest

    const def = readFindingDefById(body.finding_def_id)
    if (!def) {
      return NextResponse.json({ error: `Finding definition not found: ${body.finding_def_id}` }, { status: 404 })
    }

    const segmentValues: Record<string, string | number> = body.brand ? { brand_name: body.brand } : {}
    const allRows = await classifyFindings(def, segmentValues, asof)

    // Filter to rows matching the framing's finding_key
    const matchingRows = allRows.filter(r => r.finding_key === body.framing.finding_key)

    // Sort by severity desc, take top max_rows (default 5)
    const maxRows = body.max_rows ?? 5
    const topRows = matchingRows.slice(0, maxRows)

    const rendered = topRows.map(row => ({
      region: row.region,
      territory: row.territory,
      finding_key: row.finding_key,
      text: renderInsight(body.framing, row),
    }))

    return NextResponse.json({ data: { rendered } })
  } catch (err) {
    console.error('[POST /api/insights/preview]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
