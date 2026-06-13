import { NextRequest, NextResponse } from 'next/server'
import { readAllFramings, upsertFraming } from '@/lib/knowledge-store'
import type { InsightFraming } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ data: readAllFramings() })
  } catch (err) {
    console.error('[GET /api/insights]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Omit<InsightFraming, 'id' | 'created_at' | 'updated_at'>
    return NextResponse.json({ data: upsertFraming(null, body) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/insights]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
