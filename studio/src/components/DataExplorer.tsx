'use client'

import { useState, useEffect } from 'react'

const REGION_METRICS_COLUMNS = [
  'region_name', 'territory_name', 'brand_name', 'year_month', 'period_type',
  'sales_eur', 'units', 'market_share', 'mshare_deviation', 'growth_deviation', 'rank_sales_eur',
]

type PragmaColumn = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: unknown
  pk: number
}

function truncate(val: unknown, max = 40): string {
  const s = String(val ?? '')
  return s.length > max ? s.slice(0, max) + '…' : s
}

export default function DataExplorer() {
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [schema, setSchema] = useState<PragmaColumn[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  // Filters for region_metrics
  const [brands, setBrands] = useState<string[]>([])
  const [periodTypes, setPeriodTypes] = useState<string[]>([])
  const [yearMonths, setYearMonths] = useState<string[]>([])
  const [filterBrand, setFilterBrand] = useState('')
  const [filterPeriodType, setFilterPeriodType] = useState('')
  const [filterYearMonth, setFilterYearMonth] = useState('')

  const [loading, setLoading] = useState(false)

  // Fetch tables on mount
  useEffect(() => {
    fetch('/api/data/tables')
      .then(r => r.json())
      .then(({ data }: { data: { tables: string[] } }) => {
        setTables(data.tables)
      })
      .catch(() => {})
  }, [])

  // Fetch meta for filter dropdowns
  useEffect(() => {
    fetch('/api/meta')
      .then(r => r.json())
      .then(({ data }: { data: { brands: string[]; period_types?: string[] } }) => {
        setBrands(data.brands ?? [])
        setPeriodTypes(data.period_types ?? [])
      })
      .catch(() => {})
  }, [])

  // When a table is selected, fetch schema + distinct year_months for region_metrics
  useEffect(() => {
    if (!selectedTable) return
    setSchema([])
    setRows([])
    setColumns([])
    setTotal(0)
    setPage(0)
    setFilterBrand('')
    setFilterPeriodType('')
    setFilterYearMonth('')

    fetch(`/api/data/${selectedTable}?schema=1`)
      .then(r => r.json())
      .then(({ data }: { data: { columns: PragmaColumn[] } }) => {
        setSchema(data.columns ?? [])
      })
      .catch(() => {})

    if (selectedTable === 'region_metrics') {
      // Fetch distinct year_months via a simple unfiltered request — we read them from the first page
      fetch(`/api/data/region_metrics?limit=500&offset=0`)
        .then(r => r.json())
        .then(({ data }: { data: { rows: Record<string, unknown>[] } }) => {
          const yms = Array.from(new Set((data.rows ?? []).map(r => String(r.year_month ?? '')))).sort()
          setYearMonths(yms)
        })
        .catch(() => {})
    }
  }, [selectedTable])

  // Fetch data whenever table, page, or filters change
  useEffect(() => {
    if (!selectedTable) return
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    })
    if (selectedTable === 'region_metrics') {
      if (filterBrand) params.set('brand', filterBrand)
      if (filterPeriodType) params.set('period_type', filterPeriodType)
      if (filterYearMonth) params.set('year_month', filterYearMonth)
    }
    fetch(`/api/data/${selectedTable}?${params}`)
      .then(r => r.json())
      .then(({ data }: { data: { rows: Record<string, unknown>[]; total: number; columns: string[] } }) => {
        let displayColumns = data.columns ?? []
        if (selectedTable === 'region_metrics') {
          displayColumns = REGION_METRICS_COLUMNS.filter(c => displayColumns.includes(c))
        }
        setRows(data.rows ?? [])
        setColumns(displayColumns)
        setTotal(data.total ?? 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedTable, page, filterBrand, filterPeriodType, filterYearMonth])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-[#e2e8f0] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[#e2e8f0]">
          <h2 className="font-semibold text-sm text-[#1a2030]">Tables</h2>
        </div>
        <div className="overflow-y-auto flex-1">
          {tables.length === 0 && (
            <p className="text-xs text-[#6b7280] px-4 py-3">Loading tables…</p>
          )}
          {tables.map(t => (
            <button
              key={t}
              onClick={() => setSelectedTable(t)}
              className={`w-full text-left px-4 py-3 border-b border-[#e2e8f0] hover:bg-[#f4f6f9] transition-colors ${selectedTable === t ? 'bg-blue-50 border-l-2 border-l-[#3b5bdb]' : ''}`}
            >
              <div className="font-medium text-xs text-[#1a2030] truncate">{t}</div>
              {t === 'region_metrics' && (
                <div className="text-xs text-[#6b7280] mt-0.5">227 regions × 6 brands × 30 months</div>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Main panel */}
      <div className="flex-1 overflow-y-auto">
        {!selectedTable ? (
          <div className="max-w-2xl mx-auto p-12">
            <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm p-8 text-center">
              <h2 className="font-semibold text-lg text-[#1a2030] mb-3">Explore the source database</h2>
              <p className="text-sm text-[#6b7280] leading-relaxed">
                Select a table from the left sidebar to browse its schema and data.
                This is a read-only view of <code className="bg-[#f4f6f9] px-1.5 py-0.5 rounded text-xs font-mono">metrics.db</code> — the raw data that powers all signals and findings.
              </p>
              <p className="text-xs text-[#6b7280] mt-4">
                Use the <strong>region_metrics</strong> table to filter by brand, period type, and year/month.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto p-6 space-y-6">
            {/* Schema card */}
            <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm">
              <div className="px-6 py-4 border-b border-[#e2e8f0]">
                <h2 className="font-semibold text-[#1a2030]">{selectedTable}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                      <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Column</th>
                      <th className="text-left px-4 py-2 font-medium text-[#6b7280]">Type</th>
                      <th className="text-center px-4 py-2 font-medium text-[#6b7280]">PK</th>
                      <th className="text-center px-4 py-2 font-medium text-[#6b7280]">NOT NULL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schema.map((col, i) => (
                      <tr key={col.cid} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                        <td className="px-4 py-1.5 font-mono text-[#1a2030]">{col.name}</td>
                        <td className="px-4 py-1.5 text-[#6b7280]">{col.type}</td>
                        <td className="px-4 py-1.5 text-center">{col.pk ? '✓' : ''}</td>
                        <td className="px-4 py-1.5 text-center">{col.notnull ? '✓' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Data browser card */}
            <div className="bg-white rounded-lg border border-[#e2e8f0] shadow-sm">
              <div className="px-6 py-4 border-b border-[#e2e8f0] flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {selectedTable === 'region_metrics' && (
                    <>
                      <select
                        value={filterBrand}
                        onChange={e => { setFilterBrand(e.target.value); setPage(0) }}
                        className="border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white"
                      >
                        <option value="">All brands</option>
                        {brands.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                      <select
                        value={filterPeriodType}
                        onChange={e => { setFilterPeriodType(e.target.value); setPage(0) }}
                        className="border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white"
                      >
                        <option value="">All period types</option>
                        {periodTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                      </select>
                      <select
                        value={filterYearMonth}
                        onChange={e => { setFilterYearMonth(e.target.value); setPage(0) }}
                        className="border border-[#e2e8f0] rounded px-2 py-1 text-xs bg-white"
                      >
                        <option value="">All months</option>
                        {yearMonths.map(ym => <option key={ym} value={ym}>{ym}</option>)}
                      </select>
                    </>
                  )}
                </div>
                <span className="text-xs text-[#6b7280]">
                  {loading ? 'Loading…' : `showing ${rows.length} of ${total.toLocaleString()}`}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                      {columns.map(col => (
                        <th key={col} className="text-left px-3 py-2 font-medium text-[#6b7280] whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                        {columns.map(col => (
                          <td key={col} className="px-3 py-1.5 text-[#1a2030] whitespace-nowrap" title={String(row[col] ?? '')}>
                            {truncate(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {rows.length === 0 && !loading && (
                      <tr>
                        <td colSpan={columns.length || 1} className="px-4 py-6 text-center text-[#6b7280]">
                          No rows found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-3 border-t border-[#e2e8f0] flex items-center gap-3">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 text-xs border border-[#e2e8f0] rounded hover:bg-[#f4f6f9] disabled:opacity-40"
                  >
                    ← Previous
                  </button>
                  <span className="text-xs text-[#6b7280]">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1 text-xs border border-[#e2e8f0] rounded hover:bg-[#f4f6f9] disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
