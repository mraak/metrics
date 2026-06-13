import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Insights Studio',
  description: 'Pharma regional sales analytics studio',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="h-screen flex flex-col overflow-hidden">
        <Nav />
        <main className="flex-1 min-h-0 overflow-auto bg-[#f5f7fa]">
          {children}
        </main>
      </body>
    </html>
  )
}
