'use client'

import { useState, useEffect } from 'react'
import type { SignalDefinition, SignalRow, FilterCondition, SegmentValues } from '@/lib/types'
import Tooltip from '@/components/Tooltip'

interface Props { initialSignals: SignalDefinition[] }
const ALL_LAGS = [0, 1, 2, 3, 6, 12]
const OPERATORS: FilterCondition['operator'][] = ['=', '!=', '>', '<', '>=', '<=', 'IN']
const DIRECTIONS = [
  { value: 'higher_is_better', label: 'Higher is better' },
  { value: 'lower_is_better', label: 'Lower is better' },
]
const STRENGTH_KINDS = [
  { value: 'position', label: 'Position' },
  { value: 'growth', label: 'Growth' },
]

interface TableColumn { name: string; type: string }
interface PreviewResult { rows: SignalRow[]; asof?: string; segments: SegmentValues[]; count: number }

function Sparkline({ series }: { series: number[] }) {
  return (
    <span className="font-mono text-xs flex gap-1 flex-wrap">
      {series.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <span className={v >= 0 ? 'text-green-600' : 'text-red-600'}>{v.toFixed(2)}</span>
          {i < series.length - 1 && <span className="text-gray-400">→</span>}
        </span>
      ))}
    </span>
  )
}

function ShapeBadge({ shape }: { shape: string }) {
  const colors: Record<string, string> = {
    trend: 'bg-blue-100 text-blue-700', unstable: 'bg-orange-100 text-orange-700',
    mixed: 'bg-yellow-100 text-yellow-700', quiet: 'bg-gray-100 text-gray-500',
  }
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[shape] ?? 'bg-gray-100 text-gray-500'}`}>{shape}</span>
}

function emptyDraft(): Partial<SignalDefinition> {
  return {
    name: '', label: '',
    source_table: '', entity_dimension: '', time_dimension: '',
    filters: [], segment_by: [],
    metric: '', lags: [0, 1, 2, 3], delta_lags: [1, 3],
    direction: 'higher_is_better', strength_kind: 'position', loud_threshold: 2.0,
  }
}

export default function SignalStudio({ initialSignals }: Props) {
  const [signals, setSignals] = useState<SignalDefinition[]>(initialSignals)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<SignalDefinition>>(emptyDraft())
  const [tables, setTables] = useState<string[]>([])
  const [tableColumns, setTableColumns] = useState<TableColumn[]>([])
  const [segmentValues, setSegmentValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/data/tables').then(r => r.json()).then(({ data }: { data: { tables: string[] } }) => setTables(data.tables))
  }, [])

  useEffect(() => {
    if (!draft.source_table) { setTableColumns([]); return }
    fetch(`/api/data/${draft.source_table}?schema=1`)
      .then(r => r.json())
      .then(({ data }: { data: { columns: TableColumn[] } }) => setTableColumns(data.columns))
      .catch(() => setTableColumns([]))
  }, [draft.source_table])

  const numericCols = tableColumns.filter(c => c.type === 'REAL' || c.type === 'INTEGER').map(c => c.name)
  const allCols = tableColumns.map(c => c.name)

  function selectSignal(sig: SignalDefinition) {
    setSelected(sig.id); setDraft({ ...sig })
    setPreview(null); setPreviewError(null); setErrors({}); setSegmentValues({})
  }
  function newSignal() {
    setSelected(null); setDraft(emptyDraft())
    setPreview(null); setPreviewError(null); setErrors({}); setSegmentValues({})
  }
  function toggleLag(lag: number) {
    const lags = draft.lags ?? []
    const next = lags.includes(lag) ? lags.filter(l => l !== lag) : [...lags, lag].sort((a, b) => a - b)
    setDraft(d => ({ ...d, lags: next, delta_lags: (d.delta_lags ?? []).filter(dl => next.includes(dl)) }))
  }
  function toggleDeltaLag(lag: number) {
    const dl = draft.delta_lags ?? []
    setDraft(d => ({ ...d, delta_lags: dl.includes(lag) ? dl.filter(l => l !== lag) : [...dl, lag].sort((a, b) => a - b) }))
  }
  function addFilter() {
    setDraft(d => ({ ...d, filters: [...(d.filters ?? []), { column: allCols[0] ?? '', operator: '=' as const, value: '' }] }))
  }
  function updateFilter(i: number, patch: Partial<FilterCondition>) {
    const filters = [...(draft.filters ?? [])]; filters[i] = { ...filters[i], ...patch }
    setDraft(d => ({ ...d, filters }))
  }
  function removeFilter(i: number) { setDraft(d => ({ ...d, filters: (d.filters ?? []).filter((_, idx) => idx !== i) })) }
  function addSegment(col: string) {
    if (!col || (draft.segment_by ?? []).includes(col)) return
    setDraft(d => ({ ...d, segment_by: [...(d.segment_by ?? []), col] }))
  }
  function removeSegment(col: string) {
    setDraft(d => ({ ...d, segment_by: (d.segment_by ?? []).filter(c => c !== col) }))
    setSegmentValues(sv => { const n = { ...sv }; delete n[col]; return n })
  }
  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!draft.source_table) e.source_table = 'Required'
    if (!draft.entity_dimension) e.entity_dimension = 'Required'
    if (!draft.time_dimension) e.time_dimension = 'Required'
    if (!draft.metric) e.metric = 'Required'
    if (!draft.lags || draft.lags.length < 2) e.lags = 'At least 2 lags required'
    if (!draft.name?.trim()) e.name = 'Required'
    setErrors(e); return Object.keys(e).length === 0
  }
  async function runPreview() {
    if (!validate()) return
    setPreviewing(true); setPreviewError(null)
    try {
      const res = await fetch('/api/signals/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: draft, segmentValues }),
      })
      const json = await res.json() as { data?: PreviewResult; error?: string }
      if (json.error) { setPreviewError(json.error); setPreview(null) }
      else if (json.data) {
        setPreview(json.data)
        const sv: Record<string, string> = { ...segmentValues }
        for (const seg of json.data.segments) {
          if (!sv[seg.column] && seg.values.length > 0) sv[seg.column] = seg.values[0]
        }
        setSegmentValues(sv)
      }
    } catch (e) { setPreviewError(String(e)) }
    finally { setPreviewing(false) }
  }
  async function saveSignal() {
    if (!validate()) return
    setSaving(true)
    try {
      const res = await fetch(selected ? `/api/signals/${selected}` : '/api/signals', {
        method: selected ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json() as { data?: SignalDefinition; error?: string }
      if (json.error) setErrors({ _global: json.error })
      else if (json.data) {
        const saved = json.data
        setSignals(prev => prev.find(s => s.id === saved.id) ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved])
        setSelected(saved.id)
      }
    } finally { setSaving(false) }
  }

  const selectedLags = draft.lags ?? []
  const Err = ({ msg }: { msg?: string }) => msg ? <p className="text-xs text-[#e03131] mt-0.5">{msg}</p> : null
  const Lbl = ({ text, tip }: { text: string; tip: string }) => (
    <label className="block text-xs font-medium text-[#6b7280] mb-1">{text}<Tooltip text={tip} /></label>
  )
  const inp = (err?: string) => `w-full border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b5bdb] ${err ? 'border-[#e03131]' : 'border-[#e2e8f0]'}`

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <aside className="w-64 bg-white border-r border-[#e2e8f0] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[#e2e8f0] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[#1a2030]">Signals</h2>
          <button onClick={newSignal} className="text-xs bg-[#3b5bdb] text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors">+ New</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {signals.length === 0 && <p className="text-xs text-[#6b7280] px-4 py-3">No signals yet.</p>}
          {signals.map(sig => (
            <button key={sig.id} onClick={() => selectSignal(sig)}
              className={`w-full text-left px-4 py-3 border-b border-[#e2e8f0] hover:bg-[#f4f6f9] transition-colors ${selected === sig.id ? 'bg-blue-50 border-l-2 border-l-[#3b5bdb]' : ''}`}>
              <div className="font-medium text-xs text-[#1a2030] truncate">{sig.name}</div>
              <div className="text-xs text-[#6b7280] mt-0.5 truncate">{sig.metric} · {sig.source_table}</div>
              <div className="text-xs text-[#6b7280]">lags: [{sig.lags.join(', ')}]</div>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm">
            <div className="px-6 py-4 border-b border-[#e2e8f0]">
              <h2 className="font-semibold text-[#1a2030]">{selected ? 'Edit Signal' : 'New Signal'}</h2>
              <p className="text-xs text-[#6b7280] mt-1">A Signal is a comparative metric watched over time. Pick any table — the engine adapts to the schema. No assumptions about region names, period types, or brands.</p>
            </div>
            <div className="p-6 space-y-6">

              {/* Identity */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Lbl text="Name *" tip="Unique snake_case identifier. Example: mshare_deviation_mat" />
                  <input type="text" value={draft.name ?? ''} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    className={inp(errors.name)} placeholder="e.g. mshare_dev_mat" />
                  <Err msg={errors.name} />
                </div>
                <div>
                  <Lbl text="Label" tip="Human-readable name shown in the UI. Example: Market Share Deviation (MAT, −1m/−3m)" />
                  <input type="text" value={draft.label ?? ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                    className={inp()} placeholder="Human-readable label" />
                </div>
              </div>

              {/* Source */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-[#1a2030] uppercase tracking-wide">Source</span>
                  <Tooltip text="Which table in metrics.db, which column identifies each entity (PARTITION BY), and which column represents time (ORDER BY). Browse any table in the Data tab first." />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Lbl text="Table *" tip="Source table. The engine reads only this table — no joins. Inspect columns in the Data tab." />
                    <select value={draft.source_table ?? ''} onChange={e => setDraft(d => ({ ...d, source_table: e.target.value, entity_dimension: '', time_dimension: '', metric: '' }))}
                      className={inp(errors.source_table)}>
                      <option value="">Select table…</option>
                      {tables.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <Err msg={errors.source_table} />
                  </div>
                  <div>
                    <Lbl text="Entity dimension *" tip="PARTITION BY this column — one LAG series per distinct value. e.g. region_name, hospital_id, product_sku." />
                    <select value={draft.entity_dimension ?? ''} onChange={e => setDraft(d => ({ ...d, entity_dimension: e.target.value }))}
                      className={inp(errors.entity_dimension)} disabled={!allCols.length}>
                      <option value="">Select column…</option>
                      {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <Err msg={errors.entity_dimension} />
                  </div>
                  <div>
                    <Lbl text="Time dimension *" tip="ORDER BY this column to sequence the series. e.g. year_month, quarter, week." />
                    <select value={draft.time_dimension ?? ''} onChange={e => setDraft(d => ({ ...d, time_dimension: e.target.value }))}
                      className={inp(errors.time_dimension)} disabled={!allCols.length}>
                      <option value="">Select column…</option>
                      {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <Err msg={errors.time_dimension} />
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#1a2030] uppercase tracking-wide">Filters</span>
                    <Tooltip text="Fixed WHERE conditions for every run. Use instead of hardcoding period_type or other slice dimensions in code. Example: period_type = MAT. Conditions are AND-ed." />
                  </div>
                  <button onClick={addFilter} disabled={!allCols.length} className="text-xs text-[#3b5bdb] hover:underline disabled:opacity-40">+ Add filter</button>
                </div>
                {(draft.filters ?? []).length === 0 && (
                  <p className="text-xs text-[#6b7280] italic">No filters — reads all rows in the table (filtered only by segment values at run time).</p>
                )}
                <div className="space-y-2">
                  {(draft.filters ?? []).map((f, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select value={f.column} onChange={e => updateFilter(i, { column: e.target.value })}
                        className="border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white flex-1">
                        {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={f.operator} onChange={e => updateFilter(i, { operator: e.target.value as FilterCondition['operator'] })}
                        className="border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white w-16">
                        {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                      </select>
                      <input type="text" value={Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}
                        onChange={e => updateFilter(i, { value: f.operator === 'IN' ? e.target.value.split(',').map(s => s.trim()) : e.target.value })}
                        className="border border-[#e2e8f0] rounded px-2 py-1 text-xs flex-1" placeholder="value (IN: comma-separated)" />
                      <button onClick={() => removeFilter(i)} className="text-[#6b7280] hover:text-[#e03131] text-sm px-1">×</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Segment by */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-[#1a2030] uppercase tracking-wide">Segment by</span>
                  <Tooltip text="Run the engine once per distinct value of these columns. e.g. brand_name → one signal result set per brand. In the preview you choose which value to preview. Leave empty to run across all data combined." />
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  {(draft.segment_by ?? []).map(col => (
                    <span key={col} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded">
                      {col}
                      <button onClick={() => removeSegment(col)} className="text-blue-400 hover:text-blue-700 ml-0.5">×</button>
                    </span>
                  ))}
                  <select onChange={e => { addSegment(e.target.value); e.target.value = '' }}
                    className="border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white" disabled={!allCols.length}>
                    <option value="">+ Add segment column…</option>
                    {allCols.filter(c => !(draft.segment_by ?? []).includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Signal parameters */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-[#1a2030] uppercase tracking-wide">Signal parameters</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Lbl text="Metric *" tip="The numeric column to track over time (LAG window functions). Only REAL / INTEGER columns listed." />
                    <select value={draft.metric ?? ''} onChange={e => setDraft(d => ({ ...d, metric: e.target.value }))}
                      className={inp(errors.metric)} disabled={!numericCols.length}>
                      <option value="">Select metric column…</option>
                      {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <Err msg={errors.metric} />
                  </div>
                  <div>
                    <Lbl text="Direction *" tip="Which direction is 'good'. Higher is better: share, growth. Lower is better: cost, error rate." />
                    <select value={draft.direction ?? 'higher_is_better'} onChange={e => setDraft(d => ({ ...d, direction: e.target.value as SignalDefinition['direction'] }))}
                      className={inp()}>
                      {DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl text="Lags * (min 2)" tip="How many time steps back. Lag 0 = now, lag 3 = 3 periods ago. Series is always oldest→now." />
                    <div className="flex flex-wrap gap-2 mt-1">
                      {ALL_LAGS.map(lag => (
                        <label key={lag} className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={selectedLags.includes(lag)} onChange={() => toggleLag(lag)} className="accent-[#3b5bdb]" />
                          <span className="text-xs">{lag === 0 ? 'now' : `−${lag}`}</span>
                        </label>
                      ))}
                    </div>
                    <Err msg={errors.lags} />
                  </div>
                  <div>
                    <Lbl text="Delta lags" tip="Which steps to emit as Δ columns: now − lag_N. Must be a subset of selected lags." />
                    <div className="flex flex-wrap gap-2 mt-1">
                      {ALL_LAGS.filter(l => l > 0 && selectedLags.includes(l)).map(lag => (
                        <label key={lag} className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={(draft.delta_lags ?? []).includes(lag)} onChange={() => toggleDeltaLag(lag)} className="accent-[#3b5bdb]" />
                          <span className="text-xs">Δ−{lag}</span>
                        </label>
                      ))}
                      {selectedLags.filter(l => l > 0).length === 0 && <span className="text-xs text-[#6b7280]">Select lags first</span>}
                    </div>
                  </div>
                  <div>
                    <Lbl text="Strength kind" tip="Sets the loudness band scale. Position = pp-scale metrics (share deviation). Growth = %-scale metrics (YoY growth)." />
                    <select value={draft.strength_kind ?? 'position'} onChange={e => setDraft(d => ({ ...d, strength_kind: e.target.value as SignalDefinition['strength_kind'] }))}
                      className={inp()}>
                      {STRENGTH_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl text="Loud threshold" tip="Minimum V = Σ|step deltas| to earn the 'loud' severity bonus (+1 per axis). Position: ~2.0pp. Growth: ~10%." />
                    <input type="number" step="0.1" value={draft.loud_threshold ?? 2.0}
                      onChange={e => setDraft(d => ({ ...d, loud_threshold: parseFloat(e.target.value) }))}
                      className={inp()} />
                  </div>
                </div>
              </div>

              {/* Preview execution */}
              <div className="border-t border-[#e2e8f0] pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-[#1a2030] uppercase tracking-wide">Preview execution</span>
                  <Tooltip text="Pick one value per segment_by column to preview. The definition itself is not scoped to any value — this just controls which slice you preview against." />
                </div>
                {(draft.segment_by ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-3 mb-3">
                    {(draft.segment_by ?? []).map(col => {
                      const seg = preview?.segments.find(s => s.column === col)
                      return (
                        <div key={col}>
                          <label className="block text-xs text-[#6b7280] mb-1">{col}</label>
                          <select value={segmentValues[col] ?? ''} onChange={e => setSegmentValues(sv => ({ ...sv, [col]: e.target.value }))}
                            className="border border-[#e2e8f0] rounded px-2 py-1.5 text-xs bg-white">
                            <option value="">— run without filter (loads values after first preview) —</option>
                            {(seg?.values ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[#6b7280] mb-3">No segment columns — signal runs across all rows matching the filters.</p>
                )}
                {errors._global && (
                  <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-[#e03131] mb-3">{errors._global}</div>
                )}
                <div className="flex gap-3">
                  <button onClick={runPreview} disabled={previewing}
                    className="px-4 py-2 bg-[#3b5bdb] text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {previewing ? 'Running…' : '▶ Preview'}
                  </button>
                  <button onClick={saveSignal} disabled={saving}
                    className="px-4 py-2 bg-[#1a2030] text-white rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving…' : selected ? 'Update Signal' : 'Save Signal'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Preview results */}
          {previewError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-[#e03131]">
              <strong>Error:</strong> {previewError}
            </div>
          )}
          {preview && (
            <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm">
              <div className="px-6 py-4 border-b border-[#e2e8f0] flex items-center justify-between">
                <h3 className="font-semibold text-[#1a2030]">Preview Results</h3>
                <span className="text-xs text-[#6b7280]">
                  {preview.count} {draft.entity_dimension || 'entities'}{preview.asof ? ` · as-of ${preview.asof}` : ''}
                  {Object.entries(segmentValues).filter(([,v]) => v).map(([k, v]) => ` · ${k}=${v}`).join('')}
                </span>
              </div>
              {preview.count === 0 ? (
                <p className="p-6 text-sm text-[#6b7280]">No rows. Check that filters match the data and lags don't exceed available history.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                        <th className="text-left px-4 py-2 font-medium text-[#6b7280]">{draft.entity_dimension || 'Entity'}</th>
                        <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Series (oldest→now)</th>
                        <th className="text-right px-4 py-2 font-medium text-[#6b7280]">V</th>
                        <th className="text-right px-4 py-2 font-medium text-[#6b7280]">net</th>
                        <th className="text-right px-4 py-2 font-medium text-[#6b7280]">ρ</th>
                        <th className="text-left px-4 py-2 font-medium text-[#6b7280]">shape</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                          <td className="px-4 py-2 font-medium text-[#1a2030]">{row.entity}</td>
                          <td className="px-4 py-2"><Sparkline series={row.series} /></td>
                          <td className="px-4 py-2 text-right font-mono">{row.strength.magnitude.toFixed(3)}</td>
                          <td className={`px-4 py-2 text-right font-mono ${row.strength.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {row.strength.net >= 0 ? '+' : ''}{row.strength.net.toFixed(3)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${row.strength.coherence >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {row.strength.coherence.toFixed(3)}
                          </td>
                          <td className="px-4 py-2"><ShapeBadge shape={row.strength.shape} /></td>
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
