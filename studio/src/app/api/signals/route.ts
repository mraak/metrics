import { NextRequest, NextResponse } from 'next/server'
import { toolDb } from '@/lib/db'
import { deserializeSignal } from '@/lib/signal-engine'
import type { SignalDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const db = toolDb()
    const rows = db.prepare('SELECT * FROM signal_definitions ORDER BY created_at').all()
    const signals = rows.map(r => deserializeSignal(r as Record<string, unknown>))
    return NextResponse.json({ data: signals })
  } catch (err) {
    console.error('[GET /api/signals]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Omit<SignalDefinition, 'id' | 'created_at' | 'updated_at'>
    const db = toolDb()
    const id = crypto.randomUUID()
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    db.prepare(`
      INSERT INTO signal_definitions
        (id, name, label, source_table, entity_dimension, time_dimension,
         filters, segment_by, metric, lags, delta_lags,
         direction, strength_kind, loud_threshold, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, body.name, body.label,
      body.source_table ?? 'region_metrics',
      body.entity_dimension ?? 'region_name',
      body.time_dimension ?? 'year_month',
      JSON.stringify(body.filters ?? []),
      JSON.stringify(body.segment_by ?? []),
      body.metric,
      JSON.stringify(body.lags), JSON.stringify(body.delta_lags),
      body.direction, body.strength_kind, body.loud_threshold ?? 2.0,
      now, now
    )

    const row = db.prepare('SELECT * FROM signal_definitions WHERE id = ?').get(id)
    return NextResponse.json({ data: deserializeSignal(row as Record<string, unknown>) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/signals]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
