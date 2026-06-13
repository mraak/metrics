import ReportFrame from '@/components/ReportFrame'

// Data & Metrics: the schema diagram + metrics catalog + clickable table data,
// mounted from the schema.html report shell.
export default function DataPage() {
  return <ReportFrame panel="schema" />
}
