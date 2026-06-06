import { NextRequest, NextResponse } from 'next/server'
import { toolDb } from '@/lib/db'
import { deserializeSignal } from '@/lib/signal-engine'
import type { SignalDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const db = toolDb()
    const row = db.prepare('SELECT * FROM signal_definitions WHERE id = ?').get(params.id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: deserializeSignal(row as Record<string, unknown>) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const body = await req.json() as Partial<SignalDefinition>
    const db = toolDb()
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    const updates: string[] = []
    const values: unknown[] = []

    if (body.name !== undefined)             { updates.push('name = ?');             values.push(body.name) }
    if (body.label !== undefined)            { updates.push('label = ?');            values.push(body.label) }
    if (body.source_table !== undefined)     { updates.push('source_table = ?');     values.push(body.source_table) }
    if (body.entity_dimension !== undefined) { updates.push('entity_dimension = ?'); values.push(body.entity_dimension) }
    if (body.time_dimension !== undefined)   { updates.push('time_dimension = ?');   values.push(body.time_dimension) }
    if (body.filters !== undefined)          { updates.push('filters = ?');          values.push(JSON.stringify(body.filters)) }
    if (body.segment_by !== undefined)       { updates.push('segment_by = ?');       values.push(JSON.stringify(body.segment_by)) }
    if (body.metric !== undefined)           { updates.push('metric = ?');           values.push(body.metric) }
    if (body.lags !== undefined)             { updates.push('lags = ?');             values.push(JSON.stringify(body.lags)) }
    if (body.delta_lags !== undefined)       { updates.push('delta_lags = ?');       values.push(JSON.stringify(body.delta_lags)) }
    if (body.direction !== undefined)        { updates.push('direction = ?');        values.push(body.direction) }
    if (body.strength_kind !== undefined)    { updates.push('strength_kind = ?');    values.push(body.strength_kind) }
    if (body.loud_threshold !== undefined)   { updates.push('loud_threshold = ?');   values.push(body.loud_threshold) }

    updates.push('updated_at = ?')
    values.push(now, params.id)

    db.prepare(`UPDATE signal_definitions SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM signal_definitions WHERE id = ?').get(params.id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: deserializeSignal(row as Record<string, unknown>) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    toolDb().prepare('DELETE FROM signal_definitions WHERE id = ?').run(params.id)
    return NextResponse.json({ data: { deleted: params.id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
