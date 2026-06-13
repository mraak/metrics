import SubNav from '@/components/SubNav'

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <SubNav items={[
        { href: '/insights', label: '💡 Insights' },
        { href: '/insights/editor', label: '✎ Insights Editor' },
      ]} />
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
