import { readAllSignals } from '@/lib/knowledge-store'
import SignalStudio from '@/components/SignalStudio'

export const dynamic = 'force-dynamic'

export default function SignalEditorPage() {
  return <SignalStudio initialSignals={readAllSignals()} />
}
