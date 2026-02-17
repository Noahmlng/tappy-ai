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
    }
  }
}

export { REQUIRED_ENV_VARS }
