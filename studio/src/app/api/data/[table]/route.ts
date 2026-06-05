import { NextResponse } from 'next/server'
import { metricsDb } from '@/lib/db'

// Allowlist to prevent SQL injection
const ALLOWED_TABLES = [
  'region_metrics',
  'brands',
  'competitors',
  'forecast',
  'regions',
  'sales',
  'skus',
]

type PragmaColumn = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: unknown
  pk: number
}

export async function GET(
  request: Request,
  { params }: { params: { table: string } }
) {
  const table = params.table

  // Validate against allowed list (also check against sqlite_master at runtime)
  if (!ALLOWED_TABLES.includes(table)) {
    return NextResponse.json({ error: `Table "${table}" is not in the allowed list` }, { status: 400 })
  }

  const db = metricsDb()

  // Double-check table actually exists in db
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table)
  if (!exists) {
    return NextResponse.json({ error: `Table "${table}" does not exist` }, { status: 404 })
  }

  const url = new URL(request.url)
  const schemaParam = url.searchParams.get('schema')

  // --- Schema mode ---
  if (schemaParam === '1') {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as PragmaColumn[]
    return NextResponse.json({ data: { columns } })
  }

  // --- Data mode ---
  const limitParam = parseInt(url.searchParams.get('limit') ?? '100', 10)
  const limit = Math.min(isNaN(limitParam) ? 100 : limitParam, 500)
  const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10)
  const offset = isNaN(offsetParam) ? 0 : offsetParam

  if (table === 'region_metrics') {
    const brand = url.searchParams.get('brand')
    const period_type = url.searchParams.get('period_type')
    const year_month = url.searchParams.get('year_month')

    const conditions: string[] = []
    const args: unknown[] = []

    if (brand) {
      conditions.push('brand_name = ?')
      args.push(brand)
    }
    if (period_type) {
      conditions.push('period_type = ?')
      args.push(period_type)
    }
    if (year_month) {
      conditions.push('year_month = ?')
      args.push(year_month)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const countRow = db
      .prepare(`SELECT COUNT(*) as c FROM region_metrics ${where}`)
      .get(...args) as { c: number }
    const total = countRow.c

    const rows = db
      .prepare(`SELECT * FROM region_metrics ${where} LIMIT ? OFFSET ?`)
      .all(...args, limit, offset) as Record<string, unknown>[]

    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    return NextResponse.json({ data: { rows, total, columns } })
  }

  // --- Other tables: return first N rows unfiltered ---
  const countRow = db
    .prepare(`SELECT COUNT(*) as c FROM ${table}`)
    .get() as { c: number }
  const total = countRow.c

  const rows = db
    .prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`)
    .all(limit, offset) as Record<string, unknown>[]

  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  return NextResponse.json({ data: { rows, total, columns } })
}
