'use client'

// Mounts a single panel of the schema.html report shell (the better-looking
// vanilla report) inside the Next.js app. The page reads ?panel=<tab>, hides
// its own header + tabs (body.embed), and shows just that panel — so the
// Insights Studio nav stays the single navigation.
export default function ReportFrame({ panel }: { panel: 'schema' | 'sigan' | 'signals' | 'findings' | 'insights' }) {
  return (
    <iframe
      src={`/schema.html?panel=${panel}`}
      title={panel}
      className="w-full h-full border-0 block"
    />
  )
}
