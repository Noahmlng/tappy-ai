const ROLE_SCOPE_MAP = Object.freeze({
  publisher: Object.freeze([
    'config:read',
    'config:publish',
    'event:write'
  ]),
  reviewer: Object.freeze([
    'config:read',
    'config:approve',
    'audit:read'
  ]),
  admin: Object.freeze([
    '*'
  ])
})

const TOKEN_TTL_SECONDS = Object.freeze({
  sdkAccessToken: 900,
  serviceToken: 300,
  publishActionToken: 120,
  refreshToken: 86400
})

const AUTH_REASON_CODES = Object.freeze({
  SUCCESS: 'AUTH_SUCCESS',
  MALFORMED_TOKEN: 'AUTH_MALFORMED_TOKEN',
  SIGNING_KEY_MISSING: 'AUTH_SIGNING_KEY_MISSING',
  SIGNATURE_INVALID: 'AUTH_SIGNATURE_INVALID',
  TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  TOKEN_NOT_ACTIVE: 'AUTH_TOKEN_NOT_ACTIVE',
  ISSUER_MISMATCH: 'AUTH_ISSUER_MISMATCH',
  AUDIENCE_MISMATCH: 'AUTH_AUDIENCE_MISMATCH',
  SCOPE_DENIED: 'AUTH_SCOPE_DENIED'
})

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase()
  return ROLE_SCOPE_MAP[value] ? value : 'publisher'
}

function normalizeScopes(scopes = []) {
  if (!Array.isArray(scopes)) return []

  return Array.from(
    new Set(
      scopes
        .map((scope) => String(scope || '').trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

function resolveRoleScopes(role) {
  const normalizedRole = normalizeRole(role)
  return ROLE_SCOPE_MAP[normalizedRole] || ROLE_SCOPE_MAP.publisher
}

function buildMinimumScopes(role, additionalScopes = []) {
  const roleScopes = resolveRoleScopes(role)
  return normalizeScopes([...roleScopes, ...normalizeScopes(additionalScopes)])
}

function hasRequiredScope(scopes = [], requiredScope = '') {
  const normalizedScopes = normalizeScopes(scopes)
  const normalizedRequiredScope = String(requiredScope || '').trim().toLowerCase()

  if (!normalizedRequiredScope) return true
  if (normalizedScopes.includes('*')) return true

  return normalizedScopes.includes(normalizedRequiredScope)
}

export {
  AUTH_REASON_CODES,
  ROLE_SCOPE_MAP,
  TOKEN_TTL_SECONDS,
  buildMinimumScopes,
  hasRequiredScope,
  normalizeRole,
  normalizeScopes,
  resolveRoleScopes
}
