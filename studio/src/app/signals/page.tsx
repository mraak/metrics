import { readAllSignals } from '@/lib/knowledge-store'
import SignalStudio from '@/components/SignalStudio'

export const dynamic = 'force-dynamic'

export default function SignalsPage() {
  const initialSignals = readAllSignals()
  return <SignalStudio initialSignals={initialSignals} />
}
