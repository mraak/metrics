// knowledge-store.ts — ALL Tier 3-5 definitions are backed by the project's
// single source of truth, ../knowledge_definitions.json, NOT by studio.db:
//   signal_templates     -> SignalDefinition   (read+write)
//   finding_definitions  -> FindingDefinition  (read+write, executable configs)
//   insight_templates    -> InsightFraming     (read+write, executable configs)
// Writes splice ONLY the touched section back into the file text, so every
// other section stays byte-for-byte unchanged and diffs stay minimal.
import fs from 'fs'
import path from 'path'
import type { SignalDefinition, FindingDefinition, InsightFraming, FilterCondition } from './types'

const KNOWLEDGE_PATH = path.join(process.cwd(), '..', 'knowledge_definitions.json')

type Json = Record<string, unknown>

export function loadKnowledge(): Json {
  return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8')) as Json
}

// Find the [start, end] char span of a top-level `"<key>"` and its object
// value in the raw file text, using string-aware brace matching.
function sectionSpan(raw: string, key: string): [number, number] {
  const keyIdx = raw.indexOf(`"${key}"`)
  if (keyIdx < 0) throw new Error(`${key} key not found in knowledge_definitions.json`)
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
  throw new Error(`unbalanced braces in ${key}`)
}

// Write ONLY one section's block back into the file. Atomic (temp + rename).
function writeSection(key: string, value: Record<string, Json>): void {
  const raw = fs.readFileSync(KNOWLEDGE_PATH, 'utf8')
  const [start, end] = sectionSpan(raw, key)
  // top-level sections sit at depth 1 (2-space indent); re-indent the body one level.
  const body = JSON.stringify(value, null, 2)
    .split('\n').map((line, i) => (i === 0 ? line : '  ' + line)).join('\n')
  const next = raw.slice(0, start) + `"${key}": ` + body + raw.slice(end)
  const tmp = KNOWLEDGE_PATH + '.tmp'
  fs.writeFileSync(tmp, next, 'utf8')
  fs.renameSync(tmp, KNOWLEDGE_PATH)
}

function writeSignalTemplates(templates: Record<string, Json>): void {
  writeSection('signal_templates', templates)
}

function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19)
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
    'direction', 'strength_kind', 'materiality_from', 'source_table', 'entity_dimension',
    'cached_as', 'interpretation']
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
  // persist a non-default grain so the signal survives a round-trip (the Python
  // side and templateToSignal both default absent fields to the region grain)
  if (def.source_table && def.source_table !== SOURCE_TABLE) t.source_table = def.source_table
  if (def.entity_dimension && def.entity_dimension !== ENTITY_DIM) t.entity_dimension = def.entity_dimension
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

// ── Finding definitions (executable configs; section: finding_definitions) ───

function findingSection(kn: Json): Record<string, Json> {
  return (kn.finding_definitions as Record<string, Json> | undefined) ?? {}
}

function entryToFindingDef(name: string, e: Json): FindingDefinition {
  return {
    id: (e.id as string) ?? name,
    name,
    label: (e.label as string) ?? humanize(name),
    axes: (e.axes as FindingDefinition['axes']) ?? [],
    classifications: (e.classifications as FindingDefinition['classifications']) ?? [],
    severity: e.severity as FindingDefinition['severity'],
    created_at: (e.created_at as string) ?? '',
    updated_at: (e.updated_at as string) ?? '',
  }
}

export function readAllFindingDefs(): FindingDefinition[] {
  const kn = loadKnowledge()
  const sec = findingSection(kn)
  return Object.keys(sec).filter(k => !k.startsWith('_')).map(k => entryToFindingDef(k, sec[k]))
}

export function readFindingDefById(id: string): FindingDefinition | null {
  return readAllFindingDefs().find(d => d.id === id || d.name === id) ?? null
}

export function upsertFindingDef(id: string | null, def: Partial<FindingDefinition>): FindingDefinition {
  const kn = loadKnowledge()
  const sec = findingSection(kn)
  const existingName = id
    ? Object.keys(sec).find(k => !k.startsWith('_') && ((sec[k].id as string) === id || k === id))
    : undefined
  const name = (def.name ?? existingName ?? '').trim()
  if (!name) throw new Error('finding definition name is required')
  if (name.startsWith('_')) throw new Error(`invalid finding name '${name}'`)
  const existing = existingName ? sec[existingName] : undefined
  const entry: Json = {
    id: (existing?.id as string) ?? id ?? crypto.randomUUID(),
    label: def.label ?? (existing?.label as string) ?? humanize(name),
    axes: def.axes ?? (existing?.axes as Json[]) ?? [],
    classifications: def.classifications ?? (existing?.classifications as Json[]) ?? [],
    severity: def.severity ?? existing?.severity,
    created_at: (existing?.created_at as string) ?? nowStamp(),
    updated_at: nowStamp(),
  }
  if (existingName && existingName !== name) delete sec[existingName]   // rename
  sec[name] = entry
  writeSection('finding_definitions', sec)
  return entryToFindingDef(name, entry)
}

export function deleteFindingDef(id: string): boolean {
  const kn = loadKnowledge()
  const sec = findingSection(kn)
  const name = Object.keys(sec).find(k => !k.startsWith('_') && ((sec[k].id as string) === id || k === id))
  if (!name) return false
  delete sec[name]
  writeSection('finding_definitions', sec)
  return true
}

// ── Insight templates (executable configs; section: insight_templates) ───────

function framingSection(kn: Json): Record<string, Json> {
  return (kn.insight_templates as Record<string, Json> | undefined) ?? {}
}

function entryToFraming(e: Json): InsightFraming {
  return {
    id: e.id as string,
    persona: e.persona as string,
    finding_key: e.finding_key as string,
    mode: (e.mode as InsightFraming['mode']) ?? 'template',
    template: (e.template as string) ?? '',
    llm_system: (e.llm_system as string) ?? '',
    llm_user: (e.llm_user as string) ?? '',
    model: (e.model as string) ?? 'claude-haiku-4-5',
    surface_conditions: (e.surface_conditions as InsightFraming['surface_conditions']) ?? [],
    suppress_conditions: (e.suppress_conditions as InsightFraming['suppress_conditions']) ?? [],
    created_at: (e.created_at as string) ?? '',
    updated_at: (e.updated_at as string) ?? '',
  }
}

export function readAllFramings(): InsightFraming[] {
  const kn = loadKnowledge()
  const sec = framingSection(kn)
  return Object.keys(sec)
    .filter(k => !k.startsWith('_'))
    .sort()
    .map(k => entryToFraming(sec[k]))
}

export function readFramingById(id: string): InsightFraming | null {
  return readAllFramings().find(f => f.id === id) ?? null
}

export function upsertFraming(id: string | null, def: Partial<InsightFraming>): InsightFraming {
  const kn = loadKnowledge()
  const sec = framingSection(kn)
  const existingKey = id
    ? Object.keys(sec).find(k => !k.startsWith('_') && (sec[k].id as string) === id)
    : undefined
  const existing = existingKey ? sec[existingKey] : undefined
  const persona = def.persona ?? (existing?.persona as string)
  const findingKey = def.finding_key ?? (existing?.finding_key as string)
  if (!persona || !findingKey) throw new Error('persona and finding_key are required')
  const key = `${persona}.${findingKey}`
  const entry: Json = {
    id: (existing?.id as string) ?? id ?? crypto.randomUUID(),
    persona,
    finding_key: findingKey,
    mode: def.mode ?? (existing?.mode as string) ?? 'template',
    template: def.template ?? (existing?.template as string) ?? '',
    llm_system: def.llm_system ?? (existing?.llm_system as string) ?? '',
    llm_user: def.llm_user ?? (existing?.llm_user as string) ?? '',
    model: def.model ?? (existing?.model as string) ?? 'claude-haiku-4-5',
    surface_conditions: def.surface_conditions ?? (existing?.surface_conditions as Json[]) ?? [],
    suppress_conditions: def.suppress_conditions ?? (existing?.suppress_conditions as Json[]) ?? [],
    created_at: (existing?.created_at as string) ?? nowStamp(),
    updated_at: nowStamp(),
  }
  if (existingKey && existingKey !== key) delete sec[existingKey]   // persona/key change
  sec[key] = entry
  writeSection('insight_templates', sec)
  return entryToFraming(entry)
}

export function deleteFraming(id: string): boolean {
  const kn = loadKnowledge()
  const sec = framingSection(kn)
  const key = Object.keys(sec).find(k => !k.startsWith('_') && (sec[k].id as string) === id)
  if (!key) return false
  delete sec[key]
  writeSection('insight_templates', sec)
  return true
}
