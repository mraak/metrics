import { NextRequest, NextResponse } from 'next/server'
import { metricsDb } from '@/lib/db'
import { computeSignal } from '@/lib/signal-engine'
import type { SignalDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

function validate(def: Partial<SignalDefinition>): string[] {
  const missing: string[] = []
  if (!def.metric) missing.push('metric')
  if (!def.period_type) missing.push('period_type')
  if (!def.lags || def.lags.length < 2) missing.push('lags (at least 2 required)')
  if (!def.delta_lags) missing.push('delta_lags')
  if (!def.direction) missing.push('direction')
  if (!def.strength_kind) missing.push('strength_kind')
  return missing
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { definition: Partial<SignalDefinition>; brand: string; asof?: string }

    const missing = validate(body.definition)
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 })
    }

    const db = metricsDb()
    const asof = body.asof ?? (db.prepare('SELECT MAX(year_month) AS latest FROM region_metrics').get() as { latest: string }).latest

    const def = {
      id: 'preview',
      name: body.definition.name ?? 'preview',
      label: body.definition.label ?? 'Preview',
      metric: body.definition.metric!,
      period_type: body.definition.period_type!,
      lags: body.definition.lags!,
      delta_lags: body.definition.delta_lags!,
      direction: body.definition.direction!,
      strength_kind: body.definition.strength_kind!,
      loud_threshold: body.definition.loud_threshold ?? 2.0,
      created_at: '',
      updated_at: '',
    } satisfies SignalDefinition

    const rows = computeSignal(def, body.brand, asof)

    return NextResponse.json({
      data: { rows, asof, brand: body.brand, count: rows.length },
    })
  } catch (err) {
    console.error('[POST /api/signals/preview]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
