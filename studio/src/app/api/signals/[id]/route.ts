import { NextRequest, NextResponse } from 'next/server'
import { readSignalByName, upsertSignal, deleteSignal } from '@/lib/knowledge-store'
import type { SignalDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const sig = readSignalByName(params.id)
    if (!sig) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: sig })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    if (!readSignalByName(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await req.json() as Partial<SignalDefinition>
    const saved = upsertSignal(params.id, body)
    return NextResponse.json({ data: saved })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const deleted = deleteSignal(params.id)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: { deleted: params.id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
