import { NextRequest, NextResponse } from 'next/server'
import { composite } from '@/lib/signal-analysis'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const p = req.nextUrl.searchParams
    const sigs = (p.get('signals') ?? '').split(',').filter(Boolean)
    // Optional weights, parallel to signals and summing to ~1 (the client normalizes).
    // Re-normalized here defensively; ignored unless one per signal is supplied.
    const raw = (p.get('weights') ?? '').split(',').filter(Boolean).map(Number)
    let weights: number[] | undefined
    if (raw.length === sigs.length && raw.every(w => Number.isFinite(w) && w >= 0)) {
      const sum = raw.reduce((a, w) => a + w, 0)
      if (sum > 0) weights = raw.map(w => w / sum)
    }
    return NextResponse.json(await composite(sigs, p.get('brand') ?? undefined,
      p.get('asof') ?? undefined, 0.05, weights))
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
