import { NextRequest, NextResponse } from 'next/server'
import { territoryMetrics } from '@/lib/territory'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const brand = req.nextUrl.searchParams.get('brand') ?? 'Oncleris'
    return NextResponse.json(territoryMetrics(brand))
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
