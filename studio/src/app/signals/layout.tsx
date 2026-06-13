import SubNav from '@/components/SubNav'

// Signals section: the analytical readout (report) is primary; the Signal
// Editor (definition tool) is a sub-tab.
export default function SignalsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <SubNav items={[
        { href: '/signals', label: '📈 Signals' },
        { href: '/signals/editor', label: '✎ Signal Editor' },
      ]} />
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
