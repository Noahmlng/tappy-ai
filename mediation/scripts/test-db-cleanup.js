import { Pool } from 'pg'

const TABLES = Object.freeze([
  'control_plane_allowed_origins',
  'control_plane_agent_access_tokens',
  'control_plane_integration_tokens',
  'control_plane_dashboard_sessions',
  'control_plane_dashboard_users',
  'control_plane_api_keys',
  'control_plane_app_environments',
  'control_plane_apps',
  'mediation_runtime_event_logs',
  'mediation_runtime_decision_logs',
  'mediation_settlement_conversion_facts',
])

function resolveDbUrl() {
  const testDbUrl = String(process.env.SUPABASE_DB_URL_TEST || '').trim()
  if (testDbUrl) return testDbUrl
  return String(process.env.SUPABASE_DB_URL || '').trim()
}

async function cleanupDatabase(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('supabase.co')
      ? { rejectUnauthorized: false }
      : undefined,
  })

  try {
    await pool.query('BEGIN')
    for (const table of TABLES) {
      const existsResult = await pool.query('SELECT to_regclass($1) AS reg', [`public.${table}`])
      const exists = Boolean(existsResult?.rows?.[0]?.reg)
      if (!exists) continue
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`)
    }
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await pool.end()
  }
}

async function main() {
  const dbUrl = resolveDbUrl()
  if (!dbUrl) {
    throw new Error('[test-db-cleanup] SUPABASE_DB_URL_TEST (or SUPABASE_DB_URL) is required.')
  }

  await cleanupDatabase(dbUrl)
  console.log('[test-db-cleanup] cleanup completed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
