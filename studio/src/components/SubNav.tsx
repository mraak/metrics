'use client'

// Secondary tab bar for sections that have both a report VIEW (the analytical
// readout, mounted from schema.html) and an EDITOR (the React definition tool).
// The view stays the primary landing; the editor is one sub-tab over.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function SubNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname()
  return (
    <div className="flex-shrink-0 flex gap-0.5 px-5 bg-[#fafbfc] border-b border-[#e0e0e0]">
      {items.map(it => {
        const active = pathname === it.href
        return (
          <Link
            key={it.href}
            href={it.href}
            className={
              'px-3.5 py-2 text-[12.5px] font-medium border-b-2 transition-colors ' +
              (active
                ? 'text-[#2266aa] border-[#2266aa]'
                : 'text-[#888] border-transparent hover:text-[#333]')
            }
          >
            {it.label}
          </Link>
        )
      })}
    </div>
  )
}
