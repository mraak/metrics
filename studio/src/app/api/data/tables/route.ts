import { NextResponse } from 'next/server'
import { listTables } from '@/lib/db'

export async function GET() {
  try {
    const tables = await listTables()
    return NextResponse.json({ data: { tables } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
