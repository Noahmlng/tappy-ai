import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { createHash } from 'node:crypto'

import defaultPlacements from '../../../config/default-placements.json' with { type: 'json' }
import { runAdsRetrievalPipeline, runBidAggregationPipeline } from '../../runtime/index.js'
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
const DEFAULT_STATE_FILE_NAME = 'simulator-gateway-state.json'
const RAW_SETTLEMENT_STORAGE_MODE = String(process.env.SIMULATOR_SETTLEMENT_STORAGE || 'auto').trim().toLowerCase()
const SETTLEMENT_STORAGE_MODE = RAW_SETTLEMENT_STORAGE_MODE === 'postgres'
  ? 'supabase'
  : RAW_SETTLEMENT_STORAGE_MODE
const SETTLEMENT_STORAGE_COMPAT_POSTGRES = RAW_SETTLEMENT_STORAGE_MODE === 'postgres'
const SETTLEMENT_DB_URL = String(process.env.SUPABASE_DB_URL || '').trim()
const SETTLEMENT_FACT_TABLE = 'simulator_settlement_conversion_facts'
const RUNTIME_DECISION_LOG_TABLE = 'simulator_runtime_decision_logs'
const RUNTIME_EVENT_LOG_TABLE = 'simulator_runtime_event_logs'
const CONTROL_PLANE_APPS_TABLE = 'control_plane_apps'
const CONTROL_PLANE_APP_ENVIRONMENTS_TABLE = 'control_plane_app_environments'
const CONTROL_PLANE_API_KEYS_TABLE = 'control_plane_api_keys'
const CONTROL_PLANE_DASHBOARD_USERS_TABLE = 'control_plane_dashboard_users'
const CONTROL_PLANE_DASHBOARD_SESSIONS_TABLE = 'control_plane_dashboard_sessions'
const CONTROL_PLANE_INTEGRATION_TOKENS_TABLE = 'control_plane_integration_tokens'
const CONTROL_PLANE_AGENT_ACCESS_TOKENS_TABLE = 'control_plane_agent_access_tokens'

const PORT = Number(process.env.SIMULATOR_GATEWAY_PORT || 3100)
const HOST = process.env.SIMULATOR_GATEWAY_HOST || '127.0.0.1'
const STATE_FILE = String(process.env.SIMULATOR_STATE_FILE || '').trim()
  || path.join(
    STATE_DIR,
    PORT === 3100 ? DEFAULT_STATE_FILE_NAME : `simulator-gateway-state-${PORT}.json`,
  )
const PRODUCTION_RUNTIME = (
  String(process.env.SIMULATOR_PRODUCTION_MODE || '').trim().toLowerCase() === 'true'
  || String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
)
const REQUIRE_DURABLE_SETTLEMENT = String(
  process.env.SIMULATOR_REQUIRE_DURABLE_SETTLEMENT || (PRODUCTION_RUNTIME ? 'true' : 'false'),
).trim().toLowerCase() !== 'false'
const STRICT_MANUAL_INTEGRATION = String(
  process.env.SIMULATOR_STRICT_MANUAL_INTEGRATION || 'false',
).trim().toLowerCase() === 'true'
const REQUIRE_RUNTIME_LOG_DB_PERSISTENCE = String(
  process.env.SIMULATOR_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE
    || (REQUIRE_DURABLE_SETTLEMENT ? 'true' : 'false'),
).trim().toLowerCase() !== 'false'
const DEV_RESET_ENABLED = String(process.env.SIMULATOR_DEV_RESET_ENABLED || 'true').trim().toLowerCase() !== 'false'
const DEV_RESET_TOKEN = String(process.env.SIMULATOR_DEV_RESET_TOKEN || '').trim()
const MAX_DECISION_LOGS = parseCollectionLimit(
  process.env.SIMULATOR_MAX_DECISION_LOGS,
  PRODUCTION_RUNTIME ? 0 : 500,
)
const MAX_EVENT_LOGS = parseCollectionLimit(
  process.env.SIMULATOR_MAX_EVENT_LOGS,
  PRODUCTION_RUNTIME ? 0 : 500,
)
const MAX_PLACEMENT_AUDIT_LOGS = parseCollectionLimit(
  process.env.SIMULATOR_MAX_PLACEMENT_AUDIT_LOGS,
  PRODUCTION_RUNTIME ? 0 : 500,
)
const MAX_NETWORK_FLOW_LOGS = parseCollectionLimit(
  process.env.SIMULATOR_MAX_NETWORK_FLOW_LOGS,
  PRODUCTION_RUNTIME ? 0 : 300,
)
const MAX_CONTROL_PLANE_AUDIT_LOGS = parseCollectionLimit(
  process.env.SIMULATOR_MAX_CONTROL_PLANE_AUDIT_LOGS,
  PRODUCTION_RUNTIME ? 0 : 800,
)
const MAX_INTEGRATION_TOKENS = 500
const MAX_AGENT_ACCESS_TOKENS = 1200
const MAX_DASHBOARD_USERS = 500
const MAX_DASHBOARD_SESSIONS = 1500
const DECISION_REASON_ENUM = new Set(['served', 'no_fill', 'blocked', 'error'])
const CONTROL_PLANE_ENVIRONMENTS = new Set(['sandbox', 'staging', 'prod'])
const CONTROL_PLANE_KEY_STATUS = new Set(['active', 'revoked'])
const DEFAULT_CONTROL_PLANE_APP_ID = ''
const DEFAULT_CONTROL_PLANE_ORG_ID = ''
const TRACKING_ACCOUNT_QUERY_PARAM = 'aid'
const DASHBOARD_SESSION_PREFIX = 'dsh_'
const DASHBOARD_SESSION_TTL_SECONDS = toPositiveInteger(process.env.SIMULATOR_DASHBOARD_SESSION_TTL_SECONDS, 86400 * 7)
const DASHBOARD_AUTH_REQUIRED = String(process.env.SIMULATOR_DASHBOARD_AUTH_REQUIRED || 'true').trim().toLowerCase() !== 'false'
const RUNTIME_AUTH_REQUIRED = String(process.env.SIMULATOR_RUNTIME_AUTH_REQUIRED || 'true').trim().toLowerCase() !== 'false'
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
const V2_BID_EVENT = 'v2_bid_request'
const V2_BID_ALLOWED_FIELDS = new Set([
  'userId',
  'chatId',
  'placementId',
  'messages',
])
const V2_BID_MESSAGE_ALLOWED_FIELDS = new Set([
  'role',
  'content',
  'timestamp',
])
const V2_BID_MESSAGE_ROLES = new Set(['user', 'assistant', 'system'])
const MANAGED_ROUTING_MODE = 'managed_mediation'
const NEXT_STEP_INTENT_CARD_EVENTS = new Set(['followup_generation', 'follow_up_generation'])
const POSTBACK_EVENT_TYPES = new Set(['postback'])
const POSTBACK_TYPES = new Set(['conversion'])
const POSTBACK_STATUS = new Set(['pending', 'success', 'failed'])
const NEXT_STEP_INTENT_CLASSES = new Set([
  'shopping',
  'purchase_intent',
  'gifting',
  'product_exploration',
  'non_commercial',
  'other',
])
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
  'app_id',
  'accountId',
  'account_id',
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
  'app_id',
  'accountId',
  'account_id',
  'sessionId',
  'turnId',
  'userId',
  'event',
  'placementId',
  'placementKey',
  'kind',
  'adId',
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
const POSTBACK_CONVERSION_ALLOWED_FIELDS = new Set([
  'eventType',
  'event',
  'kind',
  'requestId',
  'appId',
  'accountId',
  'account_id',
  'sessionId',
  'turnId',
  'userId',
  'placementId',
  'placementKey',
  'adId',
  'postbackType',
  'postbackStatus',
  'conversionId',
  'conversion_id',
  'eventSeq',
  'eventAt',
  'event_at',
  'currency',
  'cpaUsd',
  'cpa_usd',
  'payoutUsd',
  'payout_usd',
])
const DASHBOARD_REGISTER_ALLOWED_FIELDS = new Set([
  'email',
  'password',
  'displayName',
  'display_name',
  'accountId',
  'account_id',
  'appId',
  'app_id',
])
const DASHBOARD_LOGIN_ALLOWED_FIELDS = new Set([
  'email',
  'password',
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

function parseCollectionLimit(value, fallback) {
  const raw = String(value ?? '').trim()
  if (!raw) return Math.max(0, Math.floor(Number(fallback) || 0))
  const n = Number(raw)
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(Number(fallback) || 0))
  if (n <= 0) return 0
  return Math.floor(n)
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function applyCollectionLimit(rows = [], limit = 0) {
  const list = Array.isArray(rows) ? rows : []
  if (!Number.isFinite(limit) || limit <= 0) return list
  return list.slice(0, Math.floor(limit))
}

function resolvePreferredSettlementStoreMode() {
  if (REQUIRE_DURABLE_SETTLEMENT) return 'supabase'
  if (REQUIRE_RUNTIME_LOG_DB_PERSISTENCE) return 'supabase'
  if (SETTLEMENT_STORAGE_MODE === 'supabase') return 'supabase'
  if (SETTLEMENT_STORAGE_MODE === 'state_file' || SETTLEMENT_STORAGE_MODE === 'json') return 'state_file'
  return SETTLEMENT_DB_URL ? 'supabase' : 'state_file'
}

const settlementStore = {
  mode: resolvePreferredSettlementStoreMode(),
  pool: null,
  initPromise: null,
}

function isSupabaseSettlementStore() {
  return settlementStore.mode === 'supabase' && Boolean(settlementStore.pool)
}

function isPostgresSettlementStore() {
  return isSupabaseSettlementStore()
}

function shouldPersistConversionFactsToStateFile() {
  return !isPostgresSettlementStore()
}

function shouldPersistControlPlaneToStateFile() {
  return !isSupabaseSettlementStore()
}

function normalizeDbTimestamp(value, fallback = '') {
  if (!value) return fallback
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return fallback
  return new Date(parsed).toISOString()
}

function toDbNullableTimestamptz(value) {
  const normalized = normalizeDbTimestamp(value, '')
  return normalized || null
}

function toDbJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' ? value : fallback
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

function normalizeControlPlaneAccountId(value, fallback = '') {
  const normalized = String(value || '').trim()
  if (normalized) return normalized
  if (fallback === '') return ''
  return String(fallback || '').trim()
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function hashPasswordWithSalt(password, salt) {
  return createHash('sha256').update(`${String(salt || '')}:${String(password || '')}`).digest('hex')
}

function passwordHashRecord(password) {
  const salt = randomToken(16)
  return {
    passwordSalt: salt,
    passwordHash: hashPasswordWithSalt(password, salt),
  }
}

function verifyPasswordRecord(password, record) {
  const passwordHash = String(record?.passwordHash || '').trim()
  const passwordSalt = String(record?.passwordSalt || '').trim()
  if (!passwordHash || !passwordSalt) return false
  return hashPasswordWithSalt(password, passwordSalt) === passwordHash
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
  const appId = String(raw.appId || '').trim()
  if (!appId) return null
  const accountId = normalizeControlPlaneAccountId(
    raw.accountId || raw.account_id || raw.organizationId || raw.organization_id,
    '',
  )
  return {
    appId,
    accountId,
    organizationId: accountId,
    displayName: String(raw.displayName || '').trim() || appId,
    status: String(raw.status || '').trim() || 'active',
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    createdAt: timestamp,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : timestamp,
  }
}

function buildControlPlaneEnvironmentRecord(raw = {}) {
  const timestamp = typeof raw.createdAt === 'string' ? raw.createdAt : nowIso()
  const appId = String(raw.appId || '').trim()
  if (!appId) return null
  const environment = normalizeControlPlaneEnvironment(raw.environment)
  const accountId = normalizeControlPlaneAccountId(
    raw.accountId || raw.account_id || raw.organizationId || raw.organization_id,
    '',
  )
  return {
    environmentId: String(raw.environmentId || '').trim() || `env_${appId}_${environment}`,
    appId,
    accountId,
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
  const appId = String(input.appId || '').trim()
  if (!appId) {
    throw new Error('appId is required.')
  }
  const accountId = normalizeControlPlaneAccountId(input.accountId || input.account_id, '')
  if (!accountId) {
    throw new Error('accountId is required.')
  }
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
      accountId,
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

  const appId = String(raw.appId || raw.app_id || '').trim()
  if (!appId) return null
  const accountId = normalizeControlPlaneAccountId(
    raw.accountId || raw.account_id || raw.organizationId || raw.organization_id,
    '',
  )
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
    accountId,
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
    appId: item.appId,
    accountId: item.accountId,
    name: item.keyName,
    environment: item.environment,
    status: item.status,
    maskedKey: item.maskedKey,
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt,
  }
}

function createIntegrationTokenRecord(input = {}) {
  const appId = String(input.appId || '').trim()
  if (!appId) {
    throw new Error('appId is required.')
  }
  const accountId = normalizeControlPlaneAccountId(input.accountId || input.account_id, '')
  if (!accountId) {
    throw new Error('accountId is required.')
  }
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
      accountId,
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

  const appId = String(raw.appId || raw.app_id || '').trim()
  if (!appId) return null
  const accountId = normalizeControlPlaneAccountId(
    raw.accountId || raw.account_id || raw.organizationId || raw.organization_id,
    '',
  )
  const environment = normalizeControlPlaneEnvironment(raw.environment)
  const placementId = String(raw.placementId || raw.placement_id || '').trim() || 'chat_inline_v1'
  const status = String(raw.status || '').trim().toLowerCase() || 'active'

  return {
    tokenId,
    appId,
    accountId,
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
    accountId: item.accountId,
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
  const appId = String(input.appId || '').trim()
  if (!appId) {
    throw new Error('appId is required.')
  }
  const accountId = normalizeControlPlaneAccountId(input.accountId || input.account_id, '')
  if (!accountId) {
    throw new Error('accountId is required.')
  }
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
      accountId,
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

  const appId = String(raw.appId || raw.app_id || '').trim()
  if (!appId) return null
  const accountId = normalizeControlPlaneAccountId(
    raw.accountId || raw.account_id || raw.organizationId || raw.organization_id,
    '',
  )
  const environment = normalizeControlPlaneEnvironment(raw.environment)
  const placementId = String(raw.placementId || raw.placement_id || '').trim() || 'chat_inline_v1'
  const status = String(raw.status || '').trim().toLowerCase() || 'active'

  return {
    tokenId,
    appId,
    accountId,
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
    accountId: item.accountId,
    environment: item.environment,
    placementId: item.placementId,
    status: item.status,
    scope: item.scope,
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt,
    ttlSeconds,
  }
}

function createDashboardUserRecord(input = {}) {
  const now = nowIso()
  const email = normalizeEmail(input.email)
  const accountId = normalizeControlPlaneAccountId(input.accountId || input.account_id)
  const appId = String(input.appId || input.app_id || '').trim()
  const displayName = String(input.displayName || input.display_name || '').trim() || email
  const { passwordHash, passwordSalt } = passwordHashRecord(String(input.password || ''))

  return {
    userId: String(input.userId || '').trim() || `usr_${randomToken(18)}`,
    email,
    displayName,
    accountId,
    appId,
    status: 'active',
    passwordHash,
    passwordSalt,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: '',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  }
}

function normalizeDashboardUserRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const userId = String(raw.userId || raw.user_id || raw.id || '').trim()
  const email = normalizeEmail(raw.email)
  const accountId = normalizeControlPlaneAccountId(raw.accountId || raw.account_id || raw.organizationId || raw.organization_id, '')
  if (!userId || !email || !accountId) return null
  const status = String(raw.status || '').trim().toLowerCase() || 'active'
  return {
    userId,
    email,
    displayName: String(raw.displayName || raw.display_name || '').trim() || email,
    accountId,
    appId: String(raw.appId || raw.app_id || '').trim(),
    status: status === 'disabled' ? 'disabled' : 'active',
    passwordHash: String(raw.passwordHash || raw.password_hash || '').trim(),
    passwordSalt: String(raw.passwordSalt || raw.password_salt || '').trim(),
    createdAt: String(raw.createdAt || raw.created_at || nowIso()),
    updatedAt: String(raw.updatedAt || raw.updated_at || nowIso()),
    lastLoginAt: String(raw.lastLoginAt || raw.last_login_at || ''),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
  }
}

function toPublicDashboardUserRecord(raw) {
  const user = normalizeDashboardUserRecord(raw)
  if (!user) return null
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    accountId: user.accountId,
    appId: user.appId,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  }
}

function createDashboardSessionRecord(input = {}) {
  const issuedAt = nowIso()
  const ttlSeconds = Math.max(300, toPositiveInteger(input.ttlSeconds, DASHBOARD_SESSION_TTL_SECONDS))
  const expiresAtMs = Date.parse(issuedAt) + ttlSeconds * 1000
  const accessToken = `${DASHBOARD_SESSION_PREFIX}${randomToken(48)}`
  return {
    sessionRecord: {
      sessionId: String(input.sessionId || '').trim() || `dshs_${randomToken(16)}`,
      tokenHash: hashToken(accessToken),
      tokenType: 'dashboard_access_token',
      userId: String(input.userId || '').trim(),
      email: normalizeEmail(input.email || ''),
      accountId: normalizeControlPlaneAccountId(input.accountId || input.account_id),
      appId: String(input.appId || input.app_id || '').trim(),
      status: 'active',
      issuedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
      revokedAt: '',
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      updatedAt: issuedAt,
    },
    accessToken,
  }
}

function normalizeDashboardSessionRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const sessionId = String(raw.sessionId || raw.session_id || raw.id || '').trim()
  const tokenHash = String(raw.tokenHash || raw.token_hash || '').trim()
  const userId = String(raw.userId || raw.user_id || '').trim()
  const accountId = normalizeControlPlaneAccountId(raw.accountId || raw.account_id || raw.organizationId || raw.organization_id, '')
  if (!sessionId || !tokenHash || !userId || !accountId) return null
  const status = String(raw.status || '').trim().toLowerCase() || 'active'
  return {
    sessionId,
    tokenHash,
    tokenType: 'dashboard_access_token',
    userId,
    email: normalizeEmail(raw.email || ''),
    accountId,
    appId: String(raw.appId || raw.app_id || '').trim(),
    status: status === 'revoked' || status === 'expired' ? status : 'active',
    issuedAt: String(raw.issuedAt || raw.issued_at || nowIso()),
    expiresAt: String(raw.expiresAt || raw.expires_at || nowIso()),
    revokedAt: String(raw.revokedAt || raw.revoked_at || ''),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    updatedAt: String(raw.updatedAt || raw.updated_at || nowIso()),
  }
}

function toPublicDashboardSessionRecord(raw, plainAccessToken = '') {
  const session = normalizeDashboardSessionRecord(raw)
  if (!session) return null
  const issuedAtMs = Date.parse(session.issuedAt)
  const expiresAtMs = Date.parse(session.expiresAt)
  const ttlSeconds = (
    Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs > issuedAtMs
      ? Math.floor((expiresAtMs - issuedAtMs) / 1000)
      : 0
  )
  return {
    sessionId: session.sessionId,
    tokenType: session.tokenType,
    accessToken: plainAccessToken || undefined,
    userId: session.userId,
    email: session.email,
    accountId: session.accountId,
    appId: session.appId,
    status: session.status,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
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

function cleanupExpiredDashboardSessions() {
  const nowMs = Date.now()
  const rows = Array.isArray(state?.controlPlane?.dashboardSessions) ? state.controlPlane.dashboardSessions : []
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

function findDashboardUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null
  const rows = Array.isArray(state?.controlPlane?.dashboardUsers) ? state.controlPlane.dashboardUsers : []
  return rows.find((item) => normalizeEmail(item?.email) === normalizedEmail) || null
}

function findDashboardUserById(userId) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) return null
  const rows = Array.isArray(state?.controlPlane?.dashboardUsers) ? state.controlPlane.dashboardUsers : []
  return rows.find((item) => String(item?.userId || '') === normalizedUserId) || null
}

function findDashboardSessionByPlaintext(accessToken) {
  const token = String(accessToken || '').trim()
  if (!token) return null
  const tokenHash = hashToken(token)
  const rows = Array.isArray(state?.controlPlane?.dashboardSessions) ? state.controlPlane.dashboardSessions : []
  return rows.find((item) => String(item?.tokenHash || '') === tokenHash) || null
}

function findLatestAppForAccount(accountId) {
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId, '')
  if (!normalizedAccountId) return null
  const rows = Array.isArray(state?.controlPlane?.apps) ? state.controlPlane.apps : []
  const matched = rows.filter((item) => normalizeControlPlaneAccountId(item?.accountId || item?.organizationId, '') === normalizedAccountId)
  matched.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return matched[0] || null
}

function appBelongsToAccount(appId, accountId) {
  const normalizedAppId = String(appId || '').trim()
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId, '')
  if (!normalizedAppId || !normalizedAccountId) return false
  const app = resolveControlPlaneAppRecord(normalizedAppId)
  if (!app) return false
  return normalizeControlPlaneAccountId(app.accountId || app.organizationId, '') === normalizedAccountId
}

function listDashboardUsersByAccount(accountId) {
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId, '')
  if (!normalizedAccountId) return []
  const rows = Array.isArray(state?.controlPlane?.dashboardUsers) ? state.controlPlane.dashboardUsers : []
  return rows.filter((item) => normalizeControlPlaneAccountId(item?.accountId, '') === normalizedAccountId)
}

function hasNonBootstrapAccountResources(accountId) {
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId, '')
  if (!normalizedAccountId) return false

  const controlPlane = state?.controlPlane && typeof state.controlPlane === 'object'
    ? state.controlPlane
    : createInitialControlPlaneState()
  const apps = Array.isArray(controlPlane.apps) ? controlPlane.apps : []
  const appEnvironments = Array.isArray(controlPlane.appEnvironments) ? controlPlane.appEnvironments : []
  const apiKeys = Array.isArray(controlPlane.apiKeys) ? controlPlane.apiKeys : []
  const integrationTokens = Array.isArray(controlPlane.integrationTokens) ? controlPlane.integrationTokens : []
  const agentAccessTokens = Array.isArray(controlPlane.agentAccessTokens) ? controlPlane.agentAccessTokens : []

  const hasAppResource = apps.some((item) => {
    const rowAccountId = normalizeControlPlaneAccountId(item?.accountId || item?.organizationId, '')
    return rowAccountId === normalizedAccountId
  })
  if (hasAppResource) return true

  const hasEnvironmentResource = appEnvironments.some((item) => {
    const rowAccountId = normalizeControlPlaneAccountId(item?.accountId, '')
    return rowAccountId === normalizedAccountId
  })
  if (hasEnvironmentResource) return true

  const hasApiKeyResource = apiKeys.some((item) => {
    const rowAccountId = normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '')
    return rowAccountId === normalizedAccountId
  })
  if (hasApiKeyResource) return true

  const hasIntegrationTokenResource = integrationTokens.some((item) => (
    normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedAccountId
  ))
  if (hasIntegrationTokenResource) return true

  const hasAgentTokenResource = agentAccessTokens.some((item) => (
    normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedAccountId
  ))
  if (hasAgentTokenResource) return true

  const hasRuntimeOrAuditRows = (
    Array.isArray(state?.decisionLogs) ? state.decisionLogs : []
  ).some((item) => normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedAccountId)
    || (
      Array.isArray(state?.eventLogs) ? state.eventLogs : []
    ).some((item) => normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedAccountId)
    || (
      Array.isArray(state?.controlPlaneAuditLogs) ? state.controlPlaneAuditLogs : []
    ).some((item) => normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedAccountId)
    || (
      Array.isArray(state?.placementAuditLogs) ? state.placementAuditLogs : []
    ).some((item) => normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedAccountId)
    || (
      Array.isArray(state?.networkFlowLogs) ? state.networkFlowLogs : []
    ).some((item) => normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedAccountId)

  return hasRuntimeOrAuditRows
}

function resolveDashboardRegisterOwnershipProof(req, accountId = '') {
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId, '')
  if (!normalizedAccountId) return { ok: false, mode: 'none' }

  const token = parseBearerToken(req)
  if (!token) return { ok: false, mode: 'none' }

  if (token.startsWith(DASHBOARD_SESSION_PREFIX)) {
    const sessionAuth = resolveDashboardSession(req)
    if (sessionAuth.kind === 'dashboard_session') {
      const scopedAccountId = normalizeControlPlaneAccountId(
        sessionAuth.user?.accountId || sessionAuth.session?.accountId,
        '',
      )
      if (scopedAccountId === normalizedAccountId) {
        return {
          ok: true,
          mode: 'dashboard_session',
          user: sessionAuth.user,
          session: sessionAuth.session,
        }
      }
    }
    return { ok: false, mode: 'dashboard_session_invalid' }
  }

  const apiKey = findActiveApiKeyBySecret(token)
  if (!apiKey) return { ok: false, mode: 'none' }
  const apiKeyAccountId = normalizeControlPlaneAccountId(apiKey.accountId || resolveAccountIdForApp(apiKey.appId), '')
  if (apiKeyAccountId !== normalizedAccountId) {
    return { ok: false, mode: 'api_key_account_mismatch' }
  }
  return {
    ok: true,
    mode: 'api_key',
    apiKey,
  }
}

function validateDashboardRegisterOwnership(req, accountId = '') {
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId, '')
  if (!normalizedAccountId) {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'INVALID_REQUEST',
        message: 'accountId is required.',
      },
    }
  }

  const existingUsers = listDashboardUsersByAccount(normalizedAccountId)
  const hasExistingUsers = existingUsers.length > 0
  const hasProtectedResources = hasExistingUsers || hasNonBootstrapAccountResources(normalizedAccountId)
  if (!hasProtectedResources) {
    return {
      ok: true,
      proofMode: 'none',
    }
  }

  const proof = resolveDashboardRegisterOwnershipProof(req, normalizedAccountId)
  if (proof.ok) {
    return {
      ok: true,
      proofMode: proof.mode,
    }
  }

  return {
    ok: false,
    status: 403,
    error: {
      code: 'DASHBOARD_ACCOUNT_OWNERSHIP_REQUIRED',
      message: hasExistingUsers
        ? `accountId ${normalizedAccountId} is already claimed. Sign in with an existing account user to add members.`
        : `accountId ${normalizedAccountId} already has provisioned resources. Provide an active account credential (dashboard session or API key).`,
    },
  }
}

function resolveDashboardSession(req) {
  cleanupExpiredDashboardSessions()
  const token = parseBearerToken(req)
  if (!token) return { kind: 'none' }
  if (!token.startsWith(DASHBOARD_SESSION_PREFIX)) {
    return {
      kind: 'invalid',
      status: 401,
      code: 'DASHBOARD_TOKEN_INVALID',
      message: 'Dashboard access token is invalid.',
    }
  }
  const session = findDashboardSessionByPlaintext(token)
  if (!session) {
    return {
      kind: 'invalid',
      status: 401,
      code: 'DASHBOARD_TOKEN_INVALID',
      message: 'Dashboard access token is invalid.',
    }
  }

  const status = String(session.status || '').trim().toLowerCase()
  if (status !== 'active') {
    return {
      kind: 'invalid',
      status: 401,
      code: status === 'expired' ? 'DASHBOARD_TOKEN_EXPIRED' : 'DASHBOARD_TOKEN_INACTIVE',
      message: status === 'expired'
        ? 'Dashboard access token has expired.'
        : `Dashboard access token is not active (${status || 'unknown'}).`,
      session,
    }
  }

  const expiresAtMs = Date.parse(String(session.expiresAt || ''))
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    session.status = 'expired'
    session.updatedAt = nowIso()
    persistState(state)
    return {
      kind: 'invalid',
      status: 401,
      code: 'DASHBOARD_TOKEN_EXPIRED',
      message: 'Dashboard access token has expired.',
      session,
    }
  }

  const user = findDashboardUserById(session.userId)
  if (!user || String(user.status || '').toLowerCase() !== 'active') {
    session.status = 'revoked'
    session.updatedAt = nowIso()
    persistState(state)
    return {
      kind: 'invalid',
      status: 401,
      code: 'DASHBOARD_USER_INVALID',
      message: 'Dashboard user is invalid or disabled.',
      session,
    }
  }

  return {
    kind: 'dashboard_session',
    accessToken: token,
    session,
    user,
  }
}

function authorizeDashboardScope(req, searchParams, options = {}) {
  const option = options && typeof options === 'object' ? options : {}
  const requireAuth = option.requireAuth === true || DASHBOARD_AUTH_REQUIRED
  const requestedScope = parseScopeFiltersFromSearchParams(searchParams)
  const resolved = resolveDashboardSession(req)

  if (resolved.kind === 'none') {
    if (requireAuth) {
      return {
        ok: false,
        status: 401,
        error: {
          code: 'DASHBOARD_AUTH_REQUIRED',
          message: 'Dashboard authentication is required.',
        },
      }
    }
    return {
      ok: true,
      scope: requestedScope,
      authMode: 'anonymous',
      session: null,
      user: null,
    }
  }

  if (resolved.kind === 'invalid') {
    return {
      ok: false,
      status: resolved.status,
      error: {
        code: resolved.code,
        message: resolved.message,
      },
    }
  }

  const session = resolved.session
  const user = resolved.user
  const enforcedAccountId = normalizeControlPlaneAccountId(user.accountId || session.accountId, '')
  let enforcedAppId = String(requestedScope.appId || '').trim()
  if (enforcedAppId && !appBelongsToAccount(enforcedAppId, enforcedAccountId)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'DASHBOARD_SCOPE_VIOLATION',
        message: `appId ${enforcedAppId} does not belong to your account.`,
      },
    }
  }

  session.updatedAt = nowIso()
  session.metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {}
  session.metadata.lastUsedAt = session.updatedAt

  user.lastLoginAt = user.lastLoginAt || session.updatedAt
  user.updatedAt = session.updatedAt

  persistState(state)
  return {
    ok: true,
    scope: {
      accountId: enforcedAccountId,
      appId: enforcedAppId,
    },
    authMode: 'dashboard_session',
    session,
    user,
  }
}

function resolveAuthorizedDashboardAccount(auth) {
  const accountId = normalizeControlPlaneAccountId(
    auth?.scope?.accountId || auth?.user?.accountId || auth?.session?.accountId || '',
    '',
  )
  return accountId
}

function validateDashboardAccountOwnership(requestedAccountId, authorizedAccountId) {
  const requested = normalizeControlPlaneAccountId(requestedAccountId, '')
  const authorized = normalizeControlPlaneAccountId(authorizedAccountId, '')
  if (!requested || !authorized) return { ok: true }
  if (requested === authorized) return { ok: true }
  return {
    ok: false,
    status: 403,
    error: {
      code: 'DASHBOARD_SCOPE_VIOLATION',
      message: `accountId ${requested} does not belong to your dashboard scope.`,
    },
  }
}

function validateDashboardAppOwnership(appId, authorizedAccountId) {
  const normalizedAppId = String(appId || '').trim()
  if (!normalizedAppId) return { ok: true }
  const app = resolveControlPlaneAppRecord(normalizedAppId)
  if (!app) return { ok: true }
  const appAccountId = normalizeControlPlaneAccountId(app.accountId || app.organizationId, '')
  const scopedAccountId = normalizeControlPlaneAccountId(authorizedAccountId, '')
  if (!appAccountId || !scopedAccountId || appAccountId === scopedAccountId) return { ok: true }
  return {
    ok: false,
    status: 403,
    error: {
      code: 'DASHBOARD_SCOPE_VIOLATION',
      message: `appId ${normalizedAppId} does not belong to your account.`,
    },
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

function resolveControlPlaneAppRecord(appId = '') {
  const normalizedAppId = String(appId || '').trim()
  if (!normalizedAppId) return null
  const apps = Array.isArray(state?.controlPlane?.apps) ? state.controlPlane.apps : []
  return apps.find((item) => String(item?.appId || '').trim() === normalizedAppId) || null
}

function resolveAccountIdForApp(appId = '') {
  const app = resolveControlPlaneAppRecord(appId)
  if (!app) return ''
  return normalizeControlPlaneAccountId(app.accountId || app.organizationId)
}

function normalizeScopeFilters(input = {}) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    appId: String(source.appId || source.app_id || '').trim(),
    accountId: normalizeControlPlaneAccountId(
      source.accountId || source.account_id || source.organizationId || source.organization_id,
      '',
    ),
  }
}

function scopeHasFilters(scope = {}) {
  return Boolean(String(scope?.appId || '').trim() || String(scope?.accountId || '').trim())
}

function appMatchesScope(app, scope = {}) {
  if (!app || typeof app !== 'object') return false
  const appId = String(app.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(app.accountId || app.organizationId, '')
  if (scope.appId && scope.appId !== appId) return false
  if (scope.accountId && scope.accountId !== accountId) return false
  return Boolean(appId)
}

function getScopedApps(scope = {}) {
  const apps = Array.isArray(state?.controlPlane?.apps) ? state.controlPlane.apps : []
  return apps.filter((item) => appMatchesScope(item, scope))
}

function recordMatchesScope(record, scope = {}) {
  if (!record || typeof record !== 'object') return false
  const appId = String(record.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(record.accountId || resolveAccountIdForApp(appId), '')
  if (scope.appId && scope.appId !== appId) return false
  if (scope.accountId && scope.accountId !== accountId) return false
  return true
}

function parseScopeFiltersFromSearchParams(searchParams) {
  return normalizeScopeFilters({
    appId: searchParams.get('appId') || searchParams.get('app_id') || '',
    accountId: searchParams.get('accountId') || searchParams.get('account_id') || '',
  })
}

function appendQueryParams(rawUrl, params = {}) {
  const text = String(rawUrl || '').trim()
  if (!text) return ''
  let url
  try {
    url = new URL(text)
  } catch {
    return text
  }

  for (const [key, value] of Object.entries(params || {})) {
    const normalizedKey = String(key || '').trim()
    const normalizedValue = String(value || '').trim()
    if (!normalizedKey || !normalizedValue) continue
    url.searchParams.set(normalizedKey, normalizedValue)
  }
  return url.toString()
}

function injectTrackingScopeIntoAd(ad, scope = {}) {
  if (!ad || typeof ad !== 'object') return ad
  const params = {
    [TRACKING_ACCOUNT_QUERY_PARAM]: String(scope.accountId || '').trim(),
  }

  const tracking = ad.tracking && typeof ad.tracking === 'object' ? { ...ad.tracking } : {}
  const clickUrl = String(tracking.clickUrl || tracking.click_url || ad.targetUrl || '').trim()
  if (clickUrl) {
    const scopedClickUrl = appendQueryParams(clickUrl, params)
    tracking.clickUrl = scopedClickUrl
    tracking.click_url = scopedClickUrl
  }

  return {
    ...ad,
    tracking,
  }
}

function injectTrackingScopeIntoAds(ads, scope = {}) {
  if (!Array.isArray(ads)) return []
  return ads.map((item) => injectTrackingScopeIntoAd(item, scope))
}

function createInitialControlPlaneState() {
  return {
    apps: [],
    appEnvironments: [],
    apiKeys: [],
    integrationTokens: [],
    agentAccessTokens: [],
    dashboardUsers: [],
    dashboardSessions: [],
  }
}

function ensureControlPlaneState(raw) {
  const fallback = createInitialControlPlaneState()
  if (!raw || typeof raw !== 'object') return fallback

  const appRows = Array.isArray(raw.apps) ? raw.apps : []
  const apps = appRows
    .map((item) => buildControlPlaneAppRecord(item))
    .filter(Boolean)

  const appIdSet = new Set(apps.map((item) => item.appId))

  const environmentRows = Array.isArray(raw.appEnvironments || raw.environments)
    ? (raw.appEnvironments || raw.environments)
    : []
  const accountByAppId = new Map(apps.map((item) => [item.appId, normalizeControlPlaneAccountId(item.accountId)]))
  const appEnvironments = []
  const envDedup = new Set()

  for (const row of environmentRows) {
    const normalized = buildControlPlaneEnvironmentRecord(row)
    if (!normalized) continue
    if (!appIdSet.has(normalized.appId)) continue
    normalized.accountId = normalizeControlPlaneAccountId(
      normalized.accountId || accountByAppId.get(normalized.appId),
    )
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
      const environmentRecord = buildControlPlaneEnvironmentRecord({
        appId: app.appId,
        accountId: accountByAppId.get(app.appId),
        environment,
      })
      if (environmentRecord) {
        appEnvironments.push(environmentRecord)
      }
    }
  }

  const keyRows = Array.isArray(raw.apiKeys || raw.keys) ? (raw.apiKeys || raw.keys) : []
  let apiKeys = keyRows
    .map((item) => normalizeControlPlaneKeyRecord(item))
    .filter((item) => item && appIdSet.has(item.appId))
    .map((item) => ({
      ...item,
      accountId: normalizeControlPlaneAccountId(item.accountId || accountByAppId.get(item.appId)),
    }))
  const tokenRows = Array.isArray(raw.integrationTokens || raw.tokens)
    ? (raw.integrationTokens || raw.tokens)
    : []
  const integrationTokens = tokenRows
    .map((item) => normalizeIntegrationTokenRecord(item))
    .filter((item) => item && appIdSet.has(item.appId))
    .map((item) => ({
      ...item,
      accountId: normalizeControlPlaneAccountId(item.accountId || accountByAppId.get(item.appId)),
    }))
    .slice(0, MAX_INTEGRATION_TOKENS)

  const agentTokenRows = Array.isArray(raw.agentAccessTokens || raw.accessTokens)
    ? (raw.agentAccessTokens || raw.accessTokens)
    : []
  const agentAccessTokens = agentTokenRows
    .map((item) => normalizeAgentAccessTokenRecord(item))
    .filter((item) => item && appIdSet.has(item.appId))
    .map((item) => ({
      ...item,
      accountId: normalizeControlPlaneAccountId(item.accountId || accountByAppId.get(item.appId)),
    }))
    .slice(0, MAX_AGENT_ACCESS_TOKENS)

  const dashboardUserRows = Array.isArray(raw.dashboardUsers || raw.users)
    ? (raw.dashboardUsers || raw.users)
    : []
  const dashboardUsers = dashboardUserRows
    .map((item) => normalizeDashboardUserRecord(item))
    .filter((item) => item && Boolean(item.accountId))
    .slice(0, MAX_DASHBOARD_USERS)

  const knownUserIds = new Set(dashboardUsers.map((item) => item.userId))
  const dashboardSessionRows = Array.isArray(raw.dashboardSessions || raw.sessions)
    ? (raw.dashboardSessions || raw.sessions)
    : []
  const dashboardSessions = dashboardSessionRows
    .map((item) => normalizeDashboardSessionRecord(item))
    .filter((item) => item && knownUserIds.has(item.userId))
    .slice(0, MAX_DASHBOARD_SESSIONS)

  return {
    apps,
    appEnvironments,
    apiKeys,
    integrationTokens,
    agentAccessTokens,
    dashboardUsers,
    dashboardSessions,
  }
}

async function ensureControlPlaneAppAndEnvironment(appId, environment, accountId = '') {
  const normalizedAppId = String(appId || '').trim()
  if (!normalizedAppId) {
    throw new Error('appId is required.')
  }
  const normalizedEnvironment = normalizeControlPlaneEnvironment(environment)
  const requestedAccountId = normalizeControlPlaneAccountId(accountId, '')
  if (!requestedAccountId) {
    throw new Error('accountId is required.')
  }
  const controlPlane = state.controlPlane
  const now = nowIso()

  const existingApp = controlPlane.apps.find((item) => item.appId === normalizedAppId)
  let appRecord = null
  if (!existingApp) {
    appRecord = buildControlPlaneAppRecord({
      appId: normalizedAppId,
      accountId: requestedAccountId,
      displayName: normalizedAppId,
      organizationId: requestedAccountId,
      createdAt: now,
      updatedAt: now,
    })
    if (!appRecord) {
      throw new Error('failed to create control plane app.')
    }
  } else {
    const existingAccountId = normalizeControlPlaneAccountId(existingApp.accountId || existingApp.organizationId)
    if (requestedAccountId && requestedAccountId !== existingAccountId) {
      throw new Error(`appId ${normalizedAppId} is already bound to accountId ${existingAccountId}.`)
    }
    appRecord = buildControlPlaneAppRecord({
      ...existingApp,
      accountId: existingAccountId,
      organizationId: existingAccountId,
      updatedAt: now,
    })
  }
  const effectiveAccountId = normalizeControlPlaneAccountId(appRecord?.accountId || appRecord?.organizationId)
  if (!effectiveAccountId) {
    throw new Error('accountId is required.')
  }

  const dedupKey = `${normalizedAppId}::${normalizedEnvironment}`
  const existingEnvironment = controlPlane.appEnvironments.find((item) => (
    `${item.appId}::${item.environment}` === dedupKey
  ))
  let environmentRecord = null
  if (!existingEnvironment) {
    environmentRecord = buildControlPlaneEnvironmentRecord({
      appId: normalizedAppId,
      accountId: effectiveAccountId,
      environment: normalizedEnvironment,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    environmentRecord = buildControlPlaneEnvironmentRecord({
      ...existingEnvironment,
      accountId: effectiveAccountId,
      appId: normalizedAppId,
      environment: normalizedEnvironment,
      updatedAt: now,
    })
  }

  if (isSupabaseSettlementStore()) {
    await upsertControlPlaneAppToSupabase(appRecord)
    if (environmentRecord) {
      await upsertControlPlaneEnvironmentToSupabase(environmentRecord)
    }
  }

  upsertControlPlaneStateRecord('apps', 'appId', appRecord)
  if (environmentRecord) {
    upsertControlPlaneEnvironmentStateRecord(environmentRecord)
  }

  getPlacementConfigForApp(normalizedAppId, effectiveAccountId, { createIfMissing: true })
  if (normalizedAppId === DEFAULT_CONTROL_PLANE_APP_ID) {
    syncLegacyPlacementSnapshot()
  }

  return {
    appId: normalizedAppId,
    accountId: effectiveAccountId,
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

function normalizeV2BidMessages(value) {
  if (!Array.isArray(value)) {
    throw new Error('messages must be an array.')
  }

  const messages = value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`messages[${index}] must be an object.`)
      }
      validateNoExtraFields(item, V2_BID_MESSAGE_ALLOWED_FIELDS, `messages[${index}]`)
      const role = String(item.role || '').trim().toLowerCase()
      if (!V2_BID_MESSAGE_ROLES.has(role)) {
        throw new Error(`messages[${index}].role must be user, assistant, or system.`)
      }
      const content = requiredNonEmptyString(item.content, `messages[${index}].content`)
      const timestamp = String(item.timestamp || '').trim()
      if (timestamp && !Number.isFinite(Date.parse(timestamp))) {
        throw new Error(`messages[${index}].timestamp must be a valid ISO-8601 datetime.`)
      }
      return {
        role,
        content,
        ...(timestamp ? { timestamp: new Date(timestamp).toISOString() } : {}),
      }
    })
    .filter(Boolean)

  if (messages.length === 0) {
    throw new Error('messages must contain at least one valid message.')
  }

  return messages
}

function normalizeV2BidPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, V2_BID_ALLOWED_FIELDS, routeName)

  const userId = requiredNonEmptyString(input.userId, 'userId')
  const chatId = requiredNonEmptyString(input.chatId, 'chatId')
  const placementId = requiredNonEmptyString(input.placementId, 'placementId')
  const messages = normalizeV2BidMessages(input.messages)

  return {
    userId,
    chatId,
    placementId,
    messages,
  }
}

function normalizeAttachEventKind(value) {
  const kind = String(value || '').trim().toLowerCase()
  if (!kind) return 'impression'
  if (kind === 'impression' || kind === 'click') return kind
  throw new Error('kind must be impression or click.')
}

function normalizeNextStepEventKind(value) {
  const kind = String(value || '').trim().toLowerCase()
  if (!kind) return 'impression'
  if (kind === 'impression' || kind === 'click' || kind === 'dismiss') return kind
  throw new Error('kind must be impression, click, or dismiss.')
}

function normalizePostbackType(value) {
  const type = String(value || '').trim().toLowerCase()
  if (!type) return 'conversion'
  if (POSTBACK_TYPES.has(type)) return type
  throw new Error('postbackType must be conversion.')
}

function normalizePostbackStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  if (!status) return 'success'
  if (POSTBACK_STATUS.has(status)) return status
  throw new Error('postbackStatus must be pending, success, or failed.')
}

function normalizeIsoTimestamp(value, fallback = nowIso(), fieldName = '') {
  const text = String(value || '').trim()
  if (!text) return fallback
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) {
    if (fieldName) {
      throw new Error(`${fieldName} must be a valid ISO-8601 datetime.`)
    }
    return fallback
  }
  return new Date(parsed).toISOString()
}

function isPostbackConversionPayload(payload) {
  if (!payload || typeof payload !== 'object') return false
  const eventType = String(payload.eventType || payload.event || '').trim().toLowerCase()
  if (POSTBACK_EVENT_TYPES.has(eventType)) return true
  if (payload.postbackType !== undefined) return true
  if (payload.postbackStatus !== undefined) return true
  if (payload.conversionId !== undefined || payload.conversion_id !== undefined) return true
  return false
}

function normalizePostbackConversionPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, POSTBACK_CONVERSION_ALLOWED_FIELDS, routeName)

  const requestId = requiredNonEmptyString(input.requestId, 'requestId')
  const appId = String(input.appId || input.app_id || '').trim()
  const accountId = normalizeControlPlaneAccountId(
    input.accountId || input.account_id || (appId ? resolveAccountIdForApp(appId) : ''),
    '',
  )
  const eventType = String(input.eventType || input.event || 'postback').trim().toLowerCase()
  if (!POSTBACK_EVENT_TYPES.has(eventType)) {
    throw new Error('eventType must be postback.')
  }

  const postbackType = normalizePostbackType(input.postbackType || input.kind || 'conversion')
  const postbackStatus = normalizePostbackStatus(input.postbackStatus || 'success')
  const cpaUsd = clampNumber(input.cpaUsd ?? input.cpa_usd ?? input.payoutUsd ?? input.payout_usd, 0, Number.MAX_SAFE_INTEGER, NaN)
  if (postbackStatus === 'success' && !Number.isFinite(cpaUsd)) {
    throw new Error('cpaUsd is required for successful postback conversion.')
  }

  const currency = String(input.currency || 'USD').trim().toUpperCase()
  if (currency !== 'USD') {
    throw new Error('currency must be USD for CPA MVP.')
  }

  return {
    eventType: 'postback',
    requestId,
    appId,
    accountId,
    sessionId: String(input.sessionId || '').trim(),
    turnId: String(input.turnId || '').trim(),
    userId: String(input.userId || '').trim(),
    placementId: String(input.placementId || '').trim(),
    placementKey: String(input.placementKey || '').trim(),
    adId: String(input.adId || '').trim(),
    postbackType,
    postbackStatus,
    conversionId: String(input.conversionId || input.conversion_id || '').trim(),
    eventSeq: String(input.eventSeq || '').trim(),
    occurredAt: normalizeIsoTimestamp(input.eventAt || input.event_at, nowIso(), 'eventAt'),
    cpaUsd: Number.isFinite(cpaUsd) ? round(cpaUsd, 4) : 0,
    currency,
  }
}

function normalizeDashboardRegisterPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, DASHBOARD_REGISTER_ALLOWED_FIELDS, routeName)
  const email = normalizeEmail(requiredNonEmptyString(input.email, 'email'))
  const password = requiredNonEmptyString(input.password, 'password')
  if (password.length < 8) {
    throw new Error('password must contain at least 8 characters.')
  }
  const accountId = normalizeControlPlaneAccountId(
    requiredNonEmptyString(input.accountId || input.account_id, 'accountId'),
    '',
  )
  const appId = String(input.appId || input.app_id || '').trim()
  const displayName = String(input.displayName || input.display_name || '').trim()
  return {
    email,
    password,
    accountId,
    appId,
    displayName,
  }
}

function normalizeDashboardLoginPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, DASHBOARD_LOGIN_ALLOWED_FIELDS, routeName)
  const email = normalizeEmail(requiredNonEmptyString(input.email, 'email'))
  const password = requiredNonEmptyString(input.password, 'password')
  return {
    email,
    password,
  }
}

function normalizeAttachMvpPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, ATTACH_MVP_ALLOWED_FIELDS, routeName)

  const requestId = String(input.requestId || '').trim()
  const appId = String(input.appId || input.app_id || '').trim()
  const accountId = normalizeControlPlaneAccountId(
    input.accountId || input.account_id || (appId ? resolveAccountIdForApp(appId) : ''),
    '',
  )
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
    accountId,
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
  const appId = String(input.appId || input.app_id || '').trim()
  const accountId = normalizeControlPlaneAccountId(
    input.accountId || input.account_id || (appId ? resolveAccountIdForApp(appId) : ''),
    '',
  )
  const sessionId = requiredNonEmptyString(input.sessionId, 'sessionId')
  const turnId = requiredNonEmptyString(input.turnId, 'turnId')
  const placementId = requiredNonEmptyString(input.placementId, 'placementId')
  const placementKey = requiredNonEmptyString(input.placementKey, 'placementKey')
  const event = String(input.event || '').trim().toLowerCase()
  const userId = String(input.userId || '').trim()
  const kind = normalizeNextStepEventKind(input.kind)
  const adId = String(input.adId || '').trim()

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
    accountId,
    sessionId,
    turnId,
    userId,
    event,
    kind,
    adId,
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

function mapInternalFacetsToInference(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((facet) => {
      if (!facet || typeof facet !== 'object') return null
      const facetKey = String(facet.facetKey || '').trim()
      const facetValue = String(facet.facetValue || '').trim()
      if (!facetKey || !facetValue) return null
      const confidence = clampNumber(facet.confidence, 0, 1, NaN)
      const source = String(facet.source || '').trim()
      return {
        facet_key: facetKey,
        facet_value: facetValue,
        ...(Number.isFinite(confidence) ? { confidence } : {}),
        ...(source ? { source } : {}),
      }
    })
    .filter(Boolean)
}

function normalizeHintIntentClass(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  if (!NEXT_STEP_INTENT_CLASSES.has(text)) return ''
  return text
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

  const hintIntentClass = normalizeHintIntentClass(hints?.intent_class)
  const hintIntentScore = clampNumber(hints?.intent_score, 0, 1, NaN)
  const hintPreferenceFacets = normalizeNextStepPreferenceFacets(hints?.preference_facets)
  const fallbackUseClientHints = Boolean(inference?.fallbackUsed) && Boolean(hintIntentClass)

  const resolvedIntentClass = fallbackUseClientHints
    ? hintIntentClass
    : String(inference?.intent_class || 'non_commercial').trim().toLowerCase()
  const resolvedIntentScore = fallbackUseClientHints
    ? (Number.isFinite(hintIntentScore) ? hintIntentScore : 0)
    : (Number.isFinite(inference?.intent_score)
      ? clampNumber(inference.intent_score, 0, 1, 0)
      : 0)
  const resolvedPreferenceFacets = fallbackUseClientHints
    ? hintPreferenceFacets
    : mapInferenceFacetsToInternal(inference?.preference_facets)
  const resolvedConstraints = mergeConstraints(context.constraints, inference?.constraints)
  const effectiveInference = fallbackUseClientHints
    ? {
        ...inference,
        intent_class: resolvedIntentClass,
        intent_score: resolvedIntentScore,
        preference_facets: mapInternalFacetsToInference(resolvedPreferenceFacets),
        inference_trace: [
          ...(Array.isArray(inference?.inference_trace) ? inference.inference_trace : []),
          'fallback:client_hints_applied',
        ].slice(0, 10),
      }
    : inference

  return {
    inference: effectiveInference,
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

function normalizeBidderConfig(value) {
  const input = value && typeof value === 'object' ? value : {}
  const networkId = String(input.networkId || input.network_id || '').trim().toLowerCase()
  if (!networkId) return null

  return {
    networkId,
    endpoint: String(input.endpoint || '').trim(),
    timeoutMs: toPositiveInteger(input.timeoutMs ?? input.timeout_ms, 800),
    enabled: input.enabled !== false,
    policyWeight: clampNumber(input.policyWeight ?? input.policy_weight, -1000, 1000, 0),
  }
}

function normalizePlacementBidders(value = []) {
  const rows = Array.isArray(value) ? value : []
  const dedupe = new Set()
  const normalized = []

  for (const row of rows) {
    const bidder = normalizeBidderConfig(row)
    if (!bidder) continue
    if (dedupe.has(bidder.networkId)) continue
    dedupe.add(bidder.networkId)
    normalized.push(bidder)
  }

  if (normalized.length > 0) return normalized

  return [
    {
      networkId: 'partnerstack',
      endpoint: '',
      timeoutMs: 800,
      enabled: true,
      policyWeight: 0,
    },
    {
      networkId: 'cj',
      endpoint: '',
      timeoutMs: 800,
      enabled: true,
      policyWeight: 0,
    },
  ]
}

function normalizePlacementFallback(value) {
  const input = value && typeof value === 'object' ? value : {}
  const store = input.store && typeof input.store === 'object' ? input.store : {}
  return {
    store: {
      enabled: store.enabled === true,
      floorPrice: clampNumber(store.floorPrice, 0, Number.MAX_SAFE_INTEGER, 0),
    },
  }
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
    bidders: normalizePlacementBidders(raw?.bidders),
    fallback: normalizePlacementFallback(raw?.fallback),
    maxFanout: toPositiveInteger(raw?.maxFanout, 3),
    globalTimeoutMs: toPositiveInteger(raw?.globalTimeoutMs, 1200),
  }
}

function buildDefaultPlacementList() {
  return defaultPlacements.map((item) => normalizePlacement(item))
}

function normalizePlacementConfigRecord(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const seed = fallback && typeof fallback === 'object' ? fallback : {}
  const appId = String(source.appId || source.app_id || seed.appId || DEFAULT_CONTROL_PLANE_APP_ID).trim()
    || DEFAULT_CONTROL_PLANE_APP_ID
  const accountId = normalizeControlPlaneAccountId(
    source.accountId || source.account_id || source.organizationId || source.organization_id
      || seed.accountId || seed.organizationId || DEFAULT_CONTROL_PLANE_ORG_ID,
    '',
  )
  const placementSource = (
    Array.isArray(source.placements) && source.placements.length > 0
      ? source.placements
      : (
        Array.isArray(seed.placements) && seed.placements.length > 0
          ? seed.placements
          : buildDefaultPlacementList()
      )
  )
  const placements = placementSource.map((item) => normalizePlacement(item))
  const derivedVersion = Math.max(1, ...placements.map((placement) => placement.configVersion || 1))
  const placementConfigVersion = Math.max(
    toPositiveInteger(source.placementConfigVersion ?? source.configVersion ?? seed.placementConfigVersion, 1),
    derivedVersion,
  )

  return {
    appId,
    accountId,
    placementConfigVersion,
    placements,
    updatedAt: String(source.updatedAt || seed.updatedAt || nowIso()),
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

function normalizeConversionFact(raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  const appId = String(item.appId || '').trim()
  const requestId = String(item.requestId || '').trim()
  const conversionId = String(item.conversionId || '').trim()
  const createdAt = normalizeIsoTimestamp(item.createdAt, nowIso())
  const occurredAt = normalizeIsoTimestamp(item.occurredAt || item.eventAt, createdAt)

  const typeRaw = String(item.postbackType || '').trim().toLowerCase()
  const statusRaw = String(item.postbackStatus || '').trim().toLowerCase()
  const postbackType = POSTBACK_TYPES.has(typeRaw) ? typeRaw : 'conversion'
  const postbackStatus = POSTBACK_STATUS.has(statusRaw) ? statusRaw : 'success'
  const cpaUsd = round(clampNumber(item.cpaUsd ?? item.revenueUsd, 0, Number.MAX_SAFE_INTEGER, 0), 4)
  const fallbackFactId = `fact_${createHash('sha1').update(`${appId}|${requestId}|${conversionId}|${createdAt}`).digest('hex').slice(0, 16)}`

  return {
    factId: String(item.factId || '').trim() || fallbackFactId,
    factType: 'cpa_conversion',
    appId,
    accountId: normalizeControlPlaneAccountId(item.accountId || resolveAccountIdForApp(appId), ''),
    requestId,
    sessionId: String(item.sessionId || '').trim(),
    turnId: String(item.turnId || '').trim(),
    userId: String(item.userId || '').trim(),
    placementId: String(item.placementId || '').trim(),
    placementKey: String(item.placementKey || '').trim(),
    adId: String(item.adId || '').trim(),
    postbackType,
    postbackStatus,
    conversionId,
    eventSeq: String(item.eventSeq || '').trim(),
    occurredAt,
    createdAt,
    cpaUsd,
    revenueUsd: postbackStatus === 'success' ? cpaUsd : 0,
    currency: 'USD',
    idempotencyKey: String(item.idempotencyKey || '').trim(),
  }
}

function mapPostgresRowToConversionFact(row) {
  if (!row || typeof row !== 'object') return null
  return normalizeConversionFact({
    factId: row.fact_id,
    factType: row.fact_type,
    appId: row.app_id,
    accountId: row.account_id,
    requestId: row.request_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    userId: row.user_id,
    placementId: row.placement_id,
    placementKey: row.placement_key,
    adId: row.ad_id,
    postbackType: row.postback_type,
    postbackStatus: row.postback_status,
    conversionId: row.conversion_id,
    eventSeq: row.event_seq,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    cpaUsd: row.cpa_usd,
    revenueUsd: row.revenue_usd,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
  })
}

async function ensureSettlementFactTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SETTLEMENT_FACT_TABLE} (
      fact_id TEXT PRIMARY KEY,
      fact_type TEXT NOT NULL,
      app_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      turn_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '',
      placement_id TEXT NOT NULL DEFAULT '',
      placement_key TEXT NOT NULL DEFAULT '',
      ad_id TEXT NOT NULL DEFAULT '',
      postback_type TEXT NOT NULL,
      postback_status TEXT NOT NULL,
      conversion_id TEXT NOT NULL,
      event_seq TEXT NOT NULL DEFAULT '',
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      cpa_usd NUMERIC(18, 4) NOT NULL DEFAULT 0,
      revenue_usd NUMERIC(18, 4) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      idempotency_key TEXT NOT NULL UNIQUE
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${SETTLEMENT_FACT_TABLE}_account_app ON ${SETTLEMENT_FACT_TABLE} (account_id, app_id, occurred_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${SETTLEMENT_FACT_TABLE}_request ON ${SETTLEMENT_FACT_TABLE} (request_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${SETTLEMENT_FACT_TABLE}_placement ON ${SETTLEMENT_FACT_TABLE} (placement_id, occurred_at DESC)`)
}

async function ensureRuntimeLogTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${RUNTIME_DECISION_LOG_TABLE} (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      request_id TEXT NOT NULL DEFAULT '',
      app_id TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      turn_id TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL DEFAULT '',
      placement_id TEXT NOT NULL DEFAULT '',
      placement_key TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${RUNTIME_DECISION_LOG_TABLE}_account_app
      ON ${RUNTIME_DECISION_LOG_TABLE} (account_id, app_id, created_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${RUNTIME_DECISION_LOG_TABLE}_request
      ON ${RUNTIME_DECISION_LOG_TABLE} (request_id)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${RUNTIME_DECISION_LOG_TABLE}_placement
      ON ${RUNTIME_DECISION_LOG_TABLE} (placement_id, created_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${RUNTIME_EVENT_LOG_TABLE} (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      event_type TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      app_id TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      turn_id TEXT NOT NULL DEFAULT '',
      placement_id TEXT NOT NULL DEFAULT '',
      placement_key TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${RUNTIME_EVENT_LOG_TABLE}_account_app
      ON ${RUNTIME_EVENT_LOG_TABLE} (account_id, app_id, created_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${RUNTIME_EVENT_LOG_TABLE}_request
      ON ${RUNTIME_EVENT_LOG_TABLE} (request_id)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${RUNTIME_EVENT_LOG_TABLE}_placement
      ON ${RUNTIME_EVENT_LOG_TABLE} (placement_id, created_at DESC)
  `)
}

async function ensureControlPlaneTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_PLANE_APPS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      app_id TEXT NOT NULL UNIQUE,
      organization_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('active', 'disabled', 'archived'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_control_plane_apps_org_status
      ON ${CONTROL_PLANE_APPS_TABLE} (organization_id, status, created_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_PLANE_APP_ENVIRONMENTS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      environment_id TEXT NOT NULL UNIQUE,
      app_id TEXT NOT NULL REFERENCES ${CONTROL_PLANE_APPS_TABLE}(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
      environment TEXT NOT NULL,
      api_base_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (app_id, environment),
      CHECK (environment IN ('sandbox', 'staging', 'prod')),
      CHECK (status IN ('active', 'disabled'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_control_plane_env_app_env
      ON ${CONTROL_PLANE_APP_ENVIRONMENTS_TABLE} (app_id, environment)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_control_plane_env_status
      ON ${CONTROL_PLANE_APP_ENVIRONMENTS_TABLE} (status, created_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_PLANE_API_KEYS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      key_id TEXT NOT NULL UNIQUE,
      app_id TEXT NOT NULL REFERENCES ${CONTROL_PLANE_APPS_TABLE}(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
      environment TEXT NOT NULL,
      key_name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      secret_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      revoked_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (environment IN ('sandbox', 'staging', 'prod')),
      CHECK (status IN ('active', 'revoked'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_control_plane_api_keys_app_env_status
      ON ${CONTROL_PLANE_API_KEYS_TABLE} (app_id, environment, status, created_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_control_plane_api_keys_prefix
      ON ${CONTROL_PLANE_API_KEYS_TABLE} (key_prefix)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_control_plane_api_keys_last_used
      ON ${CONTROL_PLANE_API_KEYS_TABLE} (last_used_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_PLANE_DASHBOARD_USERS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      app_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      last_login_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('active', 'disabled'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_dashboard_users_account
      ON ${CONTROL_PLANE_DASHBOARD_USERS_TABLE} (account_id, created_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_dashboard_users_app
      ON ${CONTROL_PLANE_DASHBOARD_USERS_TABLE} (app_id, created_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_PLANE_DASHBOARD_SESSIONS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES ${CONTROL_PLANE_DASHBOARD_USERS_TABLE}(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
      email TEXT NOT NULL,
      account_id TEXT NOT NULL,
      app_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('active', 'expired', 'revoked'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_dashboard_sessions_user
      ON ${CONTROL_PLANE_DASHBOARD_SESSIONS_TABLE} (user_id, issued_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_dashboard_sessions_account
      ON ${CONTROL_PLANE_DASHBOARD_SESSIONS_TABLE} (account_id, issued_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_dashboard_sessions_status
      ON ${CONTROL_PLANE_DASHBOARD_SESSIONS_TABLE} (status, expires_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_PLANE_INTEGRATION_TOKENS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      token_id TEXT NOT NULL UNIQUE,
      app_id TEXT NOT NULL REFERENCES ${CONTROL_PLANE_APPS_TABLE}(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
      account_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      placement_id TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      token_type TEXT NOT NULL DEFAULT 'integration_token',
      one_time BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'active',
      scope JSONB NOT NULL DEFAULT '{}'::jsonb,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (environment IN ('sandbox', 'staging', 'prod')),
      CHECK (status IN ('active', 'used', 'expired', 'revoked'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_integration_tokens_account
      ON ${CONTROL_PLANE_INTEGRATION_TOKENS_TABLE} (account_id, app_id, issued_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_integration_tokens_status
      ON ${CONTROL_PLANE_INTEGRATION_TOKENS_TABLE} (status, expires_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_PLANE_AGENT_ACCESS_TOKENS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      token_id TEXT NOT NULL UNIQUE,
      app_id TEXT NOT NULL REFERENCES ${CONTROL_PLANE_APPS_TABLE}(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
      account_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      placement_id TEXT NOT NULL DEFAULT '',
      source_token_id TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      token_type TEXT NOT NULL DEFAULT 'agent_access_token',
      status TEXT NOT NULL DEFAULT 'active',
      scope JSONB NOT NULL DEFAULT '{}'::jsonb,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (environment IN ('sandbox', 'staging', 'prod')),
      CHECK (status IN ('active', 'expired', 'revoked'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_agent_access_tokens_account
      ON ${CONTROL_PLANE_AGENT_ACCESS_TOKENS_TABLE} (account_id, app_id, issued_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cp_agent_access_tokens_status
      ON ${CONTROL_PLANE_AGENT_ACCESS_TOKENS_TABLE} (status, expires_at DESC)
  `)
}

function upsertControlPlaneStateRecord(collectionKey, recordKey, record, max = 0) {
  if (!state?.controlPlane || typeof state.controlPlane !== 'object') {
    state.controlPlane = createInitialControlPlaneState()
  }
  const rows = Array.isArray(state.controlPlane[collectionKey]) ? state.controlPlane[collectionKey] : []
  const key = String(record?.[recordKey] || '').trim()
  if (!key) return
  const nextRows = [record, ...rows.filter((item) => String(item?.[recordKey] || '').trim() !== key)]
  state.controlPlane[collectionKey] = max > 0 ? nextRows.slice(0, max) : nextRows
}

function upsertControlPlaneEnvironmentStateRecord(record) {
  if (!record || typeof record !== 'object') return
  if (!state?.controlPlane || typeof state.controlPlane !== 'object') {
    state.controlPlane = createInitialControlPlaneState()
  }
  const rows = Array.isArray(state.controlPlane.appEnvironments) ? state.controlPlane.appEnvironments : []
  const appId = String(record.appId || '').trim()
  const environment = normalizeControlPlaneEnvironment(record.environment)
  if (!appId) return
  const dedupKey = `${appId}::${environment}`
  state.controlPlane.appEnvironments = [
    {
      ...record,
      appId,
      environment,
    },
    ...rows.filter((item) => `${String(item?.appId || '').trim()}::${normalizeControlPlaneEnvironment(item?.environment)}` !== dedupKey),
  ]
}

async function loadControlPlaneStateFromSupabase(pool) {
  const db = pool || settlementStore.pool
  if (!db) return createInitialControlPlaneState()

  const [
    appsResult,
    environmentsResult,
    keysResult,
    usersResult,
    sessionsResult,
    integrationTokensResult,
    agentTokensResult,
  ] = await Promise.all([
    db.query(`
      SELECT
        app_id,
        organization_id AS account_id,
        display_name,
        status,
        metadata,
        created_at,
        updated_at
      FROM ${CONTROL_PLANE_APPS_TABLE}
      ORDER BY updated_at DESC
    `),
    db.query(`
      SELECT
        env.environment_id,
        env.app_id,
        apps.organization_id AS account_id,
        env.environment,
        env.api_base_url,
        env.status,
        env.metadata,
        env.created_at,
        env.updated_at
      FROM ${CONTROL_PLANE_APP_ENVIRONMENTS_TABLE} AS env
      LEFT JOIN ${CONTROL_PLANE_APPS_TABLE} AS apps
        ON apps.app_id = env.app_id
      ORDER BY env.updated_at DESC
    `),
    db.query(`
      SELECT
        keys.key_id,
        keys.app_id,
        apps.organization_id AS account_id,
        keys.environment,
        keys.key_name,
        keys.key_prefix,
        keys.secret_hash,
        keys.status,
        keys.revoked_at,
        keys.last_used_at,
        keys.metadata,
        keys.created_at,
        keys.updated_at
      FROM ${CONTROL_PLANE_API_KEYS_TABLE} AS keys
      LEFT JOIN ${CONTROL_PLANE_APPS_TABLE} AS apps
        ON apps.app_id = keys.app_id
      ORDER BY keys.updated_at DESC
    `),
    db.query(`
      SELECT
        user_id,
        email,
        display_name,
        account_id,
        app_id,
        status,
        password_hash,
        password_salt,
        last_login_at,
        metadata,
        created_at,
        updated_at
      FROM ${CONTROL_PLANE_DASHBOARD_USERS_TABLE}
      ORDER BY updated_at DESC
    `),
    db.query(`
      SELECT
        session_id,
        token_hash,
        user_id,
        email,
        account_id,
        app_id,
        status,
        issued_at,
        expires_at,
        revoked_at,
        metadata,
        updated_at
      FROM ${CONTROL_PLANE_DASHBOARD_SESSIONS_TABLE}
      ORDER BY issued_at DESC
    `),
    db.query(`
      SELECT
        token_id,
        app_id,
        account_id,
        environment,
        placement_id,
        token_hash,
        token_type,
        one_time,
        status,
        scope,
        issued_at,
        expires_at,
        used_at,
        revoked_at,
        metadata,
        updated_at
      FROM ${CONTROL_PLANE_INTEGRATION_TOKENS_TABLE}
      ORDER BY issued_at DESC
    `),
    db.query(`
      SELECT
        token_id,
        app_id,
        account_id,
        environment,
        placement_id,
        source_token_id,
        token_hash,
        token_type,
        status,
        scope,
        issued_at,
        expires_at,
        metadata,
        updated_at
      FROM ${CONTROL_PLANE_AGENT_ACCESS_TOKENS_TABLE}
      ORDER BY issued_at DESC
    `),
  ])

  const loaded = ensureControlPlaneState({
    apps: Array.isArray(appsResult.rows)
      ? appsResult.rows.map((row) => ({
        appId: row.app_id,
        accountId: row.account_id,
        displayName: row.display_name,
        status: row.status,
        metadata: toDbJsonObject(row.metadata, {}),
        createdAt: normalizeDbTimestamp(row.created_at, nowIso()),
        updatedAt: normalizeDbTimestamp(row.updated_at, nowIso()),
      }))
      : [],
    appEnvironments: Array.isArray(environmentsResult.rows)
      ? environmentsResult.rows.map((row) => ({
        environmentId: row.environment_id,
        appId: row.app_id,
        accountId: row.account_id,
        environment: row.environment,
        apiBaseUrl: row.api_base_url,
        status: row.status,
        metadata: toDbJsonObject(row.metadata, {}),
        createdAt: normalizeDbTimestamp(row.created_at, nowIso()),
        updatedAt: normalizeDbTimestamp(row.updated_at, nowIso()),
      }))
      : [],
    apiKeys: Array.isArray(keysResult.rows)
      ? keysResult.rows.map((row) => ({
        keyId: row.key_id,
        appId: row.app_id,
        accountId: row.account_id,
        environment: row.environment,
        keyName: row.key_name,
        keyPrefix: row.key_prefix,
        secretHash: row.secret_hash,
        status: row.status,
        revokedAt: normalizeDbTimestamp(row.revoked_at, ''),
        lastUsedAt: normalizeDbTimestamp(row.last_used_at, ''),
        metadata: toDbJsonObject(row.metadata, {}),
        createdAt: normalizeDbTimestamp(row.created_at, nowIso()),
        updatedAt: normalizeDbTimestamp(row.updated_at, nowIso()),
      }))
      : [],
    dashboardUsers: Array.isArray(usersResult.rows)
      ? usersResult.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        accountId: row.account_id,
        appId: row.app_id,
        status: row.status,
        passwordHash: row.password_hash,
        passwordSalt: row.password_salt,
        lastLoginAt: normalizeDbTimestamp(row.last_login_at, ''),
        metadata: toDbJsonObject(row.metadata, {}),
        createdAt: normalizeDbTimestamp(row.created_at, nowIso()),
        updatedAt: normalizeDbTimestamp(row.updated_at, nowIso()),
      }))
      : [],
    dashboardSessions: Array.isArray(sessionsResult.rows)
      ? sessionsResult.rows.map((row) => ({
        sessionId: row.session_id,
        tokenHash: row.token_hash,
        userId: row.user_id,
        email: row.email,
        accountId: row.account_id,
        appId: row.app_id,
        status: row.status,
        issuedAt: normalizeDbTimestamp(row.issued_at, nowIso()),
        expiresAt: normalizeDbTimestamp(row.expires_at, nowIso()),
        revokedAt: normalizeDbTimestamp(row.revoked_at, ''),
        metadata: toDbJsonObject(row.metadata, {}),
        updatedAt: normalizeDbTimestamp(row.updated_at, nowIso()),
      }))
      : [],
    integrationTokens: Array.isArray(integrationTokensResult.rows)
      ? integrationTokensResult.rows.map((row) => ({
        tokenId: row.token_id,
        appId: row.app_id,
        accountId: row.account_id,
        environment: row.environment,
        placementId: row.placement_id,
        tokenHash: row.token_hash,
        tokenType: row.token_type || 'integration_token',
        oneTime: row.one_time !== false,
        status: row.status,
        scope: toDbJsonObject(row.scope, createMinimalAgentScope()),
        issuedAt: normalizeDbTimestamp(row.issued_at, nowIso()),
        expiresAt: normalizeDbTimestamp(row.expires_at, nowIso()),
        usedAt: normalizeDbTimestamp(row.used_at, ''),
        revokedAt: normalizeDbTimestamp(row.revoked_at, ''),
        metadata: toDbJsonObject(row.metadata, {}),
        updatedAt: normalizeDbTimestamp(row.updated_at, nowIso()),
      }))
      : [],
    agentAccessTokens: Array.isArray(agentTokensResult.rows)
      ? agentTokensResult.rows.map((row) => ({
        tokenId: row.token_id,
        appId: row.app_id,
        accountId: row.account_id,
        environment: row.environment,
        placementId: row.placement_id,
        sourceTokenId: row.source_token_id,
        tokenHash: row.token_hash,
        tokenType: row.token_type || 'agent_access_token',
        status: row.status,
        scope: toDbJsonObject(row.scope, createMinimalAgentScope()),
        issuedAt: normalizeDbTimestamp(row.issued_at, nowIso()),
        expiresAt: normalizeDbTimestamp(row.expires_at, nowIso()),
        metadata: toDbJsonObject(row.metadata, {}),
        updatedAt: normalizeDbTimestamp(row.updated_at, nowIso()),
      }))
      : [],
  })

  state.controlPlane = loaded

  for (const app of loaded.apps) {
    const appId = String(app?.appId || '').trim()
    const accountId = normalizeControlPlaneAccountId(app?.accountId || app?.organizationId, '')
    if (!appId || !accountId) continue
    getPlacementConfigForApp(appId, accountId, { createIfMissing: true })
  }
  if (DEFAULT_CONTROL_PLANE_APP_ID) {
    syncLegacyPlacementSnapshot()
  }

  return loaded
}

async function upsertControlPlaneAppToSupabase(recordInput, pool = null) {
  const record = buildControlPlaneAppRecord(recordInput)
  if (!record) {
    throw new Error('control plane app record is invalid.')
  }
  const db = pool || settlementStore.pool
  if (!db) return record

  await db.query(
    `
      INSERT INTO ${CONTROL_PLANE_APPS_TABLE} (
        app_id,
        organization_id,
        display_name,
        status,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
      ON CONFLICT (app_id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        display_name = EXCLUDED.display_name,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.appId,
      record.accountId,
      record.displayName,
      record.status,
      JSON.stringify(toDbJsonObject(record.metadata, {})),
      normalizeDbTimestamp(record.createdAt, nowIso()),
      normalizeDbTimestamp(record.updatedAt, nowIso()),
    ],
  )
  return record
}

async function upsertControlPlaneEnvironmentToSupabase(recordInput, pool = null) {
  const record = buildControlPlaneEnvironmentRecord(recordInput)
  if (!record) {
    throw new Error('control plane app environment record is invalid.')
  }
  const db = pool || settlementStore.pool
  if (!db) return record

  await db.query(
    `
      INSERT INTO ${CONTROL_PLANE_APP_ENVIRONMENTS_TABLE} (
        environment_id,
        app_id,
        environment,
        api_base_url,
        status,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz)
      ON CONFLICT (app_id, environment) DO UPDATE SET
        environment_id = EXCLUDED.environment_id,
        api_base_url = EXCLUDED.api_base_url,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.environmentId,
      record.appId,
      record.environment,
      record.apiBaseUrl,
      record.status,
      JSON.stringify(toDbJsonObject(record.metadata, {})),
      normalizeDbTimestamp(record.createdAt, nowIso()),
      normalizeDbTimestamp(record.updatedAt, nowIso()),
    ],
  )
  return record
}

async function upsertControlPlaneKeyToSupabase(recordInput, pool = null) {
  const record = normalizeControlPlaneKeyRecord(recordInput)
  if (!record) {
    throw new Error('control plane api key record is invalid.')
  }
  const db = pool || settlementStore.pool
  if (!db) return record

  await db.query(
    `
      INSERT INTO ${CONTROL_PLANE_API_KEYS_TABLE} (
        key_id,
        app_id,
        environment,
        key_name,
        key_prefix,
        secret_hash,
        status,
        revoked_at,
        last_used_at,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::timestamptz, $9::timestamptz, $10::jsonb, $11::timestamptz, $12::timestamptz
      )
      ON CONFLICT (key_id) DO UPDATE SET
        app_id = EXCLUDED.app_id,
        environment = EXCLUDED.environment,
        key_name = EXCLUDED.key_name,
        key_prefix = EXCLUDED.key_prefix,
        secret_hash = EXCLUDED.secret_hash,
        status = EXCLUDED.status,
        revoked_at = EXCLUDED.revoked_at,
        last_used_at = EXCLUDED.last_used_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.keyId,
      record.appId,
      record.environment,
      record.keyName,
      record.keyPrefix,
      record.secretHash,
      record.status,
      toDbNullableTimestamptz(record.revokedAt),
      toDbNullableTimestamptz(record.lastUsedAt),
      JSON.stringify(toDbJsonObject(record.metadata, {})),
      normalizeDbTimestamp(record.createdAt, nowIso()),
      normalizeDbTimestamp(record.updatedAt, nowIso()),
    ],
  )
  return record
}

async function upsertDashboardUserToSupabase(recordInput, pool = null) {
  const record = normalizeDashboardUserRecord(recordInput)
  if (!record) {
    throw new Error('dashboard user record is invalid.')
  }
  const db = pool || settlementStore.pool
  if (!db) return record

  await db.query(
    `
      INSERT INTO ${CONTROL_PLANE_DASHBOARD_USERS_TABLE} (
        user_id,
        email,
        display_name,
        account_id,
        app_id,
        status,
        password_hash,
        password_salt,
        last_login_at,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9::timestamptz, $10::jsonb, $11::timestamptz, $12::timestamptz
      )
      ON CONFLICT (user_id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        account_id = EXCLUDED.account_id,
        app_id = EXCLUDED.app_id,
        status = EXCLUDED.status,
        password_hash = EXCLUDED.password_hash,
        password_salt = EXCLUDED.password_salt,
        last_login_at = EXCLUDED.last_login_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.userId,
      record.email,
      record.displayName,
      record.accountId,
      record.appId,
      record.status,
      record.passwordHash,
      record.passwordSalt,
      toDbNullableTimestamptz(record.lastLoginAt),
      JSON.stringify(toDbJsonObject(record.metadata, {})),
      normalizeDbTimestamp(record.createdAt, nowIso()),
      normalizeDbTimestamp(record.updatedAt, nowIso()),
    ],
  )
  return record
}

async function upsertDashboardSessionToSupabase(recordInput, pool = null) {
  const record = normalizeDashboardSessionRecord(recordInput)
  if (!record) {
    throw new Error('dashboard session record is invalid.')
  }
  const db = pool || settlementStore.pool
  if (!db) return record

  await db.query(
    `
      INSERT INTO ${CONTROL_PLANE_DASHBOARD_SESSIONS_TABLE} (
        session_id,
        token_hash,
        user_id,
        email,
        account_id,
        app_id,
        status,
        issued_at,
        expires_at,
        revoked_at,
        metadata,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::timestamptz, $9::timestamptz, $10::timestamptz,
        $11::jsonb, $12::timestamptz
      )
      ON CONFLICT (session_id) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        user_id = EXCLUDED.user_id,
        email = EXCLUDED.email,
        account_id = EXCLUDED.account_id,
        app_id = EXCLUDED.app_id,
        status = EXCLUDED.status,
        issued_at = EXCLUDED.issued_at,
        expires_at = EXCLUDED.expires_at,
        revoked_at = EXCLUDED.revoked_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.sessionId,
      record.tokenHash,
      record.userId,
      record.email,
      record.accountId,
      record.appId,
      record.status,
      normalizeDbTimestamp(record.issuedAt, nowIso()),
      normalizeDbTimestamp(record.expiresAt, nowIso()),
      toDbNullableTimestamptz(record.revokedAt),
      JSON.stringify(toDbJsonObject(record.metadata, {})),
      normalizeDbTimestamp(record.updatedAt, nowIso()),
    ],
  )
  return record
}

async function upsertIntegrationTokenToSupabase(recordInput, pool = null) {
  const record = normalizeIntegrationTokenRecord(recordInput)
  if (!record) {
    throw new Error('integration token record is invalid.')
  }
  const db = pool || settlementStore.pool
  if (!db) return record

  await db.query(
    `
      INSERT INTO ${CONTROL_PLANE_INTEGRATION_TOKENS_TABLE} (
        token_id,
        app_id,
        account_id,
        environment,
        placement_id,
        token_hash,
        token_type,
        one_time,
        status,
        scope,
        issued_at,
        expires_at,
        used_at,
        revoked_at,
        metadata,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11::timestamptz, $12::timestamptz,
        $13::timestamptz, $14::timestamptz, $15::jsonb, $16::timestamptz
      )
      ON CONFLICT (token_id) DO UPDATE SET
        app_id = EXCLUDED.app_id,
        account_id = EXCLUDED.account_id,
        environment = EXCLUDED.environment,
        placement_id = EXCLUDED.placement_id,
        token_hash = EXCLUDED.token_hash,
        token_type = EXCLUDED.token_type,
        one_time = EXCLUDED.one_time,
        status = EXCLUDED.status,
        scope = EXCLUDED.scope,
        issued_at = EXCLUDED.issued_at,
        expires_at = EXCLUDED.expires_at,
        used_at = EXCLUDED.used_at,
        revoked_at = EXCLUDED.revoked_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.tokenId,
      record.appId,
      record.accountId,
      record.environment,
      record.placementId,
      record.tokenHash,
      record.tokenType || 'integration_token',
      record.oneTime !== false,
      record.status,
      JSON.stringify(toDbJsonObject(record.scope, createMinimalAgentScope())),
      normalizeDbTimestamp(record.issuedAt, nowIso()),
      normalizeDbTimestamp(record.expiresAt, nowIso()),
      toDbNullableTimestamptz(record.usedAt),
      toDbNullableTimestamptz(record.revokedAt),
      JSON.stringify(toDbJsonObject(record.metadata, {})),
      normalizeDbTimestamp(record.updatedAt, nowIso()),
    ],
  )
  return record
}

async function upsertAgentAccessTokenToSupabase(recordInput, pool = null) {
  const record = normalizeAgentAccessTokenRecord(recordInput)
  if (!record) {
    throw new Error('agent access token record is invalid.')
  }
  const db = pool || settlementStore.pool
  if (!db) return record

  await db.query(
    `
      INSERT INTO ${CONTROL_PLANE_AGENT_ACCESS_TOKENS_TABLE} (
        token_id,
        app_id,
        account_id,
        environment,
        placement_id,
        source_token_id,
        token_hash,
        token_type,
        status,
        scope,
        issued_at,
        expires_at,
        metadata,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11::timestamptz, $12::timestamptz, $13::jsonb, $14::timestamptz
      )
      ON CONFLICT (token_id) DO UPDATE SET
        app_id = EXCLUDED.app_id,
        account_id = EXCLUDED.account_id,
        environment = EXCLUDED.environment,
        placement_id = EXCLUDED.placement_id,
        source_token_id = EXCLUDED.source_token_id,
        token_hash = EXCLUDED.token_hash,
        token_type = EXCLUDED.token_type,
        status = EXCLUDED.status,
        scope = EXCLUDED.scope,
        issued_at = EXCLUDED.issued_at,
        expires_at = EXCLUDED.expires_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.tokenId,
      record.appId,
      record.accountId,
      record.environment,
      record.placementId,
      record.sourceTokenId,
      record.tokenHash,
      record.tokenType || 'agent_access_token',
      record.status,
      JSON.stringify(toDbJsonObject(record.scope, createMinimalAgentScope())),
      normalizeDbTimestamp(record.issuedAt, nowIso()),
      normalizeDbTimestamp(record.expiresAt, nowIso()),
      JSON.stringify(toDbJsonObject(record.metadata, {})),
      normalizeDbTimestamp(record.updatedAt, nowIso()),
    ],
  )
  return record
}

async function upsertConversionFactToPostgres(fact, pool = null) {
  const db = pool || settlementStore.pool
  if (!db) return null
  const result = await db.query(
    `
      INSERT INTO ${SETTLEMENT_FACT_TABLE} (
        fact_id,
        fact_type,
        app_id,
        account_id,
        request_id,
        session_id,
        turn_id,
        user_id,
        placement_id,
        placement_key,
        ad_id,
        postback_type,
        postback_status,
        conversion_id,
        event_seq,
        occurred_at,
        created_at,
        cpa_usd,
        revenue_usd,
        currency,
        idempotency_key
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16::timestamptz, $17::timestamptz,
        $18, $19, $20, $21
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *
    `,
    [
      fact.factId,
      fact.factType,
      fact.appId,
      fact.accountId,
      fact.requestId,
      fact.sessionId,
      fact.turnId,
      fact.userId,
      fact.placementId,
      fact.placementKey,
      fact.adId,
      fact.postbackType,
      fact.postbackStatus,
      fact.conversionId,
      fact.eventSeq,
      fact.occurredAt,
      fact.createdAt,
      fact.cpaUsd,
      fact.revenueUsd,
      fact.currency,
      fact.idempotencyKey,
    ],
  )
  if (!Array.isArray(result.rows) || result.rows.length === 0) return null
  return mapPostgresRowToConversionFact(result.rows[0])
}

async function findConversionFactByIdempotencyKeyFromPostgres(idempotencyKey) {
  const db = settlementStore.pool
  if (!db) return null
  const result = await db.query(
    `SELECT * FROM ${SETTLEMENT_FACT_TABLE} WHERE idempotency_key = $1 LIMIT 1`,
    [idempotencyKey],
  )
  if (!Array.isArray(result.rows) || result.rows.length === 0) return null
  return mapPostgresRowToConversionFact(result.rows[0])
}

async function ensureSettlementStoreReady() {
  if (settlementStore.initPromise) {
    await settlementStore.initPromise
    return
  }

  settlementStore.initPromise = (async () => {
    const requiresSupabasePersistence = REQUIRE_DURABLE_SETTLEMENT || REQUIRE_RUNTIME_LOG_DB_PERSISTENCE
    if (settlementStore.mode !== 'supabase') {
      if (requiresSupabasePersistence) {
        throw new Error(
          'supabase persistence is required, but simulator settlement mode resolved to state_file.',
        )
      }
      return
    }
    if (!SETTLEMENT_DB_URL) {
      if (requiresSupabasePersistence) {
        throw new Error(
          'supabase persistence is required, but SUPABASE_DB_URL is missing.',
        )
      }
      settlementStore.mode = 'state_file'
      return
    }

    try {
      const { Pool } = await import('pg')
      const pool = new Pool({
        connectionString: SETTLEMENT_DB_URL,
        ssl: SETTLEMENT_DB_URL.includes('supabase.co')
          ? { rejectUnauthorized: false }
          : undefined,
      })
      await pool.query('SELECT 1')
      await ensureSettlementFactTable(pool)
      await ensureRuntimeLogTables(pool)
      await ensureControlPlaneTables(pool)
      settlementStore.pool = pool
      await loadControlPlaneStateFromSupabase(pool)
    } catch (error) {
      if (requiresSupabasePersistence) {
        throw new Error(
          `supabase persistence init failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      settlementStore.mode = 'state_file'
      settlementStore.pool = null
      console.error(
        '[simulator-gateway] settlement store supabase init failed, fallback to state_file:',
        error instanceof Error ? error.message : String(error),
      )
    }
  })()

  await settlementStore.initPromise
}

async function listConversionFacts(scopeInput = {}) {
  const scope = normalizeScopeFilters(scopeInput)
  await ensureSettlementStoreReady()

  if (!isPostgresSettlementStore()) {
    const rows = Array.isArray(state?.conversionFacts) ? state.conversionFacts : []
    if (!scopeHasFilters(scope)) return rows
    return filterRowsByScope(rows, scope)
  }

  const clauses = []
  const values = []
  let cursor = 1

  if (scope.accountId) {
    clauses.push(`account_id = $${cursor}`)
    values.push(scope.accountId)
    cursor += 1
  }
  if (scope.appId) {
    clauses.push(`app_id = $${cursor}`)
    values.push(scope.appId)
    cursor += 1
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const result = await settlementStore.pool.query(
    `SELECT * FROM ${SETTLEMENT_FACT_TABLE} ${whereClause} ORDER BY created_at DESC`,
    values,
  )
  return Array.isArray(result.rows)
    ? result.rows.map((item) => mapPostgresRowToConversionFact(item)).filter(Boolean)
    : []
}

async function writeConversionFact(fact) {
  await ensureSettlementStoreReady()
  if (!isPostgresSettlementStore()) {
    const existingFact = state.conversionFacts.find((item) => String(item?.idempotencyKey || '') === fact.idempotencyKey)
    if (existingFact) {
      return {
        duplicate: true,
        fact: existingFact,
      }
    }
    state.conversionFacts = [fact, ...state.conversionFacts]
    return {
      duplicate: false,
      fact,
    }
  }

  const inserted = await upsertConversionFactToPostgres(fact)
  if (inserted) {
    return {
      duplicate: false,
      fact: inserted,
    }
  }

  const existingFact = await findConversionFactByIdempotencyKeyFromPostgres(fact.idempotencyKey)
  return {
    duplicate: true,
    fact: existingFact || fact,
  }
}

async function resetConversionFactStore() {
  await ensureSettlementStoreReady()
  if (isPostgresSettlementStore()) {
    await settlementStore.pool.query(`DELETE FROM ${SETTLEMENT_FACT_TABLE}`)
  }
  state.conversionFacts = []
}

function createInitialState() {
  const placements = buildDefaultPlacementList()
  const placementConfigVersion = Math.max(1, ...placements.map((placement) => placement.configVersion || 1))
  const placementConfigs = []

  return {
    version: 6,
    updatedAt: nowIso(),
    placementConfigVersion,
    placements,
    placementConfigs,
    placementAuditLogs: [],
    controlPlaneAuditLogs: [],
    networkFlowStats: createInitialNetworkFlowStats(),
    networkFlowLogs: [],
    decisionLogs: [],
    eventLogs: [],
    conversionFacts: [],
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

    const controlPlane = ensureControlPlaneState(parsed.controlPlane)
    const apps = Array.isArray(controlPlane.apps) ? controlPlane.apps : []
    const accountByAppId = new Map(
      apps.map((item) => [String(item.appId || '').trim(), normalizeControlPlaneAccountId(item.accountId || item.organizationId, '')]),
    )

    const legacyPlacements = Array.isArray(parsed.placements)
      ? parsed.placements.map((item) => normalizePlacement(item))
      : buildDefaultPlacementList()
    const legacyDerivedPlacementConfigVersion = Math.max(
      1,
      ...legacyPlacements.map((placement) => placement.configVersion || 1),
    )
    const legacyPlacementConfigVersion = Math.max(
      toPositiveInteger(parsed?.placementConfigVersion, 1),
      legacyDerivedPlacementConfigVersion,
    )

    const placementConfigMap = new Map()
    const rawPlacementConfigs = Array.isArray(parsed.placementConfigs) ? parsed.placementConfigs : []
    for (const row of rawPlacementConfigs) {
      const appId = String(row?.appId || row?.app_id || '').trim()
      if (!appId) continue
      const normalized = normalizePlacementConfigRecord(row, {
        appId,
        accountId: accountByAppId.get(appId) || DEFAULT_CONTROL_PLANE_ORG_ID,
        placements: legacyPlacements,
        placementConfigVersion: legacyPlacementConfigVersion,
      })
      placementConfigMap.set(normalized.appId, normalized)
    }

    if (DEFAULT_CONTROL_PLANE_APP_ID && !placementConfigMap.has(DEFAULT_CONTROL_PLANE_APP_ID)) {
      placementConfigMap.set(
        DEFAULT_CONTROL_PLANE_APP_ID,
        normalizePlacementConfigRecord(
          {
            appId: DEFAULT_CONTROL_PLANE_APP_ID,
            accountId: accountByAppId.get(DEFAULT_CONTROL_PLANE_APP_ID) || DEFAULT_CONTROL_PLANE_ORG_ID,
            placementConfigVersion: legacyPlacementConfigVersion,
            placements: legacyPlacements,
          },
        ),
      )
    }

    for (const app of apps) {
      const appId = String(app?.appId || '').trim()
      if (!appId || placementConfigMap.has(appId)) continue
      placementConfigMap.set(
        appId,
        normalizePlacementConfigRecord({
          appId,
          accountId: normalizeControlPlaneAccountId(app?.accountId || app?.organizationId, ''),
          placementConfigVersion: 1,
          placements: buildDefaultPlacementList(),
        }),
      )
    }

    const placementConfigs = Array.from(placementConfigMap.values())
    const placementConfigVersion = Math.max(
      legacyPlacementConfigVersion,
      ...placementConfigs.map((item) => toPositiveInteger(item?.placementConfigVersion, 1)),
    )
    const defaultPlacementConfig = (
      (DEFAULT_CONTROL_PLANE_APP_ID ? placementConfigMap.get(DEFAULT_CONTROL_PLANE_APP_ID) : null)
      || placementConfigs[0]
      || null
    )
    const placements = Array.isArray(defaultPlacementConfig?.placements)
      ? defaultPlacementConfig.placements.map((item) => normalizePlacement(item))
      : legacyPlacements

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
      version: toPositiveInteger(parsed?.version, 6),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      placementConfigVersion,
      placements,
      placementConfigs,
      placementAuditLogs: Array.isArray(parsed.placementAuditLogs)
        ? applyCollectionLimit(parsed.placementAuditLogs, MAX_PLACEMENT_AUDIT_LOGS)
        : [],
      controlPlaneAuditLogs: Array.isArray(parsed.controlPlaneAuditLogs)
        ? applyCollectionLimit(parsed.controlPlaneAuditLogs, MAX_CONTROL_PLANE_AUDIT_LOGS)
        : [],
      networkFlowStats: normalizeNetworkFlowStats(parsed?.networkFlowStats),
      networkFlowLogs: Array.isArray(parsed.networkFlowLogs)
        ? applyCollectionLimit(parsed.networkFlowLogs, MAX_NETWORK_FLOW_LOGS)
        : [],
      decisionLogs: Array.isArray(parsed.decisionLogs) ? applyCollectionLimit(parsed.decisionLogs, MAX_DECISION_LOGS) : [],
      eventLogs: Array.isArray(parsed.eventLogs) ? applyCollectionLimit(parsed.eventLogs, MAX_EVENT_LOGS) : [],
      conversionFacts: Array.isArray(parsed.conversionFacts)
        ? parsed.conversionFacts.map((item) => normalizeConversionFact(item))
        : [],
      globalStats: {
        requests: toPositiveInteger(parsed?.globalStats?.requests, 0),
        served: toPositiveInteger(parsed?.globalStats?.served, 0),
        impressions: toPositiveInteger(parsed?.globalStats?.impressions, 0),
        clicks: toPositiveInteger(parsed?.globalStats?.clicks, 0),
        revenueUsd: clampNumber(parsed?.globalStats?.revenueUsd, 0, Number.MAX_SAFE_INTEGER, 0),
      },
      placementStats,
      dailyMetrics: ensureDailyMetricsWindow(parsed.dailyMetrics),
      controlPlane,
    }
  } catch (error) {
    console.error('[simulator-gateway] Failed to load state, fallback to initial state:', error)
    return createInitialState()
  }
}

function persistState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    const persistedState = {
      ...state,
      controlPlane: shouldPersistControlPlaneToStateFile()
        ? ensureControlPlaneState(state?.controlPlane)
        : createInitialControlPlaneState(),
      conversionFacts: shouldPersistConversionFactsToStateFile()
        ? (Array.isArray(state?.conversionFacts) ? state.conversionFacts : [])
        : [],
      updatedAt: nowIso(),
    }
    const tempFile = `${STATE_FILE}.${process.pid}.tmp`
    fs.writeFileSync(tempFile, JSON.stringify(persistedState, null, 2), 'utf-8')
    fs.renameSync(tempFile, STATE_FILE)
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

function syncLegacyPlacementSnapshot() {
  const configs = Array.isArray(state?.placementConfigs) ? state.placementConfigs : []
  const defaultConfig = (
    (DEFAULT_CONTROL_PLANE_APP_ID
      ? configs.find((item) => String(item?.appId || '').trim() === DEFAULT_CONTROL_PLANE_APP_ID)
      : null)
    || configs[0]
  )
  if (defaultConfig && Array.isArray(defaultConfig.placements)) {
    state.placements = defaultConfig.placements.map((item) => normalizePlacement(item))
  } else {
    state.placements = []
  }
  const maxConfigVersion = Math.max(
    1,
    toPositiveInteger(state.placementConfigVersion, 1),
    ...configs.map((item) => toPositiveInteger(item?.placementConfigVersion, 1)),
  )
  state.placementConfigVersion = maxConfigVersion
}

function findPlacementConfigByAppId(appId = '') {
  const normalizedAppId = String(appId || '').trim()
  if (!normalizedAppId) return null
  const rows = Array.isArray(state?.placementConfigs) ? state.placementConfigs : []
  return rows.find((item) => String(item?.appId || '').trim() === normalizedAppId) || null
}

function getPlacementConfigForApp(appId = '', accountId = '', options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const createIfMissing = opts.createIfMissing === true
  const normalizedAppId = String(appId || '').trim()
  if (!normalizedAppId) return null
  const providedAccountId = normalizeControlPlaneAccountId(accountId, '')
  const app = resolveControlPlaneAppRecord(normalizedAppId)
  const resolvedAccountId = normalizeControlPlaneAccountId(
    providedAccountId || app?.accountId || app?.organizationId,
    '',
  )

  if (!Array.isArray(state.placementConfigs)) {
    state.placementConfigs = []
  }

  let config = findPlacementConfigByAppId(normalizedAppId)
  if (!config && createIfMissing && resolvedAccountId) {
    config = normalizePlacementConfigRecord({
      appId: normalizedAppId,
      accountId: resolvedAccountId,
      placementConfigVersion: 1,
      placements: buildDefaultPlacementList(),
      updatedAt: nowIso(),
    })
    state.placementConfigs.push(config)
    state.placementConfigVersion = Math.max(
      toPositiveInteger(state.placementConfigVersion, 1),
      toPositiveInteger(config.placementConfigVersion, 1),
    )
    if (normalizedAppId === DEFAULT_CONTROL_PLANE_APP_ID) {
      syncLegacyPlacementSnapshot()
    }
  }
  if (!config) return null
  if (resolvedAccountId) {
    config.accountId = normalizeControlPlaneAccountId(config.accountId || resolvedAccountId, '')
  }
  return config
}

function getPlacementsForApp(appId = '', accountId = '', options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const clone = opts.clone === true
  const config = getPlacementConfigForApp(appId, accountId, {
    createIfMissing: opts.createIfMissing === true,
  })
  const rows = config && Array.isArray(config.placements) ? config.placements : []
  return clone ? rows.map((item) => normalizePlacement(item)) : rows
}

function resolvePlacementScopeAppId(scope = {}, fallbackAppId = '') {
  const normalizedScope = normalizeScopeFilters(scope)
  const normalizedAccountId = normalizeControlPlaneAccountId(normalizedScope.accountId, '')
  const requestedAppId = String(normalizedScope.appId || '').trim()
  if (requestedAppId) return requestedAppId

  const fallback = String(fallbackAppId || '').trim()
  if (fallback) {
    if (!normalizedAccountId || appBelongsToAccount(fallback, normalizedAccountId)) {
      return fallback
    }
  }

  if (normalizedAccountId) {
    const latest = findLatestAppForAccount(normalizedAccountId)
    if (latest?.appId) return String(latest.appId).trim()
  }
  return ''
}

function resolvePlacementConfigVersionForScope(scope = {}, fallbackAppId = '') {
  const normalizedScope = normalizeScopeFilters(scope)
  const resolvedAppId = resolvePlacementScopeAppId(normalizedScope, fallbackAppId)
  if (resolvedAppId) {
    const config = getPlacementConfigForApp(resolvedAppId, normalizedScope.accountId, {
      createIfMissing: false,
    })
    if (config) return toPositiveInteger(config.placementConfigVersion, 1)
  }

  if (normalizedScope.accountId) {
    const configs = Array.isArray(state?.placementConfigs) ? state.placementConfigs : []
    const scoped = configs.filter((item) => (
      normalizeControlPlaneAccountId(item?.accountId || resolveAccountIdForApp(item?.appId), '') === normalizedScope.accountId
    ))
    if (scoped.length > 0) {
      return Math.max(1, ...scoped.map((item) => toPositiveInteger(item?.placementConfigVersion, 1)))
    }
  }

  return Math.max(1, toPositiveInteger(state.placementConfigVersion, 1))
}

function getPlacementsForScope(scope = {}, options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const normalizedScope = normalizeScopeFilters(scope)
  const resolvedAppId = resolvePlacementScopeAppId(normalizedScope, opts.fallbackAppId || '')
  const rows = getPlacementsForApp(
    resolvedAppId,
    normalizedScope.accountId,
    { createIfMissing: opts.createIfMissing === true, clone: opts.clone === true },
  )
  return {
    appId: resolvedAppId,
    placements: rows,
  }
}

function mergePlacementRowsWithObserved(baseRows = [], observedPlacementIds = [], appId = '') {
  const map = new Map()
  for (const row of Array.isArray(baseRows) ? baseRows : []) {
    const placementId = String(row?.placementId || '').trim()
    if (!placementId || map.has(placementId)) continue
    map.set(placementId, normalizePlacement(row))
  }
  for (const placementId of observedPlacementIds) {
    const normalizedPlacementId = String(placementId || '').trim()
    if (!normalizedPlacementId || map.has(normalizedPlacementId)) continue
    map.set(normalizedPlacementId, normalizePlacement({
      placementId: normalizedPlacementId,
      placementKey: resolvePlacementKeyById(normalizedPlacementId, appId),
    }))
  }
  return Array.from(map.values())
}

syncLegacyPlacementSnapshot()

function resetGatewayState() {
  state = createInitialState()
  syncLegacyPlacementSnapshot()
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

function appendDailyMetric({ impressions = 0, clicks = 0 }) {
  state.dailyMetrics = ensureDailyMetricsWindow(state.dailyMetrics)
  const today = getTodayKey()
  const row = state.dailyMetrics.find((item) => item.date === today)
  if (!row) return

  row.impressions += Math.max(0, impressions)
  row.clicks += Math.max(0, clicks)
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

function readJsonObject(value) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeRuntimeDecisionLogRecord(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const appId = String(source.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(source.accountId || resolveAccountIdForApp(appId), '')
  const result = DECISION_REASON_ENUM.has(String(source.result || '')) ? String(source.result) : 'error'
  const reason = DECISION_REASON_ENUM.has(String(source.reason || '')) ? String(source.reason) : result
  const intentScore = clampNumber(source.intentScore, 0, 1, 0)

  return {
    ...(source && typeof source === 'object' ? source : {}),
    id: String(source.id || '').trim() || createId('decision'),
    createdAt: normalizeIsoTimestamp(source.createdAt || source.created_at, nowIso()),
    appId,
    accountId,
    requestId: String(source.requestId || source.request_id || '').trim(),
    sessionId: String(source.sessionId || source.session_id || '').trim(),
    turnId: String(source.turnId || source.turn_id || '').trim(),
    event: String(source.event || '').trim(),
    placementId: String(source.placementId || source.placement_id || '').trim(),
    placementKey: String(source.placementKey || source.placement_key || '').trim(),
    result,
    reason,
    reasonDetail: String(source.reasonDetail || source.reason_detail || '').trim() || reason,
    intentScore,
  }
}

function normalizeRuntimeEventLogRecord(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const appId = String(source.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(source.accountId || resolveAccountIdForApp(appId), '')
  return {
    ...(source && typeof source === 'object' ? source : {}),
    id: String(source.id || '').trim() || createId('event'),
    createdAt: normalizeIsoTimestamp(source.createdAt || source.created_at, nowIso()),
    appId,
    accountId,
    requestId: String(source.requestId || source.request_id || '').trim(),
    sessionId: String(source.sessionId || source.session_id || '').trim(),
    turnId: String(source.turnId || source.turn_id || '').trim(),
    placementId: String(source.placementId || source.placement_id || '').trim(),
    placementKey: String(source.placementKey || source.placement_key || '').trim(),
    eventType: String(source.eventType || source.event_type || '').trim(),
    event: String(source.event || '').trim(),
    kind: String(source.kind || '').trim(),
    result: String(source.result || '').trim(),
    reason: String(source.reason || '').trim(),
    reasonDetail: String(source.reasonDetail || source.reason_detail || '').trim(),
  }
}

function mapPostgresRowToRuntimeDecisionLog(row) {
  const payload = readJsonObject(row?.payload_json)
  return normalizeRuntimeDecisionLogRecord({
    ...payload,
    id: String(row?.id || '').trim(),
    createdAt: row?.created_at,
    requestId: row?.request_id,
    appId: row?.app_id,
    accountId: row?.account_id,
    sessionId: row?.session_id,
    turnId: row?.turn_id,
    event: row?.event,
    placementId: row?.placement_id,
    placementKey: row?.placement_key,
    result: row?.result,
    reason: row?.reason,
  })
}

function mapPostgresRowToRuntimeEventLog(row) {
  const payload = readJsonObject(row?.payload_json)
  return normalizeRuntimeEventLogRecord({
    ...payload,
    id: String(row?.id || '').trim(),
    createdAt: row?.created_at,
    eventType: row?.event_type,
    event: row?.event,
    kind: row?.kind,
    requestId: row?.request_id,
    appId: row?.app_id,
    accountId: row?.account_id,
    sessionId: row?.session_id,
    turnId: row?.turn_id,
    placementId: row?.placement_id,
    placementKey: row?.placement_key,
    result: row?.result,
  })
}

async function upsertDecisionLogToPostgres(log, pool = null) {
  const db = pool || settlementStore.pool
  if (!db) return false
  const result = await db.query(
    `
      INSERT INTO ${RUNTIME_DECISION_LOG_TABLE} (
        id,
        created_at,
        request_id,
        app_id,
        account_id,
        session_id,
        turn_id,
        event,
        placement_id,
        placement_key,
        result,
        reason,
        payload_json
      )
      VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `,
    [
      String(log?.id || '').trim(),
      String(log?.createdAt || nowIso()),
      String(log?.requestId || '').trim(),
      String(log?.appId || '').trim(),
      normalizeControlPlaneAccountId(log?.accountId || resolveAccountIdForApp(log?.appId), ''),
      String(log?.sessionId || '').trim(),
      String(log?.turnId || '').trim(),
      String(log?.event || '').trim(),
      String(log?.placementId || '').trim(),
      String(log?.placementKey || '').trim(),
      String(log?.result || '').trim(),
      String(log?.reason || '').trim(),
      JSON.stringify(log || {}),
    ],
  )
  return Array.isArray(result.rows) && result.rows.length > 0
}

async function upsertEventLogToPostgres(log, pool = null) {
  const db = pool || settlementStore.pool
  if (!db) return false
  const result = await db.query(
    `
      INSERT INTO ${RUNTIME_EVENT_LOG_TABLE} (
        id,
        created_at,
        event_type,
        event,
        kind,
        request_id,
        app_id,
        account_id,
        session_id,
        turn_id,
        placement_id,
        placement_key,
        result,
        payload_json
      )
      VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `,
    [
      String(log?.id || '').trim(),
      String(log?.createdAt || nowIso()),
      String(log?.eventType || '').trim(),
      String(log?.event || '').trim(),
      String(log?.kind || '').trim(),
      String(log?.requestId || '').trim(),
      String(log?.appId || '').trim(),
      normalizeControlPlaneAccountId(log?.accountId || resolveAccountIdForApp(log?.appId), ''),
      String(log?.sessionId || '').trim(),
      String(log?.turnId || '').trim(),
      String(log?.placementId || '').trim(),
      String(log?.placementKey || '').trim(),
      String(log?.result || '').trim(),
      JSON.stringify(log || {}),
    ],
  )
  return Array.isArray(result.rows) && result.rows.length > 0
}

async function listDecisionLogs(scopeInput = {}) {
  const scope = normalizeScopeFilters(scopeInput)
  await ensureSettlementStoreReady()

  if (!isPostgresSettlementStore()) {
    const rows = Array.isArray(state?.decisionLogs) ? state.decisionLogs : []
    return scopeHasFilters(scope) ? filterRowsByScope(rows, scope) : rows
  }

  const clauses = []
  const values = []
  let cursor = 1
  if (scope.accountId) {
    clauses.push(`account_id = $${cursor}`)
    values.push(scope.accountId)
    cursor += 1
  }
  if (scope.appId) {
    clauses.push(`app_id = $${cursor}`)
    values.push(scope.appId)
    cursor += 1
  }
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const result = await settlementStore.pool.query(
    `SELECT * FROM ${RUNTIME_DECISION_LOG_TABLE} ${whereClause} ORDER BY created_at DESC`,
    values,
  )
  return Array.isArray(result.rows)
    ? result.rows.map((row) => mapPostgresRowToRuntimeDecisionLog(row)).filter(Boolean)
    : []
}

async function listEventLogs(scopeInput = {}) {
  const scope = normalizeScopeFilters(scopeInput)
  await ensureSettlementStoreReady()

  if (!isPostgresSettlementStore()) {
    const rows = Array.isArray(state?.eventLogs) ? state.eventLogs : []
    return scopeHasFilters(scope) ? filterRowsByScope(rows, scope) : rows
  }

  const clauses = []
  const values = []
  let cursor = 1
  if (scope.accountId) {
    clauses.push(`account_id = $${cursor}`)
    values.push(scope.accountId)
    cursor += 1
  }
  if (scope.appId) {
    clauses.push(`app_id = $${cursor}`)
    values.push(scope.appId)
    cursor += 1
  }
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const result = await settlementStore.pool.query(
    `SELECT * FROM ${RUNTIME_EVENT_LOG_TABLE} ${whereClause} ORDER BY created_at DESC`,
    values,
  )
  return Array.isArray(result.rows)
    ? result.rows.map((row) => mapPostgresRowToRuntimeEventLog(row)).filter(Boolean)
    : []
}

async function recordDecision(payload) {
  const record = normalizeRuntimeDecisionLogRecord(payload)
  state.decisionLogs = applyCollectionLimit([
    record,
    ...state.decisionLogs,
  ], MAX_DECISION_LOGS)

  if (!isPostgresSettlementStore()) return record
  try {
    await upsertDecisionLogToPostgres(record)
  } catch (error) {
    if (REQUIRE_RUNTIME_LOG_DB_PERSISTENCE) {
      throw new Error(
        `decision log persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    console.error(
      '[simulator-gateway] decision log persistence failed (fallback state only):',
      error instanceof Error ? error.message : String(error),
    )
  }
  return record
}

async function recordEvent(payload) {
  const record = normalizeRuntimeEventLogRecord(payload)
  state.eventLogs = applyCollectionLimit([
    record,
    ...state.eventLogs,
  ], MAX_EVENT_LOGS)

  if (!isPostgresSettlementStore()) return record
  try {
    await upsertEventLogToPostgres(record)
  } catch (error) {
    if (REQUIRE_RUNTIME_LOG_DB_PERSISTENCE) {
      throw new Error(
        `event log persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    console.error(
      '[simulator-gateway] event log persistence failed (fallback state only):',
      error instanceof Error ? error.message : String(error),
    )
  }
  return record
}

function findPlacementIdByRequestId(requestId) {
  const targetRequestId = String(requestId || '').trim()
  if (!targetRequestId) return ''
  for (const row of state.decisionLogs) {
    if (String(row?.requestId || '').trim() !== targetRequestId) continue
    return String(row?.placementId || '').trim()
  }
  return ''
}

function resolvePlacementKeyById(placementId, appId = '') {
  const normalizedPlacementId = String(placementId || '').trim()
  if (!normalizedPlacementId) return ''
  const placements = getPlacementsForApp(appId, '', { createIfMissing: false })
  const placement = placements.find((item) => item.placementId === normalizedPlacementId)
    || state.placements.find((item) => item.placementId === normalizedPlacementId)
  if (placement) {
    return String(placement.placementKey || '').trim()
  }
  return String(PLACEMENT_KEY_BY_ID[normalizedPlacementId] || '').trim()
}

function buildConversionFactIdempotencyKey(payload = {}) {
  const appId = String(payload.appId || '').trim()
  const requestId = String(payload.requestId || '').trim()
  const conversionId = String(payload.conversionId || '').trim()
  const eventSeq = String(payload.eventSeq || '').trim()
  const postbackType = String(payload.postbackType || '').trim().toLowerCase()
  const postbackStatus = String(payload.postbackStatus || '').trim().toLowerCase()
  const adId = String(payload.adId || '').trim()
  const cpaUsd = round(clampNumber(payload.cpaUsd, 0, Number.MAX_SAFE_INTEGER, 0), 4)
  const fallback = `${adId}|${cpaUsd.toFixed(4)}`
  const semantic = [appId, requestId, conversionId, eventSeq, postbackType, postbackStatus, fallback].join('|')
  return `fact_${createHash('sha256').update(semantic).digest('hex').slice(0, 24)}`
}

async function recordConversionFact(payload) {
  const request = payload && typeof payload === 'object' ? payload : {}
  if (!Array.isArray(state.conversionFacts)) {
    state.conversionFacts = []
  }

  const placementId = String(request.placementId || '').trim() || findPlacementIdByRequestId(request.requestId)
  const placementKey = String(request.placementKey || '').trim() || resolvePlacementKeyById(placementId, request.appId)
  const idempotencyKey = buildConversionFactIdempotencyKey({
    ...request,
    placementId,
  })

  const fact = normalizeConversionFact({
    ...request,
    placementId,
    placementKey,
    idempotencyKey,
    factId: createId('fact'),
    createdAt: nowIso(),
  })
  return writeConversionFact(fact)
}

function recordPlacementAudit(payload) {
  state.placementAuditLogs = applyCollectionLimit([
    {
      id: createId('placement_audit'),
      createdAt: nowIso(),
      ...payload,
    },
    ...state.placementAuditLogs,
  ], MAX_PLACEMENT_AUDIT_LOGS)
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
  const appId = String(payload?.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(payload?.accountId || resolveAccountIdForApp(appId), '')
  state.controlPlaneAuditLogs = applyCollectionLimit([
    {
      id: createId('cp_audit'),
      createdAt: nowIso(),
      ...(payload && typeof payload === 'object' ? payload : {}),
      appId,
      accountId,
    },
    ...state.controlPlaneAuditLogs,
  ], MAX_CONTROL_PLANE_AUDIT_LOGS)
}

function queryControlPlaneAudits(searchParams) {
  const action = String(searchParams.get('action') || '').trim().toLowerCase()
  const appId = String(searchParams.get('appId') || '').trim()
  const accountId = normalizeControlPlaneAccountId(
    searchParams.get('accountId') || searchParams.get('account_id') || '',
    '',
  )
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
  if (accountId) {
    rows = rows.filter((row) => normalizeControlPlaneAccountId(row?.accountId || resolveAccountIdForApp(row?.appId), '') === accountId)
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
  const appId = String(payload?.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(payload?.accountId || resolveAccountIdForApp(appId), '')
  state.networkFlowLogs = applyCollectionLimit([
    {
      id: createId('network_flow'),
      createdAt: nowIso(),
      ...(payload && typeof payload === 'object' ? payload : {}),
      appId,
      accountId,
    },
    ...state.networkFlowLogs,
  ], MAX_NETWORK_FLOW_LOGS)
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
    appId: String(meta.appId || '').trim(),
    accountId: normalizeControlPlaneAccountId(meta.accountId || resolveAccountIdForApp(meta.appId), ''),
    placementId: meta.placementId || '',
    decisionResult: decisionResult || '',
    runtimeError,
    failOpenApplied,
    networkErrors,
    snapshotUsage,
    networkHealthSummary: healthSummary,
  })
}

function isSettledConversionFact(row) {
  return String(row?.postbackStatus || '').trim().toLowerCase() === 'success'
}

function conversionFactRevenueUsd(row) {
  if (!isSettledConversionFact(row)) return 0
  return round(clampNumber(row?.cpaUsd ?? row?.revenueUsd, 0, Number.MAX_SAFE_INTEGER, 0), 4)
}

function conversionFactDateKey(row) {
  const raw = String(row?.occurredAt || row?.createdAt || '').trim()
  if (!raw) return ''
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return raw.slice(0, 10)
  return new Date(parsed).toISOString().slice(0, 10)
}

function buildPlacementIdByRequestMap(decisionRows = []) {
  const rows = Array.isArray(decisionRows) ? decisionRows : []
  const map = new Map()
  for (const row of rows) {
    const requestId = String(row?.requestId || '').trim()
    const placementId = String(row?.placementId || '').trim()
    if (!requestId || !placementId || map.has(requestId)) continue
    map.set(requestId, placementId)
  }
  return map
}

function resolveFactPlacementId(row, placementIdByRequest = new Map()) {
  const placementId = String(row?.placementId || '').trim()
  if (placementId) return placementId
  const requestId = String(row?.requestId || '').trim()
  if (!requestId) return ''
  return String(placementIdByRequest.get(requestId) || '').trim()
}

function buildRevenueByPlacementMap(factRows = [], placementIdByRequest = new Map()) {
  const rows = Array.isArray(factRows) ? factRows : []
  const map = new Map()
  for (const row of rows) {
    const revenueUsd = conversionFactRevenueUsd(row)
    if (revenueUsd <= 0) continue
    const placementId = resolveFactPlacementId(row, placementIdByRequest)
    if (!placementId) continue
    map.set(placementId, round((map.get(placementId) || 0) + revenueUsd, 4))
  }
  return map
}

function computeRevenueFromFacts(factRows = []) {
  const rows = Array.isArray(factRows) ? factRows : []
  let total = 0
  for (const row of rows) {
    total += conversionFactRevenueUsd(row)
  }
  return round(total, 4)
}

function computeMetricsSummary(factRows = []) {
  const impressions = state.globalStats.impressions
  const clicks = state.globalStats.clicks
  const revenueUsd = computeRevenueFromFacts(factRows)
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

function computeMetricsByDay(factRows = []) {
  state.dailyMetrics = ensureDailyMetricsWindow(state.dailyMetrics)
  const rows = createDailyMetricsSeed(7)
  const byDate = new Map(rows.map((row) => [row.date, row]))

  for (const metric of state.dailyMetrics) {
    const target = byDate.get(String(metric?.date || ''))
    if (!target) continue
    target.impressions += toPositiveInteger(metric?.impressions, 0)
    target.clicks += toPositiveInteger(metric?.clicks, 0)
  }

  for (const fact of Array.isArray(factRows) ? factRows : []) {
    const dateKey = conversionFactDateKey(fact)
    const target = byDate.get(dateKey)
    if (!target) continue
    target.revenueUsd = round(target.revenueUsd + conversionFactRevenueUsd(fact), 4)
  }

  return rows.map((row) => ({
    day: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
    revenueUsd: round(row.revenueUsd, 2),
    impressions: row.impressions,
    clicks: row.clicks,
  }))
}

function computeMetricsByPlacement(scope = {}, factRows = []) {
  const placementIdByRequest = buildPlacementIdByRequestMap(state.decisionLogs)
  const revenueByPlacement = buildRevenueByPlacementMap(
    Array.isArray(factRows) ? factRows : [],
    placementIdByRequest,
  )
  const placementScope = getPlacementsForScope(scope, { createIfMissing: false, clone: true })
  const basePlacements = Array.isArray(placementScope.placements) ? placementScope.placements : []
  const observedPlacementIds = new Set([
    ...basePlacements.map((item) => String(item?.placementId || '').trim()).filter(Boolean),
    ...Object.keys(state.placementStats || {}),
    ...Array.from(revenueByPlacement.keys()),
  ])
  const placements = mergePlacementRowsWithObserved(
    basePlacements,
    Array.from(observedPlacementIds),
    placementScope.appId,
  )

  return placements.map((placement) => {
    const stats = ensurePlacementStats(placement.placementId)
    const ctr = stats.impressions > 0 ? stats.clicks / stats.impressions : 0
    const fillRate = stats.requests > 0 ? stats.served / stats.requests : 0

    return {
      placementId: placement.placementId,
      layer: layerFromPlacementKey(placement.placementKey),
      revenueUsd: round(revenueByPlacement.get(placement.placementId) || 0, 2),
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
  const placements = getPlacementsForApp(
    request?.appId,
    request?.accountId,
    { createIfMissing: true, clone: false },
  )
  return placements
    .filter((placement) => placementMatchesSelector(placement, request))
    .sort((a, b) => a.priority - b.priority)[0] || null
}

function getSessionPlacementKey(sessionId, placementId) {
  return `${sessionId}::${placementId}`
}

function getUserPlacementDayKey(userId, placementId) {
  return `${userId}::${placementId}::${getTodayKey()}`
}

function recordServeCounters(placement, request) {
  const placementStats = ensurePlacementStats(placement.placementId)

  state.globalStats.requests += 1
  state.globalStats.served += 1
  state.globalStats.impressions += 1

  placementStats.requests += 1
  placementStats.served += 1
  placementStats.impressions += 1

  appendDailyMetric({ impressions: 1 })

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

function buildRuntimeAdRequest(request, placement, intentScore, requestId = '') {
  const context = request?.context && typeof request.context === 'object' ? request.context : {}
  return {
    requestId: String(requestId || '').trim(),
    appId: String(request?.appId || '').trim(),
    accountId: normalizeControlPlaneAccountId(request?.accountId || resolveAccountIdForApp(request?.appId)),
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

function deriveBidMessageContext(messages = []) {
  const rows = Array.isArray(messages) ? messages : []
  let query = ''
  let answerText = ''

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    const role = String(row?.role || '').trim().toLowerCase()
    const content = String(row?.content || '').trim()
    if (!content) continue
    if (!query && role === 'user') {
      query = content
    }
    if (!answerText && role === 'assistant') {
      answerText = content
    }
    if (query && answerText) break
  }

  return {
    query,
    answerText,
    recentTurns: rows.slice(-8),
  }
}

function toDecisionAdFromBid(bid) {
  if (!bid || typeof bid !== 'object') return null
  const adId = String(bid.bidId || '').trim() || String(bid.url || '').trim()
  if (!adId) return null

  return {
    adId,
    title: String(bid.headline || '').trim(),
    description: String(bid.description || '').trim(),
    targetUrl: String(bid.url || '').trim(),
    disclosure: 'Sponsored',
    sourceNetwork: String(bid.dsp || '').trim(),
    tracking: {
      clickUrl: String(bid.url || '').trim(),
    },
    bidValue: clampNumber(bid.price, 0, Number.MAX_SAFE_INTEGER, 0),
  }
}

async function evaluateV2BidRequest(payload) {
  const request = payload && typeof payload === 'object' ? payload : {}
  request.appId = String(request.appId || DEFAULT_CONTROL_PLANE_APP_ID).trim()
  request.accountId = normalizeControlPlaneAccountId(
    request.accountId || resolveAccountIdForApp(request.appId),
    '',
  )
  const requestId = createId('adreq')
  const timestamp = nowIso()
  const placement = pickPlacementForRequest({
    appId: request.appId,
    accountId: request.accountId,
    placementId: request.placementId,
  })
  const messageContext = deriveBidMessageContext(request.messages)

  const decisionRequest = {
    appId: request.appId,
    accountId: request.accountId,
    sessionId: request.chatId,
    userId: request.userId,
    turnId: '',
    event: V2_BID_EVENT,
    placementId: request.placementId,
    placementKey: String(placement?.placementKey || '').trim(),
    context: {
      query: messageContext.query,
      answerText: messageContext.answerText,
      locale: 'en-US',
      intentScore: 0,
    },
  }

  const blockedTopic = matchBlockedTopic(
    {
      query: messageContext.query,
      answerText: messageContext.answerText,
    },
    normalizeStringList(placement?.trigger?.blockedTopics),
  )
  if (blockedTopic) {
    const decision = createDecision('blocked', `blocked_topic:${blockedTopic}`, 0)
    await recordDecisionForRequest({
      request: decisionRequest,
      placement,
      requestId,
      decision,
      runtime: {
        bidV2: true,
        reason: 'blocked_topic',
      },
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      timestamp,
      status: 'success',
      message: 'No bid',
      data: {
        bid: null,
      },
      diagnostics: {
        reason: 'blocked_topic',
      },
    }
  }

  if (!placement || placement.enabled === false) {
    const decision = createDecision('no_fill', 'placement_unavailable', 0)
    await recordDecisionForRequest({
      request: decisionRequest,
      placement: placement || null,
      requestId,
      decision,
      runtime: {
        bidV2: true,
        reason: 'placement_unavailable',
      },
      ads: [],
    })
    persistState(state)
    return {
      requestId,
      timestamp,
      status: 'success',
      message: 'No bid',
      data: {
        bid: null,
      },
      diagnostics: {
        reason: 'placement_unavailable',
      },
    }
  }

  const aggregation = await runBidAggregationPipeline({
    requestId,
    appId: request.appId,
    accountId: request.accountId,
    userId: request.userId,
    chatId: request.chatId,
    placementId: placement.placementId,
    placement,
    messages: request.messages,
    locale: 'en-US',
  })

  const winnerBid = aggregation?.winnerBid && typeof aggregation.winnerBid === 'object'
    ? aggregation.winnerBid
    : null
  const decision = winnerBid
    ? createDecision('served', 'runtime_eligible', 0)
    : createDecision('no_fill', 'runtime_no_bid', 0)
  const runtimeDebug = {
    networkErrors: Array.isArray(aggregation?.diagnostics?.bidders)
      ? aggregation.diagnostics.bidders
        .filter((item) => item?.ok === false)
        .map((item) => ({
          network: String(item.networkId || '').trim(),
          errorCode: item?.timeout ? 'timeout' : 'error',
          message: String(item.error || 'bidder_failed'),
        }))
      : [],
    snapshotUsage: {},
    networkHealth: getAllNetworkHealth(),
  }
  recordRuntimeNetworkStats(decision.result, runtimeDebug, {
    requestId,
    appId: request.appId,
    accountId: request.accountId,
    placementId: placement.placementId,
  })
  const decisionAd = winnerBid ? toDecisionAdFromBid(winnerBid) : null

  await recordDecisionForRequest({
    request: decisionRequest,
    placement,
    requestId,
    decision,
    runtime: {
      bidV2: true,
      diagnostics: aggregation?.diagnostics || {},
      metrics: {
        bid_latency_ms: toPositiveInteger(aggregation?.diagnostics?.bidLatencyMs, 0),
        fanout_count: toPositiveInteger(aggregation?.diagnostics?.fanoutCount, 0),
        timeout_rate: (() => {
          const fanout = toPositiveInteger(aggregation?.diagnostics?.fanoutCount, 0)
          const timeoutCount = toPositiveInteger(aggregation?.diagnostics?.timeoutCount, 0)
          return fanout > 0 ? Number((timeoutCount / fanout).toFixed(4)) : 0
        })(),
        no_bid_rate: winnerBid ? 0 : 1,
        store_fallback_rate: aggregation?.diagnostics?.storeFallbackUsed ? 1 : 0,
        winner_network_share: winnerBid ? String(winnerBid.dsp || '') : '',
      },
    },
    ads: decisionAd ? [decisionAd] : [],
  })
  persistState(state)

  return {
    requestId,
    timestamp,
    status: 'success',
    message: winnerBid ? 'Bid successful' : 'No bid',
    data: {
      bid: winnerBid,
    },
    diagnostics: aggregation?.diagnostics || {},
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
    intentCardVectorFallbackUsed: Boolean(debug.intentCardVectorFallbackUsed),
    intentCardVectorFallbackSelected: Number.isFinite(debug.intentCardVectorFallbackSelected)
      ? debug.intentCardVectorFallbackSelected
      : 0,
    intentCardVectorFallbackMeta: debug.intentCardVectorFallbackMeta &&
      typeof debug.intentCardVectorFallbackMeta === 'object'
      ? {
          itemCount: toPositiveInteger(debug.intentCardVectorFallbackMeta.itemCount, 0),
          vocabularySize: toPositiveInteger(debug.intentCardVectorFallbackMeta.vocabularySize, 0),
          candidateCount: toPositiveInteger(debug.intentCardVectorFallbackMeta.candidateCount, 0),
          topK: toPositiveInteger(debug.intentCardVectorFallbackMeta.topK, 0),
          minScore: clampNumber(debug.intentCardVectorFallbackMeta.minScore, 0, 1, 0),
        }
      : null,
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
    accountId: normalizeControlPlaneAccountId(request?.accountId || resolveAccountIdForApp(request?.appId), ''),
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

async function recordDecisionForRequest({ request, placement, requestId, decision, runtime, ads }) {
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
    accountId: normalizeControlPlaneAccountId(request?.accountId || resolveAccountIdForApp(request?.appId), ''),
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

  await recordDecision(payload)
  await recordEvent({
    eventType: 'decision',
    requestId: payload.requestId || '',
    appId: payload.appId || '',
    accountId: payload.accountId || '',
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
  request.appId = String(request.appId || '').trim()
  request.accountId = normalizeControlPlaneAccountId(request.accountId || resolveAccountIdForApp(request.appId))
  const context = request.context && typeof request.context === 'object' ? request.context : {}
  const intentScore = clampNumber(context.intentScore, 0, 1, 0)
  const intentClass = String(context.intentClass || '').trim().toLowerCase()

  const placement = pickPlacementForRequest(request)
  const requestId = createId('adreq')

  if (!placement) {
    const decision = createDecision('blocked', 'placement_not_configured', intentScore)
    await recordDecisionForRequest({
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
    await recordDecisionForRequest({
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
    await recordDecisionForRequest({
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
    await recordDecisionForRequest({
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
    await recordDecisionForRequest({
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
      await recordDecisionForRequest({
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
      await recordDecisionForRequest({
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
      await recordDecisionForRequest({
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
    await recordDecisionForRequest({
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

  const runtimeAdRequest = buildRuntimeAdRequest(request, placement, intentScore, requestId)
  let runtimeResult

  try {
    runtimeResult = await runAdsRetrievalPipeline(runtimeAdRequest)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Runtime pipeline failed'
    const decision = createDecision('no_fill', 'runtime_pipeline_fail_open', intentScore)
    recordRuntimeNetworkStats(decision.result, null, {
      requestId,
      appId: request.appId,
      accountId: request.accountId,
      placementId: placement.placementId,
      runtimeError: true,
      failOpenApplied: true,
    })
    recordBlockedOrNoFill(placement)
    await recordDecisionForRequest({
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
      appId: request.appId,
      accountId: request.accountId,
      placementId: placement.placementId,
    })
    recordBlockedOrNoFill(placement)
    await recordDecisionForRequest({
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

  recordServeCounters(placement, request)

  const scopedRuntimeAds = injectTrackingScopeIntoAds(runtimeAds, {
    accountId: request.accountId,
  })
  const ads = scopedRuntimeAds.map((ad) => ({
    ...ad,
    disclosure: placement.disclosure || ad.disclosure || 'Sponsored',
  }))

  const decision = createDecision('served', 'runtime_eligible', intentScore)
  recordRuntimeNetworkStats(decision.result, runtimeDebug, {
    requestId: runtimeRequestId,
    appId: request.appId,
    accountId: request.accountId,
    placementId: placement.placementId,
  })
  await recordDecisionForRequest({
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
  placement.bidders = next.bidders
  placement.fallback = next.fallback
  placement.maxFanout = next.maxFanout
  placement.globalTimeoutMs = next.globalTimeoutMs

  return placement
}

function filterRowsByScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : []
  if (!scopeHasFilters(scope)) return list
  return list.filter((row) => recordMatchesScope(row, scope))
}

function computeScopedMetricsSummary(decisionRows, eventRows, factRows) {
  const requests = decisionRows.length
  const servedRows = decisionRows.filter((row) => String(row?.result || '') === 'served')
  const served = servedRows.length
  const impressions = served
  const clicks = eventRows.filter((row) => {
    if (String(row?.eventType || '') !== 'sdk_event') return false
    const kind = String(row?.kind || row?.event || '').toLowerCase()
    return kind === 'click'
  }).length
  const revenueUsd = computeRevenueFromFacts(factRows)
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

function computeScopedMetricsByDay(decisionRows, eventRows, factRows) {
  const rows = createDailyMetricsSeed(7)
  const byDate = new Map(rows.map((row) => [row.date, row]))

  for (const row of decisionRows) {
    const dateKey = String(row?.createdAt || '').slice(0, 10)
    const target = byDate.get(dateKey)
    if (!target) continue
    if (String(row?.result || '') === 'served') {
      target.impressions += 1
    }
  }

  for (const row of eventRows) {
    if (String(row?.eventType || '') !== 'sdk_event') continue
    const kind = String(row?.kind || row?.event || '').toLowerCase()
    if (kind !== 'click') continue
    const dateKey = String(row?.createdAt || '').slice(0, 10)
    const target = byDate.get(dateKey)
    if (!target) continue
    target.clicks += 1
  }

  for (const row of factRows) {
    const dateKey = conversionFactDateKey(row)
    const target = byDate.get(dateKey)
    if (!target) continue
    target.revenueUsd = round(target.revenueUsd + conversionFactRevenueUsd(row), 4)
  }

  return rows.map((row) => ({
    day: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
    revenueUsd: round(row.revenueUsd, 2),
    impressions: row.impressions,
    clicks: row.clicks,
  }))
}

function computeScopedMetricsByPlacement(decisionRows, eventRows, factRows, scope = {}) {
  const decisionStatsByPlacement = new Map()
  for (const row of decisionRows) {
    const placementId = String(row?.placementId || '').trim()
    if (!placementId) continue
    if (!decisionStatsByPlacement.has(placementId)) {
      decisionStatsByPlacement.set(placementId, {
        requests: 0,
        served: 0,
        impressions: 0,
      })
    }
    const stats = decisionStatsByPlacement.get(placementId)
    stats.requests += 1
    if (String(row?.result || '') === 'served') {
      stats.served += 1
      stats.impressions += 1
    }
  }

  const placementIdByRequest = buildPlacementIdByRequestMap(decisionRows)
  const revenueByPlacement = buildRevenueByPlacementMap(factRows, placementIdByRequest)

  const clicksByPlacement = new Map()
  for (const row of eventRows) {
    if (String(row?.eventType || '') !== 'sdk_event') continue
    const kind = String(row?.kind || row?.event || '').toLowerCase()
    if (kind !== 'click') continue
    const placementId = String(row?.placementId || '').trim()
    if (!placementId) continue
    clicksByPlacement.set(placementId, (clicksByPlacement.get(placementId) || 0) + 1)
  }
  const placementScope = getPlacementsForScope(scope, { createIfMissing: false, clone: true })
  const observedPlacementIds = new Set([
    ...Array.from(decisionStatsByPlacement.keys()),
    ...Array.from(clicksByPlacement.keys()),
    ...Array.from(revenueByPlacement.keys()),
  ])
  const placements = mergePlacementRowsWithObserved(
    placementScope.placements,
    Array.from(observedPlacementIds),
    placementScope.appId,
  )

  return placements.map((placement) => {
    const stats = decisionStatsByPlacement.get(placement.placementId) || {
      requests: 0,
      served: 0,
      impressions: 0,
    }
    const clicks = clicksByPlacement.get(placement.placementId) || 0
    const ctr = stats.impressions > 0 ? clicks / stats.impressions : 0
    const fillRate = stats.requests > 0 ? stats.served / stats.requests : 0

    return {
      placementId: placement.placementId,
      layer: layerFromPlacementKey(placement.placementKey),
      revenueUsd: round(revenueByPlacement.get(placement.placementId) || 0, 2),
      ctr: round(ctr, 4),
      fillRate: round(fillRate, 4),
    }
  })
}

function computeScopedNetworkFlowStats(rows) {
  const stats = createInitialNetworkFlowStats()
  for (const row of rows) {
    const networkErrors = Array.isArray(row?.networkErrors) ? row.networkErrors : []
    const snapshotUsage = row?.snapshotUsage && typeof row.snapshotUsage === 'object' ? row.snapshotUsage : {}
    const healthSummary = row?.networkHealthSummary && typeof row.networkHealthSummary === 'object'
      ? row.networkHealthSummary
      : { degraded: 0, open: 0 }
    const hasNetworkError = networkErrors.length > 0
    const hasSnapshotFallback = Object.values(snapshotUsage).some(Boolean)
    const runtimeError = row?.runtimeError === true
    const isDegraded = runtimeError || hasNetworkError || hasSnapshotFallback || healthSummary.degraded > 0
      || healthSummary.open > 0
    const decisionResult = String(row?.decisionResult || '')

    stats.totalRuntimeEvaluations += 1
    if (isDegraded) stats.degradedRuntimeEvaluations += 1
    if (decisionResult === 'served' && isDegraded) stats.resilientServes += 1
    if (decisionResult === 'served' && hasNetworkError) stats.servedWithNetworkErrors += 1
    if (decisionResult === 'no_fill' && hasNetworkError) stats.noFillWithNetworkErrors += 1
    if (decisionResult === 'error' || runtimeError) stats.runtimeErrors += 1
    if (healthSummary.open > 0) stats.circuitOpenEvaluations += 1
  }
  return stats
}

function createSettlementAggregateRow(seed = {}) {
  return {
    accountId: String(seed.accountId || '').trim(),
    appId: String(seed.appId || '').trim(),
    placementId: String(seed.placementId || '').trim(),
    layer: String(seed.layer || '').trim(),
    requests: 0,
    served: 0,
    impressions: 0,
    clicks: 0,
    settledConversions: 0,
    settledRevenueUsd: 0,
    ctr: 0,
    fillRate: 0,
    ecpm: 0,
    cpa: 0,
  }
}

function finalizeSettlementAggregateRow(row) {
  const requests = toPositiveInteger(row?.requests, 0)
  const served = toPositiveInteger(row?.served, 0)
  const impressions = toPositiveInteger(row?.impressions, 0)
  const clicks = toPositiveInteger(row?.clicks, 0)
  const settledConversions = toPositiveInteger(row?.settledConversions, 0)
  const settledRevenueUsd = round(clampNumber(row?.settledRevenueUsd, 0, Number.MAX_SAFE_INTEGER, 0), 4)
  const ctr = impressions > 0 ? clicks / impressions : 0
  const fillRate = requests > 0 ? served / requests : 0
  const ecpm = impressions > 0 ? (settledRevenueUsd / impressions) * 1000 : 0
  const cpa = settledConversions > 0 ? settledRevenueUsd / settledConversions : 0

  return {
    accountId: String(row?.accountId || '').trim(),
    appId: String(row?.appId || '').trim(),
    placementId: String(row?.placementId || '').trim(),
    layer: String(row?.layer || '').trim(),
    requests,
    served,
    impressions,
    clicks,
    settledConversions,
    settledRevenueUsd: round(settledRevenueUsd, 2),
    ctr: round(ctr, 4),
    fillRate: round(fillRate, 4),
    ecpm: round(ecpm, 2),
    cpa: round(cpa, 2),
  }
}

function buildDecisionDimensionMap(decisionRows = []) {
  const map = new Map()
  for (const row of decisionRows) {
    const requestId = String(row?.requestId || '').trim()
    if (!requestId || map.has(requestId)) continue
    const appId = String(row?.appId || '').trim()
    map.set(requestId, {
      accountId: normalizeControlPlaneAccountId(row?.accountId || resolveAccountIdForApp(appId), ''),
      appId,
      placementId: String(row?.placementId || '').trim(),
    })
  }
  return map
}

function resolveFactDimensions(row, decisionDimensionMap = new Map()) {
  const requestId = String(row?.requestId || '').trim()
  const dimension = decisionDimensionMap.get(requestId)
  const appId = String(row?.appId || dimension?.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(
    row?.accountId || dimension?.accountId || resolveAccountIdForApp(appId),
    '',
  )
  const placementId = String(row?.placementId || dimension?.placementId || '').trim()
  return {
    accountId,
    appId,
    placementId,
  }
}

function ensureSettlementMapRow(map, key, seed) {
  if (!map.has(key)) {
    map.set(key, createSettlementAggregateRow(seed))
  }
  return map.get(key)
}

function upsertSettlementForDecision(row, maps) {
  const appId = String(row?.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(row?.accountId || resolveAccountIdForApp(appId), '')
  const placementId = String(row?.placementId || '').trim()
  const layer = layerFromPlacementKey(String(row?.placementKey || resolvePlacementKeyById(placementId, appId)))

  if (!accountId || !appId) return

  const totals = maps.totals
  const account = ensureSettlementMapRow(maps.byAccount, accountId, { accountId })
  const app = ensureSettlementMapRow(maps.byApp, `${accountId}::${appId}`, { accountId, appId })
  const placement = placementId
    ? ensureSettlementMapRow(
      maps.byPlacement,
      `${accountId}::${appId}::${placementId}`,
      { accountId, appId, placementId, layer },
    )
    : null

  const targets = placement ? [totals, account, app, placement] : [totals, account, app]
  for (const target of targets) {
    target.requests += 1
    if (String(row?.result || '') === 'served') {
      target.served += 1
      target.impressions += 1
    }
  }
}

function upsertSettlementForClick(row, maps) {
  if (String(row?.eventType || '') !== 'sdk_event') return
  const kind = String(row?.kind || row?.event || '').trim().toLowerCase()
  if (kind !== 'click') return

  const appId = String(row?.appId || '').trim()
  const accountId = normalizeControlPlaneAccountId(row?.accountId || resolveAccountIdForApp(appId), '')
  const placementId = String(row?.placementId || '').trim()
  const layer = layerFromPlacementKey(String(row?.placementKey || resolvePlacementKeyById(placementId, appId)))

  if (!accountId || !appId) return

  const totals = maps.totals
  const account = ensureSettlementMapRow(maps.byAccount, accountId, { accountId })
  const app = ensureSettlementMapRow(maps.byApp, `${accountId}::${appId}`, { accountId, appId })
  const placement = placementId
    ? ensureSettlementMapRow(
      maps.byPlacement,
      `${accountId}::${appId}::${placementId}`,
      { accountId, appId, placementId, layer },
    )
    : null

  const targets = placement ? [totals, account, app, placement] : [totals, account, app]
  for (const target of targets) {
    target.clicks += 1
  }
}

function upsertSettlementForFact(row, maps, decisionDimensionMap) {
  const revenueUsd = conversionFactRevenueUsd(row)
  if (revenueUsd <= 0) return

  const dimension = resolveFactDimensions(row, decisionDimensionMap)
  const accountId = dimension.accountId
  const appId = dimension.appId
  const placementId = dimension.placementId
  if (!accountId || !appId) return
  const layer = layerFromPlacementKey(String(row?.placementKey || resolvePlacementKeyById(placementId, appId)))

  const totals = maps.totals
  const account = ensureSettlementMapRow(maps.byAccount, accountId, { accountId })
  const app = ensureSettlementMapRow(maps.byApp, `${accountId}::${appId}`, { accountId, appId })
  const placement = placementId
    ? ensureSettlementMapRow(
      maps.byPlacement,
      `${accountId}::${appId}::${placementId}`,
      { accountId, appId, placementId, layer },
    )
    : null

  const targets = placement ? [totals, account, app, placement] : [totals, account, app]
  for (const target of targets) {
    target.settledConversions += 1
    target.settledRevenueUsd = round(target.settledRevenueUsd + revenueUsd, 4)
  }
}

function rankSettlementRows(rows = []) {
  return rows.sort((a, b) => {
    if (b.settledRevenueUsd !== a.settledRevenueUsd) return b.settledRevenueUsd - a.settledRevenueUsd
    if (b.settledConversions !== a.settledConversions) return b.settledConversions - a.settledConversions
    if (b.impressions !== a.impressions) return b.impressions - a.impressions
    return String(a.appId || a.accountId || a.placementId || '').localeCompare(
      String(b.appId || b.accountId || b.placementId || ''),
    )
  })
}

function computeSettlementAggregates(scope = {}, factRowsInput = null, options = {}) {
  const decisionRows = Array.isArray(options?.decisionRows)
    ? options.decisionRows
    : filterRowsByScope(state.decisionLogs, scope)
  const eventRows = Array.isArray(options?.eventRows)
    ? options.eventRows
    : filterRowsByScope(state.eventLogs, scope)
  const factRows = Array.isArray(factRowsInput)
    ? factRowsInput
    : filterRowsByScope(state.conversionFacts, scope)

  const maps = {
    totals: createSettlementAggregateRow({}),
    byAccount: new Map(),
    byApp: new Map(),
    byPlacement: new Map(),
  }
  const decisionDimensionMap = buildDecisionDimensionMap(decisionRows)

  for (const row of decisionRows) {
    upsertSettlementForDecision(row, maps)
  }
  for (const row of eventRows) {
    upsertSettlementForClick(row, maps)
  }
  for (const row of factRows) {
    upsertSettlementForFact(row, maps, decisionDimensionMap)
  }

  const byAccount = rankSettlementRows(
    Array.from(maps.byAccount.values()).map((item) => finalizeSettlementAggregateRow(item)),
  )
  const byApp = rankSettlementRows(
    Array.from(maps.byApp.values()).map((item) => finalizeSettlementAggregateRow(item)),
  )
  const byPlacement = rankSettlementRows(
    Array.from(maps.byPlacement.values()).map((item) => finalizeSettlementAggregateRow(item)),
  )

  return {
    settlementModel: 'CPA',
    currency: 'USD',
    totals: finalizeSettlementAggregateRow(maps.totals),
    byAccount,
    byApp,
    byPlacement,
  }
}

async function getDashboardStatePayload(scopeInput = {}) {
  const scope = normalizeScopeFilters(scopeInput)
  const hasScope = scopeHasFilters(scope)
  const networkHealth = getAllNetworkHealth()
  const scopedApps = getScopedApps(scope)
  const hasScopedApps = scopedApps.length > 0
  const shouldApplyScope = hasScope && hasScopedApps
  const emptyScoped = hasScope && !hasScopedApps
  const dataScope = shouldApplyScope ? scope : {}

  const decisionLogs = emptyScoped
    ? []
    : await listDecisionLogs(dataScope)
  const eventLogs = emptyScoped
    ? []
    : await listEventLogs(dataScope)
  const conversionFacts = emptyScoped
    ? []
    : await listConversionFacts(dataScope)
  const controlPlaneAuditLogs = emptyScoped
    ? []
    : (shouldApplyScope ? filterRowsByScope(state.controlPlaneAuditLogs, scope) : state.controlPlaneAuditLogs)
  const networkFlowLogs = emptyScoped
    ? []
    : (shouldApplyScope ? filterRowsByScope(state.networkFlowLogs, scope) : state.networkFlowLogs)

  const metricsSummary = computeScopedMetricsSummary(decisionLogs, eventLogs, conversionFacts)
  const metricsByDay = computeScopedMetricsByDay(decisionLogs, eventLogs, conversionFacts)
  const metricsByPlacement = emptyScoped
    ? []
    : computeScopedMetricsByPlacement(decisionLogs, eventLogs, conversionFacts, scope)
  const networkFlowStats = emptyScoped
    ? createInitialNetworkFlowStats()
    : shouldApplyScope
    ? computeScopedNetworkFlowStats(networkFlowLogs)
    : state.networkFlowStats
  const settlementAggregates = emptyScoped
    ? computeSettlementAggregates({ appId: '__none__', accountId: '__none__' }, [])
    : computeSettlementAggregates(shouldApplyScope ? scope : {}, conversionFacts, {
      decisionRows: decisionLogs,
      eventRows: eventLogs,
    })
  const placementScope = emptyScoped
    ? { appId: '', placements: [] }
    : getPlacementsForScope(scope, { createIfMissing: false, clone: true })
  const placementConfigVersion = emptyScoped
    ? 1
    : resolvePlacementConfigVersionForScope(scope, placementScope.appId)
  const placementAuditLogs = emptyScoped
    ? []
    : (shouldApplyScope ? filterRowsByScope(state.placementAuditLogs, scope) : [...state.placementAuditLogs])
  const filteredPlacementAudits = placementAuditLogs.filter((row) => {
    const rowAppId = String(row?.appId || '').trim()
    if (!placementScope.appId) return true
    if (!rowAppId) return placementScope.appId === DEFAULT_CONTROL_PLANE_APP_ID
    return rowAppId === placementScope.appId
  })

  return {
    scope,
    placementConfigVersion,
    metricsSummary,
    metricsByDay,
    metricsByPlacement,
    settlementAggregates,
    placements: placementScope.placements,
    placementAuditLogs: filteredPlacementAudits,
    controlPlaneAuditLogs,
    controlPlaneApps: shouldApplyScope ? scopedApps : state.controlPlane.apps,
    networkHealth,
    networkHealthSummary: summarizeNetworkHealthMap(networkHealth),
    networkFlowStats,
    networkFlowLogs,
    decisionLogs,
    eventLogs,
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

  const placements = getPlacementsForApp(appId, resolveAccountIdForApp(appId), {
    createIfMissing: false,
    clone: false,
  })
  const placement = placements.find((item) => item.placementId === placementId)
  if (!placement) {
    const error = new Error(`placementId not found: ${placementId}`)
    error.code = 'PLACEMENT_NOT_FOUND'
    throw error
  }

  const etag = `W/"placement:${appId}:${placement.placementId}:v${placement.configVersion}"`
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
      accountId: resolveAccountIdForApp(appId),
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
  const appId = requiredNonEmptyString(input.appId, 'appId')
  const accountId = normalizeControlPlaneAccountId(
    requiredNonEmptyString(input.accountId || input.account_id, 'accountId'),
    '',
  )
  const environment = normalizeControlPlaneEnvironment(input.environment || 'staging')
  const placementId = String(input.placementId || '').trim() || 'chat_inline_v1'
  return {
    appId,
    accountId,
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

function findActiveApiKey({ appId, accountId = '', environment, keyId = '' }) {
  const normalizedAppId = String(appId || '').trim()
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId, '')
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
  if (normalizedAccountId) {
    rows = rows.filter((item) => normalizeControlPlaneAccountId(item.accountId || resolveAccountIdForApp(item.appId), '') === normalizedAccountId)
  }

  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return rows[0] || null
}

async function ensureBootstrapApiKeyForScope({
  appId,
  accountId = '',
  environment = 'staging',
  actor = 'bootstrap',
} = {}) {
  if (STRICT_MANUAL_INTEGRATION) return null

  const normalizedAppId = String(appId || '').trim()
  const normalizedAccountId = normalizeControlPlaneAccountId(accountId || resolveAccountIdForApp(normalizedAppId), '')
  const normalizedEnvironment = normalizeControlPlaneEnvironment(environment)
  if (!normalizedAppId || !normalizedAccountId) return null

  const existing = findActiveApiKey({
    appId: normalizedAppId,
    accountId: normalizedAccountId,
    environment: normalizedEnvironment,
  })
  if (existing) return existing

  const { keyRecord } = createControlPlaneKeyRecord({
    appId: normalizedAppId,
    accountId: normalizedAccountId,
    environment: normalizedEnvironment,
    keyName: `bootstrap-${normalizedEnvironment}`,
  })

  if (isSupabaseSettlementStore()) {
    await upsertControlPlaneKeyToSupabase(keyRecord)
  }
  upsertControlPlaneStateRecord('apiKeys', 'keyId', keyRecord)
  recordControlPlaneAudit({
    action: 'key_create',
    actor,
    accountId: keyRecord.accountId,
    appId: keyRecord.appId,
    environment: keyRecord.environment,
    resourceType: 'api_key',
    resourceId: keyRecord.keyId,
    metadata: {
      keyName: keyRecord.keyName,
      status: keyRecord.status,
      bootstrap: true,
    },
  })
  return keyRecord
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

async function issueDashboardSession(user, options = {}) {
  const inputUser = normalizeDashboardUserRecord(user)
  if (!inputUser) {
    throw new Error('dashboard user is invalid.')
  }
  cleanupExpiredDashboardSessions()
  const { sessionRecord, accessToken } = createDashboardSessionRecord({
    userId: inputUser.userId,
    email: inputUser.email,
    accountId: inputUser.accountId,
    appId: inputUser.appId,
    ttlSeconds: options.ttlSeconds,
    metadata: options.metadata,
  })
  if (isSupabaseSettlementStore()) {
    await upsertDashboardSessionToSupabase(sessionRecord)
  }
  upsertControlPlaneStateRecord('dashboardSessions', 'sessionId', sessionRecord, MAX_DASHBOARD_SESSIONS)
  return {
    sessionRecord,
    accessToken,
  }
}

async function revokeDashboardSessionByToken(accessToken) {
  const session = findDashboardSessionByPlaintext(accessToken)
  if (!session) return null
  if (String(session.status || '').toLowerCase() !== 'revoked') {
    const revokedAt = nowIso()
    const nextSession = {
      ...session,
      status: 'revoked',
      revokedAt,
      updatedAt: revokedAt,
    }
    if (isSupabaseSettlementStore()) {
      await upsertDashboardSessionToSupabase(nextSession)
    }
    Object.assign(session, nextSession)
  }
  upsertControlPlaneStateRecord('dashboardSessions', 'sessionId', session, MAX_DASHBOARD_SESSIONS)
  return session
}

function recordSecurityDenyAudit({
  req,
  action,
  reason,
  code,
  httpStatus,
  accountId = '',
  appId = '',
  environment = '',
  resourceType = '',
  resourceId = '',
  metadata = {},
}) {
  recordControlPlaneAudit({
    action,
    actor: resolveAuditActor(req, 'security'),
    accountId: normalizeControlPlaneAccountId(accountId || resolveAccountIdForApp(appId), ''),
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

async function resolveRuntimeCredential(req) {
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
      const expiredAccess = {
        ...access,
        status: 'expired',
        updatedAt: nowIso(),
      }
      if (isSupabaseSettlementStore()) {
        await upsertAgentAccessTokenToSupabase(expiredAccess)
      }
      Object.assign(access, expiredAccess)
      upsertControlPlaneStateRecord('agentAccessTokens', 'tokenId', access, MAX_AGENT_ACCESS_TOKENS)
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

async function authorizeRuntimeCredential(req, options = {}) {
  const requirement = options && typeof options === 'object' ? options : {}
  const allowAnonymous = requirement.allowAnonymous === true
  const requiredScope = String(requirement.requiredScope || '').trim()
  const requiredAppId = String(requirement.appId || '').trim()
  const requiredEnvironment = String(requirement.environment || '').trim()
  const requiredPlacementId = String(requirement.placementId || '').trim()
  const operation = String(requirement.operation || '').trim() || 'runtime_call'

  const resolved = await resolveRuntimeCredential(req)
  if (resolved.kind === 'none') {
    if (allowAnonymous || !RUNTIME_AUTH_REQUIRED) {
      return { ok: true, mode: 'anonymous' }
    }
    return {
      ok: false,
      status: 401,
      error: {
        code: 'RUNTIME_AUTH_REQUIRED',
        message: 'Runtime authentication is required.',
      },
    }
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
    const touchedKey = {
      ...key,
      lastUsedAt: nowIso(),
    }
    touchedKey.updatedAt = touchedKey.lastUsedAt
    if (isSupabaseSettlementStore()) {
      await upsertControlPlaneKeyToSupabase(touchedKey)
    }
    Object.assign(key, touchedKey)
    upsertControlPlaneStateRecord('apiKeys', 'keyId', key)
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

  const touchedAccess = {
    ...access,
    updatedAt: nowIso(),
    metadata: access.metadata && typeof access.metadata === 'object' ? { ...access.metadata } : {},
  }
  touchedAccess.metadata.lastUsedAt = touchedAccess.updatedAt
  if (isSupabaseSettlementStore()) {
    await upsertAgentAccessTokenToSupabase(touchedAccess)
  }
  Object.assign(access, touchedAccess)
  upsertControlPlaneStateRecord('agentAccessTokens', 'tokenId', access, MAX_AGENT_ACCESS_TOKENS)
  persistState(state)
  return { ok: true, mode: 'agent_access_token', credential: access }
}

function applyRuntimeCredentialScope(request, auth, options = {}) {
  const target = request && typeof request === 'object' ? request : {}
  const credential = auth?.credential && typeof auth.credential === 'object' ? auth.credential : {}
  const scopedAppId = String(credential.appId || '').trim()
  const scopedAccountId = normalizeControlPlaneAccountId(
    credential.accountId || credential.organizationId || (scopedAppId ? resolveAccountIdForApp(scopedAppId) : ''),
    '',
  )
  const scopedEnvironment = normalizeControlPlaneEnvironment(credential.environment, '')
  const scopedPlacementId = String(credential.placementId || '').trim()
  const applyEnvironment = options && options.applyEnvironment === true

  if (scopedAppId) {
    target.appId = scopedAppId
  }
  if (!String(target.appId || '').trim()) {
    throw new Error('runtime credential missing app scope.')
  }

  if (scopedAccountId) {
    target.accountId = scopedAccountId
  }
  if (!String(target.accountId || '').trim()) {
    target.accountId = normalizeControlPlaneAccountId(resolveAccountIdForApp(target.appId), '')
  }

  if (applyEnvironment && scopedEnvironment) {
    target.environment = scopedEnvironment
  }

  if (scopedPlacementId) {
    const requestedPlacementId = String(target.placementId || '').trim()
    if (requestedPlacementId && requestedPlacementId !== scopedPlacementId) {
      throw new Error('placementId is outside runtime credential scope.')
    }
    target.placementId = scopedPlacementId
  }

  return target
}

async function recordAttachSdkEvent(request) {
  await recordEvent({
    eventType: 'sdk_event',
    requestId: request.requestId || '',
    appId: request.appId,
    accountId: normalizeControlPlaneAccountId(request.accountId || resolveAccountIdForApp(request.appId), ''),
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
    await resetConversionFactStore()
    if (isSupabaseSettlementStore()) {
      await loadControlPlaneStateFromSupabase()
    }
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
      stateFile: STATE_FILE,
      updatedAt: state.updatedAt,
      now: nowIso(),
    })
    return
  }

  if (pathname === '/api/v1/mediation/config' && req.method === 'GET') {
    try {
      const auth = await authorizeRuntimeCredential(req, {
        operation: 'mediation_config_read',
        requiredScope: 'mediationConfigRead',
        placementId: String(requestUrl.searchParams.get('placementId') || '').trim(),
      })
      if (!auth.ok) {
        sendJson(res, auth.status, {
          error: auth.error,
        })
        return
      }

      const runtimeScope = applyRuntimeCredentialScope({
        appId: String(requestUrl.searchParams.get('appId') || '').trim(),
        environment: String(requestUrl.searchParams.get('environment') || '').trim(),
      }, auth, { applyEnvironment: true })

      const resolved = resolveMediationConfigSnapshot({
        appId: runtimeScope.appId,
        placementId: requestUrl.searchParams.get('placementId'),
        environment: runtimeScope.environment || requestUrl.searchParams.get('environment'),
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
        accountId: request.accountId,
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

      const bidStartedAt = Date.now()
      const bidResult = await evaluateV2BidRequest({
        appId: request.appId,
        accountId: request.accountId,
        userId: request.sessionId,
        chatId: request.sessionId,
        placementId: request.placementId,
        messages: [
          { role: 'user', content: request.query },
          { role: 'assistant', content: request.answerText },
        ],
      })
      const bidLatencyMs = Math.max(0, Date.now() - bidStartedAt)
      const winnerBid = bidResult?.data?.bid && typeof bidResult.data.bid === 'object'
        ? bidResult.data.bid
        : null
      const requestId = String(bidResult?.requestId || '').trim()
      const status = winnerBid ? 'served' : 'no_fill'
      const statusReason = winnerBid ? 'runtime_eligible' : 'runtime_no_bid'

      const eventStartedAt = Date.now()
      await recordAttachSdkEvent({
        requestId,
        appId: request.appId,
        accountId: request.accountId,
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
        requestId,
        status,
        evidence: {
          config: {
            status: configResult.statusCode,
            placementId: request.placementId,
            configVersion: configResult.payload?.configVersion || 0,
            latencyMs: configLatencyMs,
          },
          bid: {
            status: 200,
            requestId,
            message: String(bidResult?.message || ''),
            hasBid: Boolean(winnerBid),
            bidId: winnerBid ? String(winnerBid.bidId || '') : '',
            dsp: winnerBid ? String(winnerBid.dsp || '') : '',
            price: winnerBid ? clampNumber(winnerBid.price, 0, Number.MAX_SAFE_INTEGER, 0) : 0,
            latencyMs: bidLatencyMs,
          },
          evaluate: {
            status: 200,
            requestId,
            result: status,
            reasonDetail: statusReason,
            latencyMs: bidLatencyMs,
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
      const message = error instanceof Error ? error.message : 'Invalid request'
      sendJson(res, 400, {
        error: {
          code: 'SDK_EVENTS_INVALID_PAYLOAD',
          message,
          route: '/api/v1/sdk/events',
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

  if (pathname === '/api/v1/public/dashboard/register' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const request = normalizeDashboardRegisterPayload(payload, 'public/dashboard/register')
      const existing = findDashboardUserByEmail(request.email)
      if (existing) {
        sendJson(res, 409, {
          error: {
            code: 'DASHBOARD_USER_EXISTS',
            message: `dashboard user already exists for email ${request.email}.`,
          },
        })
        return
      }
      const ownership = validateDashboardRegisterOwnership(req, request.accountId)
      if (!ownership.ok) {
        sendJson(res, ownership.status, { error: ownership.error })
        return
      }

      let appId = String(request.appId || '').trim()
      if (!appId) {
        const accountApp = findLatestAppForAccount(request.accountId)
        appId = String(accountApp?.appId || '').trim()
      }
      if (!appId) {
        const generated = request.accountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42) || 'customer'
        appId = `${generated}_app`
      }
      const ensured = await ensureControlPlaneAppAndEnvironment(appId, 'staging', request.accountId)
      if (!appBelongsToAccount(ensured.appId, request.accountId)) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: `appId ${ensured.appId} does not belong to accountId ${request.accountId}.`,
          },
        })
        return
      }
      if (!STRICT_MANUAL_INTEGRATION) {
        await ensureBootstrapApiKeyForScope({
          appId: ensured.appId,
          accountId: ensured.accountId,
          environment: 'staging',
          actor: resolveAuditActor(req, 'bootstrap'),
        })
      }

      const userRecord = createDashboardUserRecord({
        email: request.email,
        password: request.password,
        displayName: request.displayName,
        accountId: request.accountId,
        appId: ensured.appId,
      })

      if (isSupabaseSettlementStore()) {
        await upsertDashboardUserToSupabase(userRecord)
      }
      upsertControlPlaneStateRecord('dashboardUsers', 'userId', userRecord, MAX_DASHBOARD_USERS)

      const { sessionRecord, accessToken } = await issueDashboardSession(userRecord, {
        metadata: { source: 'register' },
      })
      const loggedInUserRecord = {
        ...userRecord,
        lastLoginAt: sessionRecord.issuedAt,
        updatedAt: sessionRecord.issuedAt,
      }
      if (isSupabaseSettlementStore()) {
        await upsertDashboardUserToSupabase(loggedInUserRecord)
      }
      Object.assign(userRecord, loggedInUserRecord)
      upsertControlPlaneStateRecord('dashboardUsers', 'userId', userRecord, MAX_DASHBOARD_USERS)
      persistState(state)

      sendJson(res, 201, {
        user: toPublicDashboardUserRecord(userRecord),
        session: toPublicDashboardSessionRecord(sessionRecord, accessToken),
      })
      return
    } catch (error) {
      if (error && typeof error === 'object' && error.code === '23505') {
        sendJson(res, 409, {
          error: {
            code: 'DASHBOARD_USER_EXISTS',
            message: 'dashboard user already exists for this account.',
          },
        })
        return
      }
      sendJson(res, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
      })
      return
    }
  }

  if (pathname === '/api/v1/public/dashboard/login' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const request = normalizeDashboardLoginPayload(payload, 'public/dashboard/login')
      const user = findDashboardUserByEmail(request.email)
      if (!user) {
        sendJson(res, 401, {
          error: {
            code: 'DASHBOARD_LOGIN_FAILED',
            message: 'email or password is incorrect.',
          },
        })
        return
      }
      if (String(user.status || '').toLowerCase() !== 'active') {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_USER_DISABLED',
            message: 'dashboard user is disabled.',
          },
        })
        return
      }
      if (!verifyPasswordRecord(request.password, user)) {
        sendJson(res, 401, {
          error: {
            code: 'DASHBOARD_LOGIN_FAILED',
            message: 'email or password is incorrect.',
          },
        })
        return
      }

      const { sessionRecord, accessToken } = await issueDashboardSession(user, {
        metadata: { source: 'login' },
      })
      const loggedInUser = {
        ...user,
        lastLoginAt: sessionRecord.issuedAt,
        updatedAt: sessionRecord.issuedAt,
      }
      if (isSupabaseSettlementStore()) {
        await upsertDashboardUserToSupabase(loggedInUser)
      }
      Object.assign(user, loggedInUser)
      upsertControlPlaneStateRecord('dashboardUsers', 'userId', user, MAX_DASHBOARD_USERS)
      persistState(state)

      sendJson(res, 200, {
        user: toPublicDashboardUserRecord(user),
        session: toPublicDashboardSessionRecord(sessionRecord, accessToken),
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

  if (pathname === '/api/v1/public/dashboard/me' && req.method === 'GET') {
    const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    sendJson(res, 200, {
      user: toPublicDashboardUserRecord(auth.user),
      session: toPublicDashboardSessionRecord(auth.session),
      scope: auth.scope,
    })
    return
  }

  if (pathname === '/api/v1/public/dashboard/logout' && req.method === 'POST') {
    const resolved = resolveDashboardSession(req)
    if (resolved.kind === 'none') {
      sendJson(res, 401, {
        error: {
          code: 'DASHBOARD_AUTH_REQUIRED',
          message: 'Dashboard authentication is required.',
        },
      })
      return
    }
    if (resolved.kind === 'invalid') {
      sendJson(res, resolved.status, {
        error: {
          code: resolved.code,
          message: resolved.message,
        },
      })
      return
    }

    await revokeDashboardSessionByToken(resolved.accessToken)
    persistState(state)
    sendJson(res, 200, { ok: true })
    return
  }

  if (pathname === '/api/v1/public/agent/integration-token' && req.method === 'POST') {
    try {
      const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
      if (!scopedAccountId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: 'Dashboard account scope is missing.',
          },
        })
        return
      }

      const payload = await readJsonBody(req)
      let appId = String(payload?.appId || payload?.app_id || '').trim()
      const accountOwnership = validateDashboardAccountOwnership(
        payload?.accountId || payload?.account_id || '',
        scopedAccountId,
      )
      if (!accountOwnership.ok) {
        sendJson(res, accountOwnership.status, { error: accountOwnership.error })
        return
      }
      const appOwnership = validateDashboardAppOwnership(appId, scopedAccountId)
      if (!appOwnership.ok) {
        sendJson(res, appOwnership.status, { error: appOwnership.error })
        return
      }
      if (!appId) {
        appId = String(auth.user?.appId || '').trim()
          || String(findLatestAppForAccount(scopedAccountId)?.appId || '').trim()
      }
      if (!appId) {
        const generated = scopedAccountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42) || 'customer'
        appId = `${generated}_app`
      }

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
      const ensured = await ensureControlPlaneAppAndEnvironment(appId, environment, scopedAccountId)
      let activeKey = findActiveApiKey({
        appId: ensured.appId,
        accountId: ensured.accountId,
        environment: ensured.environment,
      })
      if (!activeKey) {
        sendJson(res, 409, {
          error: {
            code: 'PRECONDITION_FAILED',
            message: `No active API key for appId=${ensured.appId} environment=${ensured.environment}.`,
          },
        })
        return
      }

      cleanupExpiredIntegrationTokens()

      const { tokenRecord, token } = createIntegrationTokenRecord({
        appId: ensured.appId,
        accountId: ensured.accountId,
        environment: ensured.environment,
        placementId,
        ttlMinutes,
        metadata: {
          issuedFor: 'agent_onboarding',
        },
      })

      if (isSupabaseSettlementStore()) {
        await upsertIntegrationTokenToSupabase(tokenRecord)
      }
      upsertControlPlaneStateRecord('integrationTokens', 'tokenId', tokenRecord, MAX_INTEGRATION_TOKENS)

      recordControlPlaneAudit({
        action: 'integration_token_issue',
        actor: resolveAuditActor(req, 'dashboard'),
        accountId: tokenRecord.accountId,
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
        const expiredSourceToken = {
          ...sourceToken,
          status: 'expired',
          updatedAt: now,
        }
        if (isSupabaseSettlementStore()) {
          await upsertIntegrationTokenToSupabase(expiredSourceToken)
        }
        Object.assign(sourceToken, expiredSourceToken)
        upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
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
        const revokedSourceToken = {
          ...sourceToken,
          status: 'revoked',
          updatedAt: now,
          revokedAt: sourceToken.revokedAt || now,
        }
        if (isSupabaseSettlementStore()) {
          await upsertIntegrationTokenToSupabase(revokedSourceToken)
        }
        Object.assign(sourceToken, revokedSourceToken)
        upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
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
        const usedSourceToken = {
          ...sourceToken,
          status: 'used',
          usedAt: now,
          updatedAt: now,
        }
        if (isSupabaseSettlementStore()) {
          await upsertIntegrationTokenToSupabase(usedSourceToken)
        }
        Object.assign(sourceToken, usedSourceToken)
        upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
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
        const expiredSourceToken = {
          ...sourceToken,
          status: 'expired',
          updatedAt: now,
        }
        if (isSupabaseSettlementStore()) {
          await upsertIntegrationTokenToSupabase(expiredSourceToken)
        }
        Object.assign(sourceToken, expiredSourceToken)
        upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
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
        accountId: sourceToken.accountId || resolveAccountIdForApp(sourceToken.appId),
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

      const usedSourceToken = {
        ...sourceToken,
        status: 'used',
        usedAt: now,
        updatedAt: now,
      }

      if (isSupabaseSettlementStore()) {
        await upsertIntegrationTokenToSupabase(usedSourceToken)
        await upsertAgentAccessTokenToSupabase(tokenRecord)
      }
      Object.assign(sourceToken, usedSourceToken)
      upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
      upsertControlPlaneStateRecord('agentAccessTokens', 'tokenId', tokenRecord, MAX_AGENT_ACCESS_TOKENS)

      recordControlPlaneAudit({
        action: 'integration_token_exchange',
        actor: resolveAuditActor(req, 'agent_exchange'),
        accountId: tokenRecord.accountId,
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
    const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
    if (!scopedAccountId) {
      sendJson(res, 403, {
        error: {
          code: 'DASHBOARD_SCOPE_VIOLATION',
          message: 'Dashboard account scope is missing.',
        },
      })
      return
    }

    const appId = String(requestUrl.searchParams.get('appId') || '').trim()
    const accountId = normalizeControlPlaneAccountId(
      requestUrl.searchParams.get('accountId') || requestUrl.searchParams.get('account_id') || '',
      '',
    )
    const accountOwnership = validateDashboardAccountOwnership(accountId, scopedAccountId)
    if (!accountOwnership.ok) {
      sendJson(res, accountOwnership.status, { error: accountOwnership.error })
      return
    }
    const appOwnership = validateDashboardAppOwnership(appId, scopedAccountId)
    if (!appOwnership.ok) {
      sendJson(res, appOwnership.status, { error: appOwnership.error })
      return
    }
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
    keys = keys.filter((row) => (
      normalizeControlPlaneAccountId(row.accountId || resolveAccountIdForApp(row.appId), '') === scopedAccountId
    ))
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
      const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
      if (!scopedAccountId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: 'Dashboard account scope is missing.',
          },
        })
        return
      }

      const payload = await readJsonBody(req)
      let appId = String(payload?.appId || payload?.app_id || '').trim()
      const accountOwnership = validateDashboardAccountOwnership(
        payload?.accountId || payload?.account_id || '',
        scopedAccountId,
      )
      if (!accountOwnership.ok) {
        sendJson(res, accountOwnership.status, { error: accountOwnership.error })
        return
      }
      const appOwnership = validateDashboardAppOwnership(appId, scopedAccountId)
      if (!appOwnership.ok) {
        sendJson(res, appOwnership.status, { error: appOwnership.error })
        return
      }
      if (!appId) {
        appId = String(auth.user?.appId || '').trim()
          || String(findLatestAppForAccount(scopedAccountId)?.appId || '').trim()
      }
      if (!appId) {
        const generated = scopedAccountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42) || 'customer'
        appId = `${generated}_app`
      }
      const requestedEnvironment = String(payload?.environment || payload?.env || '').trim().toLowerCase()
      const environment = requestedEnvironment || 'staging'
      if (!CONTROL_PLANE_ENVIRONMENTS.has(environment)) {
        throw new Error(`environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`)
      }
      const keyName = String(payload?.name || payload?.keyName || payload?.key_name || '').trim()
        || `primary-${environment}`

      const ensured = await ensureControlPlaneAppAndEnvironment(appId, environment, scopedAccountId)
      const { keyRecord, secret } = createControlPlaneKeyRecord({
        appId: ensured.appId,
        accountId: ensured.accountId,
        environment: ensured.environment,
        keyName,
      })

      if (isSupabaseSettlementStore()) {
        await upsertControlPlaneKeyToSupabase(keyRecord)
      }
      upsertControlPlaneStateRecord('apiKeys', 'keyId', keyRecord)
      recordControlPlaneAudit({
        action: 'key_create',
        actor: resolveAuditActor(req, 'public_api'),
        accountId: keyRecord.accountId,
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
    const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
    if (!scopedAccountId) {
      sendJson(res, 403, {
        error: {
          code: 'DASHBOARD_SCOPE_VIOLATION',
          message: 'Dashboard account scope is missing.',
        },
      })
      return
    }

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
    const targetAccountId = normalizeControlPlaneAccountId(target.accountId || resolveAccountIdForApp(target.appId), '')
    if (targetAccountId !== scopedAccountId) {
      sendJson(res, 403, {
        error: {
          code: 'DASHBOARD_SCOPE_VIOLATION',
          message: `keyId ${keyId} does not belong to your account.`,
        },
      })
      return
    }

    const { keyRecord, secret } = createControlPlaneKeyRecord({
      keyId: target.keyId,
      appId: target.appId,
      accountId: target.accountId || resolveAccountIdForApp(target.appId),
      environment: target.environment,
      keyName: target.keyName,
      createdAt: target.createdAt,
      lastUsedAt: target.lastUsedAt,
      metadata: target.metadata,
      status: 'active',
    })

    const rotatedTarget = {
      ...target,
      keyPrefix: keyRecord.keyPrefix,
      secretHash: keyRecord.secretHash,
      status: 'active',
      revokedAt: '',
      maskedKey: keyRecord.maskedKey,
      accountId: keyRecord.accountId,
      updatedAt: keyRecord.updatedAt,
    }

    if (isSupabaseSettlementStore()) {
      await upsertControlPlaneKeyToSupabase(rotatedTarget)
    }
    Object.assign(target, rotatedTarget)
    upsertControlPlaneStateRecord('apiKeys', 'keyId', target)

    recordControlPlaneAudit({
      action: 'key_rotate',
      actor: resolveAuditActor(req, 'public_api'),
      accountId: target.accountId,
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
    const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
    if (!scopedAccountId) {
      sendJson(res, 403, {
        error: {
          code: 'DASHBOARD_SCOPE_VIOLATION',
          message: 'Dashboard account scope is missing.',
        },
      })
      return
    }

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
    const targetAccountId = normalizeControlPlaneAccountId(target.accountId || resolveAccountIdForApp(target.appId), '')
    if (targetAccountId !== scopedAccountId) {
      sendJson(res, 403, {
        error: {
          code: 'DASHBOARD_SCOPE_VIOLATION',
          message: `keyId ${keyId} does not belong to your account.`,
        },
      })
      return
    }

    if (target.status !== 'revoked') {
      const revokedAt = nowIso()
      const revokedTarget = {
        ...target,
        status: 'revoked',
        revokedAt,
        updatedAt: revokedAt,
      }
      if (isSupabaseSettlementStore()) {
        await upsertControlPlaneKeyToSupabase(revokedTarget)
      }
      Object.assign(target, revokedTarget)
      upsertControlPlaneStateRecord('apiKeys', 'keyId', target)
      recordControlPlaneAudit({
        action: 'key_revoke',
        actor: resolveAuditActor(req, 'public_api'),
        accountId: target.accountId || resolveAccountIdForApp(target.appId),
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
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope
    sendJson(res, 200, await getDashboardStatePayload(scope))
    return
  }

  if (pathname === '/api/v1/dashboard/placements' && req.method === 'GET') {
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope
    const hasScope = scopeHasFilters(scope)
    if (hasScope && getScopedApps(scope).length === 0) {
      sendJson(res, 200, { appId: '', placementConfigVersion: 1, placements: [] })
      return
    }

    const scopedAppId = resolvePlacementScopeAppId(scope, auth.user?.appId || auth.session?.appId || '')
    if (!scopedAppId) {
      sendJson(res, 200, { appId: '', placementConfigVersion: 1, placements: [] })
      return
    }
    const config = getPlacementConfigForApp(scopedAppId, scope.accountId, { createIfMissing: true })
    const placements = config?.placements && Array.isArray(config.placements)
      ? config.placements.map((item) => normalizePlacement(item))
      : []
    sendJson(res, 200, {
      appId: scopedAppId,
      placementConfigVersion: toPositiveInteger(config?.placementConfigVersion, 1),
      placements,
    })
    return
  }

  if (pathname === '/api/v1/dashboard/placements' && req.method === 'POST') {
    try {
      const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }

      const scope = auth.scope
      const scopedAppId = resolvePlacementScopeAppId(scope, auth.user?.appId || auth.session?.appId || '')
      if (!scopedAppId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: 'appId is required for placement mutation under current dashboard scope.',
          },
        })
        return
      }
      const placementConfig = getPlacementConfigForApp(scopedAppId, scope.accountId, { createIfMissing: true })
      if (!placementConfig) {
        sendJson(res, 404, {
          error: {
            code: 'PLACEMENT_CONFIG_NOT_FOUND',
            message: `placement config not found for appId ${scopedAppId}.`,
          },
        })
        return
      }

      const payload = await readJsonBody(req)
      const placementId = String(payload?.placementId || payload?.placement_id || '').trim()
      if (!placementId) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'placementId is required.',
          },
        })
        return
      }

      const exists = Array.isArray(placementConfig.placements)
        ? placementConfig.placements.find((item) => item.placementId === placementId)
        : null
      if (exists) {
        sendJson(res, 409, {
          error: {
            code: 'PLACEMENT_EXISTS',
            message: `Placement already exists: ${placementId}`,
          },
        })
        return
      }

      const nextConfigVersion = toPositiveInteger(placementConfig.placementConfigVersion, 1) + 1
      const basePlacement = normalizePlacement({
        placementId,
        placementKey: resolvePlacementKeyById(placementId, scopedAppId),
        configVersion: nextConfigVersion,
      })
      const created = buildPlacementFromPatch(basePlacement, payload, nextConfigVersion)
      created.placementId = placementId
      created.placementKey = String(created.placementKey || '').trim() || resolvePlacementKeyById(placementId, scopedAppId)

      placementConfig.placements = Array.isArray(placementConfig.placements)
        ? [...placementConfig.placements, created]
        : [created]
      placementConfig.placementConfigVersion = nextConfigVersion
      placementConfig.updatedAt = nowIso()
      state.placementConfigVersion = Math.max(
        toPositiveInteger(state.placementConfigVersion, 1),
        nextConfigVersion,
      )
      if (scopedAppId === DEFAULT_CONTROL_PLANE_APP_ID) {
        syncLegacyPlacementSnapshot()
      }

      const actor = resolveAuditActor(req, 'dashboard')
      const scopedAccountId = normalizeControlPlaneAccountId(
        placementConfig.accountId || resolveAccountIdForApp(scopedAppId),
        '',
      )
      const patch = payload && typeof payload === 'object' ? payload : {}
      recordPlacementAudit({
        appId: scopedAppId,
        accountId: scopedAccountId,
        placementId,
        configVersion: nextConfigVersion,
        actor,
        patch,
        before: null,
        after: JSON.parse(JSON.stringify(created)),
      })
      recordControlPlaneAudit({
        action: 'config_publish',
        actor,
        accountId: scopedAccountId,
        appId: scopedAppId,
        environment: 'staging',
        resourceType: 'placement',
        resourceId: placementId,
        metadata: {
          operation: 'create',
          configVersion: nextConfigVersion,
          patch,
        },
      })

      persistState(state)

      sendJson(res, 201, {
        appId: scopedAppId,
        placementConfigVersion: toPositiveInteger(placementConfig.placementConfigVersion, 1),
        placement: created,
        changed: true,
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

  if (pathname.startsWith('/api/v1/dashboard/placements/') && req.method === 'PUT') {
    try {
      const auth = authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      const scopedAppId = resolvePlacementScopeAppId(scope, auth.user?.appId || auth.session?.appId || '')
      if (!scopedAppId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: 'appId is required for placement mutation under current dashboard scope.',
          },
        })
        return
      }
      const placementConfig = getPlacementConfigForApp(scopedAppId, scope.accountId, { createIfMissing: true })
      const placementId = decodeURIComponent(pathname.replace('/api/v1/dashboard/placements/', ''))
      const target = placementConfig?.placements?.find((item) => item.placementId === placementId)

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
        const nextConfigVersion = toPositiveInteger(placementConfig?.placementConfigVersion, 1) + 1
        applyPlacementPatch(target, payload, nextConfigVersion)
        placementConfig.placementConfigVersion = nextConfigVersion
        placementConfig.updatedAt = nowIso()
        state.placementConfigVersion = Math.max(
          toPositiveInteger(state.placementConfigVersion, 1),
          nextConfigVersion,
        )
        if (scopedAppId === DEFAULT_CONTROL_PLANE_APP_ID) {
          syncLegacyPlacementSnapshot()
        }
        const actor = resolveAuditActor(req, 'dashboard')
        const scopedAccountId = normalizeControlPlaneAccountId(
          placementConfig?.accountId || resolveAccountIdForApp(scopedAppId),
          '',
        )
        recordPlacementAudit({
          appId: scopedAppId,
          accountId: scopedAccountId,
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
          accountId: scopedAccountId,
          appId: scopedAppId,
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
        appId: scopedAppId,
        placementConfigVersion: toPositiveInteger(placementConfig?.placementConfigVersion, 1),
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
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope
    const snapshot = await getDashboardStatePayload(scope)
    sendJson(res, 200, snapshot.metricsSummary)
    return
  }

  if (pathname === '/api/v1/dashboard/metrics/by-day' && req.method === 'GET') {
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope
    const snapshot = await getDashboardStatePayload(scope)
    sendJson(res, 200, { items: snapshot.metricsByDay })
    return
  }

  if (pathname === '/api/v1/dashboard/metrics/by-placement' && req.method === 'GET') {
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope
    const snapshot = await getDashboardStatePayload(scope)
    sendJson(res, 200, { items: snapshot.metricsByPlacement })
    return
  }

  if (pathname === '/api/v1/dashboard/usage-revenue' && req.method === 'GET') {
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const snapshot = await getDashboardStatePayload(auth.scope)
    sendJson(res, 200, snapshot.settlementAggregates)
    return
  }

  if (pathname === '/api/v1/dashboard/decisions' && req.method === 'GET') {
    const result = requestUrl.searchParams.get('result')
    const placementId = requestUrl.searchParams.get('placementId')
    const requestId = requestUrl.searchParams.get('requestId')
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope

    let rows = await listDecisionLogs(scope)

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
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope

    let rows = await listEventLogs(scope)

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
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    let rows = queryControlPlaneAudits(requestUrl.searchParams)
    if (scopeHasFilters(auth.scope)) {
      rows = rows.filter((row) => recordMatchesScope(row, auth.scope))
    }
    sendJson(res, 200, {
      items: rows,
    })
    return
  }

  if (pathname === '/api/v1/dashboard/placement-audits' && req.method === 'GET') {
    const auth = authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope
    const placementId = requestUrl.searchParams.get('placementId')
    let rows = filterRowsByScope(state.placementAuditLogs, scope)
    if (placementId) {
      rows = rows.filter((row) => row.placementId === placementId)
    }
    sendJson(res, 200, { items: rows })
    return
  }

  if (pathname === '/api/v1/dashboard/network-health' && req.method === 'GET') {
    const auth = authorizeDashboardScope(req, requestUrl.searchParams)
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error })
      return
    }
    const scope = auth.scope
    const networkHealth = getAllNetworkHealth()
    const scopedFlowLogs = filterRowsByScope(state.networkFlowLogs, scope)
    sendJson(res, 200, {
      networkHealth,
      networkHealthSummary: summarizeNetworkHealthMap(networkHealth),
      networkFlowStats: scopeHasFilters(scope)
        ? computeScopedNetworkFlowStats(scopedFlowLogs)
        : state.networkFlowStats,
      items: scopedFlowLogs,
    })
    return
  }

  if (pathname === '/api/v1/sdk/config' && req.method === 'GET') {
    try {
      const appId = requiredNonEmptyString(requestUrl.searchParams.get('appId'), 'appId')
      const placements = getPlacementsForApp(appId, resolveAccountIdForApp(appId), {
        createIfMissing: false,
        clone: true,
      })
      if (!Array.isArray(placements) || placements.length === 0) {
        sendJson(res, 404, {
          error: {
            code: 'PLACEMENT_CONFIG_NOT_FOUND',
            message: `placement config not found for appId ${appId}.`,
          },
        })
        return
      }
      sendJson(res, 200, {
        appId,
        accountId: resolveAccountIdForApp(appId),
        placements,
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

  if (pathname === '/api/v2/bid' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const request = normalizeV2BidPayload(payload, 'v2/bid')
      const auth = await authorizeRuntimeCredential(req, {
        operation: 'v2_bid',
        requiredScope: 'sdkEvaluate',
        placementId: request.placementId,
      })
      if (!auth.ok) {
        sendJson(res, auth.status, {
          error: auth.error,
        })
        return
      }

      const scopedRequest = auth.mode === 'anonymous'
        ? {
            appId: DEFAULT_CONTROL_PLANE_APP_ID,
            accountId: normalizeControlPlaneAccountId(resolveAccountIdForApp(DEFAULT_CONTROL_PLANE_APP_ID), ''),
            placementId: request.placementId,
          }
        : applyRuntimeCredentialScope({
            appId: DEFAULT_CONTROL_PLANE_APP_ID,
            accountId: '',
            placementId: request.placementId,
          }, auth)

      const result = await evaluateV2BidRequest({
        ...request,
        appId: scopedRequest.appId,
        accountId: scopedRequest.accountId,
        placementId: scopedRequest.placementId || request.placementId,
      })

      sendJson(res, 200, {
        requestId: String(result.requestId || ''),
        timestamp: String(result.timestamp || nowIso()),
        status: 'success',
        message: String(result.message || 'No bid'),
        data: {
          bid: result?.data?.bid || null,
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
      const placementIdHint = String(payload?.placementId || '').trim()
      const auth = await authorizeRuntimeCredential(req, {
        operation: 'sdk_evaluate',
        requiredScope: 'sdkEvaluate',
        placementId: placementIdHint || '',
      })
      if (!auth.ok) {
        sendJson(res, auth.status, {
          error: auth.error,
        })
        return
      }

      const legacyCredential = auth?.credential && typeof auth.credential === 'object' ? auth.credential : {}
      recordNetworkFlowObservation({
        requestId: createId('legacy_eval'),
        appId: String(legacyCredential.appId || '').trim(),
        accountId: normalizeControlPlaneAccountId(
          legacyCredential.accountId || legacyCredential.organizationId || resolveAccountIdForApp(legacyCredential.appId),
          '',
        ),
        placementId: placementIdHint,
        decisionResult: 'deprecated',
        runtimeError: false,
        failOpenApplied: true,
        networkErrors: [],
        snapshotUsage: {},
        networkHealthSummary: summarizeNetworkHealthMap(getAllNetworkHealth()),
      })

      sendJson(res, 200, {
        requestId: createId('legacy_eval'),
        status: 'deprecated',
        message: 'The /api/v1/sdk/evaluate endpoint is deprecated. Please migrate to POST /api/v2/bid with unified messages payload.',
        migration: {
          endpoint: '/api/v2/bid',
          requiredFields: ['userId', 'chatId', 'placementId', 'messages'],
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

  if (pathname === '/api/v1/sdk/events' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      let responsePayload = { ok: true }
      if (isPostbackConversionPayload(payload)) {
        const request = normalizePostbackConversionPayload(payload, 'sdk/events')
        const auth = await authorizeRuntimeCredential(req, {
          operation: 'sdk_events',
          requiredScope: 'sdkEvents',
          placementId: request.placementId || findPlacementIdByRequestId(request.requestId) || 'chat_inline_v1',
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }
        applyRuntimeCredentialScope(request, auth)

        const { duplicate, fact } = await recordConversionFact(request)
        await recordEvent({
          eventType: request.eventType,
          event: 'postback',
          kind: request.postbackType,
          requestId: request.requestId,
          appId: request.appId,
          accountId: request.accountId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          userId: request.userId,
          adId: request.adId,
          placementId: fact.placementId,
          placementKey: fact.placementKey,
          postbackType: request.postbackType,
          postbackStatus: request.postbackStatus,
          conversionId: request.conversionId,
          eventSeq: request.eventSeq,
          cpaUsd: request.cpaUsd,
          currency: request.currency,
          occurredAt: request.occurredAt,
          factId: fact.factId,
          idempotencyKey: fact.idempotencyKey,
          revenueUsd: fact.revenueUsd,
          duplicate,
        })

        responsePayload = {
          ok: true,
          duplicate,
          factId: fact.factId,
          revenueUsd: round(fact.revenueUsd, 2),
        }
      } else if (isNextStepIntentCardPayload(payload)) {
        const request = normalizeNextStepIntentCardPayload(payload, 'sdk/events')
        const auth = await authorizeRuntimeCredential(req, {
          operation: 'sdk_events',
          requiredScope: 'sdkEvents',
          placementId: request.placementId,
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }
        applyRuntimeCredentialScope(request, auth)

        const inferredIntentClass = String(request.context.intentHints?.intent_class || '').trim().toLowerCase()
        const inferredIntentScore = clampNumber(request.context.intentHints?.intent_score, 0, 1, NaN)
        const inferredPreferenceFacets = normalizeNextStepPreferenceFacets(
          request.context.intentHints?.preference_facets,
        )
        const normalizedPlacementId = request.placementId || 'chat_followup_v1'
        if (request.kind === 'click') {
          recordClickCounters(normalizedPlacementId)
        }

        await recordEvent({
          eventType: 'sdk_event',
          requestId: request.requestId || '',
          appId: request.appId,
          accountId: request.accountId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          userId: request.userId,
          query: request.context.query,
          answerText: request.context.answerText,
          intentClass: inferredIntentClass || '',
          intentScore: Number.isFinite(inferredIntentScore) ? inferredIntentScore : 0,
          preferenceFacets: inferredPreferenceFacets,
          locale: request.context.locale,
          event: request.kind === 'impression' ? request.event : request.kind,
          kind: request.kind,
          adId: request.adId || '',
          placementId: normalizedPlacementId,
          placementKey: request.placementKey,
        })
      } else {
        const request = normalizeAttachMvpPayload(payload, 'sdk/events')
        const auth = await authorizeRuntimeCredential(req, {
          operation: 'sdk_events',
          requiredScope: 'sdkEvents',
          placementId: request.placementId || 'chat_inline_v1',
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }
        applyRuntimeCredentialScope(request, auth)

        if (request.kind === 'click') {
          recordClickCounters(request.placementId || 'chat_inline_v1')
        }

        await recordEvent({
          eventType: 'sdk_event',
          requestId: request.requestId || '',
          appId: request.appId,
          accountId: request.accountId,
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

      sendJson(res, 200, responsePayload)
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

async function startServer() {
  try {
    await ensureSettlementStoreReady()
  } catch (error) {
    console.error(
      '[simulator-gateway] settlement store init error (fail-fast):',
      error instanceof Error ? error.message : String(error),
    )
    process.exit(1)
    return
  }

  server.listen(PORT, HOST, () => {
    console.log(`[simulator-gateway] listening on http://${HOST}:${PORT}`)
    console.log(`[simulator-gateway] state file: ${STATE_FILE}`)
    if (SETTLEMENT_STORAGE_COMPAT_POSTGRES) {
      console.warn('[simulator-gateway] SIMULATOR_SETTLEMENT_STORAGE=postgres is deprecated, treating as supabase.')
    }
    console.log(`[simulator-gateway] settlement store mode: ${settlementStore.mode}`)
    console.log(`[simulator-gateway] strict manual integration: ${STRICT_MANUAL_INTEGRATION}`)
    console.log(`[simulator-gateway] runtime log db persistence required: ${REQUIRE_RUNTIME_LOG_DB_PERSISTENCE}`)
    if (REQUIRE_DURABLE_SETTLEMENT && !isPostgresSettlementStore()) {
      console.error('[simulator-gateway] durable settlement is required but supabase store is unavailable.')
      process.exit(1)
    }
    if (REQUIRE_RUNTIME_LOG_DB_PERSISTENCE && !isPostgresSettlementStore()) {
      console.error('[simulator-gateway] runtime log DB persistence is required but supabase store is unavailable.')
      process.exit(1)
    }
  })
}

startServer().catch((error) => {
  console.error('[simulator-gateway] startup failure:', error)
  process.exit(1)
})
