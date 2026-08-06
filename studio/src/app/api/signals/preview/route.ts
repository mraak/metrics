import { NextRequest, NextResponse } from 'next/server'
import { computeSignal, getSegmentValues } from '@/lib/signal-engine'
import type { SignalDefinition } from '@/lib/types'

export const dynamic = 'force-dynamic'

function validate(def: Partial<SignalDefinition>): string[] {
  const missing: string[] = []
  if (!def.source_table) missing.push('source_table')
  if (!def.entity_dimension) missing.push('entity_dimension')
  if (!def.time_dimension) missing.push('time_dimension')
  if (!def.metric) missing.push('metric')
  if (!def.lags || def.lags.length < 2) missing.push('lags (at least 2 required)')
  if (!def.delta_lags) missing.push('delta_lags')
  if (!def.direction) missing.push('direction')
  if (!def.strength_kind) missing.push('strength_kind')
  return missing
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      definition: Partial<SignalDefinition>
      segmentValues?: Record<string, string | number>  // one value per segment_by column
      asof?: string
    }

    const missing = validate(body.definition)
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 })
    }

    const def: SignalDefinition = {
      id: 'preview',
      name: body.definition.name ?? 'preview',
      label: body.definition.label ?? 'Preview',
      source_table: body.definition.source_table!,
      entity_dimension: body.definition.entity_dimension!,
      time_dimension: body.definition.time_dimension!,
      filters: body.definition.filters ?? [],
      segment_by: body.definition.segment_by ?? [],
      metric: body.definition.metric!,
      lags: body.definition.lags!,
      delta_lags: body.definition.delta_lags!,
      direction: body.definition.direction!,
      strength_kind: body.definition.strength_kind!,
      loud_threshold: body.definition.loud_threshold ?? 2.0,
      created_at: '',
      updated_at: '',
    }

    const segmentValues = body.segmentValues ?? {}
    const rows = await computeSignal(def, segmentValues, body.asof)
    const segments = await getSegmentValues(def)  // available values per segment_by column

    return NextResponse.json({
      data: { rows, asof: body.asof, segments, count: rows.length },
    })
  } catch (err) {
    console.error('[POST /api/signals/preview]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
