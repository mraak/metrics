import Database from 'better-sqlite3'
import path from 'path'

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
  // NOTE: ALL definitions (signals, finding definitions, insight templates)
  // live in ../knowledge_definitions.json — the version-controlled single
  // source of truth, read/written via knowledge-store.ts. This DB holds ONLY
  // the findings catalog: the append-only record of computed findings.
  db.exec(`
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

  migrateCatalog(db)
}

// The report's share×growth findings (formerly findings.py, persisted in
// metrics.db) now live in THIS catalog under finding_def_id 'fnd_share_growth',
// with the report columns added. One catalog, two writers (report pass +
// Finding Composer). Idempotent: ALTERs are guarded, copies are INSERT OR IGNORE.
function migrateCatalog(db: Database.Database): void {
  const cols = new Set((db.pragma('table_info(findings_catalog)') as { name: string }[]).map(c => c.name))
  const wanted: [string, string][] = [
    ['ms_now', 'REAL'], ['ms_sev', 'INTEGER'],
    ['growth_now', 'REAL'], ['growth_sev', 'INTEGER'],
    ['mat_rank', 'INTEGER'], ['market_share', 'REAL'],
    ['months_red', 'INTEGER DEFAULT 0'],
    ['escalate', 'INTEGER DEFAULT 0'], ['improved', 'INTEGER DEFAULT 0'],
  ]
  for (const [name, type] of wanted) {
    if (!cols.has(name)) db.exec(`ALTER TABLE findings_catalog ADD COLUMN ${name} ${type}`)
  }

  // One-time copy of the legacy Python-era catalog rows out of metrics.db.
  const legacy = metricsDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='findings_catalog'").get()
  if (!legacy) return
  const rows = metricsDb().prepare('SELECT * FROM findings_catalog').all() as Record<string, unknown>[]
  if (!rows.length) return
  const ins = db.prepare(`
    INSERT OR IGNORE INTO findings_catalog
      (finding_def_id, brand_name, region_name, territory_name, year_month,
       recorded_at, finding_key, severity_band, severity_score,
       ms_now, ms_sev, growth_now, growth_sev, mat_rank, market_share,
       months_red, escalate, improved, axes_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)
  const tx = db.transaction(() => {
    for (const r of rows) {
      ins.run(
        'fnd_share_growth', r.brand_name, r.region_name, r.territory_name, r.year_month,
        r.recorded_at, r.finding, r.severity_band, r.severity_score,
        r.ms_now, r.ms_sev, r.growth_now, r.growth_sev, r.mat_rank, r.market_share,
        r.months_red, r.escalate, r.improved, r.provenance)
    }
  })
  tx()
}
