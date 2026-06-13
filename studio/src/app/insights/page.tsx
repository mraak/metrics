import ReportFrame from '@/components/ReportFrame'

// The actual Insights readout — per-persona reports (Sales Manager / Rep / CEO),
// mounted from the schema.html report shell.
export default function InsightsPage() {
  return <ReportFrame panel="insights" />
}
