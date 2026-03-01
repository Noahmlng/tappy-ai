const REQUIRED_ENV_VARS = [
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'CJ_TOKEN',
  'PARTNERSTACK_API_KEY'
]
const SUPPORTED_MEDIATION_NETWORKS = new Set(['partnerstack', 'cj', 'house'])
const DEFAULT_ENABLED_MEDIATION_NETWORKS = ['partnerstack', 'house']
const DEFAULT_LOCALE_MATCH_MODE = 'locale_or_base'
const SUPPORTED_LOCALE_MATCH_MODES = new Set(['exact', 'locale_or_base'])

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

function toNumberInRange(value, fallback, min = 0, max = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric < min || numeric > max) return fallback
  return numeric
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false
  return fallback
}

function parseLocaleMatchMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return DEFAULT_LOCALE_MATCH_MODE
  if (normalized === 'base_or_locale') return 'locale_or_base'
  if (!SUPPORTED_LOCALE_MATCH_MODES.has(normalized)) return DEFAULT_LOCALE_MATCH_MODE
  return normalized
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
    },
    languagePolicy: {
      localeMatchMode: parseLocaleMatchMode(readEnv(env, 'MEDIATION_LOCALE_MATCH_MODE', { required: false })),
    },
    relevancePolicy: {
      minLexicalScore: toNumberInRange(
        readEnv(env, 'MEDIATION_INTENT_MIN_LEXICAL_SCORE', { required: false }),
        0.02,
      ),
      minVectorScore: toNumberInRange(
        readEnv(env, 'MEDIATION_INTENT_MIN_VECTOR_SCORE', { required: false }),
        0.35,
      ),
      intentScoreFloor: toNumberInRange(
        readEnv(env, 'MEDIATION_INTENT_SCORE_FLOOR', { required: false }),
        0.38,
      ),
      houseLowInfoFilterEnabled: parseBoolean(
        readEnv(env, 'MEDIATION_HOUSE_LOWINFO_FILTER_ENABLED', { required: false }),
        true,
      ),
    }
  }
}

export { REQUIRED_ENV_VARS }
