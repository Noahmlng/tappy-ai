import { loadRuntimeConfig } from './runtime-config.js'

function maskSecret(value, visible = 4) {
  if (value.length <= visible) return '*'.repeat(value.length)
  return `${'*'.repeat(value.length - visible)}${value.slice(-visible)}`
}

try {
  const supabaseDbUrl = String(process.env.SUPABASE_DB_URL || '').trim()
  if (!supabaseDbUrl) {
    throw new Error('[config] Missing required environment variable: SUPABASE_DB_URL')
  }

  const allowedOrigins = Array.from(
    new Set(
      String(process.env.MEDIATION_ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )
  if (allowedOrigins.length === 0) {
    throw new Error('[config] Missing required environment variable: MEDIATION_ALLOWED_ORIGINS')
  }

  const config = loadRuntimeConfig(process.env, { strict: false })
  console.log('[config] Environment check passed.')
  console.log(
    `[config] SUPABASE_DB_URL=${maskSecret(supabaseDbUrl)}, MEDIATION_ALLOWED_ORIGINS=${allowedOrigins.join(',')}`
  )
  console.log(
    `[config] Optional providers -> OPENROUTER_MODEL=${config.openrouter.model || '<empty>'}, OPENROUTER_API_KEY=${maskSecret(
      config.openrouter.apiKey
    )}, CJ_TOKEN=${maskSecret(config.cj.token)}, PARTNERSTACK_API_KEY=${maskSecret(config.partnerstack.apiKey)}`
  )
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
