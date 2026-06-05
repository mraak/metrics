import { NextRequest, NextResponse } from 'next/server'
import { toolDb, parseFindingRow } from '@/lib/db'
import type { FindingDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params
    const db = toolDb()
    const row = db.prepare('SELECT * FROM finding_definitions WHERE id = ?').get(id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: parseFindingRow(row as Parameters<typeof parseFindingRow>[0]) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params
    const body = await req.json() as Partial<FindingDefinition>
    const db = toolDb()
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    const updates: string[] = []
    const values: unknown[] = []

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name) }
    if (body.label !== undefined) { updates.push('label = ?'); values.push(body.label) }
    if (body.axes !== undefined) { updates.push('axes = ?'); values.push(JSON.stringify(body.axes)) }
    if (body.classifications !== undefined) { updates.push('classifications = ?'); values.push(JSON.stringify(body.classifications)) }
    if (body.severity !== undefined) { updates.push('severity = ?'); values.push(JSON.stringify(body.severity)) }

    updates.push('updated_at = ?')
    values.push(now)
    values.push(id)

    db.prepare(`UPDATE finding_definitions SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM finding_definitions WHERE id = ?').get(id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: parseFindingRow(row as Parameters<typeof parseFindingRow>[0]) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params
    const db = toolDb()
    db.prepare('DELETE FROM finding_definitions WHERE id = ?').run(id)
    return NextResponse.json({ data: { deleted: id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
