import { NextRequest, NextResponse } from 'next/server'
import { toolDb, parseFindingRow } from '@/lib/db'
import type { FindingDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const db = toolDb()
    const rows = db.prepare('SELECT * FROM finding_definitions ORDER BY created_at').all()
    const findings = rows.map(r => parseFindingRow(r as Parameters<typeof parseFindingRow>[0]))
    return NextResponse.json({ data: findings })
  } catch (err) {
    console.error('[GET /api/findings]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Omit<FindingDefinition, 'id' | 'created_at' | 'updated_at'>
    const db = toolDb()
    const id = crypto.randomUUID()
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    db.prepare(`
      INSERT INTO finding_definitions (id, name, label, axes, classifications, severity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, body.name, body.label,
      JSON.stringify(body.axes),
      JSON.stringify(body.classifications),
      JSON.stringify(body.severity),
      now, now
    )

    const row = db.prepare('SELECT * FROM finding_definitions WHERE id = ?').get(id)
    return NextResponse.json({ data: parseFindingRow(row as Parameters<typeof parseFindingRow>[0]) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/findings]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
