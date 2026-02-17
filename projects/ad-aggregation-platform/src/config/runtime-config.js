const REQUIRED_ENV_VARS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'CJ_TOKEN',
  'PARTNERSTACK_API_KEY'
]

function readRequiredEnv(env, key) {
  const value = env[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[config] Missing required environment variable: ${key}`)
  }
  return value.trim()
}

export function loadRuntimeConfig(env = process.env) {
  for (const key of REQUIRED_ENV_VARS) {
    readRequiredEnv(env, key)
  }

  return {
    openrouter: {
      apiKey: readRequiredEnv(env, 'OPENROUTER_API_KEY'),
      model: readRequiredEnv(env, 'OPENROUTER_MODEL')
    },
    cj: {
      token: readRequiredEnv(env, 'CJ_TOKEN')
    },
    partnerstack: {
      apiKey: readRequiredEnv(env, 'PARTNERSTACK_API_KEY')
    }
  }
}

export { REQUIRED_ENV_VARS }
