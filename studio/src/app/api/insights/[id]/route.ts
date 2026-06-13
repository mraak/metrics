import { NextRequest, NextResponse } from 'next/server'
import { readFramingById, upsertFraming, deleteFraming } from '@/lib/knowledge-store'
import type { InsightFraming } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const f = readFramingById(params.id)
    if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: f })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    if (!readFramingById(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await req.json() as Partial<InsightFraming>
    return NextResponse.json({ data: upsertFraming(params.id, body) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    deleteFraming(params.id)
    return NextResponse.json({ data: { deleted: params.id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
