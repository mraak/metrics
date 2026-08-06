import { Pool, types, type PoolClient } from 'pg'
import path from 'path'

// node-postgres returns BIGINT/NUMERIC as strings by default (they can exceed
// JS's safe integer range). This codebase does plain arithmetic on COUNT(*),
// SUM(), and money/measure columns everywhere, so parse them back to numbers
// — same behavior callers already got from better-sqlite3.
types.setTypeParser(20 /* int8   */, (v) => parseInt(v, 10))
types.setTypeParser(1700 /* numeric */, (v) => parseFloat(v))

// ─── Driver selection ───────────────────────────────────────────────────────
// DATABASE_URL set  -> Postgres/RDS (deployed). Both logical stores (the
//   read-mostly analytics tables AND the findings catalog) live as plain
//   tables in one Postgres schema.
// DATABASE_URL unset -> SQLite, exactly like before this ever touched
//   Postgres: metrics.db (read-only) + studio/studio.db (read-write). This
//   keeps local dev zero-config — just have those two files and run
//   `npm run dev`, no database to stand up.
//
// better-sqlite3 is an optionalDependency (package.json) and only ever
// dynamically import()'d from inside the sqlite branch below, at runtime,
// only when that branch actually runs — so it's never touched when
// DATABASE_URL is set. The deployed (Postgres) Docker image installs with
// `npm ci --omit=optional` and never needs that native module at all. See
// README-DEPLOY.md.
export function dbDriver(): 'sqlite' | 'postgres' {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite'
}

// Interface both drivers implement, mirroring the slice of better-sqlite3's
// chainable Statement API this codebase uses (.all / .get / .run) — the
// Postgres implementation is just this same shape wrapped around network
// calls, so callers only ever needed `await` added when this was ported.
interface StmtLike {
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>
  run(...params: unknown[]): Promise<{ changes: number }>
}

export interface DbLike {
  prepare(sql: string): StmtLike
  exec(sql: string): Promise<void>
  transaction<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R): (...args: A) => Promise<R>
}

// ─── Postgres ───────────────────────────────────────────────────────────────

let _pool: Pool | null = null

function pgPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    })
  }
  return _pool
}

// better-sqlite3-style '?' placeholders -> Postgres '$1, $2, ...' — lets the
// query text at every call site stay exactly as it was written for SQLite.
function toPgSql(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

type PgQueryable = Pick<Pool | PoolClient, 'query'>

class PgStatement implements StmtLike {
  constructor(private sql: string, private db: PgDb) {}

  async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
    const res = await this.db.activeClient().query(toPgSql(this.sql), params)
    return res.rows as T[]
  }

  async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
    const rows = await this.all<T>(...params)
    return rows[0]
  }

  async run(...params: unknown[]): Promise<{ changes: number }> {
    const res = await this.db.activeClient().query(toPgSql(this.sql), params)
    return { changes: res.rowCount ?? 0 }
  }
}

class PgDb implements DbLike {
  private txClient: PoolClient | null = null

  activeClient(): PgQueryable {
    return this.txClient ?? pgPool()
  }

  prepare(sql: string): StmtLike {
    return new PgStatement(sql, this)
  }

  async exec(sql: string): Promise<void> {
    await this.activeClient().query(sql)
  }

  /** Runs fn inside a BEGIN/COMMIT block on one dedicated connection. */
  transaction<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) {
    return async (...args: A): Promise<R> => {
      const client = await pgPool().connect()
      this.txClient = client
      try {
        await client.query('BEGIN')
        const result = await fn(...args)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        this.txClient = null
        client.release()
      }
    }
  }
}

// ─── SQLite (local dev) ─────────────────────────────────────────────────────
// better-sqlite3's API is already synchronous-.prepare().all()/.get()/.run()
// with '?' placeholders, so this wrapper just makes it return Promises to
// match the shared DbLike interface — no query-text translation needed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqliteDatabase = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqliteStatement = any

let _sqliteModule: SqliteDatabase | null = null

function loadBetterSqlite3(): SqliteDatabase {
  if (!_sqliteModule) {
    // Indirect eval to get Node's real require — webpack can't see through a
    // string handed to eval, so it neither resolves nor bundles this at
    // build time (a literal `import('better-sqlite3')`, dynamic or not,
    // gets resolved by `next build`'s tracer and fails when the package
    // isn't installed, which is exactly the Postgres-only production case).
    // eslint-disable-next-line no-eval
    const nodeRequire = eval('require') as NodeRequire
    _sqliteModule = nodeRequire('better-sqlite3')
  }
  return _sqliteModule
}

class SqliteStmt implements StmtLike {
  constructor(private stmtPromise: Promise<SqliteStatement>) {}

  async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
    return (await this.stmtPromise).all(...params) as T[]
  }

  async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
    return (await this.stmtPromise).get(...params) as T | undefined
  }

  async run(...params: unknown[]): Promise<{ changes: number }> {
    const info = (await this.stmtPromise).run(...params)
    return { changes: info.changes }
  }
}

class SqliteDb implements DbLike {
  constructor(private dbPromise: Promise<SqliteDatabase>) {}

  prepare(sql: string): StmtLike {
    return new SqliteStmt(this.dbPromise.then((db) => db.prepare(sql)))
  }

  async exec(sql: string): Promise<void> {
    ;(await this.dbPromise).exec(sql)
  }

  /** better-sqlite3's own .transaction() requires a sync callback; ours are
   *  async now, so this drives BEGIN/COMMIT/ROLLBACK by hand instead. Safe
   *  here because there's exactly one connection and no concurrent writers
   *  — this is the local single-process dev path, not the deployed one. */
  transaction<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) {
    return async (...args: A): Promise<R> => {
      const db = await this.dbPromise
      db.exec('BEGIN')
      try {
        const result = await fn(...args)
        db.exec('COMMIT')
        return result
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
  }
}

async function openSqlite(file: string, readonly: boolean): Promise<SqliteDatabase> {
  const Database = loadBetterSqlite3()
  const db = new Database(file, { readonly })
  if (!readonly) db.pragma('journal_mode = WAL')
  return db
}

// ─── Metrics tables (read-mostly) ───────────────────────────────────────────

let _metricsDb: DbLike | null = null

export function metricsDb(): DbLike {
  if (!_metricsDb) {
    _metricsDb = dbDriver() === 'postgres'
      ? new PgDb()
      : new SqliteDb(openSqlite(path.join(process.cwd(), '..', 'metrics.db'), true))
  }
  return _metricsDb
}

// ─── Tool DB (findings catalog, read-write) ────────────────────────────────

let _toolDb: DbLike | null = null
let _toolDbReady: Promise<void> | null = null

export function toolDb(): DbLike {
  if (!_toolDb) {
    if (dbDriver() === 'postgres') {
      const db = new PgDb()
      _toolDb = db
      _toolDbReady = initToolDbPostgres(db)
    } else {
      const sqlite = new SqliteDb(openSqlite(path.join(process.cwd(), 'studio.db'), false))
      _toolDb = sqlite
      _toolDbReady = initToolDbSqlite(sqlite)
    }
  }
  return _toolDb
}

// Awaited lazily by callers that need the table to exist (findings-report.ts,
// the findings/run route) before they run their first query.
export function toolDbReady(): Promise<void> {
  toolDb()
  return _toolDbReady!
}

// NOTE (both variants): ALL definitions (signals, finding definitions,
// insight templates) live in ../knowledge_definitions.json — the
// version-controlled single source of truth, read/written via
// knowledge-store.ts. This table holds ONLY the findings catalog: the
// append-only record of computed findings.

async function initToolDbPostgres(db: PgDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS findings_catalog (
      id SERIAL PRIMARY KEY,
      finding_def_id TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      region_name TEXT NOT NULL,
      territory_name TEXT NOT NULL,
      year_month TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (now()::text),
      finding_key TEXT NOT NULL,
      severity_band TEXT NOT NULL,
      severity_score INTEGER NOT NULL,
      axes_snapshot TEXT NOT NULL,
      ms_now REAL, ms_sev INTEGER,
      growth_now REAL, growth_sev INTEGER,
      mat_rank INTEGER, market_share REAL,
      months_red INTEGER DEFAULT 0,
      escalate INTEGER DEFAULT 0, improved INTEGER DEFAULT 0,
      UNIQUE(finding_def_id, brand_name, region_name, year_month)
    );
  `)
}

async function initToolDbSqlite(db: SqliteDb): Promise<void> {
  await db.exec(`
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
      ms_now REAL, ms_sev INTEGER,
      growth_now REAL, growth_sev INTEGER,
      mat_rank INTEGER, market_share REAL,
      months_red INTEGER DEFAULT 0,
      escalate INTEGER DEFAULT 0, improved INTEGER DEFAULT 0,
      UNIQUE(finding_def_id, brand_name, region_name, year_month)
    );
  `)
}

// ─── Driver-agnostic schema introspection ──────────────────────────────────
// Centralizes the one real dialect split besides placeholders: SQLite's
// sqlite_master/PRAGMA vs Postgres' information_schema. Callers (the data
// browser routes, signal-engine's column validation, the knowledge
// validator script) go through these instead of branching on dbDriver()
// themselves.

export interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: unknown
  pk: number
}

export async function listTables(): Promise<string[]> {
  if (dbDriver() === 'postgres') {
    const rows = await metricsDb().prepare(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema='public' AND table_name != 'findings_catalog'
       ORDER BY table_name`
    ).all() as { name: string }[]
    return rows.map(r => r.name)
  }
  const rows = await metricsDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all() as { name: string }[]
  return rows.map(r => r.name)
}

export async function tableExists(table: string): Promise<boolean> {
  if (dbDriver() === 'postgres') {
    const row = await metricsDb().prepare(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=?"
    ).get(table)
    return !!row
  }
  const row = await metricsDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(table)
  return !!row
}

export async function tableSchema(table: string): Promise<ColumnInfo[]> {
  if (dbDriver() === 'postgres') {
    return metricsDb().prepare(`
      SELECT ordinal_position AS cid, column_name AS name, data_type AS type,
             CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS notnull,
             column_default AS dflt_value, 0 AS pk
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=?
      ORDER BY ordinal_position
    `).all(table) as Promise<ColumnInfo[]>
  }
  // better-sqlite3's PRAGMA table_info() already returns exactly this shape.
  return metricsDb().prepare(`PRAGMA table_info(${table})`).all() as Promise<ColumnInfo[]>
}

export async function tableColumns(table: string): Promise<Set<string>> {
  const cols = await tableSchema(table)
  return new Set(cols.map(c => c.name))
}
