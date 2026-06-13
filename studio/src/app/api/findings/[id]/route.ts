import { NextRequest, NextResponse } from 'next/server'
import { readFindingDefById, upsertFindingDef, deleteFindingDef } from '@/lib/knowledge-store'
import type { FindingDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const def = readFindingDefById(params.id)
    if (!def) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: def })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    if (!readFindingDefById(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await req.json() as Partial<FindingDefinition>
    return NextResponse.json({ data: upsertFindingDef(params.id, body) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    deleteFindingDef(params.id)
    return NextResponse.json({ data: { deleted: params.id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
