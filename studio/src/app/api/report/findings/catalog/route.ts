import { NextResponse } from 'next/server'
import { catalogStats } from '@/lib/findings-report'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(catalogStats())
  } catch (err) {
    return NextResponse.json({ error: `${(err as Error).name}: ${(err as Error).message}` }, { status: 500 })
  }
}
