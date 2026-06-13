import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'SQL-Metrics Studio',
  description: 'Pharma regional sales analytics studio',
}

const navLinks = [
  { href: '/data', label: 'Data' },
  { href: '/signals', label: 'Signals' },
  { href: '/findings', label: 'Findings' },
  { href: '/insights', label: 'Insights' },
  { href: '/schema.html', label: 'Report' },   // the merged report app (static page + /api/report/*)
  { href: '/docs/signals.html', label: 'Docs' },
]

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-[#1a2030] text-white px-6 py-0 flex items-center gap-8 h-14 shadow-md">
          <span className="font-semibold text-base tracking-tight whitespace-nowrap text-white/90 mr-4">
            SQL-Metrics Studio
          </span>
          {navLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-white/70 hover:text-white transition-colors py-4 border-b-2 border-transparent hover:border-white/40"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <main className="min-h-[calc(100vh-3.5rem)] bg-[#f4f6f9]">
          {children}
        </main>
      </body>
    </html>
  )
}
