import { toolDb, parseFindingRow } from '@/lib/db'
import { readAllSignals } from '@/lib/knowledge-store'
import FindingComposer from '@/components/FindingComposer'

export const dynamic = 'force-dynamic'

export default function FindingsPage() {
  const db = toolDb()

  const initialSignals = readAllSignals()

  const findingRows = db.prepare('SELECT * FROM finding_definitions ORDER BY created_at').all()
  const initialFindings = findingRows.map(r => parseFindingRow(r as Parameters<typeof parseFindingRow>[0]))

  return <FindingComposer initialFindings={initialFindings} initialSignals={initialSignals} />
}
