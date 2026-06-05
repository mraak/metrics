import { toolDb, parseSignalRow, parseFindingRow } from '@/lib/db'
import FindingComposer from '@/components/FindingComposer'

export const dynamic = 'force-dynamic'

export default function FindingsPage() {
  const db = toolDb()

  const signalRows = db.prepare('SELECT * FROM signal_definitions ORDER BY created_at').all()
  const initialSignals = signalRows.map(r => parseSignalRow(r as Parameters<typeof parseSignalRow>[0]))

  const findingRows = db.prepare('SELECT * FROM finding_definitions ORDER BY created_at').all()
  const initialFindings = findingRows.map(r => parseFindingRow(r as Parameters<typeof parseFindingRow>[0]))

  return <FindingComposer initialFindings={initialFindings} initialSignals={initialSignals} />
}
