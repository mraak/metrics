import { toolDb, parseFramingRow, parseFindingRow } from '@/lib/db'
import { readAllSignals } from '@/lib/knowledge-store'
import InsightFramer from '@/components/InsightFramer'

export const dynamic = 'force-dynamic'

export default function InsightsPage() {
  const db = toolDb()

  const framingRows = db.prepare('SELECT * FROM insight_framings ORDER BY persona, finding_key').all()
  const initialFramings = framingRows.map(r => parseFramingRow(r as Parameters<typeof parseFramingRow>[0]))

  const findingRows = db.prepare('SELECT * FROM finding_definitions ORDER BY created_at').all()
  const initialFindings = findingRows.map(r => parseFindingRow(r as Parameters<typeof parseFindingRow>[0]))

  const initialSignals = readAllSignals()

  return (
    <InsightFramer
      initialFramings={initialFramings}
      initialFindings={initialFindings}
      initialSignals={initialSignals}
    />
  )
}
