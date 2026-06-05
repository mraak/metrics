import { NextRequest, NextResponse } from 'next/server'
import { toolDb, parseFramingRow } from '@/lib/db'
import type { InsightFraming } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params
    const db = toolDb()
    const row = db.prepare('SELECT * FROM insight_framings WHERE id = ?').get(id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: parseFramingRow(row as Parameters<typeof parseFramingRow>[0]) })
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
    const body = await req.json() as Partial<InsightFraming>
    const db = toolDb()
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    const updates: string[] = []
    const values: unknown[] = []

    if (body.persona !== undefined) { updates.push('persona = ?'); values.push(body.persona) }
    if (body.finding_key !== undefined) { updates.push('finding_key = ?'); values.push(body.finding_key) }
    if (body.mode !== undefined) { updates.push('mode = ?'); values.push(body.mode) }
    if (body.template !== undefined) { updates.push('template = ?'); values.push(body.template) }
    if (body.llm_system !== undefined) { updates.push('llm_system = ?'); values.push(body.llm_system) }
    if (body.llm_user !== undefined) { updates.push('llm_user = ?'); values.push(body.llm_user) }
    if (body.model !== undefined) { updates.push('model = ?'); values.push(body.model) }
    if (body.surface_conditions !== undefined) { updates.push('surface_conditions = ?'); values.push(JSON.stringify(body.surface_conditions)) }
    if (body.suppress_conditions !== undefined) { updates.push('suppress_conditions = ?'); values.push(JSON.stringify(body.suppress_conditions)) }

    updates.push('updated_at = ?')
    values.push(now)
    values.push(id)

    db.prepare(`UPDATE insight_framings SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM insight_framings WHERE id = ?').get(id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: parseFramingRow(row as Parameters<typeof parseFramingRow>[0]) })
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
    db.prepare('DELETE FROM insight_framings WHERE id = ?').run(id)
    return NextResponse.json({ data: { deleted: id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
