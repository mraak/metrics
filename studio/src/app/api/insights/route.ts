import { NextRequest, NextResponse } from 'next/server'
import { toolDb, parseFramingRow } from '@/lib/db'
import type { InsightFraming } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const db = toolDb()
    const rows = db.prepare('SELECT * FROM insight_framings ORDER BY persona, finding_key').all()
    const framings = rows.map(r => parseFramingRow(r as Parameters<typeof parseFramingRow>[0]))
    return NextResponse.json({ data: framings })
  } catch (err) {
    console.error('[GET /api/insights]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Omit<InsightFraming, 'id' | 'created_at' | 'updated_at'>
    const db = toolDb()
    const id = crypto.randomUUID()
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    db.prepare(`
      INSERT INTO insight_framings (id, persona, finding_key, mode, template, llm_system, llm_user, model, surface_conditions, suppress_conditions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, body.persona, body.finding_key,
      body.mode ?? 'template',
      body.template ?? '',
      body.llm_system ?? '',
      body.llm_user ?? '',
      body.model ?? 'claude-haiku-4-5',
      JSON.stringify(body.surface_conditions ?? []),
      JSON.stringify(body.suppress_conditions ?? []),
      now, now
    )

    const row = db.prepare('SELECT * FROM insight_framings WHERE id = ?').get(id)
    return NextResponse.json({ data: parseFramingRow(row as Parameters<typeof parseFramingRow>[0]) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/insights]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
