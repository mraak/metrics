// knowledge-store.ts — Signals are backed by the project's single source of
// truth, ../knowledge_definitions.json (shared with the Python app), NOT by
// studio.db. Reads map signal_templates -> SignalDefinition; writes merge back
// into the JSON, preserving JSON-only fields (readout, materiality_from,
// interpretation, cached_as) so the Python side stays intact.
import fs from 'fs'
import path from 'path'
import type { SignalDefinition, FilterCondition } from './types'

const KNOWLEDGE_PATH = path.join(process.cwd(), '..', 'knowledge_definitions.json')

type Json = Record<string, unknown>

export function loadKnowledge(): Json {
  return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8')) as Json
}

// Find the [start, end] char span of the `"signal_templates"` key and its object
// value in the raw file text, using string-aware brace matching.
function signalTemplatesSpan(raw: string): [number, number] {
  const keyIdx = raw.indexOf('"signal_templates"')
  if (keyIdx < 0) throw new Error('signal_templates key not found in knowledge_definitions.json')
  const open = raw.indexOf('{', keyIdx)
  let depth = 0, inStr = false, esc = false
  for (let i = open; i < raw.length; i++) {
    const c = raw[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return [keyIdx, i + 1]
  }
  throw new Error('unbalanced braces in signal_templates')
}

// Write ONLY the signal_templates block back into the file, splicing it into the
// original text so every other section (signal_strength floats, etc.) stays
// byte-for-byte unchanged and diffs stay minimal. Atomic (temp + rename).
function writeSignalTemplates(templates: Record<string, Json>): void {
  const raw = fs.readFileSync(KNOWLEDGE_PATH, 'utf8')
  const [start, end] = signalTemplatesSpan(raw)
  // signal_templates sits at depth 1 (2-space indent); re-indent its body one level.
  const body = JSON.stringify(templates, null, 2)
    .split('\n').map((line, i) => (i === 0 ? line : '  ' + line)).join('\n')
  const next = raw.slice(0, start) + '"signal_templates": ' + body + raw.slice(end)
  const tmp = KNOWLEDGE_PATH + '.tmp'
  fs.writeFileSync(tmp, next, 'utf8')
  fs.renameSync(tmp, KNOWLEDGE_PATH)
}

// Constants the JSON schema implies for region_metrics signals but doesn't store.
const SOURCE_TABLE = 'region_metrics'
const ENTITY_DIM = 'region_name'
const TIME_DIM = 'year_month'
const SEGMENT_BY = ['brand_name']

function humanize(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function loudFor(kind: string, kn: Json): number {
  const ss = kn.signal_strength as Json | undefined
  const bands = (ss?.loudness_bands_pp as Json | undefined)?.[kind] as Json | undefined
  return typeof bands?.loud === 'number' ? (bands.loud as number) : 2.0
}

function signals(kn: Json): Record<string, Json> {
  return (kn.signal_templates as Record<string, Json> | undefined) ?? {}
}

function templateToSignal(name: string, t: Json, kn: Json): SignalDefinition {
  const deltaLags: number[] = Array.isArray(t.delta_lags)
    ? (t.delta_lags as number[])
    : (t.delta_lag != null ? [t.delta_lag as number] : [])
  const strengthKind = (t.strength_kind as SignalDefinition['strength_kind']) ?? 'position'
  return {
    id: name,
    name,
    label: (t.label as string) || humanize(name),
    source_table: (t.source_table as string) ?? SOURCE_TABLE,
    entity_dimension: (t.entity_dimension as string) ?? ENTITY_DIM,
    time_dimension: (t.time_dimension as string) ?? TIME_DIM,
    filters: [{ column: 'period_type', operator: '=', value: t.period_type as string }],
    segment_by: SEGMENT_BY,
    metric: t.metric as string,
    lags: (t.lags as number[]) ?? [],
    delta_lags: deltaLags,
    direction: t.direction as SignalDefinition['direction'],
    strength_kind: strengthKind,
    loud_threshold: typeof t.loud_threshold === 'number' ? (t.loud_threshold as number) : loudFor(strengthKind, kn),
    created_at: '',
    updated_at: '',
  }
}

export function readAllSignals(): SignalDefinition[] {
  const kn = loadKnowledge()
  const templates = signals(kn)
  return Object.keys(templates)
    .filter(k => !k.startsWith('_'))
    .map(k => templateToSignal(k, templates[k], kn))
}

export function readSignalByName(name: string): SignalDefinition | null {
  if (name.startsWith('_')) return null
  const kn = loadKnowledge()
  const t = signals(kn)[name]
  return t ? templateToSignal(name, t, kn) : null
}

function periodFromFilters(filters: FilterCondition[] | undefined): string {
  const f = (filters ?? []).find(x => x.column === 'period_type')
  return f && !Array.isArray(f.value) ? String(f.value) : 'MAT'
}

// Canonical key order so edited templates diff cleanly against the rest.
function orderTemplate(t: Json): Json {
  const order = ['label', 'metric', 'period_type', 'lags', 'readout', 'delta_lag', 'delta_lags',
    'direction', 'strength_kind', 'materiality_from', 'cached_as', 'interpretation']
  const out: Json = {}
  for (const k of order) if (k in t) out[k] = t[k]
  for (const k of Object.keys(t)) if (!(k in out)) out[k] = t[k]
  return out
}

// Merge a Studio SignalDefinition into a JSON template, preserving JSON-only fields.
function mergeIntoTemplate(existing: Json | undefined, def: Partial<SignalDefinition>): Json {
  const t: Json = { ...(existing ?? {}) }
  t.metric = def.metric
  t.period_type = periodFromFilters(def.filters)
  t.lags = def.lags ?? []
  const dl = def.delta_lags ?? []
  delete t.delta_lag; delete t.delta_lags
  if (dl.length === 1) t.delta_lag = dl[0]
  else if (dl.length > 1) t.delta_lags = dl
  if (!t.readout) t.readout = dl.length ? 'delta' : 'series'   // preserve existing (e.g. 'slope'); derive for new
  t.direction = def.direction
  if (def.strength_kind) t.strength_kind = def.strength_kind
  // persist a label only when the user set a meaningful (non-default) one
  if (def.label && def.label !== humanize(def.name ?? '')) t.label = def.label
  return orderTemplate(t)
}

export function upsertSignal(idOrName: string | null, def: Partial<SignalDefinition>): SignalDefinition {
  const kn = loadKnowledge()
  if (!kn.signal_templates) kn.signal_templates = {}
  const templates = kn.signal_templates as Record<string, Json>

  const newName = (def.name ?? idOrName ?? '').trim()
  if (!newName) throw new Error('signal name is required')
  if (newName.startsWith('_')) throw new Error(`invalid signal name '${newName}'`)

  const oldName = idOrName ?? newName
  const merged = mergeIntoTemplate(templates[oldName], def)

  if (oldName !== newName && templates[oldName]) delete templates[oldName]   // rename
  templates[newName] = merged
  writeSignalTemplates(templates)
  return templateToSignal(newName, merged, kn)
}

export function deleteSignal(name: string): boolean {
  const kn = loadKnowledge()
  const templates = signals(kn)
  if (!templates[name]) return false
  delete (kn.signal_templates as Record<string, Json>)[name]
  writeSignalTemplates(kn.signal_templates as Record<string, Json>)
  return true
}
