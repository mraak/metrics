'use client'

import { useState, useEffect } from 'react'
import type { FindingDefinition, SignalDefinition, AxisDefinition, ClassificationRule, SeverityConfig, FindingRow, MetaInfo } from '@/lib/types'
import Tooltip from '@/components/Tooltip'

interface Props {
  initialFindings: FindingDefinition[]
  initialSignals: SignalDefinition[]
}

interface RunResult {
  rows: FindingRow[]
  brand: string
  asof: string
  summary: { key: string; label: string; count: number }[]
  saved: number
}

function emptyDraft(): Partial<FindingDefinition> {
  return {
    name: '',
    label: '',
    axes: [],
    classifications: [],
    severity: { deterioration_delta: 0.3, bands: { critical: 5, high: 3, moderate: 2 } },
  }
}

function severityColor(score: number): string {
  if (score >= 5) return 'text-red-600 bg-red-50'
  if (score >= 3) return 'text-orange-600 bg-orange-50'
  if (score >= 2) return 'text-yellow-600 bg-yellow-50'
  return 'text-gray-500 bg-gray-50'
}

function bandColor(band: string): string {
  const map: Record<string, string> = {
    critical: 'text-red-600 bg-red-50 border-red-200',
    high: 'text-orange-600 bg-orange-50 border-orange-200',
    moderate: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    low: 'text-gray-500 bg-gray-50 border-gray-200',
  }
  return map[band] ?? 'text-gray-500 bg-gray-50 border-gray-200'
}

// Generate all 2^N classification combinations from axes
function generateClassifications(axes: AxisDefinition[]): ClassificationRule[] {
  if (axes.length === 0) return []
  const n = axes.length
  const total = Math.pow(2, n)
  const rules: ClassificationRule[] = []
  for (let mask = 0; mask < total; mask++) {
    const conditions: { axis: string; side: 'good' | 'bad' }[] = []
    const keyParts: string[] = []
    for (let i = 0; i < n; i++) {
      const bit = (mask >> i) & 1
      const side: 'good' | 'bad' = bit === 1 ? 'good' : 'bad'
      conditions.push({ axis: axes[i].name, side })
      keyParts.push(side)
    }
    rules.push({
      key: keyParts.join('_'),
      label: keyParts.map((s, i) => `${axes[i].name}: ${s}`).join(', '),
      conditions,
    })
  }
  return rules
}

export default function FindingComposer({ initialFindings, initialSignals }: Props) {
  const [findings, setFindings] = useState<FindingDefinition[]>(initialFindings)
  const [signals] = useState<SignalDefinition[]>(initialSignals)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<FindingDefinition>>(emptyDraft())
  const [classificationLabels, setClassificationLabels] = useState<Record<string, string>>({})
  const [meta, setMeta] = useState<MetaInfo | null>(null)
  const [brand, setBrand] = useState<string>('')
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/meta').then(r => r.json()).then(({ data }: { data: MetaInfo }) => {
      setMeta(data)
      if (!brand && data.brands.length > 0) setBrand(data.brands[0])
    })
  }, [])

  // Regenerate classification combinations whenever axes change
  useEffect(() => {
    const axes = draft.axes ?? []
    const generated = generateClassifications(axes)
    // Preserve existing labels
    const updated = generated.map(g => ({
      ...g,
      label: classificationLabels[g.key] ?? g.label,
    }))
    setDraft(d => ({ ...d, classifications: updated }))
  }, [JSON.stringify(draft.axes)])

  function selectFinding(f: FindingDefinition) {
    setSelected(f.id)
    const labels: Record<string, string> = {}
    for (const c of f.classifications) labels[c.key] = c.label
    setClassificationLabels(labels)
    setDraft({
      name: f.name,
      label: f.label,
      axes: f.axes,
      classifications: f.classifications,
      severity: f.severity,
    })
    setRunResult(null)
    setRunError(null)
    setErrors({})
  }

  function newFinding() {
    setSelected(null)
    setClassificationLabels({})
    setDraft(emptyDraft())
    setRunResult(null)
    setRunError(null)
    setErrors({})
  }

  function addAxis() {
    const axes = draft.axes ?? []
    if (axes.length >= 6) return
    const firstSignal = signals[0]
    const newAxis: AxisDefinition = {
      name: `axis_${axes.length + 1}`,
      signal_id: firstSignal?.id ?? '',
      good_direction: 'positive',
      threshold: 0,
    }
    setDraft(d => ({ ...d, axes: [...(d.axes ?? []), newAxis] }))
  }

  function removeAxis(idx: number) {
    setDraft(d => ({ ...d, axes: (d.axes ?? []).filter((_, i) => i !== idx) }))
  }

  function updateAxis(idx: number, patch: Partial<AxisDefinition>) {
    setDraft(d => {
      const axes = [...(d.axes ?? [])]
      axes[idx] = { ...axes[idx], ...patch }
      return { ...d, axes }
    })
  }

  function updateClassificationLabel(key: string, label: string) {
    setClassificationLabels(prev => ({ ...prev, [key]: label }))
    setDraft(d => ({
      ...d,
      classifications: (d.classifications ?? []).map(c =>
        c.key === key ? { ...c, label } : c
      ),
    }))
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!draft.name?.trim()) errs.name = 'Name is required'
    if (!draft.label?.trim()) errs.label = 'Label is required'
    if (!draft.axes || draft.axes.length === 0) errs.axes = 'At least one axis required'
    if (!brand) errs.brand = 'Brand is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function runFinding(save = false) {
    if (!validate()) return
    setRunning(true)
    setRunError(null)
    try {
      const body = selected
        ? { definition_id: selected, brand, save }
        : { definition: { ...draft, id: 'preview', created_at: '', updated_at: '' }, brand, save }

      const res = await fetch('/api/findings/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { data?: RunResult; error?: string }
      if (json.error) {
        setRunError(json.error)
        setRunResult(null)
      } else if (json.data) {
        setRunResult(json.data)
      }
    } catch (e) {
      setRunError(String(e))
    } finally {
      setRunning(false)
    }
  }

  async function saveFinding() {
    if (!validate()) return
    setSaving(true)
    try {
      const url = selected ? `/api/findings/${selected}` : '/api/findings'
      const method = selected ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json() as { data?: FindingDefinition; error?: string }
      if (json.error) {
        setErrors({ _global: json.error })
      } else if (json.data) {
        const saved = json.data
        setFindings(prev => {
          const exists = prev.find(f => f.id === saved.id)
          return exists ? prev.map(f => f.id === saved.id ? saved : f) : [...prev, saved]
        })
        setSelected(saved.id)
      }
    } finally {
      setSaving(false)
    }
  }

  const axes = draft.axes ?? []
  const classifications = draft.classifications ?? []
  const severity = draft.severity ?? { deterioration_delta: 0.3, bands: { critical: 5, high: 3, moderate: 2 } }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-[#e2e8f0] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[#e2e8f0] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[#1a2030]">Findings</h2>
          <button
            onClick={newFinding}
            className="text-xs bg-[#3b5bdb] text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
          >
            + New
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {findings.length === 0 && (
            <p className="text-xs text-[#6b7280] px-4 py-3">No findings yet.</p>
          )}
          {findings.map(f => (
            <button
              key={f.id}
              onClick={() => selectFinding(f)}
              className={`w-full text-left px-4 py-3 border-b border-[#e2e8f0] hover:bg-[#f4f6f9] transition-colors ${selected === f.id ? 'bg-blue-50 border-l-2 border-l-[#3b5bdb]' : ''}`}
            >
              <div className="font-medium text-xs text-[#1a2030] truncate">{f.name}</div>
              <div className="text-xs text-[#6b7280] mt-0.5">{f.axes.length} axes · {f.classifications.length} classes</div>
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Editor card */}
          <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm">
            <div className="px-6 py-4 border-b border-[#e2e8f0]">
              <h2 className="font-semibold text-[#1a2030]">{selected ? 'Edit Finding' : 'New Finding'}</h2>
              <p className="text-xs text-[#6b7280] mt-1">
                A Finding composes N signals into one N-dimensional point. Each axis is one signal; the
                classification rules define which combination of &quot;good/bad&quot; axes maps to which finding label.
                Severity = sum of per-axis severities (each 0–3).
              </p>
            </div>
            <div className="p-6 space-y-5">
              {/* Basic fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#6b7280] mb-1">Name *<Tooltip text="Unique identifier for this finding definition. Example: `share_growth_quadrant`" /></label>
                  <input
                    type="text"
                    value={draft.name ?? ''}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    className={`w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${errors.name ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`}
                  />
                  {errors.name && <p className="text-xs text-[#e03131] mt-0.5">{errors.name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#6b7280] mb-1">Label *<Tooltip text="Display name. Example: 'Share × Growth Quadrant'" /></label>
                  <input
                    type="text"
                    value={draft.label ?? ''}
                    onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                    className={`w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${errors.label ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`}
                  />
                  {errors.label && <p className="text-xs text-[#e03131] mt-0.5">{errors.label}</p>}
                </div>
              </div>

              {/* Axes section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-[#6b7280]">Axes<Tooltip text="Each axis is one signal. The finding engine fetches signal data for all axes and joins by region. For a 2-axis finding you get 2² = 4 quadrant combinations; for 3 axes, 2³ = 8 octants." /></label>
                  {axes.length < 6 && (
                    <button
                      onClick={addAxis}
                      className="text-xs text-[#3b5bdb] hover:underline"
                    >
                      + Add axis
                    </button>
                  )}
                </div>
                {errors.axes && <p className="text-xs text-[#e03131] mb-2">{errors.axes}</p>}
                <div className="space-y-2">
                  {axes.map((axis, idx) => (
                    <div key={idx} className="flex gap-2 items-start bg-[#f8fafc] border border-[#e2e8f0] rounded p-3">
                      <div className="flex-1 grid grid-cols-4 gap-2">
                        {/* Signal */}
                        <div>
                          <label className="block text-xs text-[#6b7280] mb-0.5">Signal<Tooltip text="The signal whose current value defines this axis. Uses the signal definition to fetch series + strength." /></label>
                          <select
                            value={axis.signal_id}
                            onChange={e => {
                              const sig = signals.find(s => s.id === e.target.value)
                              updateAxis(idx, {
                                signal_id: e.target.value,
                                name: sig ? sig.name.split('_')[0] : axis.name,
                              })
                            }}
                            className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white"
                          >
                            <option value="">Select…</option>
                            {signals.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        {/* Axis name */}
                        <div>
                          <label className="block text-xs text-[#6b7280] mb-0.5">Axis name<Tooltip text="Short identifier used in {{variable}} templates. Example: 'share' → {{share_now}}, {{share_shape}}, etc." /></label>
                          <input
                            type="text"
                            value={axis.name}
                            onChange={e => updateAxis(idx, { name: e.target.value })}
                            className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs"
                          />
                        </div>
                        {/* Good direction */}
                        <div>
                          <label className="block text-xs text-[#6b7280] mb-0.5">Good direction<Tooltip text="Which side of the threshold is 'good'. Positive = above threshold is good (e.g. market share above average). Negative = below threshold is good (e.g. cost below budget)." /></label>
                          <select
                            value={axis.good_direction}
                            onChange={e => updateAxis(idx, { good_direction: e.target.value as 'positive' | 'negative' })}
                            className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white"
                          >
                            <option value="positive">Positive (above thresh)</option>
                            <option value="negative">Negative (below thresh)</option>
                          </select>
                        </div>
                        {/* Threshold */}
                        <div>
                          <label className="block text-xs text-[#6b7280] mb-0.5">Threshold<Tooltip text="The dividing line between 'good' and 'bad'. Default 0 = peer average for deviation signals. Adjust if you want to flag only regions more than X pp below peers." /></label>
                          <input
                            type="number"
                            step="0.1"
                            value={axis.threshold}
                            onChange={e => updateAxis(idx, { threshold: parseFloat(e.target.value) })}
                            className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeAxis(idx)}
                        className="mt-4 text-[#e03131] text-xs hover:text-red-800"
                        title="Remove axis"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Classifications section */}
              {classifications.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[#6b7280] mb-2">
                    Classifications ({classifications.length} combinations from {axes.length} axes)<Tooltip text="Auto-generated from axes — one combination per possible good/bad assignment across all axes. Edit the labels to match business meaning. The key is used in insight templates and the catalog." />
                  </label>
                  <div className="space-y-1">
                    {classifications.map(c => (
                      <div key={c.key} className="flex items-center gap-3 bg-[#f8fafc] border border-[#e2e8f0] rounded px-3 py-2">
                        <code className="text-xs text-[#3b5bdb] font-mono w-32 shrink-0">{c.key}</code>
                        <div className="text-xs text-[#6b7280] flex gap-1 flex-wrap flex-1">
                          {c.conditions.map(cond => (
                            <span
                              key={cond.axis}
                              className={`px-1.5 py-0.5 rounded ${cond.side === 'good' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                            >
                              {cond.axis}:{cond.side}
                            </span>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={c.label}
                          onChange={e => updateClassificationLabel(c.key, e.target.value)}
                          className="border border-[#e2e8f0] rounded px-2 py-1 text-xs w-48"
                          placeholder="Label…"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Severity config */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-2">Severity Configuration</label>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-[#6b7280] mb-0.5">Deterioration delta<Tooltip text="A signal axis is 'deteriorating' if its net displacement (D = now − start) is worse than −threshold. For position signals try 0.3pp; for growth signals try 2pp." /></label>
                    <input
                      type="number"
                      step="0.1"
                      value={severity.deterioration_delta}
                      onChange={e => setDraft(d => ({
                        ...d,
                        severity: { ...severity, deterioration_delta: parseFloat(e.target.value) },
                      }))}
                      className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6b7280] mb-0.5">Critical threshold<Tooltip text="Severity score bands. Score = sum of per-axis severities (each 0–3, so max = 3 × axes). Critical fires when score ≥ this value." /></label>
                    <input
                      type="number"
                      value={severity.bands.critical}
                      onChange={e => setDraft(d => ({
                        ...d,
                        severity: { ...severity, bands: { ...severity.bands, critical: parseInt(e.target.value) } },
                      }))}
                      className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6b7280] mb-0.5">High threshold<Tooltip text="Severity score bands. Score = sum of per-axis severities (each 0–3, so max = 3 × axes). High fires when score ≥ this value." /></label>
                    <input
                      type="number"
                      value={severity.bands.high}
                      onChange={e => setDraft(d => ({
                        ...d,
                        severity: { ...severity, bands: { ...severity.bands, high: parseInt(e.target.value) } },
                      }))}
                      className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6b7280] mb-0.5">Moderate threshold<Tooltip text="Severity score bands. Score = sum of per-axis severities (each 0–3, so max = 3 × axes). Moderate fires when score ≥ this value." /></label>
                    <input
                      type="number"
                      value={severity.bands.moderate}
                      onChange={e => setDraft(d => ({
                        ...d,
                        severity: { ...severity, bands: { ...severity.bands, moderate: parseInt(e.target.value) } },
                      }))}
                      className="w-full border border-[#e2e8f0] rounded px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Brand + actions */}
              <div className="flex items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#6b7280] mb-1">Brand *</label>
                  <select
                    value={brand}
                    onChange={e => setBrand(e.target.value)}
                    className={`border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${errors.brand ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`}
                  >
                    <option value="">Select brand…</option>
                    {(meta?.brands ?? []).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  {errors.brand && <p className="text-xs text-[#e03131] mt-0.5">{errors.brand}</p>}
                </div>
                <button
                  onClick={() => runFinding(false)}
                  disabled={running}
                  className="px-4 py-2 bg-[#3b5bdb] text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {running ? 'Running…' : '▶ Run'}
                </button>
                <button
                  onClick={saveFinding}
                  disabled={saving}
                  className="px-4 py-2 bg-[#1a2030] text-white rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : (selected ? 'Update Finding' : 'Save Finding')}
                </button>
              </div>

              {errors._global && (
                <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-[#e03131]">
                  {errors._global}
                </div>
              )}
            </div>
          </div>

          {/* Run error */}
          {runError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-[#e03131]">
              <strong>Run error:</strong> {runError}
            </div>
          )}

          {/* Results */}
          {runResult && (
            <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm">
              <div className="px-6 py-4 border-b border-[#e2e8f0] flex items-center justify-between flex-wrap gap-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <h3 className="font-semibold text-[#1a2030] mr-2">Results</h3>
                  {runResult.summary.map(s => (
                    <span key={s.key} className="text-xs px-2 py-0.5 bg-[#f4f6f9] border border-[#e2e8f0] rounded-full">
                      {s.label}: <strong>{s.count}</strong>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#6b7280]">
                    {runResult.rows.length} regions · {runResult.asof} · {runResult.brand}
                    {runResult.saved > 0 && ` · saved ${runResult.saved}`}
                  </span>
                  <button
                    onClick={() => runFinding(true)}
                    disabled={running}
                    className="text-xs px-3 py-1 bg-[#2f9e44] text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Save to catalog
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                      <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Region</th>
                      <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Territory</th>
                      <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Finding</th>
                      <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Severity</th>
                      {(runResult.rows[0] ? Object.keys(runResult.rows[0].axes) : []).map(axisName => (
                        <th key={axisName} className="text-right px-4 py-2 font-medium text-[#6b7280]">{axisName} now</th>
                      ))}
                      <th className="text-right px-4 py-2 font-medium text-[#6b7280]">rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runResult.rows.map((row, i) => (
                      <tr key={`${row.region}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                        <td className="px-4 py-2 font-medium text-[#1a2030]">{row.region}</td>
                        <td className="px-4 py-2 text-[#6b7280]">{row.territory}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${bandColor(row.severity.band)}`}>
                            {row.finding_label}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityColor(row.severity.score)}`}>
                            {row.severity.band} ({row.severity.score})
                          </span>
                        </td>
                        {Object.entries(row.axes).map(([axisName, axisRes]) => (
                          <td key={axisName} className={`px-4 py-2 text-right font-mono ${axisRes.now >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {axisRes.now >= 0 ? '+' : ''}{axisRes.now.toFixed(2)}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right text-[#6b7280]">{row.mat_rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
