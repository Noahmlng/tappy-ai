const REQUIRED_ENV_VARS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'CJ_TOKEN',
  'PARTNERSTACK_API_KEY'
]

function readEnv(env, key, { required = true } = {}) {
  const value = env[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (required) {
      throw new Error(`[config] Missing required environment variable: ${key}`)
    }
    return ''
  }
  return value.trim()
}

function toPositiveInteger(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.floor(numeric)
}

export function loadRuntimeConfig(env = process.env, options = {}) {
  const strict = options?.strict !== false

  return {
    openrouter: {
      apiKey: readEnv(env, 'OPENROUTER_API_KEY', { required: strict }),
      model: readEnv(env, 'OPENROUTER_MODEL', { required: strict })
    },
    cj: {
      token: readEnv(env, 'CJ_TOKEN', { required: strict })
    },
    partnerstack: {
      apiKey: readEnv(env, 'PARTNERSTACK_API_KEY', { required: strict })
    },
    houseAds: {
      source: readEnv(env, 'HOUSE_ADS_SOURCE', { required: false }) || 'supabase',
      dbCacheTtlMs: toPositiveInteger(readEnv(env, 'HOUSE_ADS_DB_CACHE_TTL_MS', { required: false }), 15000),
      dbFetchLimit: toPositiveInteger(readEnv(env, 'HOUSE_ADS_DB_FETCH_LIMIT', { required: false }), 1500),
      dbUrl: readEnv(env, 'SUPABASE_DB_URL', { required: false })
    }
  }
}

export { REQUIRED_ENV_VARS }
