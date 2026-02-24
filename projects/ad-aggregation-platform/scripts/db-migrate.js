import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'migrations')

function parseArgs(argv) {
  const flags = new Set(argv)
  return {
    dryRun: flags.has('--dry-run'),
    statusOnly: flags.has('--status')
  }
}

function resolveDbUrl() {
  return String(process.env.SUPABASE_DB_URL || '').trim()
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function fetchAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, file_name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
  )
  return Array.isArray(result.rows) ? result.rows : []
}

function versionFromFileName(fileName) {
  const base = fileName.replace(/\.sql$/i, '')
  const match = base.match(/^([0-9]{4,})_/)
  if (match) return match[1]
  return base
}

async function readMigrationContent(fileName) {
  const fullPath = path.join(MIGRATIONS_DIR, fileName)
  return fs.readFile(fullPath, 'utf8')
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const files = await listMigrationFiles()

  if (files.length === 0) {
    console.log('[db:migrate] no migration files found.')
    return
  }

  const dbUrl = resolveDbUrl()
  if (!dbUrl) {
    if (args.dryRun || args.statusOnly) {
      console.log('[db:migrate] no SUPABASE_DB_URL provided, running in local status mode.')
      console.log('[db:migrate] pending migrations:')
      for (const file of files) {
        console.log(`  - ${file}`)
      }
      return
    }
    throw new Error('SUPABASE_DB_URL is required for db:migrate.')
  }

  const { Client } = await import('pg')
  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase.co')
      ? { rejectUnauthorized: false }
      : undefined
  })

  await client.connect()

  try {
    await ensureMigrationsTable(client)
    const appliedRows = await fetchAppliedMigrations(client)
    const appliedMap = new Map(appliedRows.map((row) => [String(row.file_name), row]))

    const pending = []
    for (const file of files) {
      const sql = await readMigrationContent(file)
      const currentChecksum = checksum(sql)
      const existing = appliedMap.get(file)
      if (!existing) {
        pending.push({ file, sql, currentChecksum })
        continue
      }
      if (String(existing.checksum) !== currentChecksum) {
        throw new Error(`checksum mismatch for applied migration: ${file}`)
      }
    }

    console.log(`[db:migrate] applied=${appliedRows.length} pending=${pending.length}`)

    if (args.dryRun || args.statusOnly) {
      if (pending.length === 0) {
        console.log('[db:migrate] no pending migrations.')
      } else {
        console.log('[db:migrate] pending migrations:')
        for (const item of pending) {
          console.log(`  - ${item.file}`)
        }
      }
      return
    }

    for (const item of pending) {
      const version = versionFromFileName(item.file)
      console.log(`[db:migrate] applying ${item.file}`)

      await client.query('BEGIN')
      try {
        await client.query(item.sql)
        await client.query(
          'INSERT INTO schema_migrations(version, file_name, checksum) VALUES ($1, $2, $3)',
          [version, item.file, item.currentChecksum]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    console.log('[db:migrate] done.')
  } finally {
    await client.end()
  }
}

run().catch((error) => {
  console.error(`[db:migrate] failed: ${error.message}`)
  process.exit(1)
})
