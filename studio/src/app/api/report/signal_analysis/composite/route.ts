import { NextRequest, NextResponse } from 'next/server'
import { composite } from '@/lib/signal-analysis'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const p = req.nextUrl.searchParams
    const sigs = (p.get('signals') ?? '').split(',').filter(Boolean)
    return NextResponse.json(composite(sigs, p.get('brand') ?? undefined, p.get('asof') ?? undefined))
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
