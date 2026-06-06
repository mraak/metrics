import Database from 'better-sqlite3'
import path from 'path'
import type { SignalDefinition, FindingDefinition, InsightFraming } from './types'

// ─── Metrics DB (read-only) ────────────────────────────────────────────────

let _metricsDb: Database.Database | null = null

export function metricsDb(): Database.Database {
  if (!_metricsDb) {
    const dbPath = path.join(process.cwd(), '..', 'metrics.db')
    _metricsDb = new Database(dbPath, { readonly: true })
    // Do NOT set journal_mode on a readonly database — it requires write access
  }
  return _metricsDb
}

// ─── Tool DB (read-write, singleton) ──────────────────────────────────────

let _toolDb: Database.Database | null = null

export function toolDb(): Database.Database {
  if (!_toolDb) {
    const dbPath = path.join(process.cwd(), 'studio.db')
    _toolDb = new Database(dbPath)
    _toolDb.pragma('journal_mode = WAL')
    _toolDb.pragma('foreign_keys = ON')
    initToolDb(_toolDb)
  }
  return _toolDb
}

function initToolDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      source_table TEXT NOT NULL DEFAULT 'region_metrics',
      entity_dimension TEXT NOT NULL DEFAULT 'region_name',
      time_dimension TEXT NOT NULL DEFAULT 'year_month',
      filters TEXT NOT NULL DEFAULT '[]',
      segment_by TEXT NOT NULL DEFAULT '[]',
      metric TEXT NOT NULL,
      lags TEXT NOT NULL,
      delta_lags TEXT NOT NULL,
      direction TEXT NOT NULL,
      strength_kind TEXT NOT NULL,
      loud_threshold REAL NOT NULL DEFAULT 2.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS finding_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      axes TEXT NOT NULL,
      classifications TEXT NOT NULL,
      severity TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS insight_framings (
      id TEXT PRIMARY KEY,
      persona TEXT NOT NULL,
      finding_key TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'template',
      template TEXT NOT NULL DEFAULT '',
      llm_system TEXT NOT NULL DEFAULT '',
      llm_user TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
      surface_conditions TEXT NOT NULL DEFAULT '[]',
      suppress_conditions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(persona, finding_key)
    );

    CREATE TABLE IF NOT EXISTS findings_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_def_id TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      region_name TEXT NOT NULL,
      territory_name TEXT NOT NULL,
      year_month TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      finding_key TEXT NOT NULL,
      severity_band TEXT NOT NULL,
      severity_score INTEGER NOT NULL,
      axes_snapshot TEXT NOT NULL,
      UNIQUE(finding_def_id, brand_name, region_name, year_month)
    );
  `)

  // Migrate: add new generic columns to signal_definitions if they don't exist yet
  // (SQLite ALTER TABLE ADD COLUMN is idempotent on the column-exists check via try/catch)
  const existingCols = new Set(
    (db.pragma('table_info(signal_definitions)') as { name: string }[]).map(r => r.name)
  )
  const newCols: [string, string][] = [
    ['source_table',     "TEXT NOT NULL DEFAULT 'region_metrics'"],
    ['entity_dimension', "TEXT NOT NULL DEFAULT 'region_name'"],
    ['time_dimension',   "TEXT NOT NULL DEFAULT 'year_month'"],
    ['filters',          "TEXT NOT NULL DEFAULT '[]'"],
    ['segment_by',       "TEXT NOT NULL DEFAULT '[]'"],
  ]
  for (const [col, def] of newCols) {
    if (!existingCols.has(col)) {
      db.exec(`ALTER TABLE signal_definitions ADD COLUMN ${col} ${def}`)
    }
  }

  // Migrate existing rows: move period_type column value into filters[],
  // add brand_name to segment_by. Uses the still-present legacy period_type column.
  const legacyRows = db.prepare(
    `SELECT id, period_type, filters, segment_by FROM signal_definitions
     WHERE source_table = 'region_metrics'`
  ).all() as { id: string; period_type: string | null; filters: string; segment_by: string }[]

  for (const row of legacyRows) {
    const filters = JSON.parse(row.filters ?? '[]') as unknown[]
    const segBy = JSON.parse(row.segment_by ?? '[]') as string[]
    // Add period_type filter if period_type existed and no period_type filter yet
    const hasPTFilter = filters.some((f: unknown) => (f as {column:string}).column === 'period_type')
    const newFilters = [...filters]
    if (!hasPTFilter && row.period_type) {
      newFilters.push({ column: 'period_type', operator: '=', value: row.period_type })
    }
    const newSegBy = segBy.includes('brand_name') ? segBy : ['brand_name', ...segBy]
    db.prepare('UPDATE signal_definitions SET filters=?, segment_by=? WHERE id=?')
      .run(JSON.stringify(newFilters), JSON.stringify(newSegBy), row.id)
  }

  // Seed default data if empty
  const signalCount = (db.prepare('SELECT COUNT(*) as c FROM signal_definitions').get() as { c: number }).c
  if (signalCount === 0) {
    seedDefaults(db)
  }
}

function seedDefaults(db: Database.Database): void {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

  const sigCols = `id, name, label, source_table, entity_dimension, time_dimension,
    filters, segment_by, metric, lags, delta_lags, direction, strength_kind, loud_threshold,
    created_at, updated_at`
  const sigPlaceholders = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`

  // Signal 1: market share deviation — generic, no period_type hardcoded (use a filter)
  db.prepare(`INSERT INTO signal_definitions (${sigCols}) VALUES (${sigPlaceholders})`).run(
    'sig_mshare_dev_mat',
    'mshare_dev_mat_step_1m_3m',
    'Market Share Deviation (MAT, −1m/−3m)',
    'region_metrics',
    'region_name',
    'year_month',
    JSON.stringify([{ column: 'period_type', operator: '=', value: 'MAT' }]),
    JSON.stringify(['brand_name']),
    'mshare_deviation',
    JSON.stringify([0, 1, 2, 3]),
    JSON.stringify([1, 3]),
    'higher_is_better',
    'position',
    2.0,
    now, now
  )

  // Signal 2: growth deviation
  db.prepare(`INSERT INTO signal_definitions (${sigCols}) VALUES (${sigPlaceholders})`).run(
    'sig_growth_dev_mat',
    'growth_deviation_mat_step_1m_3m',
    'Growth Deviation (MAT, −1m/−3m)',
    'region_metrics',
    'region_name',
    'year_month',
    JSON.stringify([{ column: 'period_type', operator: '=', value: 'MAT' }]),
    JSON.stringify(['brand_name']),
    'growth_deviation',
    JSON.stringify([0, 1, 2, 3]),
    JSON.stringify([1, 3]),
    'higher_is_better',
    'growth',
    10.0,
    now, now
  )

  // Finding 1: share × growth quadrant
  const axes = [
    { name: 'share', signal_id: 'sig_mshare_dev_mat', good_direction: 'positive', threshold: 0 },
    { name: 'growth', signal_id: 'sig_growth_dev_mat', good_direction: 'positive', threshold: 0 },
  ]
  const classifications = [
    { key: 'losing_both', label: 'Losing on both', conditions: [{ axis: 'share', side: 'bad' }, { axis: 'growth', side: 'bad' }] },
    { key: 'slipping', label: 'Slipping', conditions: [{ axis: 'share', side: 'good' }, { axis: 'growth', side: 'bad' }] },
    { key: 'catching_up', label: 'Catching up', conditions: [{ axis: 'share', side: 'bad' }, { axis: 'growth', side: 'good' }] },
    { key: 'star', label: 'Star', conditions: [{ axis: 'share', side: 'good' }, { axis: 'growth', side: 'good' }] },
  ]
  const severity = { deterioration_delta: 0.3, bands: { critical: 5, high: 3, moderate: 2 } }

  db.prepare(`
    INSERT INTO finding_definitions (id, name, label, axes, classifications, severity, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'fnd_share_growth',
    'share_growth_quadrant',
    'Share × Growth Quadrant',
    JSON.stringify(axes),
    JSON.stringify(classifications),
    JSON.stringify(severity),
    now, now
  )

  // Insight framings for sales_manager
  const framings = [
    {
      id: 'frm_sm_losing_both',
      persona: 'sales_manager',
      finding_key: 'losing_both',
      template: '{{region}} (rank {{rank}}) — losing on both: {{share_now}}pp below peers on share (was {{share_oldest}}pp 3m ago, ρ={{share_coherence}} {{share_shape}}), and under-growing by {{growth_now}}pp (was {{growth_oldest}}pp). Severity: {{severity_band}} ({{severity_score}}/6).',
    },
    {
      id: 'frm_sm_slipping',
      persona: 'sales_manager',
      finding_key: 'slipping',
      template: '{{region}} (rank {{rank}}) — slipping: ahead on share (+{{share_now}}pp) but under-growing ({{growth_now}}pp, {{growth_shape}} ρ={{growth_coherence}}). Worth watching.',
    },
    {
      id: 'frm_sm_catching_up',
      persona: 'sales_manager',
      finding_key: 'catching_up',
      template: '{{region}} (rank {{rank}}) — catching up: below on share ({{share_now}}pp) but out-growing peers (+{{growth_now}}pp, ρ={{growth_coherence}}). Positive momentum.',
    },
    {
      id: 'frm_sm_star',
      persona: 'sales_manager',
      finding_key: 'star',
      template: '{{region}} (rank {{rank}}) — star: +{{share_now}}pp on share, +{{growth_now}}pp on growth. Both trending well (share ρ={{share_coherence}}, growth ρ={{growth_coherence}}).',
    },
  ]

  const insertFraming = db.prepare(`
    INSERT INTO insight_framings (id, persona, finding_key, mode, template, llm_system, llm_user, model, surface_conditions, suppress_conditions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const f of framings) {
    insertFraming.run(
      f.id, f.persona, f.finding_key,
      'template', f.template, '', '',
      'claude-haiku-4-5',
      '[]', '[]',
      now, now
    )
  }
}

// ─── Row serialization helpers ─────────────────────────────────────────────

// parseSignalRow kept for any legacy callers; prefer deserializeSignal from signal-engine
export function parseSignalRow(row: Record<string, unknown>): SignalDefinition {
  const { deserializeSignal } = require('./signal-engine') as typeof import('./signal-engine')
  return deserializeSignal(row)
}

type RawFindingRow = {
  id: string
  name: string
  label: string
  axes: string
  classifications: string
  severity: string
  created_at: string
  updated_at: string
}

export function parseFindingRow(row: RawFindingRow): FindingDefinition {
  return {
    ...row,
    axes: JSON.parse(row.axes),
    classifications: JSON.parse(row.classifications),
    severity: JSON.parse(row.severity),
  }
}

type RawFramingRow = {
  id: string
  persona: string
  finding_key: string
  mode: string
  template: string
  llm_system: string
  llm_user: string
  model: string
  surface_conditions: string
  suppress_conditions: string
  created_at: string
  updated_at: string
}

export function parseFramingRow(row: RawFramingRow): InsightFraming {
  return {
    ...row,
    mode: row.mode as InsightFraming['mode'],
    surface_conditions: JSON.parse(row.surface_conditions),
    suppress_conditions: JSON.parse(row.suppress_conditions),
  }
}
