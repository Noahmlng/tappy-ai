import { loadRuntimeConfig } from './runtime-config.js'

function maskSecret(value, visible = 4) {
  if (value.length <= visible) return '*'.repeat(value.length)
  return `${'*'.repeat(value.length - visible)}${value.slice(-visible)}`
}

try {
  const config = loadRuntimeConfig()
  console.log('[config] Environment check passed.')
  console.log(
    `[config] OPENROUTER_MODEL=${config.openrouter.model}, OPENROUTER_API_KEY=${maskSecret(
      config.openrouter.apiKey
    )}, CJ_TOKEN=${maskSecret(config.cj.token)}, PARTNERSTACK_API_KEY=${maskSecret(
      config.partnerstack.apiKey
    )}`
  )
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
