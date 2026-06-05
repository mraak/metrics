import { NextRequest, NextResponse } from 'next/server'
import { toolDb, parseSignalRow } from '@/lib/db'
import type { SignalDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params
    const db = toolDb()
    const row = db.prepare('SELECT * FROM signal_definitions WHERE id = ?').get(id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: parseSignalRow(row as Parameters<typeof parseSignalRow>[0]) })
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
    const body = await req.json() as Partial<SignalDefinition>
    const db = toolDb()
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    const updates: string[] = []
    const values: unknown[] = []

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name) }
    if (body.label !== undefined) { updates.push('label = ?'); values.push(body.label) }
    if (body.metric !== undefined) { updates.push('metric = ?'); values.push(body.metric) }
    if (body.period_type !== undefined) { updates.push('period_type = ?'); values.push(body.period_type) }
    if (body.lags !== undefined) { updates.push('lags = ?'); values.push(JSON.stringify(body.lags)) }
    if (body.delta_lags !== undefined) { updates.push('delta_lags = ?'); values.push(JSON.stringify(body.delta_lags)) }
    if (body.direction !== undefined) { updates.push('direction = ?'); values.push(body.direction) }
    if (body.strength_kind !== undefined) { updates.push('strength_kind = ?'); values.push(body.strength_kind) }
    if (body.loud_threshold !== undefined) { updates.push('loud_threshold = ?'); values.push(body.loud_threshold) }

    updates.push('updated_at = ?')
    values.push(now)
    values.push(id)

    db.prepare(`UPDATE signal_definitions SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM signal_definitions WHERE id = ?').get(id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: parseSignalRow(row as Parameters<typeof parseSignalRow>[0]) })
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
    db.prepare('DELETE FROM signal_definitions WHERE id = ?').run(id)
    return NextResponse.json({ data: { deleted: id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
