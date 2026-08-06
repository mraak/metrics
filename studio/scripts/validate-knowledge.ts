// validate-knowledge.ts — CLI replacement for `python3 knowledge.py`:
// validates knowledge_definitions.json against the live schema — Postgres if
// DATABASE_URL is set, else the local metrics.db (see README-DEPLOY.md).
// Run: npm run validate   ·   compile a signal: npm run validate -- --signal <id>
import { tableColumns } from '../src/lib/db'
import {
  knowledgeDefs, signalTemplates, sourceTable, level, validateKnowledge, compileSignalSql,
} from '../src/lib/knowledge'

async function main() {
  const defs = knowledgeDefs()
  const signals = signalTemplates(defs)

  const sigArg = process.argv.indexOf('--signal')
  if (sigArg >= 0) {
    const id = process.argv[sigArg + 1]
    const sig = signals[id]
    if (!sig) {
      console.error(`No such signal template: ${id}`)
      process.exit(2)
    }
    console.log(compileSignalSql(sig))
    process.exit(0)
  }

  const colsByTable: Record<string, Set<string>> = {}
  for (const s of Object.values(signals)) {
    const t = sourceTable(s)
    if (!(t in colsByTable)) colsByTable[t] = await tableColumns(t)
  }

  console.log(`Knowledge Definitions v${defs.version} (updated ${defs.updated})`)
  console.log(`\n  Signal templates (${Object.keys(signals).length}):`)
  for (const [k, s] of Object.entries(signals)) {
    const lvl = level(s) !== 'region' ? `  [${level(s)}]` : ''
    const cache = s.cached_as ? `  [cached: ${s.cached_as}]` : ''
    console.log(`    - ${k}: ${s.metric} @ ${s.period_type} lags=[${s.lags}] -> ${s.readout}${lvl}${cache}`)
  }
  const fdefs = Object.keys((defs.finding_definitions as object) ?? {}).filter(k => !k.startsWith('_'))
  const frms = Object.keys((defs.insight_templates as object) ?? {}).filter(k => !k.startsWith('_'))
  console.log(`\n  Finding definitions (${fdefs.length}): ${fdefs.join(', ')}`)
  console.log(`  Insight templates (${frms.length}): ${frms.join(', ')}`)

  const problems = validateKnowledge(defs, colsByTable)
  console.log()
  if (problems.length) {
    console.log(`VALIDATION FAILED (${problems.length} problem(s)):`)
    for (const p of problems) console.log(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log('VALIDATION PASSED ✓  (all signals map to real columns; all recipes reference defined signals)')
  process.exit(0)
}

main()
