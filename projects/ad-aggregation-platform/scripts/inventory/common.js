import { Pool } from 'pg'

function cleanText(value) {
  return String(value || '').trim()
}

export function parseArgs(argv = []) {
  const args = {}
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue
    const token = raw.slice(2)
    const [key, ...rest] = token.split('=')
    const value = rest.length > 0 ? rest.join('=') : 'true'
    args[key] = value
  }
  return args
}

export function toPositiveInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function resolveDbUrl() {
  const dbUrl = cleanText(process.env.SUPABASE_DB_URL)
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required for inventory scripts.')
  }
  return dbUrl
}

export async function withDbPool(run) {
  const dbUrl = resolveDbUrl()
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase.co')
      ? { rejectUnauthorized: false }
      : undefined,
  })

  try {
    return await run(pool)
  } finally {
    await pool.end()
  }
}

export function printJson(payload = {}) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}
