import type { InsightFraming, FindingRow } from './types'

function buildVarMap(row: FindingRow): Record<string, string> {
  const vars: Record<string, string> = {
    region: row.region,
    territory: row.territory,
    rank: String(row.mat_rank),
    finding: row.finding_key,
    finding_label: row.finding_label,
    severity_band: row.severity.band,
    severity_score: String(row.severity.score),
    months_red: '0', // placeholder
  }

  for (const [axisName, axisResult] of Object.entries(row.axes)) {
    const oldest = axisResult.series.length > 0 ? axisResult.series[0] : axisResult.now
    vars[`${axisName}_now`] = String(Math.round(axisResult.now * 100) / 100)
    vars[`${axisName}_oldest`] = String(Math.round(oldest * 100) / 100)
    vars[`${axisName}_net`] = String(Math.round(axisResult.strength.net * 100) / 100)
    vars[`${axisName}_coherence`] = String(Math.round(axisResult.strength.coherence * 100) / 100)
    vars[`${axisName}_shape`] = axisResult.strength.shape
    vars[`${axisName}_magnitude`] = String(Math.round(axisResult.strength.magnitude * 100) / 100)
  }

  return vars
}

function substituteTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, varName: string) => {
    const key = varName.trim()
    if (key in vars) {
      return vars[key]
    }
    console.warn(`[insight-engine] Unknown template variable: {{${key}}}`)
    return `{{UNKNOWN:${key}}}`
  })
}

export function renderInsight(framing: InsightFraming, row: FindingRow): string {
  const vars = buildVarMap(row)

  if (framing.mode === 'template') {
    return substituteTemplate(framing.template, vars)
  }

  // LLM mode: substitute vars into prompts but return stub
  const _system = substituteTemplate(framing.llm_system, vars)
  const _user = substituteTemplate(framing.llm_user, vars)
  return `[LLM mode: configure ANTHROPIC_API_KEY to enable. Prompt prepared with ${Object.keys(vars).length} variables.]`
}
