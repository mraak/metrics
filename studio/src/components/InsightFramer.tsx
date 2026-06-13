'use client'

import { useState, useEffect } from 'react'
import type { InsightFraming, FindingDefinition, SignalDefinition } from '@/lib/types'
import Tooltip from '@/components/Tooltip'

interface Props {
  initialFramings: InsightFraming[]
  initialFindings: FindingDefinition[]
  initialSignals: SignalDefinition[]
}

interface RenderedRow {
  region: string
  territory: string
  finding_key: string
  text: string
}

interface PreviewResult {
  rendered: RenderedRow[]
}

function bandColor(band: string): string {
  const map: Record<string, string> = {
    critical: 'text-red-600 bg-red-50 border border-red-200',
    high: 'text-orange-600 bg-orange-50 border border-orange-200',
    moderate: 'text-yellow-600 bg-yellow-50 border border-yellow-200',
    low: 'text-gray-500 bg-gray-50 border border-gray-200',
    unclassified: 'text-gray-400 bg-gray-50 border border-gray-200',
  }
  return map[band] ?? 'text-gray-500 bg-gray-50 border border-gray-200'
}

function emptyDraft(): Partial<InsightFraming> {
  return {
    persona: '',
    finding_key: '',
    mode: 'template',
    template: '',
    llm_system: '',
    llm_user: '',
    model: 'claude-haiku-4-5',
    surface_conditions: [],
    suppress_conditions: [],
  }
}

// Get all classification keys from all finding definitions
function getAllFindingKeys(findings: FindingDefinition[]): { findingId: string; findingLabel: string; key: string; label: string }[] {
  const result: { findingId: string; findingLabel: string; key: string; label: string }[] = []
  for (const f of findings) {
    for (const c of f.classifications) {
      result.push({ findingId: f.id, findingLabel: f.label, key: c.key, label: c.label })
    }
  }
  return result
}

// Get axis names for a finding
function getAxisNames(findings: FindingDefinition[], findingId: string): string[] {
  const f = findings.find(f => f.id === findingId)
  return f ? f.axes.map(a => a.name) : []
}

export default function InsightFramer({ initialFramings, initialFindings, initialSignals }: Props) {
  const [framings, setFramings] = useState<InsightFraming[]>(initialFramings)
  const [findings] = useState<FindingDefinition[]>(initialFindings)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<InsightFraming>>(emptyDraft())
  const [selectedFindingDefId, setSelectedFindingDefId] = useState<string>('')
  const [meta, setMeta] = useState<{ brands: string[] } | null>(null)
  const [brand, setBrand] = useState<string>('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [varsOpen, setVarsOpen] = useState(true)
  const [newSurface, setNewSurface] = useState('')
  const [newSuppress, setNewSuppress] = useState('')

  useEffect(() => {
    fetch('/api/report/meta').then(r => r.json()).then((data: { brands: string[] }) => {
      setMeta(data)
      if (!brand && data.brands.length > 0) setBrand(data.brands[0])
    })
  }, [])

  // Auto-select finding def when finding_key changes
  useEffect(() => {
    if (draft.finding_key) {
      const match = findings.find(f => f.classifications.some(c => c.key === draft.finding_key))
      if (match && !selectedFindingDefId) setSelectedFindingDefId(match.id)
    }
  }, [draft.finding_key])

  function selectFraming(f: InsightFraming) {
    setSelected(f.id)
    setDraft({
      persona: f.persona,
      finding_key: f.finding_key,
      mode: f.mode,
      template: f.template,
      llm_system: f.llm_system,
      llm_user: f.llm_user,
      model: f.model,
      surface_conditions: f.surface_conditions,
      suppress_conditions: f.suppress_conditions,
    })
    // Auto-pick finding def
    const match = findings.find(fd => fd.classifications.some(c => c.key === f.finding_key))
    if (match) setSelectedFindingDefId(match.id)
    setPreview(null)
    setPreviewError(null)
    setErrors({})
  }

  function newFraming() {
    setSelected(null)
    setDraft(emptyDraft())
    setSelectedFindingDefId('')
    setPreview(null)
    setPreviewError(null)
    setErrors({})
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!draft.persona?.trim()) errs.persona = 'Persona is required'
    if (!draft.finding_key?.trim()) errs.finding_key = 'Finding key is required'
    if (!brand) errs.brand = 'Brand is required'
    if (!selectedFindingDefId) errs.finding_def = 'Select a finding definition for preview'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function runPreview() {
    if (!validate()) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      const res = await fetch('/api/insights/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          framing: { ...draft, id: selected ?? 'preview', created_at: '', updated_at: '' },
          brand,
          finding_def_id: selectedFindingDefId,
        }),
      })
      const json = await res.json() as { data?: PreviewResult; error?: string }
      if (json.error) {
        setPreviewError(json.error)
        setPreview(null)
      } else if (json.data) {
        setPreview(json.data)
      }
    } catch (e) {
      setPreviewError(String(e))
    } finally {
      setPreviewing(false)
    }
  }

  async function saveFraming() {
    if (!validate()) return
    setSaving(true)
    try {
      const url = selected ? `/api/insights/${selected}` : '/api/insights'
      const method = selected ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json() as { data?: InsightFraming; error?: string }
      if (json.error) {
        setErrors({ _global: json.error })
      } else if (json.data) {
        const saved = json.data
        setFramings(prev => {
          const exists = prev.find(f => f.id === saved.id)
          return exists ? prev.map(f => f.id === saved.id ? saved : f) : [...prev, saved]
        })
        setSelected(saved.id)
      }
    } finally {
      setSaving(false)
    }
  }

  const allFindingKeys = getAllFindingKeys(findings)
  const axisNames = getAxisNames(findings, selectedFindingDefId)

  // Group framings by persona for sidebar
  const byPersona = framings.reduce<Record<string, InsightFraming[]>>((acc, f) => {
    if (!acc[f.persona]) acc[f.persona] = []
    acc[f.persona].push(f)
    return acc
  }, {})

  const mode = draft.mode ?? 'template'
  const surfaceConditions = draft.surface_conditions ?? []
  const suppressConditions = draft.suppress_conditions ?? []

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-[#e0e0e0] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[#e0e0e0] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[#1a2030]">Framings</h2>
          <button
            onClick={newFraming}
            className="text-xs bg-[#2266aa] text-white px-2 py-1 rounded hover:bg-[#1a5288] transition-colors"
          >
            + New
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {framings.length === 0 && (
            <p className="text-xs text-[#888888] px-4 py-3">No framings yet.</p>
          )}
          {Object.entries(byPersona).map(([persona, pFramings]) => (
            <div key={persona}>
              <div className="px-4 py-2 bg-[#f5f7fa] text-xs font-semibold text-[#888888] uppercase tracking-wide border-b border-[#e0e0e0]">
                {persona}
              </div>
              {pFramings.map(f => (
                <button
                  key={f.id}
                  onClick={() => selectFraming(f)}
                  className={`w-full text-left px-4 py-2.5 border-b border-[#e0e0e0] hover:bg-[#f5f7fa] transition-colors ${selected === f.id ? 'bg-blue-50 border-l-2 border-l-[#2266aa]' : ''}`}
                >
                  <div className="font-medium text-xs text-[#1a2030] truncate">{f.finding_key}</div>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${f.mode === 'template' ? 'bg-blue-100 text-[#2266aa]' : 'bg-purple-100 text-purple-700'}`}>
                    {f.mode}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Editor card */}
          <div className="bg-white rounded-lg border border-[#e0e0e0] shadow-sm">
            <div className="px-6 py-4 border-b border-[#e0e0e0]">
              <h2 className="font-semibold text-[#1a2030]">{selected ? 'Edit Framing' : 'New Framing'}</h2>
              <p className="text-xs text-[#888888] mt-1">
                An Insight Framing turns a structured Finding into human-readable text for a specific persona.
                Use {'{{'+'variable}}'} placeholders — they are substituted with live finding data at render time.
                Same template + same data = identical output every time.
              </p>
            </div>
            <div className="p-6 space-y-5">
              {/* Persona + Finding key */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#888888] mb-1">Persona *<Tooltip text="Who this insight is for. Common values: sales_manager, sales_rep, ceo. Free text — use whatever your system uses. Each persona gets different framings per finding key." /></label>
                  <input
                    type="text"
                    value={draft.persona ?? ''}
                    onChange={e => setDraft(d => ({ ...d, persona: e.target.value }))}
                    placeholder="e.g. sales_manager"
                    className={`w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2266aa] ${errors.persona ? 'border-[#e03131]' : 'border-[#e0e0e0]'}`}
                  />
                  {errors.persona && <p className="text-xs text-[#e03131] mt-0.5">{errors.persona}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#888888] mb-1">Finding Key *<Tooltip text="Which finding classification this framing applies to. Must match a key in a Finding Definition (e.g. 'losing_both', 'star'). One framing per persona × finding key pair." /></label>
                  <select
                    value={draft.finding_key ?? ''}
                    onChange={e => {
                      const key = e.target.value
                      setDraft(d => ({ ...d, finding_key: key }))
                      // auto-set finding def
                      const match = findings.find(f => f.classifications.some(c => c.key === key))
                      if (match) setSelectedFindingDefId(match.id)
                    }}
                    className={`w-full border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2266aa] ${errors.finding_key ? 'border-[#e03131]' : 'border-[#e0e0e0]'}`}
                  >
                    <option value="">Select finding key…</option>
                    {allFindingKeys.map(fk => (
                      <option key={`${fk.findingId}:${fk.key}`} value={fk.key}>
                        {fk.key} ({fk.label}) — {fk.findingLabel}
                      </option>
                    ))}
                  </select>
                  {errors.finding_key && <p className="text-xs text-[#e03131] mt-0.5">{errors.finding_key}</p>}
                </div>
              </div>

              {/* Mode toggle */}
              <div>
                <label className="block text-xs font-medium text-[#888888] mb-2">Mode</label>
                {/* Mode-specific tooltip shown below buttons via inline approach */}
                <div className="flex gap-2 items-center">
                  {(['template', 'llm'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setDraft(d => ({ ...d, mode: m }))}
                      className={`px-4 py-1.5 rounded text-sm font-medium border transition-colors ${
                        mode === m
                          ? 'bg-[#2266aa] text-white border-[#2266aa]'
                          : 'bg-white text-[#888888] border-[#e0e0e0] hover:border-[#2266aa]'
                      }`}
                    >
                      {m === 'template' ? 'Template' : 'LLM'}
                    </button>
                  ))}
                  <Tooltip text="Template: pure string substitution, guaranteed identical output. LLM: feed variables into an LLM prompt, near-deterministic at temperature=0. Requires ANTHROPIC_API_KEY." />
                </div>
              </div>

              {/* Template editor */}
              {mode === 'template' && (
                <div>
                  <label className="block text-xs font-medium text-[#888888] mb-1">Template<Tooltip text="Write the insight text with {{variable}} placeholders. Example: '{{region}} (rank {{rank}}) is losing on both axes — share {{share_now}}pp vs peers, growth {{growth_now}}pp vs national.'" /></label>
                  <textarea
                    value={draft.template ?? ''}
                    onChange={e => setDraft(d => ({ ...d, template: e.target.value }))}
                    rows={5}
                    className="w-full border border-[#e0e0e0] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2266aa] resize-y"
                    placeholder="Use {{region}}, {{severity_band}}, {{share_now}}, etc."
                  />
                </div>
              )}

              {/* LLM editor */}
              {mode === 'llm' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#888888] mb-1">Model</label>
                    <input
                      type="text"
                      value={draft.model ?? 'claude-haiku-4-5'}
                      onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
                      className="w-64 border border-[#e0e0e0] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2266aa]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#888888] mb-1">System Prompt</label>
                    <textarea
                      value={draft.llm_system ?? ''}
                      onChange={e => setDraft(d => ({ ...d, llm_system: e.target.value }))}
                      rows={4}
                      className="w-full border border-[#e0e0e0] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2266aa] resize-y"
                      placeholder="You are a {{persona}} analyst. {{region}} has severity {{severity_band}}…"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#888888] mb-1">User Message</label>
                    <textarea
                      value={draft.llm_user ?? ''}
                      onChange={e => setDraft(d => ({ ...d, llm_user: e.target.value }))}
                      rows={4}
                      className="w-full border border-[#e0e0e0] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2266aa] resize-y"
                      placeholder="Write a concise insight for {{region}} (rank {{rank}})…"
                    />
                  </div>
                </div>
              )}

              {/* Variable reference panel */}
              <div className="border border-[#e0e0e0] rounded">
                <button
                  onClick={() => setVarsOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-[#888888] hover:bg-[#f5f7fa]"
                >
                  <span>Available variables<Tooltip text="All {{placeholders}} that can be used in your template or LLM prompt. Identity variables are always available. Per-axis variables depend on which finding definition you run against." /></span>
                  <span>{varsOpen ? '▲' : '▼'}</span>
                </button>
                {varsOpen && (
                  <div className="px-4 pb-3 space-y-2 border-t border-[#e0e0e0]">
                    <div className="pt-2">
                      <div className="text-xs font-medium text-[#888888] mb-1">Identity</div>
                      <div className="flex flex-wrap gap-1">
                        {['region', 'territory', 'rank', 'finding', 'finding_label', 'severity_band', 'severity_score', 'months_red'].map(v => (
                          <code key={v} className="text-xs bg-blue-50 text-[#2266aa] px-1.5 py-0.5 rounded font-mono">{`{{${v}}}`}</code>
                        ))}
                      </div>
                    </div>
                    {axisNames.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-[#888888] mb-1">Per axis ({axisNames.join(', ')})</div>
                        <div className="flex flex-wrap gap-1">
                          {axisNames.flatMap(axis =>
                            ['now', 'oldest', 'net', 'coherence', 'shape', 'magnitude'].map(suffix => (
                              <code key={`${axis}_${suffix}`} className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-mono">{`{{${axis}_${suffix}}}`}</code>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Surface / suppress conditions */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#888888] mb-1">Surface conditions<Tooltip text="Optional: only surface this insight when these conditions are true. Leave empty to always surface. Example: severity_band = critical" /></label>
                  <div className="space-y-1 mb-1">
                    {surfaceConditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-xs flex-1 bg-[#f5f7fa] px-2 py-1 rounded border border-[#e0e0e0]">{c}</span>
                        <button
                          onClick={() => setDraft(d => ({ ...d, surface_conditions: surfaceConditions.filter((_, j) => j !== i) }))}
                          className="text-[#e03131] text-xs px-1"
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newSurface}
                      onChange={e => setNewSurface(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newSurface.trim()) {
                          setDraft(d => ({ ...d, surface_conditions: [...surfaceConditions, newSurface.trim()] }))
                          setNewSurface('')
                        }
                      }}
                      placeholder="Add condition…"
                      className="flex-1 border border-[#e0e0e0] rounded px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => {
                        if (newSurface.trim()) {
                          setDraft(d => ({ ...d, surface_conditions: [...surfaceConditions, newSurface.trim()] }))
                          setNewSurface('')
                        }
                      }}
                      className="text-xs px-2 py-1 bg-[#2266aa] text-white rounded"
                    >+</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#888888] mb-1">Suppress conditions<Tooltip text="Optional: suppress this insight when these conditions are true. Example: mat_rank < 40 (suppress for small/immaterial regions)" /></label>
                  <div className="space-y-1 mb-1">
                    {suppressConditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-xs flex-1 bg-[#f5f7fa] px-2 py-1 rounded border border-[#e0e0e0]">{c}</span>
                        <button
                          onClick={() => setDraft(d => ({ ...d, suppress_conditions: suppressConditions.filter((_, j) => j !== i) }))}
                          className="text-[#e03131] text-xs px-1"
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newSuppress}
                      onChange={e => setNewSuppress(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newSuppress.trim()) {
                          setDraft(d => ({ ...d, suppress_conditions: [...suppressConditions, newSuppress.trim()] }))
                          setNewSuppress('')
                        }
                      }}
                      placeholder="Add condition…"
                      className="flex-1 border border-[#e0e0e0] rounded px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => {
                        if (newSuppress.trim()) {
                          setDraft(d => ({ ...d, suppress_conditions: [...suppressConditions, newSuppress.trim()] }))
                          setNewSuppress('')
                        }
                      }}
                      className="text-xs px-2 py-1 bg-[#2266aa] text-white rounded"
                    >+</button>
                  </div>
                </div>
              </div>

              {/* Finding def + brand for preview */}
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-[#888888] mb-1">Finding definition (for preview)<Tooltip text="Which finding definition to run when generating the preview. This determines which axes are available as {{variables}}." /></label>
                  <select
                    value={selectedFindingDefId}
                    onChange={e => setSelectedFindingDefId(e.target.value)}
                    className={`border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2266aa] ${errors.finding_def ? 'border-[#e03131]' : 'border-[#e0e0e0]'}`}
                  >
                    <option value="">Select finding def…</option>
                    {findings.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  {errors.finding_def && <p className="text-xs text-[#e03131] mt-0.5">{errors.finding_def}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#888888] mb-1">Brand</label>
                  <select
                    value={brand}
                    onChange={e => setBrand(e.target.value)}
                    className={`border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2266aa] ${errors.brand ? 'border-[#e03131]' : 'border-[#e0e0e0]'}`}
                  >
                    <option value="">Select brand…</option>
                    {(meta?.brands ?? []).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  {errors.brand && <p className="text-xs text-[#e03131] mt-0.5">{errors.brand}</p>}
                </div>
                <button
                  onClick={runPreview}
                  disabled={previewing}
                  className="px-4 py-2 bg-[#2266aa] text-white rounded text-sm font-medium hover:bg-[#1a5288] disabled:opacity-50"
                >
                  {previewing ? 'Running…' : '▶ Preview'}
                </button>
                <button
                  onClick={saveFraming}
                  disabled={saving}
                  className="px-4 py-2 bg-[#1a2030] text-white rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : (selected ? 'Update Framing' : 'Save Framing')}
                </button>
              </div>

              {errors._global && (
                <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-[#e03131]">
                  {errors._global}
                </div>
              )}
            </div>
          </div>

          {/* Preview error */}
          {previewError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-[#e03131]">
              <strong>Preview error:</strong> {previewError}
            </div>
          )}

          {/* Preview results */}
          {preview && preview.rendered.length === 0 && (
            <div className="bg-white rounded-lg border border-[#e0e0e0] p-6 text-sm text-[#888888]">
              No regions found for finding key &ldquo;{draft.finding_key}&rdquo; with the current settings.
            </div>
          )}

          {preview && preview.rendered.length > 0 && (
            <div className="bg-white rounded-lg border border-[#e0e0e0] shadow-sm">
              <div className="px-6 py-4 border-b border-[#e0e0e0]">
                <h3 className="font-semibold text-[#1a2030]">Preview — top {preview.rendered.length} rows for &quot;{draft.finding_key}&quot;</h3>
              </div>
              <div className="divide-y divide-[#e0e0e0]">
                {preview.rendered.map((r, i) => (
                  <div key={i} className="px-6 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-sm text-[#1a2030]">{r.region}</span>
                      <span className="text-xs text-[#888888]">{r.territory}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${bandColor(r.finding_key)}`}>
                        {r.finding_key}
                      </span>
                    </div>
                    <p className="text-sm text-[#1a2030] leading-relaxed">{r.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
