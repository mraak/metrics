import { NextRequest, NextResponse } from 'next/server'
import { analyzeAll } from '@/lib/signal-analysis'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const p = req.nextUrl.searchParams
    return NextResponse.json(analyzeAll(p.get('brand') ?? undefined, p.get('asof') ?? undefined))
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
