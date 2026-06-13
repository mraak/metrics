import { NextRequest, NextResponse } from 'next/server'
import { findFindings } from '@/lib/findings-report'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const p = req.nextUrl.searchParams
    const brand = p.get('brand') ?? 'Oncleris'
    const force = p.get('force') === '1'
    return NextResponse.json(findFindings(brand, undefined, force))
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
