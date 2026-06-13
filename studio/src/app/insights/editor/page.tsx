import { readAllSignals, readAllFindingDefs, readAllFramings } from '@/lib/knowledge-store'
import InsightFramer from '@/components/InsightFramer'

export const dynamic = 'force-dynamic'

export default function InsightsEditorPage() {
  return (
    <InsightFramer
      initialFramings={readAllFramings()}
      initialFindings={readAllFindingDefs()}
      initialSignals={readAllSignals()}
    />
  )
}
