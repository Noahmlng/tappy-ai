export {
  AUTH_REASON_CODES,
  ROLE_SCOPE_MAP,
  TOKEN_TTL_SECONDS,
  buildMinimumScopes,
  hasRequiredScope,
  normalizeRole,
  normalizeScopes,
  resolveRoleScopes
} from './token-policy.js'

export {
  SERVICE_TOKEN_AUDIENCE,
  SERVICE_TOKEN_ISSUER,
  authorizeServiceRequest,
  buildAuthAuditRecord,
  createServiceToken,
  parseServiceTokenKeyringFromEnv,
  resolveSigningKeyFromEnv,
  verifyServiceToken
} from './service-auth.js'
