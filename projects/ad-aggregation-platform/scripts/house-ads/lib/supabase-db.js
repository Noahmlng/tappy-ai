import { Client } from 'pg'

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

export function resolveSupabaseDbUrl(env = process.env) {
  return cleanText(env.SUPABASE_DB_URL)
}

export function createSupabaseClient(dbUrl = resolveSupabaseDbUrl()) {
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required.')
  }
  return new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase.co')
      ? { rejectUnauthorized: false }
      : undefined,
  })
}

export async function withSupabaseClient(worker, options = {}) {
  const client = createSupabaseClient(options.dbUrl)
  await client.connect()
  try {
    return await worker(client)
  } finally {
    await client.end()
  }
}

export async function withTransaction(client, worker) {
  await client.query('BEGIN')
  try {
    const result = await worker(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export function chunk(items = [], size = 500) {
  const safeSize = Math.max(1, Number(size) || 500)
  const out = []
  for (let i = 0; i < items.length; i += safeSize) {
    out.push(items.slice(i, i + safeSize))
  }
  return out
}

export async function countRows(client, tableName) {
  const allowed = new Set(['house_ads_brands', 'house_ads_offers'])
  if (!allowed.has(tableName)) {
    throw new Error(`countRows table is not allowed: ${tableName}`)
  }
  const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${tableName}`)
  return Number(result.rows?.[0]?.count || 0)
}
