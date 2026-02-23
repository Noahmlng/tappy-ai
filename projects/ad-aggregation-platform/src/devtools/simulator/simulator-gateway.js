import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { createHash } from 'node:crypto'

import defaultPlacements from '../../../config/default-placements.json' with { type: 'json' }
import { runAdsRetrievalPipeline } from '../../runtime/index.js'
import { getAllNetworkHealth } from '../../runtime/network-health-state.js'
import { inferIntentWithLlm } from '../../providers/intent/index.js'
import {
  createIntentCardVectorIndex,
  normalizeIntentCardCatalogItems,
  retrieveIntentCardTopK,
} from '../../providers/intent-card/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const STATE_DIR = path.join(PROJECT_ROOT, '.local')
const STATE_FILE = path.join(STATE_DIR, 'simulator-gateway-state.json')

const PORT = Number(process.env.SIMULATOR_GATEWAY_PORT || 3100)
const HOST = process.env.SIMULATOR_GATEWAY_HOST || '127.0.0.1'
const DEV_RESET_ENABLED = String(process.env.SIMULATOR_DEV_RESET_ENABLED || 'true').trim().toLowerCase() !== 'false'
const DEV_RESET_TOKEN = String(process.env.SIMULATOR_DEV_RESET_TOKEN || '').trim()
const DEFAULT_SIMULATOR_BOOTSTRAP_API_KEY = 'sk_staging_simulator_local_bootstrap_v1'
const SIMULATOR_BOOTSTRAP_API_KEY = String(
  process.env.SIMULATOR_BOOTSTRAP_API_KEY || DEFAULT_SIMULATOR_BOOTSTRAP_API_KEY,
).trim()
const MAX_DECISION_LOGS = 500
const MAX_EVENT_LOGS = 500
const MAX_PLACEMENT_AUDIT_LOGS = 500
const MAX_NETWORK_FLOW_LOGS = 300
const MAX_CONTROL_PLANE_AUDIT_LOGS = 800
const MAX_INTEGRATION_TOKENS = 500
const MAX_AGENT_ACCESS_TOKENS = 1200
const DECISION_REASON_ENUM = new Set(['served', 'no_fill', 'blocked', 'error'])
const CONTROL_PLANE_ENVIRONMENTS = new Set(['sandbox', 'staging', 'prod'])
const CONTROL_PLANE_KEY_STATUS = new Set(['active', 'revoked'])
const DEFAULT_CONTROL_PLANE_APP_ID = 'simulator-chatbot'
const DEFAULT_CONTROL_PLANE_ORG_ID = 'org_simulator'
const MIN_AGENT_ACCESS_TTL_SECONDS = 60
const MAX_AGENT_ACCESS_TTL_SECONDS = 900
const TOKEN_EXCHANGE_FORBIDDEN_FIELDS = new Set([
  'appId',
  'app_id',
  'environment',
  'env',
  'placementId',
  'placement_id',
  'scope',
  'sourceTokenId',
  'source_token_id',
  'tokenType',
  'token_type',
])

const PLACEMENT_KEY_BY_ID = {
  chat_inline_v1: 'attach.post_answer_render',
  chat_followup_v1: 'next_step.intent_card',
  search_parallel_v1: 'intervention.search_parallel',
}

const EVENT_SURFACE_MAP = {
  answer_completed: 'CHAT_INLINE',
  followup_generation: 'FOLLOW_UP',
  follow_up_generation: 'FOLLOW_UP',
  web_search_called: 'AGENT_PANEL',
}

const ATTACH_MVP_PLACEMENT_KEY = 'attach.post_answer_render'
const ATTACH_MVP_EVENT = 'answer_completed'
const NEXT_STEP_INTENT_CARD_PLACEMENT_KEY = 'next_step.intent_card'
const MANAGED_ROUTING_MODE = 'managed_mediation'
const NEXT_STEP_INTENT_CARD_EVENTS = new Set(['followup_generation', 'follow_up_generation'])
const NEXT_STEP_INTENT_POST_RULES = Object.freeze({
  intentThresholdFloor: 0.35,
  cooldownSeconds: 20,
  maxPerSession: 2,
  maxPerUserPerDay: 5,
})
const NEXT_STEP_SENSITIVE_TOPICS = [
  'medical',
  'medicine',
  'health diagnosis',
  'finance',
  'financial advice',
  'investment',
  'legal',
  'lawsuit',
  'self-harm',
  'suicide',
  'minor',
  'underage',
  'adult',
  'gambling',
  'drug',
  'diagnosis',
  '处方',
  '医疗',
  '投资',
  '理财',
  '法律',
  '未成年',
  '自残',
  '自杀',
  '赌博',
  '毒品',
  '成人',
]
const ATTACH_MVP_ALLOWED_FIELDS = new Set([
  'requestId',
  'appId',
  'sessionId',
  'turnId',
  'query',
  'answerText',
  'intentScore',
  'locale',
  'kind',
  'adId',
  'placementId',
])
const NEXT_STEP_INTENT_CARD_ALLOWED_FIELDS = new Set([
  'requestId',
  'appId',
  'sessionId',
  'turnId',
  'userId',
  'event',
  'placementId',
  'placementKey',
  'context',
])
const NEXT_STEP_INTENT_CARD_CONTEXT_ALLOWED_FIELDS = new Set([
  'query',
  'answerText',
  'recent_turns',
  'locale',
  'intent_class',
  'intent_score',
  'preference_facets',
  'constraints',
  'blocked_topics',
  'expected_revenue',
  'debug',
])
const INTENT_CARD_RETRIEVE_ALLOWED_FIELDS = new Set([
  'query',
  'facets',
  'topK',
  'minScore',
  'catalog',
])

const runtimeMemory = {
  cooldownBySessionPlacement: new Map(),
  perSessionPlacementCount: new Map(),
  perUserPlacementDayCount: new Map(),
}

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function mergeNormalizedStringLists(...values) {
  const merged = []
  for (const value of values) {
    if (!Array.isArray(value)) continue
    merged.push(...value)
  }
  return normalizeStringList(merged)
}

function normalizeDisclosure(value) {
  const text = String(value || '').trim()
  if (text === 'Ad' || text === 'Sponsored') return text
  return 'Sponsored'
}

function normalizeControlPlaneEnvironment(value, fallback = 'staging') {
  const normalized = String(value || '').trim().toLowerCase()
  if (CONTROL_PLANE_ENVIRONMENTS.has(normalized)) return normalized
  return fallback
}

function normalizeControlPlaneKeyStatus(value, fallback = 'active') {
  const normalized = String(value || '').trim().toLowerCase()
  if (CONTROL_PLANE_KEY_STATUS.has(normalized)) return normalized
  return fallback
}

function randomToken(length = 12) {
  let token = ''
  while (token.length < length) {
    token += Math.random().toString(36).slice(2)
  }
  return token.slice(0, length)
}

function hashToken(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

function tokenFingerprint(value) {
  const digest = hashToken(value)
  return digest ? digest.slice(0, 16) : ''
}

function createMinimalAgentScope() {
  return {
    mediationConfigRead: true,
    sdkEvaluate: true,
    sdkEvents: true,
  }
}

function resolveBootstrapApiKey(environment = 'staging') {
  const env = normalizeControlPlaneEnvironment(environment)
  if (SIMULATOR_BOOTSTRAP_API_KEY && SIMULATOR_BOOTSTRAP_API_KEY.startsWith(`sk_${env}_`)) {
    return SIMULATOR_BOOTSTRAP_API_KEY
  }
  if (env === 'staging') return DEFAULT_SIMULATOR_BOOTSTRAP_API_KEY
  return `sk_${env}_simulator_local_bootstrap_v1`
}

function buildApiKeySecret(environment = 'staging', preferredSecret = '') {
  const env = normalizeControlPlaneEnvironment(environment)
  const preferred = String(preferredSecret || '').trim()
  if (preferred && preferred.startsWith(`sk_${env}_`)) {
    return preferred
  }
  return `sk_${env}_${randomToken(24)}`
}

function maskApiKeySecret(secret) {
  const value = String(secret || '')
  if (value.length < 10) return '****'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function buildControlPlaneAppRecord(raw = {}) {
  const timestamp = typeof raw.createdAt === 'string' ? raw.createdAt : nowIso()
  const appId = String(raw.appId || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  return {
    appId,
    organizationId: String(raw.organizationId || '').trim() || DEFAULT_CONTROL_PLANE_ORG_ID,
    displayName: String(raw.displayName || '').trim() || 'Simulator Chatbot',
    status: String(raw.status || '').trim() || 'active',
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    createdAt: timestamp,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : timestamp,
  }
}

function buildControlPlaneEnvironmentRecord(raw = {}) {
  const timestamp = typeof raw.createdAt === 'string' ? raw.createdAt : nowIso()
  const appId = String(raw.appId || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(raw.environment)
  return {
    environmentId: String(raw.environmentId || '').trim() || `env_${appId}_${environment}`,
    appId,
    environment,
    routingMode: MANAGED_ROUTING_MODE,
    apiBaseUrl: String(raw.apiBaseUrl || '').trim() || '/api/v1/sdk',
    status: String(raw.status || '').trim() || 'active',
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    createdAt: timestamp,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : timestamp,
  }
}

function createControlPlaneKeyRecord(input = {}) {
  const appId = String(input.appId || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(input.environment)
  const keyName = String(input.keyName || '').trim() || `primary-${environment}`
  const keyId = String(input.keyId || '').trim() || `key_${randomToken(18)}`
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : nowIso()
  const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : createdAt
  const secret = buildApiKeySecret(environment, input.secret)
  const keyPrefix = secret.slice(0, 14)
  const secretHash = createHash('sha256').update(secret).digest('hex')
  const status = normalizeControlPlaneKeyStatus(input.status, 'active')
  const revokedAt = status === 'revoked'
    ? (typeof input.revokedAt === 'string' ? input.revokedAt : updatedAt)
    : ''

  return {
    keyRecord: {
      keyId,
      appId,
      environment,
      keyName,
      keyPrefix,
      secretHash,
      status,
      revokedAt,
      lastUsedAt: typeof input.lastUsedAt === 'string' ? input.lastUsedAt : '',
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      maskedKey: maskApiKeySecret(secret),
      createdAt,
      updatedAt,
    },
    secret,
  }
}

function normalizeControlPlaneKeyRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const keyId = String(raw.keyId || raw.key_id || raw.id || '').trim()
  if (!keyId) return null

  const appId = String(raw.appId || raw.app_id || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(raw.environment)
  const keyName = String(raw.keyName || raw.key_name || raw.name || '').trim() || `primary-${environment}`
  const status = normalizeControlPlaneKeyStatus(raw.status, 'active')
  const createdAt = typeof raw.createdAt === 'string'
    ? raw.createdAt
    : (typeof raw.created_at === 'string' ? raw.created_at : nowIso())
  const updatedAt = typeof raw.updatedAt === 'string'
    ? raw.updatedAt
    : (typeof raw.updated_at === 'string' ? raw.updated_at : createdAt)
  const keyPrefix = String(raw.keyPrefix || raw.key_prefix || '').trim()
  const maskedKey = String(raw.maskedKey || raw.keyMasked || raw.preview || '').trim() || (
    keyPrefix ? `${keyPrefix}...****` : '****'
  )
  const revokedAt = status === 'revoked'
    ? String(raw.revokedAt || raw.revoked_at || updatedAt)
    : ''

  return {
    keyId,
    appId,
    environment,
    keyName,
    keyPrefix,
    secretHash: String(raw.secretHash || raw.secret_hash || '').trim(),
    status,
    revokedAt,
    lastUsedAt: String(raw.lastUsedAt || raw.last_used_at || '').trim(),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    maskedKey,
    createdAt,
    updatedAt,
  }
}

function toPublicApiKeyRecord(record) {
  const item = normalizeControlPlaneKeyRecord(record)
  if (!item) return null
  return {
    keyId: item.keyId,
    name: item.keyName,
    environment: item.environment,
    status: item.status,
    maskedKey: item.maskedKey,
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt,
  }
}

function createIntegrationTokenRecord(input = {}) {
  const appId = String(input.appId || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(input.environment)
  const placementId = String(input.placementId || '').trim() || 'chat_inline_v1'
  const ttlMinutes = toPositiveInteger(input.ttlMinutes, 10)
  const ttlSeconds = ttlMinutes * 60
  const issuedAt = typeof input.issuedAt === 'string' ? input.issuedAt : nowIso()
  const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : issuedAt
  const issuedAtMs = Date.parse(issuedAt)
  const expiresAtMs = (Number.isFinite(issuedAtMs) ? issuedAtMs : Date.now()) + ttlSeconds * 1000
  const expiresAt = new Date(expiresAtMs).toISOString()
  const token = `itk_${environment}_${randomToken(30)}`
  const tokenHash = hashToken(token)

  return {
    tokenRecord: {
      tokenId: String(input.tokenId || '').trim() || `itk_${randomToken(16)}`,
      appId,
      environment,
      placementId,
      tokenHash,
      tokenType: 'integration_token',
      oneTime: true,
      status: 'active',
      scope: createMinimalAgentScope(),
      issuedAt,
      expiresAt,
      usedAt: '',
      revokedAt: '',
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      updatedAt,
    },
    token,
  }
}

function normalizeIntegrationTokenRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const tokenId = String(raw.tokenId || raw.token_id || raw.id || '').trim()
  if (!tokenId) return null

  const appId = String(raw.appId || raw.app_id || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(raw.environment)
  const placementId = String(raw.placementId || raw.placement_id || '').trim() || 'chat_inline_v1'
  const status = String(raw.status || '').trim().toLowerCase() || 'active'

  return {
    tokenId,
    appId,
    environment,
    placementId,
    tokenHash: String(raw.tokenHash || raw.token_hash || '').trim(),
    tokenType: 'integration_token',
    oneTime: true,
    status: ['active', 'used', 'expired', 'revoked'].includes(status) ? status : 'active',
    scope: raw.scope && typeof raw.scope === 'object'
      ? raw.scope
      : createMinimalAgentScope(),
    issuedAt: String(raw.issuedAt || raw.issued_at || nowIso()),
    expiresAt: String(raw.expiresAt || raw.expires_at || nowIso()),
    usedAt: String(raw.usedAt || raw.used_at || ''),
    revokedAt: String(raw.revokedAt || raw.revoked_at || ''),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    updatedAt: String(raw.updatedAt || raw.updated_at || raw.issuedAt || raw.issued_at || nowIso()),
  }
}

function toPublicIntegrationTokenRecord(record, plainToken = '') {
  const item = normalizeIntegrationTokenRecord(record)
  if (!item) return null
  const issuedAtMs = Date.parse(item.issuedAt)
  const expiresAtMs = Date.parse(item.expiresAt)
  const ttlSeconds = (
    Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs > issuedAtMs
      ? Math.floor((expiresAtMs - issuedAtMs) / 1000)
      : 0
  )

  return {
    tokenId: item.tokenId,
    tokenType: item.tokenType,
    integrationToken: plainToken || undefined,
    appId: item.appId,
    environment: item.environment,
    placementId: item.placementId,
    oneTime: item.oneTime,
    status: item.status,
    scope: item.scope,
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt,
    ttlSeconds,
  }
}

function createAgentAccessTokenRecord(input = {}) {
  const appId = String(input.appId || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(input.environment)
  const placementId = String(input.placementId || '').trim() || 'chat_inline_v1'
  const ttlSeconds = toPositiveInteger(input.ttlSeconds, 300)
  const issuedAt = typeof input.issuedAt === 'string' ? input.issuedAt : nowIso()
  const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : issuedAt
  const issuedAtMs = Date.parse(issuedAt)
  const expiresAtMs = (Number.isFinite(issuedAtMs) ? issuedAtMs : Date.now()) + ttlSeconds * 1000
  const expiresAt = new Date(expiresAtMs).toISOString()
  const accessToken = `atk_${environment}_${randomToken(30)}`
  const tokenHash = hashToken(accessToken)

  return {
    tokenRecord: {
      tokenId: String(input.tokenId || '').trim() || `atk_${randomToken(16)}`,
      appId,
      environment,
      placementId,
      sourceTokenId: String(input.sourceTokenId || '').trim(),
      tokenHash,
      tokenType: 'agent_access_token',
      status: 'active',
      scope: input.scope && typeof input.scope === 'object'
        ? input.scope
        : createMinimalAgentScope(),
      issuedAt,
      expiresAt,
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      updatedAt,
    },
    accessToken,
  }
}

function normalizeAgentAccessTokenRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const tokenId = String(raw.tokenId || raw.token_id || raw.id || '').trim()
  if (!tokenId) return null

  const appId = String(raw.appId || raw.app_id || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(raw.environment)
  const placementId = String(raw.placementId || raw.placement_id || '').trim() || 'chat_inline_v1'
  const status = String(raw.status || '').trim().toLowerCase() || 'active'

  return {
    tokenId,
    appId,
    environment,
    placementId,
    sourceTokenId: String(raw.sourceTokenId || raw.source_token_id || '').trim(),
    tokenHash: String(raw.tokenHash || raw.token_hash || '').trim(),
    tokenType: 'agent_access_token',
    status: ['active', 'expired', 'revoked'].includes(status) ? status : 'active',
    scope: raw.scope && typeof raw.scope === 'object'
      ? raw.scope
      : createMinimalAgentScope(),
    issuedAt: String(raw.issuedAt || raw.issued_at || nowIso()),
    expiresAt: String(raw.expiresAt || raw.expires_at || nowIso()),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    updatedAt: String(raw.updatedAt || raw.updated_at || raw.issuedAt || raw.issued_at || nowIso()),
  }
}

function toPublicAgentAccessTokenRecord(record, plainToken = '') {
  const item = normalizeAgentAccessTokenRecord(record)
  if (!item) return null
  const issuedAtMs = Date.parse(item.issuedAt)
  const expiresAtMs = Date.parse(item.expiresAt)
  const ttlSeconds = (
    Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs > issuedAtMs
      ? Math.floor((expiresAtMs - issuedAtMs) / 1000)
      : 0
  )
  return {
    tokenId: item.tokenId,
    tokenType: item.tokenType,
    accessToken: plainToken || undefined,
    sourceTokenId: item.sourceTokenId,
    appId: item.appId,
    environment: item.environment,
    placementId: item.placementId,
    status: item.status,
    scope: item.scope,
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt,
    ttlSeconds,
  }
}

function cleanupExpiredIntegrationTokens() {
  const nowMs = Date.now()
  const rows = Array.isArray(state?.controlPlane?.integrationTokens) ? state.controlPlane.integrationTokens : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (String(row.status || '').toLowerCase() !== 'active') continue
    const expiresAtMs = Date.parse(String(row.expiresAt || ''))
    if (!Number.isFinite(expiresAtMs)) continue
    if (expiresAtMs > nowMs) continue
    row.status = 'expired'
    row.updatedAt = nowIso()
  }
}

function cleanupExpiredAgentAccessTokens() {
  const nowMs = Date.now()
  const rows = Array.isArray(state?.controlPlane?.agentAccessTokens) ? state.controlPlane.agentAccessTokens : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (String(row.status || '').toLowerCase() !== 'active') continue
    const expiresAtMs = Date.parse(String(row.expiresAt || ''))
    if (!Number.isFinite(expiresAtMs)) continue
    if (expiresAtMs > nowMs) continue
    row.status = 'expired'
    row.updatedAt = nowIso()
  }
}

function findIntegrationTokenByPlaintext(integrationToken) {
  const token = String(integrationToken || '').trim()
  if (!token) return null
  const tokenHash = hashToken(token)
  const rows = Array.isArray(state?.controlPlane?.integrationTokens) ? state.controlPlane.integrationTokens : []
  return rows.find((item) => String(item?.tokenHash || '') === tokenHash) || null
}

function findAgentAccessTokenByPlaintext(accessToken) {
  const token = String(accessToken || '').trim()
  if (!token) return null
  const tokenHash = hashToken(token)
  const rows = Array.isArray(state?.controlPlane?.agentAccessTokens) ? state.controlPlane.agentAccessTokens : []
  return rows.find((item) => String(item?.tokenHash || '') === tokenHash) || null
}

function parseBearerToken(req) {
  if (!req || !req.headers) return ''
  const authorization = String(req.headers.authorization || '').trim()
  if (!authorization) return ''
  const matched = authorization.match(/^bearer\s+(.+)$/i)
  if (!matched) return ''
  return String(matched[1] || '').trim()
}

function createInitialControlPlaneState() {
  const app = buildControlPlaneAppRecord({
    appId: DEFAULT_CONTROL_PLANE_APP_ID,
    displayName: 'Simulator Chatbot',
    organizationId: DEFAULT_CONTROL_PLANE_ORG_ID,
  })
  const appEnvironments = ['sandbox', 'staging', 'prod'].map((environment) => buildControlPlaneEnvironmentRecord({
    appId: app.appId,
    environment,
  }))
  const { keyRecord } = createControlPlaneKeyRecord({
    appId: app.appId,
    environment: 'staging',
    keyName: 'primary-staging',
    secret: resolveBootstrapApiKey('staging'),
  })

  return {
    apps: [app],
    appEnvironments,
    apiKeys: [keyRecord],
    integrationTokens: [],
    agentAccessTokens: [],
  }
}

function ensureControlPlaneState(raw) {
  const fallback = createInitialControlPlaneState()
  if (!raw || typeof raw !== 'object') return fallback

  const appRows = Array.isArray(raw.apps) ? raw.apps : []
  const apps = appRows
    .map((item) => buildControlPlaneAppRecord(item))
    .filter((item) => Boolean(item.appId))
  if (apps.length === 0) {
    apps.push(...fallback.apps)
  }

  const appIdSet = new Set(apps.map((item) => item.appId))
  if (!appIdSet.has(DEFAULT_CONTROL_PLANE_APP_ID)) {
    const app = buildControlPlaneAppRecord({
      appId: DEFAULT_CONTROL_PLANE_APP_ID,
      displayName: 'Simulator Chatbot',
      organizationId: DEFAULT_CONTROL_PLANE_ORG_ID,
    })
    apps.push(app)
    appIdSet.add(app.appId)
  }

  const environmentRows = Array.isArray(raw.appEnvironments || raw.environments)
    ? (raw.appEnvironments || raw.environments)
    : []
  const appEnvironments = []
  const envDedup = new Set()

  for (const row of environmentRows) {
    const normalized = buildControlPlaneEnvironmentRecord(row)
    if (!appIdSet.has(normalized.appId)) continue
    const dedupKey = `${normalized.appId}::${normalized.environment}`
    if (envDedup.has(dedupKey)) continue
    envDedup.add(dedupKey)
    appEnvironments.push(normalized)
  }

  for (const app of apps) {
    for (const environment of CONTROL_PLANE_ENVIRONMENTS) {
      const dedupKey = `${app.appId}::${environment}`
      if (envDedup.has(dedupKey)) continue
      envDedup.add(dedupKey)
      appEnvironments.push(buildControlPlaneEnvironmentRecord({
        appId: app.appId,
        environment,
      }))
    }
  }

  const keyRows = Array.isArray(raw.apiKeys || raw.keys) ? (raw.apiKeys || raw.keys) : []
  let apiKeys = keyRows
    .map((item) => normalizeControlPlaneKeyRecord(item))
    .filter((item) => item && appIdSet.has(item.appId))
  if (apiKeys.length === 0) {
    apiKeys = fallback.apiKeys
  }

  const bootstrapSecret = resolveBootstrapApiKey('staging')
  const bootstrapHash = hashToken(bootstrapSecret)
  const hasBootstrapKey = apiKeys.some((item) => (
    item
    && item.appId === DEFAULT_CONTROL_PLANE_APP_ID
    && item.environment === 'staging'
    && item.secretHash === bootstrapHash
    && item.status === 'active'
  ))
  if (!hasBootstrapKey) {
    const { keyRecord } = createControlPlaneKeyRecord({
      appId: DEFAULT_CONTROL_PLANE_APP_ID,
      environment: 'staging',
      keyName: 'primary-staging',
      secret: bootstrapSecret,
      status: 'active',
    })
    apiKeys.unshift(keyRecord)
  }

  const tokenRows = Array.isArray(raw.integrationTokens || raw.tokens)
    ? (raw.integrationTokens || raw.tokens)
    : []
  const integrationTokens = tokenRows
    .map((item) => normalizeIntegrationTokenRecord(item))
    .filter((item) => item && appIdSet.has(item.appId))
    .slice(0, MAX_INTEGRATION_TOKENS)

  const agentTokenRows = Array.isArray(raw.agentAccessTokens || raw.accessTokens)
    ? (raw.agentAccessTokens || raw.accessTokens)
    : []
  const agentAccessTokens = agentTokenRows
    .map((item) => normalizeAgentAccessTokenRecord(item))
    .filter((item) => item && appIdSet.has(item.appId))
    .slice(0, MAX_AGENT_ACCESS_TOKENS)

  return {
    apps,
    appEnvironments,
    apiKeys,
    integrationTokens,
    agentAccessTokens,
  }
}

function ensureControlPlaneAppAndEnvironment(appId, environment) {
  const normalizedAppId = String(appId || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const normalizedEnvironment = normalizeControlPlaneEnvironment(environment)
  const controlPlane = state.controlPlane

  let app = controlPlane.apps.find((item) => item.appId === normalizedAppId)
  if (!app) {
    app = buildControlPlaneAppRecord({
      appId: normalizedAppId,
      displayName: normalizedAppId,
      organizationId: DEFAULT_CONTROL_PLANE_ORG_ID,
    })
    controlPlane.apps.push(app)
  }

  const dedupKey = `${normalizedAppId}::${normalizedEnvironment}`
  const hasEnvironment = controlPlane.appEnvironments.some((item) => (
    `${item.appId}::${item.environment}` === dedupKey
  ))
  if (!hasEnvironment) {
    controlPlane.appEnvironments.push(buildControlPlaneEnvironmentRecord({
      appId: normalizedAppId,
      environment: normalizedEnvironment,
    }))
  }

  return {
    appId: normalizedAppId,
    environment: normalizedEnvironment,
  }
}

function createDecision(result, reasonDetail, intentScore) {
  const normalizedResult = DECISION_REASON_ENUM.has(result) ? result : 'error'
  const detail = String(reasonDetail || '').trim() || normalizedResult
  return {
    result: normalizedResult,
    reason: normalizedResult,
    reasonDetail: detail,
    intentScore,
  }
}

function createInitialNetworkFlowStats() {
  return {
    totalRuntimeEvaluations: 0,
    degradedRuntimeEvaluations: 0,
    resilientServes: 0,
    servedWithNetworkErrors: 0,
    noFillWithNetworkErrors: 0,
    runtimeErrors: 0,
    circuitOpenEvaluations: 0,
  }
}

function normalizeNetworkFlowStats(raw) {
  const fallback = createInitialNetworkFlowStats()
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    totalRuntimeEvaluations: toPositiveInteger(value.totalRuntimeEvaluations, fallback.totalRuntimeEvaluations),
    degradedRuntimeEvaluations: toPositiveInteger(value.degradedRuntimeEvaluations, fallback.degradedRuntimeEvaluations),
    resilientServes: toPositiveInteger(value.resilientServes, fallback.resilientServes),
    servedWithNetworkErrors: toPositiveInteger(value.servedWithNetworkErrors, fallback.servedWithNetworkErrors),
    noFillWithNetworkErrors: toPositiveInteger(value.noFillWithNetworkErrors, fallback.noFillWithNetworkErrors),
    runtimeErrors: toPositiveInteger(value.runtimeErrors, fallback.runtimeErrors),
    circuitOpenEvaluations: toPositiveInteger(value.circuitOpenEvaluations, fallback.circuitOpenEvaluations),
  }
}

function summarizeNetworkHealthMap(networkHealth = {}) {
  const items = Object.values(networkHealth || {})
  let healthy = 0
  let degraded = 0
  let open = 0

  for (const item of items) {
    const status = String(item?.status || '').toLowerCase()
    if (status === 'healthy') healthy += 1
    else if (status === 'degraded') degraded += 1
    else if (status === 'open') open += 1
  }

  return {
    totalNetworks: items.length,
    healthy,
    degraded,
    open,
  }
}

function validateNoExtraFields(payload, allowedFields, routeName) {
  const keys = Object.keys(payload)
  const extras = keys.filter((key) => !allowedFields.has(key))
  if (extras.length > 0) {
    throw new Error(`${routeName} contains unsupported fields: ${extras.join(', ')}`)
  }
}

function requiredNonEmptyString(value, fieldName) {
  const text = String(value || '').trim()
  if (!text) {
    throw new Error(`${fieldName} is required.`)
  }
  return text
}

function normalizeAttachEventKind(value) {
  const kind = String(value || '').trim().toLowerCase()
  if (!kind) return 'impression'
  if (kind === 'impression' || kind === 'click') return kind
  throw new Error('kind must be impression or click.')
}

function normalizeAttachMvpPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, ATTACH_MVP_ALLOWED_FIELDS, routeName)

  const requestId = String(input.requestId || '').trim()
  const appId = requiredNonEmptyString(input.appId, 'appId')
  const sessionId = requiredNonEmptyString(input.sessionId, 'sessionId')
  const turnId = requiredNonEmptyString(input.turnId, 'turnId')
  const query = requiredNonEmptyString(input.query, 'query')
  const answerText = requiredNonEmptyString(input.answerText, 'answerText')
  const locale = requiredNonEmptyString(input.locale, 'locale')
  const intentScore = clampNumber(input.intentScore, 0, 1, NaN)
  const kind = normalizeAttachEventKind(input.kind)
  const adId = String(input.adId || '').trim()
  const placementId = String(input.placementId || '').trim() || 'chat_inline_v1'

  if (!Number.isFinite(intentScore)) {
    throw new Error('intentScore is required and must be a number between 0 and 1.')
  }

  return {
    requestId,
    appId,
    sessionId,
    turnId,
    query,
    answerText,
    intentScore,
    locale,
    kind,
    adId,
    placementId,
  }
}

function isNextStepIntentCardPayload(payload) {
  if (!payload || typeof payload !== 'object') return false

  const placementKey = String(payload.placementKey || '').trim()
  if (placementKey === NEXT_STEP_INTENT_CARD_PLACEMENT_KEY) return true

  const event = String(payload.event || '').trim().toLowerCase()
  if (NEXT_STEP_INTENT_CARD_EVENTS.has(event)) return true

  const context = payload.context && typeof payload.context === 'object' ? payload.context : null
  if (!context) return false

  return (
    Object.prototype.hasOwnProperty.call(context, 'intent_class') ||
    Object.prototype.hasOwnProperty.call(context, 'intent_score') ||
    Object.prototype.hasOwnProperty.call(context, 'preference_facets')
  )
}

function normalizeNextStepRecentTurns(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const role = String(item.role || '').trim().toLowerCase()
      const content = String(item.content || '').trim()
      if (!role || !content) return null
      return { role, content }
    })
    .filter(Boolean)
    .slice(-8)
}

function normalizeNextStepPreferenceFacets(value) {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const facetKey = String(item.facet_key || item.facetKey || '').trim()
      const facetValue = String(item.facet_value || item.facetValue || '').trim()
      if (!facetKey || !facetValue) return null

      const confidence = clampNumber(item.confidence, 0, 1, NaN)
      const source = String(item.source || '').trim()

      return {
        facetKey,
        facetValue,
        confidence: Number.isFinite(confidence) ? confidence : null,
        source: source || '',
      }
    })
    .filter(Boolean)
}

function normalizeNextStepConstraints(value) {
  if (!value || typeof value !== 'object') return null
  const mustInclude = Array.isArray(value.must_include || value.mustInclude)
    ? (value.must_include || value.mustInclude).map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const mustExclude = Array.isArray(value.must_exclude || value.mustExclude)
    ? (value.must_exclude || value.mustExclude).map((item) => String(item || '').trim()).filter(Boolean)
    : []

  if (mustInclude.length === 0 && mustExclude.length === 0) return null
  return {
    mustInclude,
    mustExclude,
  }
}

function normalizeNextStepIntentCardPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, NEXT_STEP_INTENT_CARD_ALLOWED_FIELDS, routeName)

  const requestId = String(input.requestId || '').trim()
  const appId = requiredNonEmptyString(input.appId, 'appId')
  const sessionId = requiredNonEmptyString(input.sessionId, 'sessionId')
  const turnId = requiredNonEmptyString(input.turnId, 'turnId')
  const placementId = requiredNonEmptyString(input.placementId, 'placementId')
  const placementKey = requiredNonEmptyString(input.placementKey, 'placementKey')
  const event = String(input.event || '').trim().toLowerCase()
  const userId = String(input.userId || '').trim()

  if (placementKey !== NEXT_STEP_INTENT_CARD_PLACEMENT_KEY) {
    throw new Error(`placementKey must be ${NEXT_STEP_INTENT_CARD_PLACEMENT_KEY}.`)
  }

  if (!NEXT_STEP_INTENT_CARD_EVENTS.has(event)) {
    throw new Error('event must be followup_generation or follow_up_generation.')
  }

  const rawContext = input.context && typeof input.context === 'object' ? input.context : null
  if (!rawContext) {
    throw new Error('context is required.')
  }
  validateNoExtraFields(rawContext, NEXT_STEP_INTENT_CARD_CONTEXT_ALLOWED_FIELDS, `${routeName}.context`)

  const query = requiredNonEmptyString(rawContext.query, 'context.query')
  const locale = requiredNonEmptyString(rawContext.locale, 'context.locale')
  const rawIntentClass = String(rawContext.intent_class || rawContext.intentClass || '').trim().toLowerCase()
  const rawIntentScore = clampNumber(rawContext.intent_score ?? rawContext.intentScore, 0, 1, NaN)
  const rawPreferenceFacets = normalizeNextStepPreferenceFacets(
    rawContext.preference_facets ?? rawContext.preferenceFacets,
  )

  const expectedRevenue = clampNumber(rawContext.expected_revenue, 0, Number.MAX_SAFE_INTEGER, NaN)

  return {
    requestId,
    appId,
    sessionId,
    turnId,
    userId,
    event,
    placementId,
    placementKey,
    context: {
      query,
      answerText: String(rawContext.answerText || '').trim(),
      recentTurns: normalizeNextStepRecentTurns(rawContext.recent_turns),
      locale,
      intentClass: '',
      intentScore: 0,
      preferenceFacets: [],
      intentHints: {
        ...(rawIntentClass ? { intent_class: rawIntentClass } : {}),
        ...(Number.isFinite(rawIntentScore) ? { intent_score: rawIntentScore } : {}),
        ...(rawPreferenceFacets.length > 0 ? { preference_facets: rawPreferenceFacets.map((facet) => ({
          facet_key: facet.facetKey,
          facet_value: facet.facetValue,
          ...(Number.isFinite(facet.confidence) ? { confidence: facet.confidence } : {}),
          ...(facet.source ? { source: facet.source } : {}),
        })) } : {}),
      },
      constraints: normalizeNextStepConstraints(rawContext.constraints),
      blockedTopics: normalizeStringList(rawContext.blocked_topics),
      expectedRevenue: Number.isFinite(expectedRevenue) ? expectedRevenue : undefined,
    },
  }
}

function normalizeIntentCardRetrievePayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, INTENT_CARD_RETRIEVE_ALLOWED_FIELDS, routeName)

  const query = requiredNonEmptyString(input.query, 'query')
  const facets = normalizeNextStepPreferenceFacets(input.facets)
  const topK = toPositiveInteger(input.topK, 3) || 3
  const minScore = clampNumber(input.minScore, 0, 1, 0)
  const catalog = normalizeIntentCardCatalogItems(input.catalog)

  if (!Array.isArray(input.catalog)) {
    throw new Error('catalog must be an array.')
  }
  if (catalog.length === 0) {
    throw new Error('catalog must contain at least one valid item.')
  }

  return {
    query,
    facets,
    topK: Math.min(20, topK),
    minScore,
    catalog,
  }
}

function mapInferenceFacetsToInternal(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((facet) => {
      if (!facet || typeof facet !== 'object') return null
      const facetKey = String(facet.facet_key || '').trim()
      const facetValue = String(facet.facet_value || '').trim()
      if (!facetKey || !facetValue) return null
      const confidence = clampNumber(facet.confidence, 0, 1, NaN)
      const source = String(facet.source || '').trim()

      return {
        facetKey,
        facetValue,
        confidence: Number.isFinite(confidence) ? confidence : null,
        source: source || '',
      }
    })
    .filter(Boolean)
}

function mergeUniqueStrings(...values) {
  const set = new Set()
  for (const value of values) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      const normalized = String(item || '').trim()
      if (!normalized) continue
      set.add(normalized)
    }
  }
  return Array.from(set)
}

function mergeConstraints(primary, secondary) {
  const normalizedPrimary = normalizeNextStepConstraints(primary)
  const normalizedSecondary = normalizeNextStepConstraints(secondary)

  if (!normalizedPrimary && !normalizedSecondary) return null
  return {
    mustInclude: mergeUniqueStrings(normalizedPrimary?.mustInclude, normalizedSecondary?.mustInclude),
    mustExclude: mergeUniqueStrings(normalizedPrimary?.mustExclude, normalizedSecondary?.mustExclude),
  }
}

async function resolveIntentInferenceForNextStep(request) {
  const context = request?.context && typeof request.context === 'object' ? request.context : {}
  const hints = context.intentHints && typeof context.intentHints === 'object'
    ? context.intentHints
    : {}

  const inference = await inferIntentWithLlm({
    query: context.query || '',
    answerText: context.answerText || '',
    locale: context.locale || 'en-US',
    recentTurns: Array.isArray(context.recentTurns) ? context.recentTurns : [],
    hints,
  })

  const resolvedIntentClass = String(inference?.intent_class || 'non_commercial').trim().toLowerCase()
  const resolvedIntentScore = Number.isFinite(inference?.intent_score)
    ? clampNumber(inference.intent_score, 0, 1, 0)
    : 0
  const resolvedPreferenceFacets = mapInferenceFacetsToInternal(inference?.preference_facets)
  const resolvedConstraints = mergeConstraints(context.constraints, inference?.constraints)

  return {
    inference,
    resolvedContext: {
      ...context,
      intentClass: resolvedIntentClass || 'non_commercial',
      intentScore: resolvedIntentScore,
      preferenceFacets: resolvedPreferenceFacets,
      constraints: resolvedConstraints,
    },
  }
}

function mapRuntimeAdToNextStepCardItem(ad, index) {
  if (!ad || typeof ad !== 'object') return null
  const title = String(ad.title || '').trim()
  const targetUrl = String(ad.targetUrl || '').trim()
  if (!title || !targetUrl) return null

  const itemId = String(ad.offerId || ad.adId || ad.entityCanonicalId || `next_step_item_${index}`).trim()
  const merchantOrNetwork = String(ad.sourceNetwork || ad.networkId || 'affiliate').trim() || 'affiliate'
  const primaryReason = String(ad.reason || '').trim() || 'semantic_match'
  const tracking = ad.tracking && typeof ad.tracking === 'object' ? ad.tracking : {}
  const normalizedTracking = {}

  if (typeof tracking.impressionUrl === 'string' && tracking.impressionUrl.trim()) {
    normalizedTracking.impression_url = tracking.impressionUrl.trim()
  }
  if (typeof tracking.clickUrl === 'string' && tracking.clickUrl.trim()) {
    normalizedTracking.click_url = tracking.clickUrl.trim()
  }
  if (typeof tracking.dismissUrl === 'string' && tracking.dismissUrl.trim()) {
    normalizedTracking.dismiss_url = tracking.dismissUrl.trim()
  }

  const cardItem = {
    item_id: itemId,
    title,
    target_url: targetUrl,
    merchant_or_network: merchantOrNetwork,
    match_reasons: [primaryReason],
    disclosure: normalizeDisclosure(ad.disclosure),
  }

  if (typeof ad.description === 'string' && ad.description.trim()) {
    cardItem.snippet = ad.description.trim()
  }
  if (typeof ad.priceHint === 'string' && ad.priceHint.trim()) {
    cardItem.price_hint = ad.priceHint.trim()
  }
  if (typeof ad.relevanceScore === 'number' && Number.isFinite(ad.relevanceScore)) {
    cardItem.relevance_score = clampNumber(ad.relevanceScore, 0, 1, 0)
  }
  if (Object.keys(normalizedTracking).length > 0) {
    cardItem.tracking = normalizedTracking
  }

  return cardItem
}

function buildNextStepIntentCardResponse(result, request, inference) {
  const ads = Array.isArray(result?.ads)
    ? result.ads.map((item, index) => mapRuntimeAdToNextStepCardItem(item, index)).filter(Boolean)
    : []
  const intentScore = Number.isFinite(inference?.intent_score)
    ? inference.intent_score
    : Number.isFinite(request?.context?.intentScore)
      ? request.context.intentScore
      : 0
  const decision = result?.decision && typeof result.decision === 'object' ? result.decision : {}
  const constraints = inference?.constraints || request?.context?.constraints

  const response = {
    requestId: result?.requestId || createId('adreq'),
    placementId: result?.placementId || request?.placementId || '',
    placementKey: NEXT_STEP_INTENT_CARD_PLACEMENT_KEY,
    decision: {
      result: DECISION_REASON_ENUM.has(decision.result) ? decision.result : 'error',
      reason: DECISION_REASON_ENUM.has(decision.reason) ? decision.reason : 'error',
      reasonDetail: String(decision.reasonDetail || decision.result || 'error'),
      intent_score: Number.isFinite(decision.intentScore) ? decision.intentScore : intentScore,
    },
    intent_inference: {
      intent_class: String(inference?.intent_class || request?.context?.intentClass || 'non_commercial'),
      intent_score: intentScore,
      preference_facets: Array.isArray(inference?.preference_facets) ? inference.preference_facets : [],
    },
    ads,
    meta: {
      selected_count: ads.length,
      model_version: String(inference?.model || ''),
      inference_fallback: Boolean(inference?.fallbackUsed),
      inference_fallback_reason: String(inference?.fallbackReason || ''),
    },
  }

  if (constraints) {
    response.intent_inference.constraints = {
      ...(constraints.mustInclude?.length ? { must_include: constraints.mustInclude } : {}),
      ...(constraints.mustExclude?.length ? { must_exclude: constraints.mustExclude } : {}),
      ...(constraints.must_include?.length ? { must_include: constraints.must_include } : {}),
      ...(constraints.must_exclude?.length ? { must_exclude: constraints.must_exclude } : {}),
    }
  }

  if (Array.isArray(inference?.inference_trace) && inference.inference_trace.length > 0) {
    response.intent_inference.inference_trace = inference.inference_trace.slice(0, 8)
  }

  return response
}

function toPositiveInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

function layerFromPlacementKey(placementKey = '') {
  if (placementKey.startsWith('attach.')) return 'attach'
  if (placementKey.startsWith('next_step.')) return 'next_step'
  if (placementKey.startsWith('intervention.')) return 'intervention'
  if (placementKey.startsWith('takeover.')) return 'takeover'
  return 'unknown'
}

function normalizePlacement(raw) {
  const placementId = String(raw?.placementId || '').trim()
  const placementKey = String(raw?.placementKey || PLACEMENT_KEY_BY_ID[placementId] || '').trim()

  return {
    placementId,
    placementKey,
    configVersion: toPositiveInteger(raw?.configVersion, 1),
    enabled: raw?.enabled !== false,
    disclosure: normalizeDisclosure(raw?.disclosure),
    priority: toPositiveInteger(raw?.priority, 100),
    routingMode: MANAGED_ROUTING_MODE,
    surface: String(raw?.surface || 'CHAT_INLINE'),
    format: String(raw?.format || 'CARD'),
    trigger: {
      intentThreshold: clampNumber(raw?.trigger?.intentThreshold, 0, 1, 0.6),
      cooldownSeconds: toPositiveInteger(raw?.trigger?.cooldownSeconds, 0),
      minExpectedRevenue: clampNumber(raw?.trigger?.minExpectedRevenue, 0, Number.MAX_SAFE_INTEGER, 0),
      blockedTopics: normalizeStringList(raw?.trigger?.blockedTopics),
    },
    frequencyCap: {
      maxPerSession: toPositiveInteger(raw?.frequencyCap?.maxPerSession, 0),
      maxPerUserPerDay: toPositiveInteger(raw?.frequencyCap?.maxPerUserPerDay, 0),
    },
  }
}

function getTodayKey(timestamp = Date.now()) {
  const d = new Date(timestamp)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function createDailyMetricsSeed(days = 7) {
  const rows = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)
    rows.push({
      date: getTodayKey(date.getTime()),
      impressions: 0,
      clicks: 0,
      revenueUsd: 0,
    })
  }
  return rows
}

function ensureDailyMetricsWindow(dailyMetrics = []) {
  const rows = Array.isArray(dailyMetrics) ? [...dailyMetrics] : []
  const known = new Set(rows.map((row) => row.date))
  const seed = createDailyMetricsSeed(7)

  for (const item of seed) {
    if (!known.has(item.date)) rows.push(item)
  }

  rows.sort((a, b) => a.date.localeCompare(b.date))
  return rows.slice(-7)
}

function initialPlacementStats(placements) {
  const stats = {}
  for (const placement of placements) {
    stats[placement.placementId] = {
      requests: 0,
      served: 0,
      impressions: 0,
      clicks: 0,
      revenueUsd: 0,
    }
  }
  return stats
}

function createInitialState() {
  const placements = defaultPlacements.map((item) => normalizePlacement(item))
  const placementConfigVersion = Math.max(1, ...placements.map((placement) => placement.configVersion || 1))

  return {
    version: 4,
    updatedAt: nowIso(),
    placementConfigVersion,
    placements,
    placementAuditLogs: [],
    controlPlaneAuditLogs: [],
    networkFlowStats: createInitialNetworkFlowStats(),
    networkFlowLogs: [],
    decisionLogs: [],
    eventLogs: [],
    globalStats: {
      requests: 0,
      served: 0,
      impressions: 0,
      clicks: 0,
      revenueUsd: 0,
    },
    placementStats: initialPlacementStats(placements),
    dailyMetrics: createDailyMetricsSeed(7),
    controlPlane: createInitialControlPlaneState(),
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return createInitialState()
    const raw = fs.readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return createInitialState()

    const placements = Array.isArray(parsed.placements)
      ? parsed.placements.map((item) => normalizePlacement(item))
      : defaultPlacements.map((item) => normalizePlacement(item))
    const derivedPlacementConfigVersion = Math.max(1, ...placements.map((placement) => placement.configVersion || 1))
    const placementConfigVersion = Math.max(
      toPositiveInteger(parsed?.placementConfigVersion, 1),
      derivedPlacementConfigVersion,
    )

    const placementStats = parsed.placementStats && typeof parsed.placementStats === 'object'
      ? parsed.placementStats
      : initialPlacementStats(placements)

    for (const placement of placements) {
      if (!placementStats[placement.placementId]) {
        placementStats[placement.placementId] = {
          requests: 0,
          served: 0,
          impressions: 0,
          clicks: 0,
          revenueUsd: 0,
        }
      }
    }

    return {
      version: toPositiveInteger(parsed?.version, 4),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      placementConfigVersion,
      placements,
      placementAuditLogs: Array.isArray(parsed.placementAuditLogs)
        ? parsed.placementAuditLogs.slice(0, MAX_PLACEMENT_AUDIT_LOGS)
        : [],
      controlPlaneAuditLogs: Array.isArray(parsed.controlPlaneAuditLogs)
        ? parsed.controlPlaneAuditLogs.slice(0, MAX_CONTROL_PLANE_AUDIT_LOGS)
        : [],
      networkFlowStats: normalizeNetworkFlowStats(parsed?.networkFlowStats),
      networkFlowLogs: Array.isArray(parsed.networkFlowLogs)
        ? parsed.networkFlowLogs.slice(0, MAX_NETWORK_FLOW_LOGS)
        : [],
      decisionLogs: Array.isArray(parsed.decisionLogs) ? parsed.decisionLogs.slice(0, MAX_DECISION_LOGS) : [],
      eventLogs: Array.isArray(parsed.eventLogs) ? parsed.eventLogs.slice(0, MAX_EVENT_LOGS) : [],
      globalStats: {
        requests: toPositiveInteger(parsed?.globalStats?.requests, 0),
        served: toPositiveInteger(parsed?.globalStats?.served, 0),
        impressions: toPositiveInteger(parsed?.globalStats?.impressions, 0),
        clicks: toPositiveInteger(parsed?.globalStats?.clicks, 0),
        revenueUsd: clampNumber(parsed?.globalStats?.revenueUsd, 0, Number.MAX_SAFE_INTEGER, 0),
      },
      placementStats,
      dailyMetrics: ensureDailyMetricsWindow(parsed.dailyMetrics),
      controlPlane: ensureControlPlaneState(parsed.controlPlane),
    }
  } catch (error) {
    console.error('[simulator-gateway] Failed to load state, fallback to initial state:', error)
    return createInitialState()
  }
}

function persistState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ ...state, updatedAt: nowIso() }, null, 2),
      'utf-8',
    )
  } catch (error) {
    console.error('[simulator-gateway] Failed to persist state:', error)
  }
}

function clearRuntimeMemory() {
  runtimeMemory.cooldownBySessionPlacement.clear()
  runtimeMemory.perSessionPlacementCount.clear()
  runtimeMemory.perUserPlacementDayCount.clear()
}

let state = loadState()

function resetGatewayState() {
  state = createInitialState()
  clearRuntimeMemory()
  persistState(state)
  return state
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-dashboard-actor,x-user-id')
}

function sendJson(res, statusCode, payload) {
  withCors(res)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function sendNotFound(res) {
  sendJson(res, 404, {
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found.',
    },
  })
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON payload'))
      }
    })
    req.on('error', reject)
  })
}

function appendDailyMetric({ impressions = 0, clicks = 0, revenueUsd = 0 }) {
  state.dailyMetrics = ensureDailyMetricsWindow(state.dailyMetrics)
  const today = getTodayKey()
  const row = state.dailyMetrics.find((item) => item.date === today)
  if (!row) return

  row.impressions += Math.max(0, impressions)
  row.clicks += Math.max(0, clicks)
  row.revenueUsd = round(row.revenueUsd + Math.max(0, revenueUsd), 4)
}

function ensurePlacementStats(placementId) {
  if (!state.placementStats[placementId]) {
    state.placementStats[placementId] = {
      requests: 0,
      served: 0,
      impressions: 0,
      clicks: 0,
      revenueUsd: 0,
    }
  }
  return state.placementStats[placementId]
}

function recordDecision(payload) {
  state.decisionLogs = [
    {
      id: createId('decision'),
      createdAt: nowIso(),
      ...payload,
    },
    ...state.decisionLogs,
  ].slice(0, MAX_DECISION_LOGS)
}

function recordEvent(payload) {
  state.eventLogs = [
    {
      id: createId('event'),
      createdAt: nowIso(),
      ...payload,
    },
    ...state.eventLogs,
  ].slice(0, MAX_EVENT_LOGS)
}

function recordPlacementAudit(payload) {
  state.placementAuditLogs = [
    {
      id: createId('placement_audit'),
      createdAt: nowIso(),
      ...payload,
    },
    ...state.placementAuditLogs,
  ].slice(0, MAX_PLACEMENT_AUDIT_LOGS)
}

function resolveAuditActor(req, fallback = 'dashboard') {
  if (!req || !req.headers) return fallback
  const actor = String(req.headers['x-dashboard-actor'] || req.headers['x-user-id'] || '').trim()
  return actor || fallback
}

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
}

function isLoopbackHost(value) {
  const host = normalizeHost(value)
  if (!host) return false
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host.startsWith('127.')) return true
  return false
}

function requiresProtectedReset() {
  return !isLoopbackHost(HOST)
}

function authorizeDevReset(req) {
  if (!DEV_RESET_ENABLED) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'RESET_DISABLED',
        message: 'Reset endpoint is disabled by simulator policy.',
      },
    }
  }

  if (!requiresProtectedReset()) {
    return { ok: true, mode: 'loopback_bind' }
  }

  const providedToken = String(req?.headers?.['x-simulator-reset-token'] || '').trim()
  if (DEV_RESET_TOKEN && providedToken && providedToken === DEV_RESET_TOKEN) {
    return { ok: true, mode: 'token' }
  }

  return {
    ok: false,
    status: 403,
    error: {
      code: 'RESET_FORBIDDEN',
      message: DEV_RESET_TOKEN
        ? 'Reset endpoint requires x-simulator-reset-token when gateway is publicly bound.'
        : 'Reset endpoint is blocked on non-loopback bind. Configure SIMULATOR_DEV_RESET_TOKEN to allow internal reset.',
    },
  }
}

function recordControlPlaneAudit(payload) {
  state.controlPlaneAuditLogs = [
    {
      id: createId('cp_audit'),
      createdAt: nowIso(),
      ...payload,
    },
    ...state.controlPlaneAuditLogs,
  ].slice(0, MAX_CONTROL_PLANE_AUDIT_LOGS)
}

function queryControlPlaneAudits(searchParams) {
  const action = String(searchParams.get('action') || '').trim().toLowerCase()
  const appId = String(searchParams.get('appId') || '').trim()
  const resourceType = String(searchParams.get('resourceType') || '').trim().toLowerCase()
  const resourceId = String(searchParams.get('resourceId') || '').trim()
  const environment = String(searchParams.get('environment') || '').trim().toLowerCase()
  const actor = String(searchParams.get('actor') || '').trim().toLowerCase()
  const limit = clampNumber(searchParams.get('limit'), 1, 500, 100)

  let rows = [...state.controlPlaneAuditLogs]
  if (action) {
    rows = rows.filter((row) => String(row?.action || '').toLowerCase() === action)
  }
  if (appId) {
    rows = rows.filter((row) => String(row?.appId || '') === appId)
  }
  if (resourceType) {
    rows = rows.filter((row) => String(row?.resourceType || '').toLowerCase() === resourceType)
  }
  if (resourceId) {
    rows = rows.filter((row) => String(row?.resourceId || '') === resourceId)
  }
  if (environment) {
    rows = rows.filter((row) => String(row?.environment || '').toLowerCase() === environment)
  }
  if (actor) {
    rows = rows.filter((row) => String(row?.actor || '').toLowerCase() === actor)
  }

  return rows.slice(0, Math.floor(limit))
}

function recordNetworkFlowObservation(payload) {
  state.networkFlowLogs = [
    {
      id: createId('network_flow'),
      createdAt: nowIso(),
      ...payload,
    },
    ...state.networkFlowLogs,
  ].slice(0, MAX_NETWORK_FLOW_LOGS)
}

function recordRuntimeNetworkStats(decisionResult, runtimeDebug, meta = {}) {
  const stats = state.networkFlowStats
  stats.totalRuntimeEvaluations += 1

  const networkErrors = Array.isArray(runtimeDebug?.networkErrors) ? runtimeDebug.networkErrors : []
  const snapshotUsage = runtimeDebug?.snapshotUsage && typeof runtimeDebug.snapshotUsage === 'object'
    ? runtimeDebug.snapshotUsage
    : {}
  const networkHealth = runtimeDebug?.networkHealth && typeof runtimeDebug.networkHealth === 'object'
    ? runtimeDebug.networkHealth
    : getAllNetworkHealth()

  const hasSnapshotFallback = Object.values(snapshotUsage).some(Boolean)
  const healthSummary = summarizeNetworkHealthMap(networkHealth)
  const hasNetworkError = networkErrors.length > 0
  const runtimeError = meta.runtimeError === true
  const failOpenApplied = meta.failOpenApplied === true || runtimeError
  const isDegraded =
    runtimeError || hasNetworkError || hasSnapshotFallback || healthSummary.degraded > 0 || healthSummary.open > 0

  if (isDegraded) {
    stats.degradedRuntimeEvaluations += 1
  }

  if (decisionResult === 'served' && isDegraded) {
    stats.resilientServes += 1
  }

  if (decisionResult === 'served' && hasNetworkError) {
    stats.servedWithNetworkErrors += 1
  }

  if (decisionResult === 'no_fill' && hasNetworkError) {
    stats.noFillWithNetworkErrors += 1
  }

  if (decisionResult === 'error' || runtimeError) {
    stats.runtimeErrors += 1
  }

  if (healthSummary.open > 0) {
    stats.circuitOpenEvaluations += 1
  }

  recordNetworkFlowObservation({
    requestId: meta.requestId || '',
    placementId: meta.placementId || '',
    decisionResult: decisionResult || '',
    runtimeError,
    failOpenApplied,
    networkErrors,
    snapshotUsage,
    networkHealthSummary: healthSummary,
  })
}

function computeMetricsSummary() {
  const impressions = state.globalStats.impressions
  const clicks = state.globalStats.clicks
  const revenueUsd = state.globalStats.revenueUsd
  const requests = state.globalStats.requests
  const served = state.globalStats.served

  const ctr = impressions > 0 ? clicks / impressions : 0
  const ecpm = impressions > 0 ? (revenueUsd / impressions) * 1000 : 0
  const fillRate = requests > 0 ? served / requests : 0

  return {
    revenueUsd: round(revenueUsd, 2),
    impressions,
    clicks,
    ctr: round(ctr, 4),
    ecpm: round(ecpm, 2),
    fillRate: round(fillRate, 4),
  }
}

function computeMetricsByDay() {
  state.dailyMetrics = ensureDailyMetricsWindow(state.dailyMetrics)
  return state.dailyMetrics.map((row) => ({
    day: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
    revenueUsd: round(row.revenueUsd, 2),
    impressions: row.impressions,
    clicks: row.clicks,
  }))
}

function computeMetricsByPlacement() {
  return state.placements.map((placement) => {
    const stats = ensurePlacementStats(placement.placementId)
    const ctr = stats.impressions > 0 ? stats.clicks / stats.impressions : 0
    const fillRate = stats.requests > 0 ? stats.served / stats.requests : 0

    return {
      placementId: placement.placementId,
      layer: layerFromPlacementKey(placement.placementKey),
      revenueUsd: round(stats.revenueUsd, 2),
      ctr: round(ctr, 4),
      fillRate: round(fillRate, 4),
    }
  })
}

function placementMatchesSelector(placement, request) {
  const requestedPlacementId = String(request.placementId || '').trim()
  const requestedPlacementKey = String(request.placementKey || '').trim()
  const event = String(request.event || '').trim().toLowerCase()

  if (requestedPlacementId) return placement.placementId === requestedPlacementId
  if (requestedPlacementKey) return placement.placementKey === requestedPlacementKey

  const surface = EVENT_SURFACE_MAP[event]
  if (!surface) return true
  return placement.surface === surface
}

function pickPlacementForRequest(request) {
  return state.placements
    .filter((placement) => placementMatchesSelector(placement, request))
    .sort((a, b) => a.priority - b.priority)[0] || null
}

function getSessionPlacementKey(sessionId, placementId) {
  return `${sessionId}::${placementId}`
}

function getUserPlacementDayKey(userId, placementId) {
  return `${userId}::${placementId}::${getTodayKey()}`
}

function recordServeCounters(placement, request, revenueUsd) {
  const placementStats = ensurePlacementStats(placement.placementId)

  state.globalStats.requests += 1
  state.globalStats.served += 1
  state.globalStats.impressions += 1
  state.globalStats.revenueUsd = round(state.globalStats.revenueUsd + revenueUsd, 4)

  placementStats.requests += 1
  placementStats.served += 1
  placementStats.impressions += 1
  placementStats.revenueUsd = round(placementStats.revenueUsd + revenueUsd, 4)

  appendDailyMetric({ impressions: 1, revenueUsd })

  const sessionId = String(request.sessionId || '').trim()
  if (sessionId) {
    const key = getSessionPlacementKey(sessionId, placement.placementId)
    runtimeMemory.perSessionPlacementCount.set(key, (runtimeMemory.perSessionPlacementCount.get(key) || 0) + 1)
    runtimeMemory.cooldownBySessionPlacement.set(key, Date.now())
  }

  const userId = String(request.userId || '').trim()
  if (userId) {
    const dayKey = getUserPlacementDayKey(userId, placement.placementId)
    runtimeMemory.perUserPlacementDayCount.set(dayKey, (runtimeMemory.perUserPlacementDayCount.get(dayKey) || 0) + 1)
  }
}

function recordClickCounters(placementId) {
  const normalizedPlacementId = String(placementId || '').trim() || 'chat_inline_v1'
  const placementStats = ensurePlacementStats(normalizedPlacementId)
  state.globalStats.clicks += 1
  placementStats.clicks += 1
  appendDailyMetric({ clicks: 1 })
}

function recordBlockedOrNoFill(placement) {
  const placementStats = ensurePlacementStats(placement.placementId)
  state.globalStats.requests += 1
  placementStats.requests += 1
}

function matchBlockedTopic(context, blockedTopics) {
  if (!blockedTopics.length) return ''
  const corpus = `${String(context?.query || '')} ${String(context?.answerText || '')}`.toLowerCase()
  for (const topic of blockedTopics) {
    if (corpus.includes(topic)) return topic
  }
  return ''
}

function resolveIntentPostRulePolicy(request, placement) {
  const context = request?.context && typeof request.context === 'object' ? request.context : {}
  const placementBlockedTopics = normalizeStringList(placement?.trigger?.blockedTopics)
  const requestBlockedTopics = normalizeStringList(context?.blockedTopics)

  const isNextStepIntentCard = String(placement?.placementKey || '').trim() === NEXT_STEP_INTENT_CARD_PLACEMENT_KEY
  if (!isNextStepIntentCard) {
    return {
      intentThreshold: clampNumber(placement?.trigger?.intentThreshold, 0, 1, 0.6),
      cooldownSeconds: toPositiveInteger(placement?.trigger?.cooldownSeconds, 0),
      maxPerSession: toPositiveInteger(placement?.frequencyCap?.maxPerSession, 0),
      maxPerUserPerDay: toPositiveInteger(placement?.frequencyCap?.maxPerUserPerDay, 0),
      blockedTopics: mergeNormalizedStringLists(placementBlockedTopics, requestBlockedTopics),
    }
  }

  const placementIntentThreshold = clampNumber(placement?.trigger?.intentThreshold, 0, 1, 0)
  const placementCooldownSeconds = toPositiveInteger(placement?.trigger?.cooldownSeconds, 0)
  const placementMaxPerSession = toPositiveInteger(placement?.frequencyCap?.maxPerSession, 0)
  const placementMaxPerUserPerDay = toPositiveInteger(placement?.frequencyCap?.maxPerUserPerDay, 0)

  return {
    intentThreshold: Math.max(placementIntentThreshold, NEXT_STEP_INTENT_POST_RULES.intentThresholdFloor),
    cooldownSeconds: Math.max(placementCooldownSeconds, NEXT_STEP_INTENT_POST_RULES.cooldownSeconds),
    maxPerSession: placementMaxPerSession > 0 ? placementMaxPerSession : NEXT_STEP_INTENT_POST_RULES.maxPerSession,
    maxPerUserPerDay: placementMaxPerUserPerDay > 0
      ? placementMaxPerUserPerDay
      : NEXT_STEP_INTENT_POST_RULES.maxPerUserPerDay,
    blockedTopics: mergeNormalizedStringLists(
      placementBlockedTopics,
      requestBlockedTopics,
      NEXT_STEP_SENSITIVE_TOPICS,
    ),
  }
}

function buildRuntimeAdRequest(request, placement, intentScore) {
  const context = request?.context && typeof request.context === 'object' ? request.context : {}
  return {
    appId: String(request?.appId || '').trim(),
    sessionId: String(request?.sessionId || '').trim(),
    userId: String(request?.userId || '').trim(),
    placementId: placement?.placementKey || placement?.placementId || ATTACH_MVP_PLACEMENT_KEY,
    context: {
      query: String(context.query || '').trim(),
      answerText: String(context.answerText || '').trim(),
      locale: String(context.locale || '').trim() || 'en-US',
      intentScore,
      intentClass: String(context.intentClass || '').trim(),
    },
  }
}

function summarizeRuntimeDebug(debug) {
  if (!debug || typeof debug !== 'object') return {}
  const entityItems = Array.isArray(debug.entities)
    ? debug.entities
      .map((item) => {
        const entityText = String(item?.entityText || '').trim()
        const normalizedText = String(item?.normalizedText || '').trim()
        const entityType = String(item?.entityType || '').trim()
        const confidence = Number(item?.confidence)
        if (!entityText && !normalizedText) return null
        return {
          entityText,
          normalizedText,
          entityType,
          confidence: Number.isFinite(confidence) ? confidence : 0,
        }
      })
      .filter(Boolean)
    : []
  const networkErrors = Array.isArray(debug.networkErrors)
    ? debug.networkErrors.map((item) => ({
        network: item?.network || '',
        errorCode: item?.errorCode || '',
        message: item?.message || '',
      }))
    : []

  return {
    entities: entityItems.length,
    entityItems,
    totalOffers: Number.isFinite(debug.totalOffers) ? debug.totalOffers : 0,
    selectedOffers: Number.isFinite(debug.selectedOffers) ? debug.selectedOffers : 0,
    matchedCandidates: Number.isFinite(debug.matchedCandidates) ? debug.matchedCandidates : 0,
    unmatchedOffers: Number.isFinite(debug.unmatchedOffers) ? debug.unmatchedOffers : 0,
    noFillReason: String(debug.noFillReason || '').trim(),
    keywords: String(debug.keywords || '').trim(),
    ner: debug.ner && typeof debug.ner === 'object'
      ? {
          status: String(debug.ner.status || '').trim(),
          message: String(debug.ner.message || '').trim(),
          model: String(debug.ner.model || '').trim(),
        }
      : {},
    networkHits: debug.networkHits && typeof debug.networkHits === 'object' ? debug.networkHits : {},
    networkErrors,
    snapshotUsage: debug.snapshotUsage && typeof debug.snapshotUsage === 'object' ? debug.snapshotUsage : {},
    networkHealth: debug.networkHealth && typeof debug.networkHealth === 'object' ? debug.networkHealth : {},
  }
}

function clipText(value, maxLength = 800) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function normalizeIntentInferenceMeta(value, options = {}) {
  const input = value && typeof value === 'object' ? value : {}
  const force = options?.force === true
  const inferenceFallbackReason = String(
    input.inferenceFallbackReason || input.fallbackReason || '',
  ).trim()
  const inferenceModel = String(input.inferenceModel || input.model || '').trim()
  const inferenceLatencyMs = toPositiveInteger(input.inferenceLatencyMs, 0)

  if (!force && !inferenceFallbackReason && !inferenceModel && inferenceLatencyMs === 0) {
    return null
  }

  return {
    inferenceFallbackReason,
    inferenceModel,
    inferenceLatencyMs,
  }
}

function buildDecisionInputSnapshot(request, placement, intentScore) {
  const context = request?.context && typeof request.context === 'object' ? request.context : {}
  const placementKey = String(placement?.placementKey || request?.placementKey || '').trim()
  const isNextStepIntentCard = placementKey === NEXT_STEP_INTENT_CARD_PLACEMENT_KEY
  const postRulePolicy = context?.postRulePolicy && typeof context.postRulePolicy === 'object'
    ? context.postRulePolicy
    : null
  const intentInference = normalizeIntentInferenceMeta(context.intentInferenceMeta, {
    force: isNextStepIntentCard,
  })

  return {
    appId: String(request?.appId || '').trim(),
    sessionId: String(request?.sessionId || '').trim(),
    turnId: String(request?.turnId || '').trim(),
    event: String(request?.event || '').trim(),
    placementId: String(placement?.placementId || '').trim(),
    placementKey,
    query: clipText(context.query, 280),
    answerText: clipText(context.answerText, 800),
    locale: String(context.locale || '').trim(),
    intentClass: String(context.intentClass || '').trim(),
    intentScore: Number.isFinite(intentScore) ? intentScore : 0,
    ...(intentInference ? { intentInference } : {}),
    ...(postRulePolicy
      ? {
          postRules: {
            intentThreshold: Number(postRulePolicy.intentThreshold) || 0,
            cooldownSeconds: toPositiveInteger(postRulePolicy.cooldownSeconds, 0),
            maxPerSession: toPositiveInteger(postRulePolicy.maxPerSession, 0),
            maxPerUserPerDay: toPositiveInteger(postRulePolicy.maxPerUserPerDay, 0),
            blockedTopicCount: Array.isArray(postRulePolicy.blockedTopics) ? postRulePolicy.blockedTopics.length : 0,
          },
        }
      : {}),
  }
}

function summarizeAdsForDecisionLog(ads) {
  if (!Array.isArray(ads)) return []
  return ads
    .map((item) => {
      const ad = item && typeof item === 'object' ? item : null
      if (!ad) return null
      const adId = String(ad.adId || '').trim()
      const title = String(ad.title || '').trim()
      const targetUrl = String(ad.targetUrl || '').trim()
      if (!adId && !title && !targetUrl) return null
      return {
        adId,
        title,
        entityText: String(ad.entityText || '').trim(),
        sourceNetwork: String(ad.sourceNetwork || '').trim(),
        reason: String(ad.reason || '').trim(),
        targetUrl: clipText(targetUrl, 240),
      }
    })
    .filter(Boolean)
}

function recordDecisionForRequest({ request, placement, requestId, decision, runtime, ads }) {
  const result = DECISION_REASON_ENUM.has(decision?.result) ? decision.result : 'error'
  const reason = DECISION_REASON_ENUM.has(decision?.reason) ? decision.reason : 'error'
  const context = request?.context && typeof request.context === 'object' ? request.context : {}
  const placementKey = String(placement?.placementKey || request?.placementKey || '').trim()
  const isNextStepIntentCard = placementKey === NEXT_STEP_INTENT_CARD_PLACEMENT_KEY
  const intentInference = normalizeIntentInferenceMeta(context.intentInferenceMeta, {
    force: isNextStepIntentCard,
  })

  const payload = {
    requestId,
    appId: request?.appId || '',
    sessionId: request?.sessionId || '',
    turnId: request?.turnId || '',
    event: request?.event || '',
    placementId: placement?.placementId || '',
    placementKey,
    result,
    reason,
    reasonDetail: decision?.reasonDetail || '',
    intentScore: Number.isFinite(decision?.intentScore) ? decision.intentScore : 0,
    input: buildDecisionInputSnapshot(request, placement, decision?.intentScore),
    ads: summarizeAdsForDecisionLog(ads),
    ...(intentInference ? { intentInference } : {}),
  }

  if (runtime && typeof runtime === 'object') {
    payload.runtime = runtime
  }

  recordDecision(payload)
  recordEvent({
    eventType: 'decision',
    requestId: payload.requestId || '',
    appId: payload.appId || '',
    sessionId: payload.sessionId || '',
    turnId: payload.turnId || '',
    placementId: payload.placementId || '',
    placementKey: payload.placementKey || '',
    event: payload.event || '',
    result,
    reason,
    reasonDetail: payload.reasonDetail || '',
  })
}

async function evaluateRequest(payload) {
  const request = payload && typeof payload === 'object' ? payload : {}
  const context = request.context && typeof request.context === 'object' ? request.context : {}
  const intentScore = clampNumber(context.intentScore, 0, 1, 0)
  const intentClass = String(context.intentClass || '').trim().toLowerCase()

  const placement = pickPlacementForRequest(request)
  const requestId = createId('adreq')

  if (!placement) {
    const decision = createDecision('blocked', 'placement_not_configured', intentScore)
    recordDecisionForRequest({
      request,
      placement: null,
      requestId,
      decision,
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      placementId: '',
      decision,
      ads: [],
    }
  }

  if (!placement.enabled) {
    const decision = createDecision('blocked', 'placement_disabled', intentScore)
    recordBlockedOrNoFill(placement)
    recordDecisionForRequest({
      request,
      placement,
      requestId,
      decision,
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision,
      ads: [],
    }
  }

  const postRulePolicy = resolveIntentPostRulePolicy(request, placement)
  context.postRulePolicy = postRulePolicy
  const blockedTopic = matchBlockedTopic(context, postRulePolicy.blockedTopics)
  if (blockedTopic) {
    const decision = createDecision('blocked', `blocked_topic:${blockedTopic}`, intentScore)
    recordBlockedOrNoFill(placement)
    recordDecisionForRequest({
      request,
      placement,
      requestId,
      decision,
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision,
      ads: [],
    }
  }

  if (placement.placementKey === NEXT_STEP_INTENT_CARD_PLACEMENT_KEY && intentClass === 'non_commercial') {
    const decision = createDecision('blocked', 'intent_non_commercial', intentScore)
    recordBlockedOrNoFill(placement)
    recordDecisionForRequest({
      request,
      placement,
      requestId,
      decision,
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision,
      ads: [],
    }
  }

  if (intentScore < postRulePolicy.intentThreshold) {
    const decision = createDecision('blocked', 'intent_below_threshold', intentScore)
    recordBlockedOrNoFill(placement)
    recordDecisionForRequest({
      request,
      placement,
      requestId,
      decision,
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision,
      ads: [],
    }
  }

  const sessionId = String(request.sessionId || '').trim()
  const userId = String(request.userId || '').trim()

  if (postRulePolicy.cooldownSeconds > 0 && sessionId) {
    const cooldownKey = getSessionPlacementKey(sessionId, placement.placementId)
    const lastTs = runtimeMemory.cooldownBySessionPlacement.get(cooldownKey) || 0
    const withinCooldown = Date.now() - lastTs < postRulePolicy.cooldownSeconds * 1000
    if (withinCooldown) {
      const decision = createDecision('blocked', 'cooldown', intentScore)
      recordBlockedOrNoFill(placement)
      recordDecisionForRequest({
        request,
        placement,
        requestId,
        decision,
        ads: [],
      })
      persistState(state)
      return {
        requestId,
        placementId: placement.placementId,
        decision,
        ads: [],
      }
    }
  }

  if (postRulePolicy.maxPerSession > 0 && sessionId) {
    const sessionCapKey = getSessionPlacementKey(sessionId, placement.placementId)
    const count = runtimeMemory.perSessionPlacementCount.get(sessionCapKey) || 0
    if (count >= postRulePolicy.maxPerSession) {
      const decision = createDecision('blocked', 'frequency_cap_session', intentScore)
      recordBlockedOrNoFill(placement)
      recordDecisionForRequest({
        request,
        placement,
        requestId,
        decision,
        ads: [],
      })
      persistState(state)
      return {
        requestId,
        placementId: placement.placementId,
        decision,
        ads: [],
      }
    }
  }

  if (postRulePolicy.maxPerUserPerDay > 0 && userId) {
    const userCapKey = getUserPlacementDayKey(userId, placement.placementId)
    const count = runtimeMemory.perUserPlacementDayCount.get(userCapKey) || 0
    if (count >= postRulePolicy.maxPerUserPerDay) {
      const decision = createDecision('blocked', 'frequency_cap_user_day', intentScore)
      recordBlockedOrNoFill(placement)
      recordDecisionForRequest({
        request,
        placement,
        requestId,
        decision,
        ads: [],
      })
      persistState(state)
      return {
        requestId,
        placementId: placement.placementId,
        decision,
        ads: [],
      }
    }
  }

  const expectedRevenue = clampNumber(
    context.expectedRevenue,
    0,
    Number.MAX_SAFE_INTEGER,
    round(0.08 + intentScore * 0.25, 4),
  )

  if (expectedRevenue < placement.trigger.minExpectedRevenue) {
    const decision = createDecision('no_fill', 'revenue_below_min', intentScore)
    recordBlockedOrNoFill(placement)
    recordDecisionForRequest({
      request,
      placement,
      requestId,
      decision,
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision,
      ads: [],
    }
  }

  const runtimeAdRequest = buildRuntimeAdRequest(request, placement, intentScore)
  let runtimeResult

  try {
    runtimeResult = await runAdsRetrievalPipeline(runtimeAdRequest)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Runtime pipeline failed'
    const decision = createDecision('no_fill', 'runtime_pipeline_fail_open', intentScore)
    recordRuntimeNetworkStats(decision.result, null, {
      requestId,
      placementId: placement.placementId,
      runtimeError: true,
      failOpenApplied: true,
    })
    recordBlockedOrNoFill(placement)
    recordDecisionForRequest({
      request,
      placement,
      requestId,
      decision,
      runtime: {
        failOpenApplied: true,
        failureMode: 'runtime_pipeline_exception',
        message: errorMessage,
      },
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision,
      ads: [],
    }
  }

  const runtimeAds = Array.isArray(runtimeResult?.adResponse?.ads) ? runtimeResult.adResponse.ads : []
  const runtimeRequestId = String(runtimeResult?.adResponse?.requestId || requestId)
  const runtimeDebug = summarizeRuntimeDebug(runtimeResult?.debug)

  if (runtimeAds.length === 0) {
    const decision = createDecision('no_fill', 'runtime_no_offer', intentScore)
    recordRuntimeNetworkStats(decision.result, runtimeDebug, {
      requestId: runtimeRequestId,
      placementId: placement.placementId,
    })
    recordBlockedOrNoFill(placement)
    recordDecisionForRequest({
      request,
      placement,
      requestId: runtimeRequestId,
      decision,
      runtime: runtimeDebug,
      ads: [],
    })
    persistState(state)
    return {
      requestId: runtimeRequestId,
      placementId: placement.placementId,
      decision,
      ads: [],
    }
  }

  const serveRevenue = round(0.03 + intentScore * 0.07, 4)
  recordServeCounters(placement, request, serveRevenue)

  const ads = runtimeAds.map((ad) => ({
    ...ad,
    disclosure: placement.disclosure || ad.disclosure || 'Sponsored',
  }))

  const decision = createDecision('served', 'runtime_eligible', intentScore)
  recordRuntimeNetworkStats(decision.result, runtimeDebug, {
    requestId: runtimeRequestId,
    placementId: placement.placementId,
  })
  recordDecisionForRequest({
    request,
    placement,
    requestId: runtimeRequestId,
    decision,
    runtime: runtimeDebug,
    ads,
  })

  persistState(state)

  return {
    requestId: runtimeRequestId,
    placementId: placement.placementId,
    decision,
    ads,
  }
}

function buildPlacementFromPatch(placement, patch, configVersion) {
  return normalizePlacement({
    ...placement,
    ...patch,
    configVersion,
    trigger: {
      ...placement.trigger,
      ...(patch?.trigger && typeof patch.trigger === 'object' ? patch.trigger : {}),
    },
    frequencyCap: {
      ...placement.frequencyCap,
      ...(patch?.frequencyCap && typeof patch.frequencyCap === 'object' ? patch.frequencyCap : {}),
    },
  })
}

function applyPlacementPatch(placement, patch, configVersion) {
  const next = buildPlacementFromPatch(placement, patch, configVersion)

  placement.configVersion = next.configVersion
  placement.enabled = next.enabled
  placement.disclosure = next.disclosure
  placement.priority = next.priority
  placement.surface = next.surface
  placement.format = next.format
  placement.placementKey = next.placementKey
  placement.trigger = next.trigger
  placement.frequencyCap = next.frequencyCap

  return placement
}

function getDashboardStatePayload() {
  const networkHealth = getAllNetworkHealth()
  return {
    placementConfigVersion: state.placementConfigVersion,
    metricsSummary: computeMetricsSummary(),
    metricsByDay: computeMetricsByDay(),
    metricsByPlacement: computeMetricsByPlacement(),
    placements: state.placements,
    placementAuditLogs: state.placementAuditLogs,
    controlPlaneAuditLogs: state.controlPlaneAuditLogs,
    networkHealth,
    networkHealthSummary: summarizeNetworkHealthMap(networkHealth),
    networkFlowStats: state.networkFlowStats,
    networkFlowLogs: state.networkFlowLogs,
    decisionLogs: state.decisionLogs,
    eventLogs: state.eventLogs,
  }
}

function resolveMediationConfigSnapshot(query = {}) {
  const appId = requiredNonEmptyString(query.appId, 'appId')
  const placementId = requiredNonEmptyString(query.placementId, 'placementId')
  const rawEnvironment = requiredNonEmptyString(query.environment, 'environment')
  const environment = normalizeControlPlaneEnvironment(rawEnvironment, '')
  if (!CONTROL_PLANE_ENVIRONMENTS.has(environment)) {
    throw new Error(`environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`)
  }
  const schemaVersion = requiredNonEmptyString(query.schemaVersion, 'schemaVersion')
  const sdkVersion = requiredNonEmptyString(query.sdkVersion, 'sdkVersion')
  const requestAt = requiredNonEmptyString(query.requestAt, 'requestAt')
  const ifNoneMatch = String(query.ifNoneMatch || query.if_none_match || '').trim()

  const placement = state.placements.find((item) => item.placementId === placementId)
  if (!placement) {
    const error = new Error(`placementId not found: ${placementId}`)
    error.code = 'PLACEMENT_NOT_FOUND'
    throw error
  }

  const etag = `W/"placement:${placement.placementId}:v${placement.configVersion}"`
  if (ifNoneMatch && ifNoneMatch === etag) {
    return {
      statusCode: 304,
      payload: null,
      etag,
    }
  }

  return {
    statusCode: 200,
    etag,
    payload: {
      appId,
      environment,
      placementId: placement.placementId,
      placementKey: placement.placementKey,
      schemaVersion,
      sdkVersion,
      requestAt,
      configVersion: placement.configVersion,
      ttlSec: 300,
      placement,
    },
  }
}

function buildQuickStartVerifyRequest(input = {}) {
  const appId = String(input.appId || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
  const environment = normalizeControlPlaneEnvironment(input.environment || 'staging')
  const placementId = String(input.placementId || '').trim() || 'chat_inline_v1'
  return {
    appId,
    environment,
    placementId,
    sessionId: String(input.sessionId || '').trim() || `quickstart_session_${randomToken(8)}`,
    turnId: String(input.turnId || '').trim() || `quickstart_turn_${randomToken(8)}`,
    query: String(input.query || '').trim() || 'Recommend waterproof running shoes',
    answerText: String(input.answerText || '').trim() || 'Prioritize grip and breathable waterproof upper.',
    intentScore: clampNumber(input.intentScore, 0, 1, 0.91),
    locale: String(input.locale || '').trim() || 'en-US',
  }
}

function findActiveApiKeyBySecret(secret) {
  const value = String(secret || '').trim()
  if (!value) return null
  const digest = hashToken(value)
  const rows = Array.isArray(state?.controlPlane?.apiKeys) ? state.controlPlane.apiKeys : []
  const matched = rows.filter((item) => (
    String(item?.status || '').toLowerCase() === 'active'
    && String(item?.secretHash || '') === digest
  ))
  matched.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return matched[0] || null
}

function findActiveApiKey({ appId, environment, keyId = '' }) {
  const normalizedAppId = String(appId || '').trim()
  const normalizedEnvironment = normalizeControlPlaneEnvironment(environment)
  const normalizedKeyId = String(keyId || '').trim()

  let rows = state.controlPlane.apiKeys.filter((item) => (
    item.appId === normalizedAppId
    && item.environment === normalizedEnvironment
    && item.status === 'active'
  ))

  if (normalizedKeyId) {
    rows = rows.filter((item) => item.keyId === normalizedKeyId)
  }

  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return rows[0] || null
}

function hasRequiredAgentScope(scope, requiredScope) {
  if (!requiredScope) return true
  if (!scope || typeof scope !== 'object') return false
  return scope[requiredScope] === true
}

function getExchangeForbiddenFields(payload) {
  if (!payload || typeof payload !== 'object') return []
  return [...TOKEN_EXCHANGE_FORBIDDEN_FIELDS].filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
}

function recordSecurityDenyAudit({
  req,
  action,
  reason,
  code,
  httpStatus,
  appId = '',
  environment = '',
  resourceType = '',
  resourceId = '',
  metadata = {},
}) {
  recordControlPlaneAudit({
    action,
    actor: resolveAuditActor(req, 'security'),
    appId: String(appId || '').trim(),
    environment: String(environment || '').trim(),
    resourceType: String(resourceType || '').trim(),
    resourceId: String(resourceId || '').trim(),
    metadata: {
      reason: String(reason || '').trim(),
      code: String(code || '').trim(),
      httpStatus: Number(httpStatus || 0),
      ...metadata,
    },
  })
}

function resolveRuntimeCredential(req) {
  const token = parseBearerToken(req)
  if (!token) {
    return { kind: 'none' }
  }

  if (token.startsWith('sk_')) {
    const key = findActiveApiKeyBySecret(token)
    if (!key) {
      return {
        kind: 'invalid',
        status: 401,
        code: 'INVALID_API_KEY',
        message: 'API key is invalid or revoked.',
      }
    }
    return {
      kind: 'api_key',
      key,
    }
  }

  if (token.startsWith('atk_')) {
    cleanupExpiredAgentAccessTokens()
    const access = findAgentAccessTokenByPlaintext(token)
    if (!access) {
      return {
        kind: 'invalid',
        status: 401,
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Agent access token is invalid.',
      }
    }

    const status = String(access.status || '').trim().toLowerCase()
    if (status !== 'active') {
      return {
        kind: 'invalid',
        status: 401,
        code: status === 'expired' ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INACTIVE',
        message: status === 'expired'
          ? 'Agent access token has expired.'
          : `Agent access token is not active (${status || 'unknown'}).`,
        access,
      }
    }

    const expiresAtMs = Date.parse(String(access.expiresAt || ''))
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      access.status = 'expired'
      access.updatedAt = nowIso()
      persistState(state)
      return {
        kind: 'invalid',
        status: 401,
        code: 'ACCESS_TOKEN_EXPIRED',
        message: 'Agent access token has expired.',
        access,
      }
    }

    return {
      kind: 'agent_access_token',
      access,
    }
  }

  if (token.startsWith('itk_')) {
    return {
      kind: 'invalid',
      status: 401,
      code: 'UNSUPPORTED_TOKEN_TYPE',
      message: 'integration token cannot be used for runtime API calls.',
    }
  }

  return {
    kind: 'invalid',
    status: 401,
    code: 'UNSUPPORTED_BEARER_TOKEN',
    message: 'Unsupported bearer token.',
  }
}

function authorizeRuntimeCredential(req, options = {}) {
  const requirement = options && typeof options === 'object' ? options : {}
  const requiredScope = String(requirement.requiredScope || '').trim()
  const requiredAppId = String(requirement.appId || '').trim()
  const requiredEnvironment = String(requirement.environment || '').trim()
  const requiredPlacementId = String(requirement.placementId || '').trim()
  const operation = String(requirement.operation || '').trim() || 'runtime_call'

  const resolved = resolveRuntimeCredential(req)
  if (resolved.kind === 'none') {
    return { ok: true, mode: 'anonymous' }
  }

  if (resolved.kind === 'invalid') {
    if (resolved.access) {
      recordSecurityDenyAudit({
        req,
        action: 'agent_access_deny',
        reason: 'invalid_or_expired_token',
        code: resolved.code,
        httpStatus: resolved.status,
        appId: resolved.access.appId,
        environment: resolved.access.environment,
        resourceType: 'agent_access_token',
        resourceId: resolved.access.tokenId,
        metadata: {
          operation,
        },
      })
      persistState(state)
    }
    return {
      ok: false,
      status: resolved.status,
      error: {
        code: resolved.code,
        message: resolved.message,
      },
    }
  }

  if (resolved.kind === 'api_key') {
    const key = resolved.key
    if (requiredAppId && key.appId && key.appId !== requiredAppId) {
      return {
        ok: false,
        status: 403,
        error: {
          code: 'API_KEY_SCOPE_VIOLATION',
          message: 'API key does not match requested appId.',
        },
      }
    }
    if (requiredEnvironment && key.environment && key.environment !== normalizeControlPlaneEnvironment(requiredEnvironment, '')) {
      return {
        ok: false,
        status: 403,
        error: {
          code: 'API_KEY_SCOPE_VIOLATION',
          message: 'API key does not match requested environment.',
        },
      }
    }
    key.lastUsedAt = nowIso()
    key.updatedAt = key.lastUsedAt
    persistState(state)
    return { ok: true, mode: 'api_key', credential: key }
  }

  const access = resolved.access
  if (!hasRequiredAgentScope(access.scope, requiredScope)) {
    recordSecurityDenyAudit({
      req,
      action: 'agent_access_deny',
      reason: 'scope_missing',
      code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
      httpStatus: 403,
      appId: access.appId,
      environment: access.environment,
      resourceType: 'agent_access_token',
      resourceId: access.tokenId,
      metadata: {
        operation,
        requiredScope,
      },
    })
    persistState(state)
    return {
      ok: false,
      status: 403,
      error: {
        code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
        message: `Missing required scope: ${requiredScope}`,
      },
    }
  }

  if (requiredAppId && access.appId && access.appId !== requiredAppId) {
    recordSecurityDenyAudit({
      req,
      action: 'agent_access_deny',
      reason: 'app_mismatch',
      code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
      httpStatus: 403,
      appId: access.appId,
      environment: access.environment,
      resourceType: 'agent_access_token',
      resourceId: access.tokenId,
      metadata: {
        operation,
        requiredAppId,
      },
    })
    persistState(state)
    return {
      ok: false,
      status: 403,
      error: {
        code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
        message: 'Agent access token does not match requested appId.',
      },
    }
  }

  if (
    requiredEnvironment
    && access.environment
    && access.environment !== normalizeControlPlaneEnvironment(requiredEnvironment, '')
  ) {
    recordSecurityDenyAudit({
      req,
      action: 'agent_access_deny',
      reason: 'environment_mismatch',
      code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
      httpStatus: 403,
      appId: access.appId,
      environment: access.environment,
      resourceType: 'agent_access_token',
      resourceId: access.tokenId,
      metadata: {
        operation,
        requiredEnvironment,
      },
    })
    persistState(state)
    return {
      ok: false,
      status: 403,
      error: {
        code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
        message: 'Agent access token does not match requested environment.',
      },
    }
  }

  if (requiredPlacementId && access.placementId && access.placementId !== requiredPlacementId) {
    recordSecurityDenyAudit({
      req,
      action: 'agent_access_deny',
      reason: 'placement_mismatch',
      code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
      httpStatus: 403,
      appId: access.appId,
      environment: access.environment,
      resourceType: 'agent_access_token',
      resourceId: access.tokenId,
      metadata: {
        operation,
        requiredPlacementId,
      },
    })
    persistState(state)
    return {
      ok: false,
      status: 403,
      error: {
        code: 'ACCESS_TOKEN_SCOPE_VIOLATION',
        message: 'Agent access token does not match requested placementId.',
      },
    }
  }

  access.updatedAt = nowIso()
  access.metadata = access.metadata && typeof access.metadata === 'object' ? access.metadata : {}
  access.metadata.lastUsedAt = access.updatedAt
  persistState(state)
  return { ok: true, mode: 'agent_access_token', credential: access }
}

function recordAttachSdkEvent(request) {
  recordEvent({
    eventType: 'sdk_event',
    requestId: request.requestId || '',
    appId: request.appId,
    sessionId: request.sessionId,
    turnId: request.turnId,
    query: request.query,
    answerText: request.answerText,
    intentScore: request.intentScore,
    locale: request.locale,
    event: ATTACH_MVP_EVENT,
    placementKey: ATTACH_MVP_PLACEMENT_KEY,
  })
}

async function requestHandler(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`)
  const pathname = requestUrl.pathname

  if (req.method === 'OPTIONS') {
    withCors(res)
    res.statusCode = 204
    res.end()
    return
  }

  if (pathname === '/api/v1/dev/reset' && req.method === 'POST') {
    const auth = authorizeDevReset(req)
    if (!auth.ok) {
      sendJson(res, auth.status, {
        error: auth.error,
      })
      return
    }

    const previousPlacementConfigVersion = state.placementConfigVersion
    resetGatewayState()
    sendJson(res, 200, {
      ok: true,
      previousPlacementConfigVersion,
      placementConfigVersion: state.placementConfigVersion,
      authMode: auth.mode || 'unknown',
      stateFile: STATE_FILE,
      updatedAt: state.updatedAt,
    })
    return
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'simulator-gateway',
      updatedAt: state.updatedAt,
      now: nowIso(),
    })
    return
  }

  if (pathname === '/api/v1/mediation/config' && req.method === 'GET') {
    try {
      const auth = authorizeRuntimeCredential(req, {
        operation: 'mediation_config_read',
        requiredScope: 'mediationConfigRead',
        appId: String(requestUrl.searchParams.get('appId') || '').trim(),
        environment: String(requestUrl.searchParams.get('environment') || '').trim(),
        placementId: String(requestUrl.searchParams.get('placementId') || '').trim(),
      })
      if (!auth.ok) {
        sendJson(res, auth.status, {
          error: auth.error,
        })
        return
      }

      const resolved = resolveMediationConfigSnapshot({
        appId: requestUrl.searchParams.get('appId'),
        placementId: requestUrl.searchParams.get('placementId'),
        environment: requestUrl.searchParams.get('environment'),
        schemaVersion: requestUrl.searchParams.get('schemaVersion'),
        sdkVersion: requestUrl.searchParams.get('sdkVersion'),
        requestAt: requestUrl.searchParams.get('requestAt'),
        ifNoneMatch: requestUrl.searchParams.get('ifNoneMatch'),
      })

      if (resolved.statusCode === 304) {
        withCors(res)
        res.statusCode = 304
        res.setHeader('ETag', resolved.etag)
        res.end()
        return
      }

      res.setHeader('ETag', resolved.etag)
      sendJson(res, 200, resolved.payload)
      return
    } catch (error) {
      const code = error instanceof Error && error.code === 'PLACEMENT_NOT_FOUND'
        ? 'PLACEMENT_NOT_FOUND'
        : 'INVALID_REQUEST'
      sendJson(res, code === 'PLACEMENT_NOT_FOUND' ? 404 : 400, {
        error: {
          code,
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/public/quick-start/verify' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const request = buildQuickStartVerifyRequest(payload)
      const activeKey = findActiveApiKey({
        appId: request.appId,
        environment: request.environment,
      })

      if (!activeKey) {
        sendJson(res, 409, {
          error: {
            code: 'PRECONDITION_FAILED',
            message: `No active API key for appId=${request.appId} environment=${request.environment}.`,
          },
        })
        return
      }

      const configStartedAt = Date.now()
      const configResult = resolveMediationConfigSnapshot({
        appId: request.appId,
        placementId: request.placementId,
        environment: request.environment,
        schemaVersion: 'schema_v1',
        sdkVersion: '1.0.0',
        requestAt: nowIso(),
      })
      const configLatencyMs = Math.max(0, Date.now() - configStartedAt)

      const evaluateStartedAt = Date.now()
      const evaluate = await evaluateRequest({
        appId: request.appId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        event: ATTACH_MVP_EVENT,
        placementId: request.placementId,
        placementKey: ATTACH_MVP_PLACEMENT_KEY,
        context: {
          query: request.query,
          answerText: request.answerText,
          intentScore: request.intentScore,
          locale: request.locale,
        },
      })
      const evaluateLatencyMs = Math.max(0, Date.now() - evaluateStartedAt)

      const eventStartedAt = Date.now()
      recordAttachSdkEvent({
        requestId: evaluate.requestId || '',
        appId: request.appId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        query: request.query,
        answerText: request.answerText,
        intentScore: request.intentScore,
        locale: request.locale,
      })
      persistState(state)
      const eventLatencyMs = Math.max(0, Date.now() - eventStartedAt)

      sendJson(res, 200, {
        ok: true,
        requestId: evaluate.requestId || '',
        status: String(evaluate?.decision?.result || ''),
        evidence: {
          config: {
            status: configResult.statusCode,
            placementId: request.placementId,
            configVersion: configResult.payload?.configVersion || 0,
            latencyMs: configLatencyMs,
          },
          evaluate: {
            status: 200,
            requestId: evaluate.requestId || '',
            result: String(evaluate?.decision?.result || ''),
            reasonDetail: String(evaluate?.decision?.reasonDetail || ''),
            latencyMs: evaluateLatencyMs,
          },
          events: {
            status: 200,
            ok: true,
            latencyMs: eventLatencyMs,
          },
        },
      })
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/public/audit/logs' && req.method === 'GET') {
    sendJson(res, 200, {
      items: queryControlPlaneAudits(requestUrl.searchParams),
    })
    return
  }

  if (pathname === '/api/v1/public/agent/integration-token' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const appId = String(payload?.appId || payload?.app_id || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
      const requestedEnvironment = String(payload?.environment || payload?.env || '').trim().toLowerCase()
      const environment = requestedEnvironment || 'staging'
      if (!CONTROL_PLANE_ENVIRONMENTS.has(environment)) {
        throw new Error(`environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`)
      }

      const ttlMinutes = toPositiveInteger(payload?.ttlMinutes ?? payload?.ttl_minutes, 10)
      if (ttlMinutes < 10 || ttlMinutes > 15) {
        throw new Error('ttlMinutes must be between 10 and 15.')
      }

      const placementId = String(payload?.placementId || payload?.placement_id || '').trim() || 'chat_inline_v1'
      const activeKey = findActiveApiKey({
        appId,
        environment,
      })
      if (!activeKey) {
        sendJson(res, 409, {
          error: {
            code: 'PRECONDITION_FAILED',
            message: `No active API key for appId=${appId} environment=${environment}.`,
          },
        })
        return
      }

      ensureControlPlaneAppAndEnvironment(appId, environment)
      cleanupExpiredIntegrationTokens()

      const { tokenRecord, token } = createIntegrationTokenRecord({
        appId,
        environment,
        placementId,
        ttlMinutes,
        metadata: {
          issuedFor: 'agent_onboarding',
        },
      })

      state.controlPlane.integrationTokens = [tokenRecord, ...state.controlPlane.integrationTokens]
        .slice(0, MAX_INTEGRATION_TOKENS)

      recordControlPlaneAudit({
        action: 'integration_token_issue',
        actor: resolveAuditActor(req, 'dashboard'),
        appId: tokenRecord.appId,
        environment: tokenRecord.environment,
        resourceType: 'integration_token',
        resourceId: tokenRecord.tokenId,
        metadata: {
          placementId: tokenRecord.placementId,
          ttlSeconds: ttlMinutes * 60,
        },
      })
      persistState(state)

      sendJson(res, 201, toPublicIntegrationTokenRecord(tokenRecord, token))
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/public/agent/token-exchange' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      cleanupExpiredIntegrationTokens()
      cleanupExpiredAgentAccessTokens()
      const forbiddenFields = getExchangeForbiddenFields(payload)
      if (forbiddenFields.length > 0) {
        const providedToken = String(payload?.integrationToken || payload?.integration_token || '').trim()
        const sourceToken = providedToken ? findIntegrationTokenByPlaintext(providedToken) : null
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'privilege_escalation_attempt',
          code: 'TOKEN_EXCHANGE_SCOPE_VIOLATION',
          httpStatus: 403,
          appId: sourceToken?.appId || '',
          environment: sourceToken?.environment || '',
          resourceType: 'integration_token',
          resourceId: sourceToken?.tokenId || '',
          metadata: {
            forbiddenFields,
            tokenFingerprint: providedToken ? tokenFingerprint(providedToken) : '',
          },
        })
        persistState(state)
        sendJson(res, 403, {
          error: {
            code: 'TOKEN_EXCHANGE_SCOPE_VIOLATION',
            message: 'token exchange payload contains forbidden privilege fields.',
          },
        })
        return
      }

      const integrationToken = requiredNonEmptyString(
        payload?.integrationToken || payload?.integration_token,
        'integrationToken',
      )

      const sourceToken = findIntegrationTokenByPlaintext(integrationToken)
      if (!sourceToken) {
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'invalid_integration_token',
          code: 'INVALID_INTEGRATION_TOKEN',
          httpStatus: 401,
          resourceType: 'integration_token',
          metadata: {
            tokenFingerprint: tokenFingerprint(integrationToken),
          },
        })
        persistState(state)
        sendJson(res, 401, {
          error: {
            code: 'INVALID_INTEGRATION_TOKEN',
            message: 'integration token is invalid.',
          },
        })
        return
      }

      const sourceStatus = String(sourceToken.status || '').toLowerCase()
      if (sourceStatus === 'used') {
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'integration_token_replay',
          code: 'INTEGRATION_TOKEN_ALREADY_USED',
          httpStatus: 409,
          appId: sourceToken.appId,
          environment: sourceToken.environment,
          resourceType: 'integration_token',
          resourceId: sourceToken.tokenId,
        })
        persistState(state)
        sendJson(res, 409, {
          error: {
            code: 'INTEGRATION_TOKEN_ALREADY_USED',
            message: 'integration token has already been exchanged.',
          },
        })
        return
      }
      if (sourceStatus !== 'active') {
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'integration_token_inactive',
          code: 'INTEGRATION_TOKEN_INACTIVE',
          httpStatus: 401,
          appId: sourceToken.appId,
          environment: sourceToken.environment,
          resourceType: 'integration_token',
          resourceId: sourceToken.tokenId,
          metadata: {
            sourceStatus,
          },
        })
        persistState(state)
        sendJson(res, 401, {
          error: {
            code: 'INTEGRATION_TOKEN_INACTIVE',
            message: `integration token is not active (${sourceStatus || 'unknown'}).`,
          },
        })
        return
      }

      const now = nowIso()
      const expiresAtMs = Date.parse(String(sourceToken.expiresAt || ''))
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        sourceToken.status = 'expired'
        sourceToken.updatedAt = now
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'integration_token_expired',
          code: 'INTEGRATION_TOKEN_EXPIRED',
          httpStatus: 401,
          appId: sourceToken.appId,
          environment: sourceToken.environment,
          resourceType: 'integration_token',
          resourceId: sourceToken.tokenId,
        })
        persistState(state)
        sendJson(res, 401, {
          error: {
            code: 'INTEGRATION_TOKEN_EXPIRED',
            message: 'integration token has expired.',
          },
        })
        return
      }

      if (
        sourceToken.tokenType !== 'integration_token'
        || sourceToken.oneTime !== true
        || !hasRequiredAgentScope(sourceToken.scope, 'mediationConfigRead')
        || !hasRequiredAgentScope(sourceToken.scope, 'sdkEvaluate')
        || !hasRequiredAgentScope(sourceToken.scope, 'sdkEvents')
      ) {
        sourceToken.status = 'revoked'
        sourceToken.updatedAt = now
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'source_token_scope_invalid',
          code: 'INTEGRATION_TOKEN_SCOPE_INVALID',
          httpStatus: 403,
          appId: sourceToken.appId,
          environment: sourceToken.environment,
          resourceType: 'integration_token',
          resourceId: sourceToken.tokenId,
        })
        persistState(state)
        sendJson(res, 403, {
          error: {
            code: 'INTEGRATION_TOKEN_SCOPE_INVALID',
            message: 'integration token scope is invalid.',
          },
        })
        return
      }

      const replayBySource = state.controlPlane.agentAccessTokens.find((item) => (
        String(item?.sourceTokenId || '') === sourceToken.tokenId
      ))
      if (replayBySource) {
        sourceToken.status = 'used'
        sourceToken.usedAt = now
        sourceToken.updatedAt = now
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'integration_token_replay_by_source',
          code: 'INTEGRATION_TOKEN_ALREADY_USED',
          httpStatus: 409,
          appId: sourceToken.appId,
          environment: sourceToken.environment,
          resourceType: 'integration_token',
          resourceId: sourceToken.tokenId,
          metadata: {
            existingAccessTokenId: String(replayBySource.tokenId || ''),
          },
        })
        persistState(state)
        sendJson(res, 409, {
          error: {
            code: 'INTEGRATION_TOKEN_ALREADY_USED',
            message: 'integration token has already been exchanged.',
          },
        })
        return
      }

      const requestedTtl = toPositiveInteger(payload?.ttlSeconds ?? payload?.ttl_seconds, 300)
      if (
        requestedTtl < MIN_AGENT_ACCESS_TTL_SECONDS
        || requestedTtl > MAX_AGENT_ACCESS_TTL_SECONDS
      ) {
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'ttl_out_of_range',
          code: 'INVALID_TTL_SECONDS',
          httpStatus: 400,
          appId: sourceToken.appId,
          environment: sourceToken.environment,
          resourceType: 'integration_token',
          resourceId: sourceToken.tokenId,
          metadata: {
            requestedTtlSeconds: requestedTtl,
            minTtlSeconds: MIN_AGENT_ACCESS_TTL_SECONDS,
            maxTtlSeconds: MAX_AGENT_ACCESS_TTL_SECONDS,
          },
        })
        persistState(state)
        sendJson(res, 400, {
          error: {
            code: 'INVALID_TTL_SECONDS',
            message: `ttlSeconds must be between ${MIN_AGENT_ACCESS_TTL_SECONDS} and ${MAX_AGENT_ACCESS_TTL_SECONDS}.`,
          },
        })
        return
      }

      const remainingTtlSeconds = Math.floor((expiresAtMs - Date.now()) / 1000)
      if (remainingTtlSeconds < MIN_AGENT_ACCESS_TTL_SECONDS) {
        sourceToken.status = 'expired'
        sourceToken.updatedAt = now
        recordSecurityDenyAudit({
          req,
          action: 'integration_token_exchange_deny',
          reason: 'integration_token_remaining_ttl_too_short',
          code: 'INTEGRATION_TOKEN_EXPIRED',
          httpStatus: 401,
          appId: sourceToken.appId,
          environment: sourceToken.environment,
          resourceType: 'integration_token',
          resourceId: sourceToken.tokenId,
          metadata: {
            remainingTtlSeconds,
          },
        })
        persistState(state)
        sendJson(res, 401, {
          error: {
            code: 'INTEGRATION_TOKEN_EXPIRED',
            message: 'integration token has expired.',
          },
        })
        return
      }

      const ttlSeconds = Math.min(requestedTtl, remainingTtlSeconds)
      const minimalScope = createMinimalAgentScope()

      const { tokenRecord, accessToken } = createAgentAccessTokenRecord({
        appId: sourceToken.appId,
        environment: sourceToken.environment,
        placementId: sourceToken.placementId,
        sourceTokenId: sourceToken.tokenId,
        ttlSeconds,
        issuedAt: now,
        scope: minimalScope,
        metadata: {
          exchangedFromTokenType: sourceToken.tokenType,
        },
      })

      sourceToken.status = 'used'
      sourceToken.usedAt = now
      sourceToken.updatedAt = now

      state.controlPlane.agentAccessTokens = [tokenRecord, ...state.controlPlane.agentAccessTokens]
        .slice(0, MAX_AGENT_ACCESS_TOKENS)

      recordControlPlaneAudit({
        action: 'integration_token_exchange',
        actor: resolveAuditActor(req, 'agent_exchange'),
        appId: tokenRecord.appId,
        environment: tokenRecord.environment,
        resourceType: 'agent_access_token',
        resourceId: tokenRecord.tokenId,
        metadata: {
          sourceTokenId: sourceToken.tokenId,
          requestedTtlSeconds: requestedTtl,
          ttlSeconds,
          placementId: tokenRecord.placementId,
        },
      })
      persistState(state)

      sendJson(res, 201, toPublicAgentAccessTokenRecord(tokenRecord, accessToken))
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/public/credentials/keys' && req.method === 'GET') {
    const appId = String(requestUrl.searchParams.get('appId') || '').trim()
    const statusQuery = String(requestUrl.searchParams.get('status') || '').trim().toLowerCase()
    const environmentQuery = String(
      requestUrl.searchParams.get('environment') || requestUrl.searchParams.get('env') || '',
    ).trim().toLowerCase()

    if (statusQuery && !CONTROL_PLANE_KEY_STATUS.has(statusQuery)) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_STATUS',
          message: `status must be one of: ${Array.from(CONTROL_PLANE_KEY_STATUS).join(', ')}`,
        },
      })
      return
    }

    if (environmentQuery && !CONTROL_PLANE_ENVIRONMENTS.has(environmentQuery)) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_ENVIRONMENT',
          message: `environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`,
        },
      })
      return
    }

    let keys = [...state.controlPlane.apiKeys]
    if (appId) {
      keys = keys.filter((row) => row.appId === appId)
    }
    if (statusQuery) {
      keys = keys.filter((row) => row.status === statusQuery)
    }
    if (environmentQuery) {
      keys = keys.filter((row) => row.environment === environmentQuery)
    }

    keys.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    sendJson(res, 200, {
      keys: keys.map((row) => toPublicApiKeyRecord(row)).filter(Boolean),
    })
    return
  }

  if (pathname === '/api/v1/public/credentials/keys' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const appId = String(payload?.appId || payload?.app_id || '').trim() || DEFAULT_CONTROL_PLANE_APP_ID
      const requestedEnvironment = String(payload?.environment || payload?.env || '').trim().toLowerCase()
      const environment = requestedEnvironment || 'staging'
      if (!CONTROL_PLANE_ENVIRONMENTS.has(environment)) {
        throw new Error(`environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`)
      }
      const keyName = String(payload?.name || payload?.keyName || payload?.key_name || '').trim()
        || `primary-${environment}`

      const ensured = ensureControlPlaneAppAndEnvironment(appId, environment)
      const { keyRecord, secret } = createControlPlaneKeyRecord({
        appId: ensured.appId,
        environment: ensured.environment,
        keyName,
      })

      state.controlPlane.apiKeys.unshift(keyRecord)
      recordControlPlaneAudit({
        action: 'key_create',
        actor: resolveAuditActor(req, 'public_api'),
        appId: keyRecord.appId,
        environment: keyRecord.environment,
        resourceType: 'api_key',
        resourceId: keyRecord.keyId,
        metadata: {
          keyName: keyRecord.keyName,
          status: keyRecord.status,
        },
      })
      persistState(state)

      sendJson(res, 201, {
        key: toPublicApiKeyRecord(keyRecord),
        secret,
      })
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  const rotateKeyMatch = pathname.match(/^\/api\/v1\/public\/credentials\/keys\/([^/]+)\/rotate$/)
  if (rotateKeyMatch && req.method === 'POST') {
    const keyId = decodeURIComponent(rotateKeyMatch[1] || '').trim()
    const target = state.controlPlane.apiKeys.find((item) => item.keyId === keyId)
    if (!target) {
      sendJson(res, 404, {
        error: {
          code: 'KEY_NOT_FOUND',
          message: `API key not found: ${keyId}`,
        },
      })
      return
    }

    const { keyRecord, secret } = createControlPlaneKeyRecord({
      keyId: target.keyId,
      appId: target.appId,
      environment: target.environment,
      keyName: target.keyName,
      createdAt: target.createdAt,
      lastUsedAt: target.lastUsedAt,
      metadata: target.metadata,
      status: 'active',
    })

    target.keyPrefix = keyRecord.keyPrefix
    target.secretHash = keyRecord.secretHash
    target.status = 'active'
    target.revokedAt = ''
    target.maskedKey = keyRecord.maskedKey
    target.updatedAt = keyRecord.updatedAt

    recordControlPlaneAudit({
      action: 'key_rotate',
      actor: resolveAuditActor(req, 'public_api'),
      appId: target.appId,
      environment: target.environment,
      resourceType: 'api_key',
      resourceId: target.keyId,
      metadata: {
        keyName: target.keyName,
        status: target.status,
      },
    })
    persistState(state)
    sendJson(res, 200, {
      key: toPublicApiKeyRecord(target),
      secret,
    })
    return
  }

  const revokeKeyMatch = pathname.match(/^\/api\/v1\/public\/credentials\/keys\/([^/]+)\/revoke$/)
  if (revokeKeyMatch && req.method === 'POST') {
    const keyId = decodeURIComponent(revokeKeyMatch[1] || '').trim()
    const target = state.controlPlane.apiKeys.find((item) => item.keyId === keyId)
    if (!target) {
      sendJson(res, 404, {
        error: {
          code: 'KEY_NOT_FOUND',
          message: `API key not found: ${keyId}`,
        },
      })
      return
    }

    if (target.status !== 'revoked') {
      const revokedAt = nowIso()
      target.status = 'revoked'
      target.revokedAt = revokedAt
      target.updatedAt = revokedAt
      recordControlPlaneAudit({
        action: 'key_revoke',
        actor: resolveAuditActor(req, 'public_api'),
        appId: target.appId,
        environment: target.environment,
        resourceType: 'api_key',
        resourceId: target.keyId,
        metadata: {
          keyName: target.keyName,
          status: target.status,
          revokedAt,
        },
      })
      persistState(state)
    }

    sendJson(res, 200, {
      key: toPublicApiKeyRecord(target),
    })
    return
  }

  if (pathname === '/api/v1/dashboard/state' && req.method === 'GET') {
    sendJson(res, 200, getDashboardStatePayload())
    return
  }

  if (pathname === '/api/v1/dashboard/placements' && req.method === 'GET') {
    sendJson(res, 200, { placements: state.placements })
    return
  }

  if (pathname.startsWith('/api/v1/dashboard/placements/') && req.method === 'PUT') {
    try {
      const placementId = decodeURIComponent(pathname.replace('/api/v1/dashboard/placements/', ''))
      const target = state.placements.find((item) => item.placementId === placementId)

      if (!target) {
        sendJson(res, 404, {
          error: {
            code: 'PLACEMENT_NOT_FOUND',
            message: `Placement not found: ${placementId}`,
          },
        })
        return
      }

      const payload = await readJsonBody(req)
      const before = JSON.parse(JSON.stringify(target))
      const preview = buildPlacementFromPatch(target, payload, target.configVersion || 1)
      const changed = JSON.stringify(before) !== JSON.stringify(preview)

      if (changed) {
        const nextConfigVersion = state.placementConfigVersion + 1
        applyPlacementPatch(target, payload, nextConfigVersion)
        state.placementConfigVersion = nextConfigVersion
        const actor = resolveAuditActor(req, 'dashboard')
        recordPlacementAudit({
          placementId: placementId,
          configVersion: nextConfigVersion,
          actor,
          patch: payload && typeof payload === 'object' ? payload : {},
          before,
          after: JSON.parse(JSON.stringify(target)),
        })
        recordControlPlaneAudit({
          action: 'config_publish',
          actor,
          appId: DEFAULT_CONTROL_PLANE_APP_ID,
          environment: 'staging',
          resourceType: 'placement',
          resourceId: placementId,
          metadata: {
            configVersion: nextConfigVersion,
            patch: payload && typeof payload === 'object' ? payload : {},
          },
        })
      }

      persistState(state)

      sendJson(res, 200, {
        placement: target,
        changed,
      })
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/dashboard/metrics/summary' && req.method === 'GET') {
    sendJson(res, 200, computeMetricsSummary())
    return
  }

  if (pathname === '/api/v1/dashboard/metrics/by-day' && req.method === 'GET') {
    sendJson(res, 200, { items: computeMetricsByDay() })
    return
  }

  if (pathname === '/api/v1/dashboard/metrics/by-placement' && req.method === 'GET') {
    sendJson(res, 200, { items: computeMetricsByPlacement() })
    return
  }

  if (pathname === '/api/v1/dashboard/decisions' && req.method === 'GET') {
    const result = requestUrl.searchParams.get('result')
    const placementId = requestUrl.searchParams.get('placementId')
    const requestId = requestUrl.searchParams.get('requestId')

    let rows = [...state.decisionLogs]

    if (result) {
      rows = rows.filter((row) => row.result === result)
    }

    if (placementId) {
      rows = rows.filter((row) => row.placementId === placementId)
    }
    if (requestId) {
      rows = rows.filter((row) => row.requestId === requestId)
    }

    sendJson(res, 200, { items: rows })
    return
  }

  if (pathname === '/api/v1/dashboard/events' && req.method === 'GET') {
    const result = requestUrl.searchParams.get('result')
    const placementId = requestUrl.searchParams.get('placementId')
    const requestId = requestUrl.searchParams.get('requestId')
    const eventType = requestUrl.searchParams.get('eventType')

    let rows = [...state.eventLogs]

    if (result) {
      rows = rows.filter((row) => String(row?.result || '') === result)
    }
    if (placementId) {
      rows = rows.filter((row) => String(row?.placementId || '') === placementId)
    }
    if (requestId) {
      rows = rows.filter((row) => String(row?.requestId || '') === requestId)
    }
    if (eventType) {
      rows = rows.filter((row) => String(row?.eventType || '') === eventType)
    }

    sendJson(res, 200, { items: rows })
    return
  }

  if (pathname === '/api/v1/dashboard/audit/logs' && req.method === 'GET') {
    sendJson(res, 200, {
      items: queryControlPlaneAudits(requestUrl.searchParams),
    })
    return
  }

  if (pathname === '/api/v1/dashboard/placement-audits' && req.method === 'GET') {
    const placementId = requestUrl.searchParams.get('placementId')
    let rows = [...state.placementAuditLogs]
    if (placementId) {
      rows = rows.filter((row) => row.placementId === placementId)
    }
    sendJson(res, 200, { items: rows })
    return
  }

  if (pathname === '/api/v1/dashboard/network-health' && req.method === 'GET') {
    const networkHealth = getAllNetworkHealth()
    sendJson(res, 200, {
      networkHealth,
      networkHealthSummary: summarizeNetworkHealthMap(networkHealth),
      networkFlowStats: state.networkFlowStats,
      items: state.networkFlowLogs,
    })
    return
  }

  if (pathname === '/api/v1/sdk/config' && req.method === 'GET') {
    const appId = requestUrl.searchParams.get('appId') || 'simulator-chatbot'
    sendJson(res, 200, {
      appId,
      placements: state.placements,
    })
    return
  }

  if (pathname === '/api/v1/intent-card/retrieve' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const request = normalizeIntentCardRetrievePayload(payload, 'intent-card/retrieve')
      const startedAt = Date.now()
      const vectorIndex = createIntentCardVectorIndex(request.catalog)
      const retrieval = retrieveIntentCardTopK(vectorIndex, {
        query: request.query,
        facets: request.facets.map((facet) => ({
          facet_key: facet.facetKey,
          facet_value: facet.facetValue,
          confidence: Number.isFinite(facet.confidence) ? facet.confidence : undefined,
        })),
        topK: request.topK,
        minScore: request.minScore,
      })

      sendJson(res, 200, {
        requestId: createId('intent_retr'),
        items: retrieval.items,
        meta: {
          retrieval_ms: Date.now() - startedAt,
          index_item_count: vectorIndex.items.length,
          index_vocabulary_size: vectorIndex.vocabularySize,
          candidate_count: retrieval.meta.candidateCount,
          top_k: retrieval.meta.topK,
          min_score: retrieval.meta.minScore,
          index_version: retrieval.meta.indexVersion,
        },
      })
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/sdk/evaluate' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      if (isNextStepIntentCardPayload(payload)) {
        const request = normalizeNextStepIntentCardPayload(payload, 'sdk/evaluate')
        const auth = authorizeRuntimeCredential(req, {
          operation: 'sdk_evaluate',
          requiredScope: 'sdkEvaluate',
          appId: request.appId,
          placementId: request.placementId,
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }

        const inferenceStartedAt = Date.now()
        const { inference, resolvedContext } = await resolveIntentInferenceForNextStep(request)
        const inferenceLatencyMs = Math.max(0, Date.now() - inferenceStartedAt)
        const result = await evaluateRequest({
          appId: request.appId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          userId: request.userId,
          event: request.event,
          placementId: request.placementId,
          placementKey: request.placementKey,
          context: {
            query: resolvedContext.query,
            answerText: resolvedContext.answerText,
            intentClass: resolvedContext.intentClass,
            intentScore: resolvedContext.intentScore,
            preferenceFacets: resolvedContext.preferenceFacets,
            constraints: resolvedContext.constraints,
            expectedRevenue: resolvedContext.expectedRevenue,
            locale: resolvedContext.locale,
            intentInferenceMeta: {
              inferenceFallbackReason: String(inference?.fallbackReason || ''),
              inferenceModel: String(inference?.model || ''),
              inferenceLatencyMs,
            },
          },
        })
        sendJson(
          res,
          200,
          buildNextStepIntentCardResponse(
            result,
            {
              ...request,
              context: resolvedContext,
            },
            inference,
          ),
        )
        return
      }

      const request = normalizeAttachMvpPayload(payload, 'sdk/evaluate')
      const auth = authorizeRuntimeCredential(req, {
        operation: 'sdk_evaluate',
        requiredScope: 'sdkEvaluate',
        appId: request.appId,
        placementId: 'chat_inline_v1',
      })
      if (!auth.ok) {
        sendJson(res, auth.status, {
          error: auth.error,
        })
        return
      }

      const result = await evaluateRequest({
        appId: request.appId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        event: ATTACH_MVP_EVENT,
        placementKey: ATTACH_MVP_PLACEMENT_KEY,
        context: {
          query: request.query,
          answerText: request.answerText,
          intentScore: request.intentScore,
          locale: request.locale,
        },
      })
      sendJson(res, 200, result)
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/sdk/events' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      if (isNextStepIntentCardPayload(payload)) {
        const request = normalizeNextStepIntentCardPayload(payload, 'sdk/events')
        const auth = authorizeRuntimeCredential(req, {
          operation: 'sdk_events',
          requiredScope: 'sdkEvents',
          appId: request.appId,
          placementId: request.placementId,
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }

        const inferredIntentClass = String(request.context.intentHints?.intent_class || '').trim().toLowerCase()
        const inferredIntentScore = clampNumber(request.context.intentHints?.intent_score, 0, 1, NaN)
        const inferredPreferenceFacets = normalizeNextStepPreferenceFacets(
          request.context.intentHints?.preference_facets,
        )

        recordEvent({
          eventType: 'sdk_event',
          requestId: request.requestId || '',
          appId: request.appId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          userId: request.userId,
          query: request.context.query,
          answerText: request.context.answerText,
          intentClass: inferredIntentClass || '',
          intentScore: Number.isFinite(inferredIntentScore) ? inferredIntentScore : 0,
          preferenceFacets: inferredPreferenceFacets,
          locale: request.context.locale,
          event: request.event,
          placementId: request.placementId,
          placementKey: request.placementKey,
        })
      } else {
        const request = normalizeAttachMvpPayload(payload, 'sdk/events')
        const auth = authorizeRuntimeCredential(req, {
          operation: 'sdk_events',
          requiredScope: 'sdkEvents',
          appId: request.appId,
          placementId: request.placementId || 'chat_inline_v1',
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }

        if (request.kind === 'click') {
          recordClickCounters(request.placementId || 'chat_inline_v1')
        }

        recordEvent({
          eventType: 'sdk_event',
          requestId: request.requestId || '',
          appId: request.appId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          query: request.query,
          answerText: request.answerText,
          intentScore: request.intentScore,
          locale: request.locale,
          event: request.kind === 'click' ? 'click' : ATTACH_MVP_EVENT,
          kind: request.kind,
          adId: request.adId || '',
          placementId: request.placementId || 'chat_inline_v1',
          placementKey: ATTACH_MVP_PLACEMENT_KEY,
        })
      }

      persistState(state)

      sendJson(res, 200, {
        ok: true,
      })
      return
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  sendNotFound(res)
}

const server = http.createServer((req, res) => {
  requestHandler(req, res).catch((error) => {
    console.error('[simulator-gateway] unhandled error:', error)
    sendJson(res, 500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    })
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[simulator-gateway] listening on http://${HOST}:${PORT}`)
  console.log(`[simulator-gateway] state file: ${STATE_FILE}`)
})
