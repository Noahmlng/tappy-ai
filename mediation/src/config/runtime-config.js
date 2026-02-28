const REQUIRED_ENV_VARS = [
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'CJ_TOKEN',
  'PARTNERSTACK_API_KEY'
]
const SUPPORTED_MEDIATION_NETWORKS = new Set(['partnerstack', 'cj', 'house'])
const DEFAULT_ENABLED_MEDIATION_NETWORKS = ['partnerstack', 'house']

function readEnv(env, key, { required = false } = {}) {
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

function parseEnabledNetworks(rawValue) {
  const parsed = String(rawValue || '')
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => item && SUPPORTED_MEDIATION_NETWORKS.has(item))
  const deduped = Array.from(new Set(parsed))
  return deduped.length > 0 ? deduped : [...DEFAULT_ENABLED_MEDIATION_NETWORKS]
}

export function loadRuntimeConfig(env = process.env, options = {}) {
  const strict = options?.strict === true

  return {
    deepseek: {
      apiKey: readEnv(env, 'DEEPSEEK_API_KEY', { required: strict }),
      model: readEnv(env, 'DEEPSEEK_MODEL', { required: false }) || 'deepseek-chat',
      baseUrl: readEnv(env, 'DEEPSEEK_BASE_URL', { required: false }) || 'https://api.deepseek.com/chat/completions',
      intentMaxTokens: toPositiveInteger(readEnv(env, 'DEEPSEEK_INTENT_MAX_TOKENS', { required: false }), 96),
    },
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
    },
    networkPolicy: {
      enabledNetworks: parseEnabledNetworks(readEnv(env, 'MEDIATION_ENABLED_NETWORKS', { required: false }))
    }
  }
}

export { REQUIRED_ENV_VARS }
