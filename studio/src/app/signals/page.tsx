import { toolDb, parseSignalRow } from '@/lib/db'
import SignalStudio from '@/components/SignalStudio'

export const dynamic = 'force-dynamic'

export default function SignalsPage() {
  const db = toolDb()
  const rows = db.prepare('SELECT * FROM signal_definitions ORDER BY created_at').all()
  const initialSignals = rows.map(r => parseSignalRow(r as Parameters<typeof parseSignalRow>[0]))

  return <SignalStudio initialSignals={initialSignals} />
}
