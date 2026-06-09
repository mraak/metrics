import { NextRequest, NextResponse } from 'next/server'
import { readAllSignals, upsertSignal } from '@/lib/knowledge-store'
import type { SignalDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ data: readAllSignals() })
  } catch (err) {
    console.error('[GET /api/signals]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Partial<SignalDefinition>
    const saved = upsertSignal(null, body)
    return NextResponse.json({ data: saved }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/signals]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
