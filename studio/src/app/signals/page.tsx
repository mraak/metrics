import ReportFrame from '@/components/ReportFrame'

// The actual Signals readout — per-entity signal + strength + relevance,
// mounted from the schema.html report shell.
export default function SignalsPage() {
  return <ReportFrame panel="signals" />
}
