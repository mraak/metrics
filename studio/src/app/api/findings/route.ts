import { NextRequest, NextResponse } from 'next/server'
import { readAllFindingDefs, upsertFindingDef } from '@/lib/knowledge-store'
import type { FindingDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ data: readAllFindingDefs() })
  } catch (err) {
    console.error('[GET /api/findings]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Omit<FindingDefinition, 'id' | 'created_at' | 'updated_at'>
    return NextResponse.json({ data: upsertFindingDef(null, body) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/findings]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
