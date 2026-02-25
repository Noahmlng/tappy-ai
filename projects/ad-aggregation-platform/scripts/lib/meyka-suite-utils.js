import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
export const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src', 'devtools', 'simulator', 'simulator-gateway.js')
export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 3213
export const HEALTH_CHECK_TIMEOUT_MS = 15000
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000

export const DEFAULT_PLACEMENTS = Object.freeze(['chat_from_answer_v1', 'chat_intent_recommendation_v1'])
export const DEFAULT_SCENARIO_SET_PATH = path.join(PROJECT_ROOT, 'tests', 'scenarios', 'meyka-finance-dialogues.json')
export const DEFAULT_INVENTORY_NETWORKS = Object.freeze(['house', 'partnerstack', 'cj'])

const SUPPORTED_SETTLEMENT_STORAGE = new Set(['auto', 'supabase', 'state_file'])
const SUPPORTED_SCENARIO_ROLES = new Set(['user', 'assistant', 'system'])
const SUPPORTED_INVENTORY_NETWORKS = new Set(['house', 'partnerstack', 'cj'])

export function parseArgs(argv) {
  const options = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const index = arg.indexOf('=')
    if (index < 0) {
      options[arg.slice(2)] = 'true'
      continue
    }
    options[arg.slice(2, index)] = arg.slice(index + 1)
  }
  return options
}

export function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

export function toInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

export function toNumber(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function clamp01(value) {
  return clamp(toNumber(value, 0), 0, 1)
}

export function round(value, digits = 4) {
  const n = toNumber(value, 0)
  return Number(n.toFixed(digits))
}

export function nowIso() {
  return new Date().toISOString()
}

export function nowTag(date = new Date()) {
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const sec = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

export async function requestJson(baseUrl, pathname, options = {}) {
  const timeout = createTimeoutSignal(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    try {
      const response = await fetch(`${String(baseUrl || '').replace(/\/+$/, '')}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: timeout.signal,
      })

      const payload = await response.json().catch(() => ({}))
      return {
        ok: response.ok,
        status: response.status,
        payload,
        elapsedMs: Date.now() - startedAt,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request_failed'
      return {
        ok: false,
        status: 0,
        payload: {
          error: {
            code: 'REQUEST_FAILED',
            message,
          },
        },
        elapsedMs: Date.now() - startedAt,
      }
    }
  } finally {
    timeout.clear()
  }
}

export async function waitForGateway(baseUrl) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < HEALTH_CHECK_TIMEOUT_MS) {
    const health = await requestJson(baseUrl, '/api/health', { timeoutMs: 1200 })
    if (health.ok && health.payload?.ok === true) return
    await sleep(250)
  }
  throw new Error(`Gateway health check timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`)
}

export function startGatewayProcess(port, extraEnv = {}) {
  const child = spawn(process.execPath, [GATEWAY_ENTRY], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SIMULATOR_GATEWAY_HOST: DEFAULT_HOST,
      SIMULATOR_GATEWAY_PORT: String(port),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })

  return {
    child,
    logs: () => ({ stdout, stderr }),
  }
}

export async function stopGatewayProcess(handle) {
  if (!handle?.child) return
  handle.child.kill('SIGTERM')
  await sleep(200)
  if (!handle.child.killed) {
    handle.child.kill('SIGKILL')
  }
}

export function parsePlacements(rawValue, fallback = DEFAULT_PLACEMENTS) {
  const raw = String(rawValue || '').trim()
  if (!raw) return [...fallback]
  const values = raw
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  if (values.length === 0) return [...fallback]
  return [...new Set(values)]
}

export function parseSettlementStorage(rawValue, fallback = 'auto') {
  const normalizedFallback = SUPPORTED_SETTLEMENT_STORAGE.has(String(fallback || '').trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : 'auto'
  const normalized = String(rawValue || '').trim().toLowerCase()
  if (!normalized) return normalizedFallback
  if (SUPPORTED_SETTLEMENT_STORAGE.has(normalized)) return normalized
  throw new Error(`invalid settlementStorage: ${rawValue}`)
}

export function parseInventoryNetworks(rawValue, fallback = DEFAULT_INVENTORY_NETWORKS) {
  const raw = String(rawValue || '').trim().toLowerCase()
  if (!raw) return [...fallback]
  const values = raw
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => SUPPORTED_INVENTORY_NETWORKS.has(item))
  if (values.length === 0) return [...fallback]
  return [...new Set(values)]
}

function normalizeScenarioMessages(value = [], index = 0) {
  if (!Array.isArray(value)) return []
  const rows = value.map((item, rowIndex) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`invalid scenario messages at index ${index}, row ${rowIndex}`)
    }
    const role = String(item.role || '').trim().toLowerCase()
    const content = String(item.content || '').trim()
    if (!SUPPORTED_SCENARIO_ROLES.has(role) || !content) {
      throw new Error(`invalid scenario message role/content at index ${index}, row ${rowIndex}`)
    }
    return {
      role,
      content,
    }
  })
  return rows
}

function deriveScenarioTextFromMessages(messages = []) {
  const rows = Array.isArray(messages) ? messages : []
  let query = ''
  let answerText = ''
  for (let cursor = rows.length - 1; cursor >= 0; cursor -= 1) {
    const row = rows[cursor]
    const role = String(row?.role || '').trim().toLowerCase()
    const content = String(row?.content || '').trim()
    if (!content) continue
    if (!query && role === 'user') query = content
    if (!answerText && role === 'assistant') answerText = content
    if (query && answerText) break
  }
  return { query, answerText }
}

function normalizeScenarioItem(item = {}, index = 0) {
  const key = String(item.key || `scenario_${index + 1}`).trim()
  const messages = normalizeScenarioMessages(item.messages, index)
  const derived = deriveScenarioTextFromMessages(messages)
  const query = String(item.query || derived.query || '').trim()
  const answerText = String(item.answerText || derived.answerText || '').trim()
  if (!query || !answerText) {
    throw new Error(`invalid scenario at index ${index}: query/answerText or messages are required`)
  }

  const intentScore = clamp(toNumber(item.intentScore, 0.82), 0, 1)
  const normalizedMessages = messages.length > 0
    ? messages
    : [
        { role: 'user', content: query },
        { role: 'assistant', content: answerText },
      ]
  return {
    key,
    category: String(item.category || '').trim(),
    query,
    answerText,
    messages: normalizedMessages,
    locale: String(item.locale || 'en-US').trim() || 'en-US',
    intentClass: String(item.intentClass || 'product_exploration').trim() || 'product_exploration',
    intentScore,
    preferenceFacets: Array.isArray(item.preferenceFacets) ? item.preferenceFacets : [],
  }
}

export async function loadScenarioSet(filePath = DEFAULT_SCENARIO_SET_PATH) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  const raw = await fs.readFile(absolute, 'utf8')
  const parsed = JSON.parse(raw)
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.scenarios)
    ? parsed.scenarios
    : []
  if (list.length === 0) {
    throw new Error(`scenario set is empty: ${absolute}`)
  }

  const scenarios = list.map((item, index) => normalizeScenarioItem(item, index))
  const scenarioSet = String(parsed?.scenarioSet || path.basename(absolute)).trim()
  return {
    scenarioSet,
    sourcePath: absolute,
    scenarios,
  }
}

export function hashToUnitInterval(seed = '') {
  const digest = createHash('sha1').update(String(seed || '')).digest()
  const value = digest.readUInt32BE(0)
  return value / 0xffffffff
}

export function buildStableConversionId(requestId, adId, turnId) {
  const seed = `${requestId}|${adId}|${turnId}`
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 16)
  return `conv_${digest}`
}

export function shouldSamplePostback(requestId, adId, turnId, pConv) {
  const probability = clamp01(pConv)
  if (probability <= 0) return false
  const sample = hashToUnitInterval(`${requestId}|${adId}|${turnId}`)
  return sample < probability
}

export function percentile(values = [], p = 0.5) {
  const rows = Array.isArray(values)
    ? values.filter((item) => Number.isFinite(Number(item))).map((item) => Number(item))
    : []
  if (rows.length === 0) return 0
  rows.sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(rows.length - 1, Math.ceil(rows.length * p) - 1))
  return rows[idx]
}

export function average(values = []) {
  const rows = Array.isArray(values)
    ? values.filter((item) => Number.isFinite(Number(item))).map((item) => Number(item))
    : []
  if (rows.length === 0) return 0
  return rows.reduce((sum, item) => sum + item, 0) / rows.length
}

export async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export function runtimeHeaders(runtimeKey) {
  const token = String(runtimeKey || '').trim()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export function dashboardHeaders(dashboardToken) {
  const token = String(dashboardToken || '').trim()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

function formatApiError(payload = {}) {
  const code = String(payload?.error?.code || payload?.code || '').trim()
  const message = String(payload?.error?.message || payload?.message || '').trim()
  if (code && message) return `${code}: ${message}`
  if (code) return code
  if (message) return message
  return ''
}

export async function registerDashboardUser(baseUrl, input = {}) {
  const accountId = String(input.accountId || 'org_simulator').trim()
  const appId = String(input.appId || 'simulator-chatbot').trim()
  const email = String(input.email || `meyka_suite_${Date.now()}@example.com`).trim().toLowerCase()
  const password = String(input.password || 'pass12345').trim()
  const response = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
    method: 'POST',
    body: {
      email,
      password,
      accountId,
      appId,
    },
  })
  if (!response.ok) {
    const detail = formatApiError(response.payload)
    throw new Error(`dashboard register failed: HTTP_${response.status}${detail ? ` ${detail}` : ''}`)
  }
  const accessToken = String(response.payload?.session?.accessToken || '').trim()
  if (!accessToken) {
    throw new Error('dashboard register failed: missing accessToken')
  }
  return {
    accountId,
    appId,
    dashboardToken: accessToken,
  }
}

export async function issueRuntimeKey(baseUrl, input = {}) {
  const accountId = String(input.accountId || '').trim()
  const appId = String(input.appId || '').trim()
  const environment = String(input.environment || 'prod').trim() || 'prod'
  const dashboardToken = String(input.dashboardToken || '').trim()
  if (!dashboardToken) {
    throw new Error('issueRuntimeKey requires dashboardToken')
  }
  if (!accountId || !appId) {
    throw new Error('issueRuntimeKey requires accountId and appId')
  }

  const response = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
    method: 'POST',
    headers: dashboardHeaders(dashboardToken),
    body: {
      accountId,
      appId,
      environment,
      name: `meyka-suite-${Date.now()}`,
    },
  })
  if (!response.ok) {
    const detail = formatApiError(response.payload)
    throw new Error(`issue runtime key failed: HTTP_${response.status}${detail ? ` ${detail}` : ''}`)
  }
  const secret = String(response.payload?.secret || '').trim()
  if (!secret) {
    throw new Error('issue runtime key failed: missing secret')
  }
  return secret
}

export async function resolveAuthContext(baseUrl, args = {}, options = {}) {
  const useExternalGateway = options.useExternalGateway === true
  const allowAutoRegister = toBoolean(
    args.autoRegisterDashboard,
    !useExternalGateway,
  )

  let runtimeKey = String(
    args.runtimeKey || (useExternalGateway ? process.env.MEYKA_RUNTIME_KEY : '') || '',
  ).trim()
  let dashboardToken = String(
    args.dashboardToken || (useExternalGateway ? process.env.MEYKA_DASHBOARD_TOKEN : '') || '',
  ).trim()
  const explicitAccountId = String(
    args.accountId || (useExternalGateway ? process.env.MEYKA_ACCOUNT_ID : '') || '',
  ).trim()
  const explicitAppId = String(
    args.appId || (useExternalGateway ? process.env.MEYKA_APP_ID : '') || '',
  ).trim()
  const fallbackSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  let accountId = explicitAccountId || (allowAutoRegister ? `org_meyka_${fallbackSuffix}` : 'org_simulator')
  let appId = explicitAppId || (allowAutoRegister ? `meyka_app_${fallbackSuffix}` : 'simulator-chatbot')
  let environment = String(
    args.environment || (useExternalGateway ? process.env.MEYKA_ENVIRONMENT : '') || 'prod',
  ).trim().toLowerCase() || 'prod'

  if (!dashboardToken && allowAutoRegister) {
    const registered = await registerDashboardUser(baseUrl, { accountId, appId })
    dashboardToken = registered.dashboardToken
  }

  if (!runtimeKey && dashboardToken) {
    let issueError = null
    try {
      runtimeKey = await issueRuntimeKey(baseUrl, {
        accountId,
        appId,
        environment,
        dashboardToken,
      })
    } catch (error) {
      issueError = error
    }

    if (!runtimeKey && environment !== 'prod') {
      try {
        runtimeKey = await issueRuntimeKey(baseUrl, {
          accountId,
          appId,
          environment: 'prod',
          dashboardToken,
        })
        environment = 'prod'
        issueError = null
      } catch (error) {
        issueError = error
      }
    }

    if (!runtimeKey) {
      if (!allowAutoRegister || explicitAccountId || explicitAppId) {
        throw issueError || new Error('issue runtime key failed')
      }
      const recoverSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      accountId = `org_meyka_${recoverSuffix}`
      appId = `meyka_app_${recoverSuffix}`
      const registered = await registerDashboardUser(baseUrl, {
        accountId,
        appId,
        email: `meyka_suite_recover_${Date.now()}@example.com`,
      })
      dashboardToken = registered.dashboardToken
      runtimeKey = await issueRuntimeKey(baseUrl, {
        accountId,
        appId,
        environment: 'prod',
        dashboardToken,
      })
      environment = 'prod'
    }
  }

  return {
    accountId,
    appId,
    environment,
    runtimeKey,
    dashboardToken,
    runtimeHeaders: runtimeHeaders(runtimeKey),
    dashboardHeaders: dashboardHeaders(dashboardToken),
  }
}

export async function ensurePlacementsEnabled(baseUrl, placementIds = [], dashboardAuthHeaders = {}) {
  const placementsRes = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
    headers: dashboardAuthHeaders,
  })
  if (!placementsRes.ok) {
    throw new Error(`load placements failed: HTTP_${placementsRes.status}`)
  }

  const placements = Array.isArray(placementsRes.payload?.placements)
    ? placementsRes.payload.placements
    : []

  for (const placementId of placementIds) {
    const target = placements.find((item) => String(item?.placementId || '').trim() === placementId)
    if (!target || !target.placementId) {
      throw new Error(`placement not found: ${placementId}`)
    }
    if (target.enabled === true) continue

    const updateRes = await requestJson(
      baseUrl,
      `/api/v1/dashboard/placements/${encodeURIComponent(placementId)}`,
      {
        method: 'PUT',
        headers: dashboardAuthHeaders,
        body: { enabled: true },
      },
    )

    if (!updateRes.ok) {
      throw new Error(`enable placement failed (${placementId}): HTTP_${updateRes.status}`)
    }
  }
}

function toInventoryOfferCount(statusPayload = {}) {
  const counts = Array.isArray(statusPayload?.counts) ? statusPayload.counts : []
  return counts.reduce((sum, row) => sum + toNumber(row?.offer_count ?? row?.offerCount, 0), 0)
}

export async function ensureInventoryReady(baseUrl, options = {}) {
  const inventoryPrewarm = options.inventoryPrewarm === true
  const fallbackWhenInventoryUnavailable = options.fallbackWhenInventoryUnavailable !== false
  const networks = parseInventoryNetworks(options.networks, DEFAULT_INVENTORY_NETWORKS)

  const statusRes = await requestJson(baseUrl, '/api/v1/internal/inventory/status', {
    timeoutMs: toInteger(options.statusTimeoutMs, 15000),
  })

  if (!statusRes.ok) {
    return {
      ok: false,
      fatal: true,
      code: 'INVENTORY_STATUS_FAILED',
      status: statusRes.status,
      payload: statusRes.payload,
      mode: '',
      counts: [],
      offerCount: 0,
      prewarmed: false,
      syncStatus: 0,
    }
  }

  const mode = String(statusRes.payload?.mode || '').trim().toLowerCase()
  const initialOfferCount = toInventoryOfferCount(statusRes.payload)
  const base = {
    status: statusRes.status,
    payload: statusRes.payload,
    mode,
    counts: Array.isArray(statusRes.payload?.counts) ? statusRes.payload.counts : [],
    offerCount: initialOfferCount,
    prewarmed: false,
    syncStatus: 0,
  }

  if (mode !== 'postgres') {
    if (fallbackWhenInventoryUnavailable) {
      return {
        ok: true,
        fatal: false,
        code: 'INVENTORY_NON_POSTGRES_FALLBACK',
        ...base,
      }
    }
    return {
      ok: false,
      fatal: true,
      code: 'INVENTORY_STORE_UNAVAILABLE',
      ...base,
    }
  }

  if (initialOfferCount > 0) {
    return {
      ok: true,
      fatal: false,
      code: 'INVENTORY_READY',
      ...base,
    }
  }

  if (!inventoryPrewarm) {
    return {
      ok: false,
      fatal: true,
      code: 'INVENTORY_EMPTY_PREWARM_DISABLED',
      ...base,
    }
  }

  const syncRes = await requestJson(baseUrl, '/api/v1/internal/inventory/sync', {
    method: 'POST',
    body: {
      networks,
      buildEmbeddings: true,
      materializeSnapshot: true,
    },
    timeoutMs: toInteger(options.syncTimeoutMs, 120000),
  })

  if (!syncRes.ok) {
    return {
      ok: false,
      fatal: true,
      code: 'INVENTORY_SYNC_FAILED',
      ...base,
      prewarmed: true,
      syncStatus: syncRes.status,
      syncPayload: syncRes.payload,
    }
  }

  const recheckRes = await requestJson(baseUrl, '/api/v1/internal/inventory/status', {
    timeoutMs: toInteger(options.statusTimeoutMs, 15000),
  })
  const recheckCount = recheckRes.ok ? toInventoryOfferCount(recheckRes.payload) : 0
  const recheckMode = recheckRes.ok ? String(recheckRes.payload?.mode || mode).trim().toLowerCase() : mode

  if (!recheckRes.ok || recheckMode !== 'postgres' || recheckCount <= 0) {
    return {
      ok: false,
      fatal: true,
      code: 'INVENTORY_SYNC_EMPTY',
      ...base,
      prewarmed: true,
      syncStatus: syncRes.status,
      syncPayload: syncRes.payload,
      recheckStatus: recheckRes.status,
      recheckPayload: recheckRes.payload,
    }
  }

  return {
    ok: true,
    fatal: false,
    code: 'INVENTORY_PREWARMED',
    ...base,
    offerCount: recheckCount,
    counts: Array.isArray(recheckRes.payload?.counts) ? recheckRes.payload.counts : base.counts,
    prewarmed: true,
    syncStatus: syncRes.status,
  }
}

export function createInlineEventPayload(input = {}) {
  return {
    appId: String(input.appId || 'simulator-chatbot').trim(),
    sessionId: String(input.sessionId || '').trim(),
    turnId: String(input.turnId || '').trim(),
    query: String(input.query || '').trim(),
    answerText: String(input.answerText || '').trim(),
    intentScore: clamp01(input.intentScore),
    locale: String(input.locale || 'en-US').trim() || 'en-US',
    kind: String(input.kind || 'impression').trim().toLowerCase(),
    placementId: String(input.placementId || 'chat_from_answer_v1').trim(),
    requestId: String(input.requestId || '').trim(),
    adId: String(input.adId || '').trim(),
  }
}

export function createFollowupEventPayload(input = {}) {
  return {
    appId: String(input.appId || 'simulator-chatbot').trim(),
    sessionId: String(input.sessionId || '').trim(),
    turnId: String(input.turnId || '').trim(),
    userId: String(input.userId || '').trim(),
    event: 'followup_generation',
    kind: String(input.kind || 'impression').trim().toLowerCase(),
    placementId: String(input.placementId || 'chat_intent_recommendation_v1').trim(),
    placementKey: 'next_step.intent_card',
    requestId: String(input.requestId || '').trim(),
    adId: String(input.adId || '').trim(),
    context: {
      query: String(input.query || '').trim(),
      answerText: String(input.answerText || '').trim(),
      locale: String(input.locale || 'en-US').trim() || 'en-US',
      intent_class: String(input.intentClass || 'product_exploration').trim() || 'product_exploration',
      intent_score: clamp01(input.intentScore),
      preference_facets: Array.isArray(input.preferenceFacets) ? input.preferenceFacets : [],
    },
  }
}

export function createSdkEventPayload(input = {}) {
  const placementId = String(input.placementId || '').trim()
  if (placementId === 'chat_intent_recommendation_v1') {
    return createFollowupEventPayload(input)
  }
  return createInlineEventPayload(input)
}

export function summarizeIssues(issues) {
  const rows = Array.isArray(issues) ? issues : []
  const bySeverity = { P0: 0, P1: 0, P2: 0 }
  for (const item of rows) {
    const severity = String(item?.severity || '').toUpperCase()
    if (Object.prototype.hasOwnProperty.call(bySeverity, severity)) {
      bySeverity[severity] += 1
    }
  }
  return {
    total: rows.length,
    bySeverity,
  }
}

export function computeIssueDiff(previousIssues, currentIssues) {
  const prev = Array.isArray(previousIssues) ? previousIssues : []
  const curr = Array.isArray(currentIssues) ? currentIssues : []

  const prevMap = new Map(prev.map((item) => [String(item?.fingerprint || ''), item]).filter(([key]) => key))
  const currMap = new Map(curr.map((item) => [String(item?.fingerprint || ''), item]).filter(([key]) => key))

  const newIssues = []
  const resolvedIssues = []
  for (const [key, item] of currMap.entries()) {
    if (!prevMap.has(key)) newIssues.push(item)
  }
  for (const [key, item] of prevMap.entries()) {
    if (!currMap.has(key)) resolvedIssues.push(item)
  }
  return { newIssues, resolvedIssues }
}
