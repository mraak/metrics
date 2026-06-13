import { loadKnowledge } from '@/lib/knowledge-store'
import KnowledgeViewer from '@/components/KnowledgeViewer'

// The whole knowledge_definitions.json, browsable. Loaded server-side (the
// file IS the single source of truth) and rendered as a searchable tree.
export const dynamic = 'force-dynamic'

export default function KnowledgePage() {
  const data = loadKnowledge()
  return (
    <KnowledgeViewer
      data={data}
      version={data.version as string | undefined}
      updated={data.updated as string | undefined}
    />
  )
}
