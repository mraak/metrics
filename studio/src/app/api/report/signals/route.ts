import { NextRequest, NextResponse } from 'next/server'
import { apiSignals } from '@/lib/report'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    void params
    return NextResponse.json(await apiSignals(params))
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
