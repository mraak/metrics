'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SignalDefinition, SignalRow, MetaInfo } from '@/lib/types'
import Tooltip from '@/components/Tooltip'

interface Props {
  initialSignals: SignalDefinition[]
}

const ALL_LAGS = [0, 1, 2, 3, 6, 12]
const PERIOD_TYPES = ['MAT', 'RollQ', 'YTD', 'Month']
const DIRECTIONS = [
  { value: 'higher_is_better', label: 'Higher is better' },
  { value: 'lower_is_better', label: 'Lower is better' },
]
const STRENGTH_KINDS = [
  { value: 'position', label: 'Position' },
  { value: 'growth', label: 'Growth' },
]

interface PreviewResult {
  rows: SignalRow[]
  asof: string
  brand: string
  count: number
}

function Sparkline({ series }: { series: number[] }) {
  return (
    <span className="font-mono text-xs flex gap-1 flex-wrap">
      {series.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <span className={v >= 0 ? 'text-green-600' : 'text-red-600'}>
            {v.toFixed(2)}
          </span>
          {i < series.length - 1 && <span className="text-gray-400">→</span>}
        </span>
      ))}
    </span>
  )
}

function SeverityBandBadge({ shape }: { shape: string }) {
  const colors: Record<string, string> = {
    trend: 'bg-blue-100 text-blue-700',
    unstable: 'bg-orange-100 text-orange-700',
    mixed: 'bg-yellow-100 text-yellow-700',
    quiet: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[shape] ?? 'bg-gray-100 text-gray-500'}`}>
      {shape}
    </span>
  )
}

function emptyDraft(): Partial<SignalDefinition> {
  return {
    name: '',
    label: '',
    metric: '',
    period_type: 'MAT',
    lags: [0, 1, 2, 3],
    delta_lags: [1, 3],
    direction: 'higher_is_better',
    strength_kind: 'position',
    loud_threshold: 2.0,
  }
}

export default function SignalStudio({ initialSignals }: Props) {
  const [signals, setSignals] = useState<SignalDefinition[]>(initialSignals)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<SignalDefinition>>(emptyDraft())
  const [meta, setMeta] = useState<MetaInfo | null>(null)
  const [brand, setBrand] = useState<string>('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/meta').then(r => r.json()).then(({ data }: { data: MetaInfo }) => {
      setMeta(data)
      if (!brand && data.brands.length > 0) setBrand(data.brands[0])
      if (!draft.metric && data.metrics.length > 0) setDraft(d => ({ ...d, metric: data.metrics[0] }))
    })
  }, [])

  function selectSignal(sig: SignalDefinition) {
    setSelected(sig.id)
    setDraft({
      name: sig.name,
      label: sig.label,
      metric: sig.metric,
      period_type: sig.period_type,
      lags: sig.lags,
      delta_lags: sig.delta_lags,
      direction: sig.direction,
      strength_kind: sig.strength_kind,
      loud_threshold: sig.loud_threshold,
    })
    setPreview(null)
    setPreviewError(null)
    setErrors({})
  }

  function newSignal() {
    setSelected(null)
    setDraft(emptyDraft())
    setPreview(null)
    setPreviewError(null)
    setErrors({})
  }

  function toggleLag(lag: number) {
    const lags = draft.lags ?? []
    const next = lags.includes(lag) ? lags.filter(l => l !== lag) : [...lags, lag].sort((a, b) => a - b)
    // Remove delta_lags that are no longer in lags
    const deltaLags = (draft.delta_lags ?? []).filter(dl => next.includes(dl))
    setDraft(d => ({ ...d, lags: next, delta_lags: deltaLags }))
  }

  function toggleDeltaLag(lag: number) {
    const delta_lags = draft.delta_lags ?? []
    const next = delta_lags.includes(lag)
      ? delta_lags.filter(l => l !== lag)
      : [...delta_lags, lag].sort((a, b) => a - b)
    setDraft(d => ({ ...d, delta_lags: next }))
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!draft.name?.trim()) errs.name = 'Name is required'
    if (!draft.label?.trim()) errs.label = 'Label is required'
    if (!draft.metric) errs.metric = 'Metric is required'
    if (!draft.period_type) errs.period_type = 'Period type is required'
    if (!draft.lags || draft.lags.length < 2) errs.lags = 'At least 2 lags required'
    if (!draft.direction) errs.direction = 'Direction is required'
    if (!draft.strength_kind) errs.strength_kind = 'Strength kind is required'
    if (!brand) errs.brand = 'Brand is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function runPreview() {
    if (!validate()) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      const res = await fetch('/api/signals/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: draft, brand }),
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

  async function saveSignal() {
    if (!validate()) return
    setSaving(true)
    try {
      const url = selected ? `/api/signals/${selected}` : '/api/signals'
      const method = selected ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json() as { data?: SignalDefinition; error?: string }
      if (json.error) {
        setErrors({ _global: json.error })
      } else if (json.data) {
        const saved = json.data
        setSignals(prev => {
          const exists = prev.find(s => s.id === saved.id)
          return exists ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved]
        })
        setSelected(saved.id)
      }
    } finally {
      setSaving(false)
    }
  }

  const selectedLags = draft.lags ?? []

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-[#e2e8f0] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[#e2e8f0] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[#1a2030]">Signals</h2>
          <button
            onClick={newSignal}
            className="text-xs bg-[#3b5bdb] text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
          >
            + New
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {signals.length === 0 && (
            <p className="text-xs text-[#6b7280] px-4 py-3">No signals yet.</p>
          )}
          {signals.map(sig => (
            <button
              key={sig.id}
              onClick={() => selectSignal(sig)}
              className={`w-full text-left px-4 py-3 border-b border-[#e2e8f0] hover:bg-[#f4f6f9] transition-colors ${selected === sig.id ? 'bg-blue-50 border-l-2 border-l-[#3b5bdb]' : ''}`}
            >
              <div className="font-medium text-xs text-[#1a2030] truncate">{sig.name}</div>
              <div className="text-xs text-[#6b7280] mt-0.5 truncate">{sig.metric} · {sig.period_type}</div>
              <div className="text-xs text-[#6b7280]">lags: [{sig.lags.join(', ')}]</div>
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
              <h2 className="font-semibold text-[#1a2030]">
                {selected ? 'Edit Signal' : 'New Signal'}
              </h2>
              <p className="text-xs text-[#6b7280] mt-1">
                A Signal is a comparative metric watched over time — it adds trajectory to a data point.
                Define the metric, period, and how far back to look, then preview against any brand.
              </p>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {/* Name */}
              <div className="col-span-1">
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Name *<Tooltip text="Unique identifier used in code and config. Use snake_case. Example: `mshare_dev_mat_step_1m_3m`" /></label>
                <input
                  type="text"
                  value={draft.name ?? ''}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  className={`w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${errors.name ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`}
                  placeholder="e.g. mshare_dev_mat"
                />
                {errors.name && <p className="text-xs text-[#e03131] mt-0.5">{errors.name}</p>}
              </div>

              {/* Label */}
              <div className="col-span-1">
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Label *<Tooltip text="Human-readable display name shown in the UI. Example: 'Market Share Deviation (MAT, −1m/−3m)'" /></label>
                <input
                  type="text"
                  value={draft.label ?? ''}
                  onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                  className={`w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${errors.label ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`}
                  placeholder="Human-readable label"
                />
                {errors.label && <p className="text-xs text-[#e03131] mt-0.5">{errors.label}</p>}
              </div>

              {/* Metric */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Metric *<Tooltip text="The column from `region_metrics` to track over time. Must be a numeric column. This is the raw comparative metric (Tier 2) that becomes a Signal (Tier 3) when watched over time." /></label>
                <select
                  value={draft.metric ?? ''}
                  onChange={e => setDraft(d => ({ ...d, metric: e.target.value }))}
                  className={`w-full border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${errors.metric ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`}
                >
                  <option value="">Select metric…</option>
                  {(meta?.metrics ?? []).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                {errors.metric && <p className="text-xs text-[#e03131] mt-0.5">{errors.metric}</p>}
              </div>

              {/* Period type */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Period Type *<Tooltip text="Which aggregation window to use. MAT = Moving Annual Total (12-month rolling sum). RollQ = Rolling Quarter. YTD = Year to Date. Month = single calendar month. MAT is the most stable for signal analysis." /></label>
                <select
                  value={draft.period_type ?? 'MAT'}
                  onChange={e => setDraft(d => ({ ...d, period_type: e.target.value }))}
                  className="w-full border border-[#e2e8f0] rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b5bdb]"
                >
                  {PERIOD_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                </select>
              </div>

              {/* Lags */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Lags * (min 2)<Tooltip text="How many months back to look. Lag 0 = now, lag 1 = last month, lag 3 = 3 months ago. The series will be [lag_max → lag_0] (oldest to now). Minimum 2 lags to compute any delta." /></label>
                <div className="flex flex-wrap gap-2">
                  {ALL_LAGS.map(lag => (
                    <label key={lag} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedLags.includes(lag)}
                        onChange={() => toggleLag(lag)}
                        className="accent-[#3b5bdb]"
                      />
                      <span className="text-xs">{lag}m</span>
                    </label>
                  ))}
                </div>
                {errors.lags && <p className="text-xs text-[#e03131] mt-0.5">{errors.lags}</p>}
              </div>

              {/* Delta lags */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Delta Lags<Tooltip text="Which step-deltas to compute and display. Delta 1m = now minus last month. Delta 3m = now minus 3 months ago. These appear as columns in the preview table." /></label>
                <div className="flex flex-wrap gap-2">
                  {ALL_LAGS.filter(l => l > 0 && selectedLags.includes(l)).map(lag => (
                    <label key={lag} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(draft.delta_lags ?? []).includes(lag)}
                        onChange={() => toggleDeltaLag(lag)}
                        className="accent-[#3b5bdb]"
                      />
                      <span className="text-xs">−{lag}m</span>
                    </label>
                  ))}
                  {selectedLags.filter(l => l > 0).length === 0 && (
                    <span className="text-xs text-[#6b7280]">Select lags first</span>
                  )}
                </div>
              </div>

              {/* Direction */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Direction *<Tooltip text="Which direction is 'good' for this metric. For market share deviation: higher is better (positive = above peers). For cost deviation: lower is better." /></label>
                <select
                  value={draft.direction ?? 'higher_is_better'}
                  onChange={e => setDraft(d => ({ ...d, direction: e.target.value as SignalDefinition['direction'] }))}
                  className="w-full border border-[#e2e8f0] rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b5bdb]"
                >
                  {DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>

              {/* Strength kind */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Strength Kind *<Tooltip text="Affects the loudness threshold interpretation. 'Position' = share-deviation-style metrics (measured in pp, typically small numbers). 'Growth' = growth-rate metrics (measured in %, typically larger numbers)." /></label>
                <select
                  value={draft.strength_kind ?? 'position'}
                  onChange={e => setDraft(d => ({ ...d, strength_kind: e.target.value as SignalDefinition['strength_kind'] }))}
                  className="w-full border border-[#e2e8f0] rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b5bdb]"
                >
                  {STRENGTH_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </div>

              {/* Loud threshold */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Loud Threshold<Tooltip text="Minimum magnitude (V = Σ|step deltas|) for a signal to be considered 'loud' when computing severity. Position signals: try 2.0pp. Growth signals: try 10pp. A signal below this threshold won't trigger the +1 'loud' severity bonus." /></label>
                <input
                  type="number"
                  step="0.1"
                  value={draft.loud_threshold ?? 2.0}
                  onChange={e => setDraft(d => ({ ...d, loud_threshold: parseFloat(e.target.value) }))}
                  className="w-full border border-[#e2e8f0] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3b5bdb]"
                />
              </div>

              {/* Brand selector */}
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">Brand *<Tooltip text="Which brand to run the preview against. Doesn't affect the saved signal definition — it's only for preview." /></label>
                <select
                  value={brand}
                  onChange={e => setBrand(e.target.value)}
                  className={`w-full border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${errors.brand ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`}
                >
                  <option value="">Select brand…</option>
                  {(meta?.brands ?? []).map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                {errors.brand && <p className="text-xs text-[#e03131] mt-0.5">{errors.brand}</p>}
              </div>

              {/* Global error */}
              {errors._global && (
                <div className="col-span-2 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-[#e03131]">
                  {errors._global}
                </div>
              )}

              {/* Action buttons */}
              <div className="col-span-2 flex gap-3 pt-2">
                <button
                  onClick={runPreview}
                  disabled={previewing}
                  className="px-4 py-2 bg-[#3b5bdb] text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {previewing ? 'Running…' : '▶ Preview'}
                </button>
                <button
                  onClick={saveSignal}
                  disabled={saving}
                  className="px-4 py-2 bg-[#1a2030] text-white rounded text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : (selected ? 'Update Signal' : 'Save Signal')}
                </button>
              </div>
            </div>
          </div>

          {/* Preview section */}
          {previewError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-[#e03131]">
              <strong>Preview error:</strong> {previewError}
            </div>
          )}

          {preview && (
            <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm">
              <div className="px-6 py-4 border-b border-[#e2e8f0] flex items-center justify-between">
                <h3 className="font-semibold text-[#1a2030]">Preview Results</h3>
                <span className="text-xs text-[#6b7280]">
                  {preview.count} region{preview.count !== 1 ? 's' : ''} · asof {preview.asof} · {preview.brand}
                </span>
              </div>

              {preview.count === 0 ? (
                <div className="p-6 text-sm text-[#6b7280]">
                  No rows returned. This usually means there is not enough history for the selected lags (need at least {Math.max(...(draft.lags ?? [0]))} months of data for brand/period_type combination).
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                        <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Region</th>
                        <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Territory</th>
                        <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Series (oldest→now)</th>
                        <th className="text-right px-4 py-2 font-medium text-[#6b7280]">V (mag)</th>
                        <th className="text-right px-4 py-2 font-medium text-[#6b7280]">net</th>
                        <th className="text-right px-4 py-2 font-medium text-[#6b7280]">ρ</th>
                        <th className="text-left px-4 py-2 font-medium text-[#6b7280]">shape</th>
                        <th className="text-right px-4 py-2 font-medium text-[#6b7280]">rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr
                          key={`${row.region}-${i}`}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}
                        >
                          <td className="px-4 py-2 font-medium text-[#1a2030]">{row.region}</td>
                          <td className="px-4 py-2 text-[#6b7280]">{row.territory}</td>
                          <td className="px-4 py-2"><Sparkline series={row.series} /></td>
                          <td className="px-4 py-2 text-right font-mono">{row.strength.magnitude.toFixed(3)}</td>
                          <td className={`px-4 py-2 text-right font-mono ${row.strength.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {row.strength.net >= 0 ? '+' : ''}{row.strength.net.toFixed(3)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${row.strength.coherence >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {row.strength.coherence.toFixed(3)}
                          </td>
                          <td className="px-4 py-2"><SeverityBandBadge shape={row.strength.shape} /></td>
                          <td className="px-4 py-2 text-right text-[#6b7280]">{row.mat_rank}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
