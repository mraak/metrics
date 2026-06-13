import { readAllSignals, readAllFindingDefs } from '@/lib/knowledge-store'
import FindingComposer from '@/components/FindingComposer'

export const dynamic = 'force-dynamic'

export default function FindingsPage() {
  return <FindingComposer initialFindings={readAllFindingDefs()} initialSignals={readAllSignals()} />
}
