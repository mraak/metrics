import SubNav from '@/components/SubNav'

export default function FindingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <SubNav items={[
        { href: '/findings', label: '🔎 Findings' },
        { href: '/findings/editor', label: '✎ Findings Editor' },
      ]} />
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
