import { NextResponse } from 'next/server'
import { metricsDb } from '@/lib/db'

export async function GET() {
  try {
    const db = metricsDb()
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const tables = rows.map(r => r.name)
    return NextResponse.json({ data: { tables } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
