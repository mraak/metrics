import { NextRequest, NextResponse } from 'next/server'
import { regionHistory } from '@/lib/findings-report'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const p = req.nextUrl.searchParams
    const brand = p.get('brand') ?? 'Oncleris'
    const region = p.get('region')
    if (!region) return NextResponse.json({ error: 'region required' }, { status: 400 })
    return NextResponse.json({ brand, region, history: await regionHistory(brand, region) })
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
