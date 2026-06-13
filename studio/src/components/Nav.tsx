'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// One navigation for the whole Insights Studio. Tab styling mirrors the
// schema.html report shell (white bar, blue active underline) so the mounted
// report panels and the React editors read as a single app.
const tabs = [
  { href: '/data', label: '🗂 Data & Metrics' },
  { href: '/signals', label: '📈 Signals' },
  { href: '/analysis', label: '📊 Signal Analysis' },
  { href: '/findings', label: '🔎 Findings' },
  { href: '/insights', label: '💡 Insights' },
  { href: '/knowledge', label: '🧠 Knowledge' },
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <header className="flex-shrink-0">
      {/* Header bar */}
      <div className="flex items-baseline gap-3 px-5 py-3 bg-white border-b border-[#e0e0e0]">
        <h1 className="text-[19px] font-bold text-[#1a2030] tracking-tight">Insights Studio</h1>
        <span className="text-[12px] text-[#888]">Pharma regional analytics · metrics.db · SQLite</span>
        <a
          href="/docs/signals.html"
          className="ml-auto text-[12px] text-[#888] hover:text-[#2266aa] transition-colors"
        >
          📖 Docs
        </a>
      </div>
      {/* Tab bar */}
      <nav className="flex gap-0.5 px-5 bg-white border-b border-[#e0e0e0]">
        {tabs.map(t => {
          const active = pathname === t.href || pathname.startsWith(t.href + '/')
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                'px-4 py-[11px] text-[13px] font-semibold border-b-2 transition-colors ' +
                (active
                  ? 'text-[#2266aa] border-[#2266aa]'
                  : 'text-[#888] border-transparent hover:text-[#333]')
              }
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
