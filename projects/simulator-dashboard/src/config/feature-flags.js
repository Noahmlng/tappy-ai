function parseBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

export const featureFlags = Object.freeze({
  dashboardV1Minimal: parseBooleanFlag(import.meta.env.VITE_DASHBOARD_V1_MINIMAL, true),
  enableInternalReset: parseBooleanFlag(import.meta.env.VITE_ENABLE_INTERNAL_RESET, false),
})

export function isFeatureEnabled(flagName) {
  return Boolean(featureFlags[flagName])
}
