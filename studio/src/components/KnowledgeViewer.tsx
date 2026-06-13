'use client'

// KnowledgeViewer — renders the ENTIRE knowledge_definitions.json as a
// collapsible, searchable tree with a section sidebar. This is the single
// source of truth for all Tier 3-5 definitions, so the whole file is browsable
// here (read-only view; the per-section editors do the writing).
import { useMemo, useState } from 'react'

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

const isContainer = (v: JsonValue): v is JsonValue[] | { [k: string]: JsonValue } =>
  v !== null && typeof v === 'object'

const entriesOf = (v: JsonValue[] | { [k: string]: JsonValue }): [string, JsonValue][] =>
  Array.isArray(v) ? v.map((x, i) => [String(i), x] as [string, JsonValue]) : Object.entries(v)

const isDocKey = (k: string) => k.startsWith('_')

function collectContainerPaths(value: JsonValue, path: string, acc: string[]): void {
  if (!isContainer(value)) return
  if (path) acc.push(path)
  for (const [k, v] of entriesOf(value)) collectContainerPaths(v, path ? `${path}.${k}` : k, acc)
}

// True if this key OR anything in its subtree contains the (lowercased) query.
function subtreeMatches(key: string, value: JsonValue, q: string): boolean {
  if (key.toLowerCase().includes(q)) return true
  if (!isContainer(value)) return String(value).toLowerCase().includes(q)
  return entriesOf(value).some(([k, v]) => subtreeMatches(k, v, q))
}

// A node matches "directly" when its own key, or its own scalar value, hits the
// query (not via a descendant). When an OBJECT has a direct hit on one field we
// show ALL its fields — so a matched record reads in full with its context,
// rather than just the one leaf that matched.
function directMatch(key: string, value: JsonValue, q: string): boolean {
  if (key.toLowerCase().includes(q)) return true
  return !isContainer(value) && String(value).toLowerCase().includes(q)
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-yellow-200 text-inherit rounded-sm px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

function Scalar({ value }: { value: JsonValue }) {
  if (typeof value === 'string') return <span className="text-[#1a7f37]">{`"${value}"`}</span>
  if (typeof value === 'number') return <span className="text-[#b5651d]">{value}</span>
  if (typeof value === 'boolean') return <span className="text-[#8b3fb0]">{String(value)}</span>
  return <span className="text-[#999] italic">null</span>
}

function Node({
  k, value, path, depth, expanded, toggle, q, forceShow = false,
}: {
  k: string
  value: JsonValue
  path: string
  depth: number
  expanded: Set<string>
  toggle: (p: string) => void
  q: string
  forceShow?: boolean
}) {
  // While searching, prune non-matching branches — unless an ancestor record
  // matched directly (forceShow), in which case we keep the field for context.
  if (q && !forceShow && !subtreeMatches(k, value, q)) return null

  const keyEl = <span className="font-semibold text-[#1a2030]"><Highlight text={k} q={q} /></span>

  if (!isContainer(value)) {
    // Doc keys (_about / _note / …) hold long prose — render unquoted + wrapped.
    if (isDocKey(k) && typeof value === 'string') {
      return (
        <div className="py-1 pl-[18px]" style={{ marginLeft: depth * 14 }}>
          <div className="text-[11px] uppercase tracking-wide text-[#aaa] font-semibold">{k}</div>
          <div className="text-[12.5px] leading-relaxed text-[#667] italic max-w-[78ch]">
            <Highlight text={value} q={q} />
          </div>
        </div>
      )
    }
    return (
      <div className="py-[2px] leading-snug" style={{ marginLeft: depth * 14 }}>
        <span className="inline-block w-[18px]" />
        {keyEl}
        <span className="text-[#bbb]">: </span>
        {typeof value === 'string'
          ? <span className="text-[#1a7f37]">&quot;<Highlight text={value} q={q} />&quot;</span>
          : <Scalar value={value} />}
      </div>
    )
  }

  const open = !!q || expanded.has(path)
  const items = entriesOf(value)
  const isArr = Array.isArray(value)
  const count = items.length
  const summary = isArr ? `[${count}]` : `{${count}}`
  // Objects with a direct field hit show all fields (full record). Arrays never
  // force — so only the matching element(s) of a list appear.
  const forceChildren = !!q && !isArr && items.some(([ck, cv]) => directMatch(ck, cv, q))

  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div
        className="py-[2px] leading-snug cursor-pointer hover:bg-[#eef2f7] rounded select-none"
        onClick={() => toggle(path)}
      >
        <span className="inline-block w-[18px] text-[#2266aa] text-center">{open ? '▾' : '▸'}</span>
        {keyEl}
        <span className="text-[#bbb] ml-1">{summary}</span>
      </div>
      {open && (
        <div className="border-l border-[#eaecef] ml-[8px]">
          {items.map(([ck, cv]) => (
            <Node
              key={ck}
              k={ck}
              value={cv}
              path={path ? `${path}.${ck}` : ck}
              depth={1}
              expanded={expanded}
              toggle={toggle}
              q={q}
              forceShow={forceChildren}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function KnowledgeViewer({ data, version, updated }: { data: unknown; version?: string; updated?: string }) {
  const root = data as JsonValue
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const topKeys = isContainer(root) ? entriesOf(root).map(([k]) => k) : []
  const allPaths = useMemo(() => {
    const acc: string[] = []
    collectContainerPaths(root, '', acc)
    return acc
  }, [root])

  const toggle = (p: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const jump = (k: string) => {
    setExpanded(prev => new Set(prev).add(k))
    requestAnimationFrame(() => document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const matchCount = q && isContainer(root)
    ? entriesOf(root).filter(([k, v]) => subtreeMatches(k, v, q)).length
    : 0

  return (
    <div className="h-full flex">
      {/* Sidebar: top-level sections */}
      <aside className="w-[210px] flex-shrink-0 border-r border-[#e0e0e0] bg-white overflow-auto py-3">
        <div className="px-4 pb-2 text-[11px] uppercase tracking-wide text-[#aaa] font-semibold">Sections</div>
        {topKeys.filter(k => !isDocKey(k)).map(k => {
          const v = (root as { [key: string]: JsonValue })[k]
          const n = isContainer(v) ? entriesOf(v).filter(([ck]) => !isDocKey(ck)).length : null
          return (
            <button
              key={k}
              onClick={() => jump(k)}
              className="w-full text-left px-4 py-1.5 text-[13px] text-[#445] hover:bg-[#eef2f7] hover:text-[#2266aa] transition-colors flex items-center justify-between gap-2"
            >
              <span className="font-medium truncate">{k}</span>
              {n != null && <span className="text-[11px] text-[#bbb]">{n}</span>}
            </button>
          )
        })}
      </aside>

      {/* Main: toolbar + tree */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 px-5 py-2.5 bg-white border-b border-[#e0e0e0]">
          <span className="text-[13px] font-semibold text-[#1a2030]">knowledge_definitions.json</span>
          {version && <span className="text-[11px] text-[#999]">v{version}{updated ? ` · ${updated}` : ''}</span>}
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search keys & values…"
            className="ml-auto w-[280px] px-3 py-1.5 text-[13px] border border-[#dfe3e8] rounded-md focus:outline-none focus:border-[#2266aa]"
          />
          {q
            ? <span className="text-[11px] text-[#888] whitespace-nowrap">{matchCount} section{matchCount === 1 ? '' : 's'}</span>
            : (
              <div className="flex gap-1">
                <button onClick={() => setExpanded(new Set(allPaths))}
                  className="px-2.5 py-1.5 text-[12px] text-[#445] border border-[#dfe3e8] rounded-md hover:bg-[#eef2f7]">Expand all</button>
                <button onClick={() => setExpanded(new Set())}
                  className="px-2.5 py-1.5 text-[12px] text-[#445] border border-[#dfe3e8] rounded-md hover:bg-[#eef2f7]">Collapse all</button>
              </div>
            )}
        </div>

        <div className="flex-1 overflow-auto p-5 font-mono text-[12.5px]">
          {isContainer(root) && entriesOf(root).map(([k, v]) => (
            <div key={k} id={`sec-${k}`} className="mb-1 scroll-mt-3">
              <Node k={k} value={v} path={k} depth={0} expanded={expanded} toggle={toggle} q={q} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
