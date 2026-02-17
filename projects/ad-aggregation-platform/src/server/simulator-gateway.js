import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

import defaultPlacements from '../../config/default-placements.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const STATE_DIR = path.join(PROJECT_ROOT, '.local')
const STATE_FILE = path.join(STATE_DIR, 'simulator-gateway-state.json')

const PORT = Number(process.env.SIMULATOR_GATEWAY_PORT || 3100)
const HOST = process.env.SIMULATOR_GATEWAY_HOST || '127.0.0.1'
const MAX_DECISION_LOGS = 500

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
const ATTACH_MVP_ALLOWED_FIELDS = new Set([
  'appId',
  'sessionId',
  'turnId',
  'query',
  'answerText',
  'intentScore',
  'locale',
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

function normalizeDisclosure(value) {
  const text = String(value || '').trim()
  if (text === 'Ad' || text === 'Sponsored') return text
  return 'Sponsored'
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

function normalizeAttachMvpPayload(payload, routeName) {
  const input = payload && typeof payload === 'object' ? payload : {}
  validateNoExtraFields(input, ATTACH_MVP_ALLOWED_FIELDS, routeName)

  const appId = requiredNonEmptyString(input.appId, 'appId')
  const sessionId = requiredNonEmptyString(input.sessionId, 'sessionId')
  const turnId = requiredNonEmptyString(input.turnId, 'turnId')
  const query = requiredNonEmptyString(input.query, 'query')
  const answerText = requiredNonEmptyString(input.answerText, 'answerText')
  const locale = requiredNonEmptyString(input.locale, 'locale')
  const intentScore = clampNumber(input.intentScore, 0, 1, NaN)

  if (!Number.isFinite(intentScore)) {
    throw new Error('intentScore is required and must be a number between 0 and 1.')
  }

  return {
    appId,
    sessionId,
    turnId,
    query,
    answerText,
    intentScore,
    locale,
  }
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
    enabled: raw?.enabled !== false,
    disclosure: normalizeDisclosure(raw?.disclosure),
    priority: toPositiveInteger(raw?.priority, 100),
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

  return {
    version: 1,
    updatedAt: nowIso(),
    placements,
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
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      placements,
      decisionLogs: Array.isArray(parsed.decisionLogs) ? parsed.decisionLogs.slice(0, MAX_DECISION_LOGS) : [],
      eventLogs: Array.isArray(parsed.eventLogs) ? parsed.eventLogs.slice(0, MAX_DECISION_LOGS) : [],
      globalStats: {
        requests: toPositiveInteger(parsed?.globalStats?.requests, 0),
        served: toPositiveInteger(parsed?.globalStats?.served, 0),
        impressions: toPositiveInteger(parsed?.globalStats?.impressions, 0),
        clicks: toPositiveInteger(parsed?.globalStats?.clicks, 0),
        revenueUsd: clampNumber(parsed?.globalStats?.revenueUsd, 0, Number.MAX_SAFE_INTEGER, 0),
      },
      placementStats,
      dailyMetrics: ensureDailyMetricsWindow(parsed.dailyMetrics),
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

const state = loadState()

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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

function recordBlockedOrNoFill(placement) {
  const placementStats = ensurePlacementStats(placement.placementId)
  state.globalStats.requests += 1
  placementStats.requests += 1
}

function buildMockAd(placement, request, intentScore) {
  const query = String(request?.context?.query || '').trim()
  const label = query ? query.slice(0, 36) : 'recommended offer'

  return {
    adId: createId('ad'),
    title: `Sponsored: ${label}`,
    description: `Matched for ${placement.placementKey || placement.placementId} (intent ${intentScore.toFixed(2)}).`,
    targetUrl: `https://example.com/offer?placement=${encodeURIComponent(placement.placementId)}`,
    disclosure: placement.disclosure,
    reason: 'simulator_match',
    tracking: {
      impressionUrl: `https://tracking.example.com/impression/${encodeURIComponent(placement.placementId)}`,
      clickUrl: `https://tracking.example.com/click/${encodeURIComponent(placement.placementId)}`,
    },
    sourceNetwork: 'simulator',
    entityText: query || 'general',
    entityType: 'service',
  }
}

function matchBlockedTopic(context, blockedTopics) {
  if (!blockedTopics.length) return ''
  const corpus = `${String(context?.query || '')} ${String(context?.answerText || '')}`.toLowerCase()
  for (const topic of blockedTopics) {
    if (corpus.includes(topic)) return topic
  }
  return ''
}

function evaluateRequest(payload) {
  const request = payload && typeof payload === 'object' ? payload : {}
  const context = request.context && typeof request.context === 'object' ? request.context : {}
  const intentScore = clampNumber(context.intentScore, 0, 1, 0)

  const placement = pickPlacementForRequest(request)
  const requestId = createId('adreq')

  if (!placement) {
    return {
      requestId,
      placementId: '',
      decision: {
        result: 'blocked',
        reason: 'placement_not_configured',
        intentScore,
      },
      ads: [],
    }
  }

  if (!placement.enabled) {
    recordBlockedOrNoFill(placement)
    recordDecision({
      requestId,
      appId: request.appId || '',
      sessionId: request.sessionId || '',
      turnId: request.turnId || '',
      event: request.event || '',
      placementId: placement.placementId,
      result: 'blocked',
      reason: 'placement_disabled',
      intentScore,
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision: {
        result: 'blocked',
        reason: 'placement_disabled',
        intentScore,
      },
      ads: [],
    }
  }

  const blockedTopic = matchBlockedTopic(context, placement.trigger.blockedTopics || [])
  if (blockedTopic) {
    recordBlockedOrNoFill(placement)
    recordDecision({
      requestId,
      appId: request.appId || '',
      sessionId: request.sessionId || '',
      turnId: request.turnId || '',
      event: request.event || '',
      placementId: placement.placementId,
      result: 'blocked',
      reason: `blocked_topic:${blockedTopic}`,
      intentScore,
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision: {
        result: 'blocked',
        reason: `blocked_topic:${blockedTopic}`,
        intentScore,
      },
      ads: [],
    }
  }

  if (intentScore < placement.trigger.intentThreshold) {
    recordBlockedOrNoFill(placement)
    recordDecision({
      requestId,
      appId: request.appId || '',
      sessionId: request.sessionId || '',
      turnId: request.turnId || '',
      event: request.event || '',
      placementId: placement.placementId,
      result: 'blocked',
      reason: 'intent_below_threshold',
      intentScore,
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision: {
        result: 'blocked',
        reason: 'intent_below_threshold',
        intentScore,
      },
      ads: [],
    }
  }

  const sessionId = String(request.sessionId || '').trim()
  const userId = String(request.userId || '').trim()

  if (placement.trigger.cooldownSeconds > 0 && sessionId) {
    const cooldownKey = getSessionPlacementKey(sessionId, placement.placementId)
    const lastTs = runtimeMemory.cooldownBySessionPlacement.get(cooldownKey) || 0
    const withinCooldown = Date.now() - lastTs < placement.trigger.cooldownSeconds * 1000
    if (withinCooldown) {
      recordBlockedOrNoFill(placement)
      recordDecision({
        requestId,
        appId: request.appId || '',
        sessionId,
        turnId: request.turnId || '',
        event: request.event || '',
        placementId: placement.placementId,
        result: 'blocked',
        reason: 'cooldown',
        intentScore,
      })
      persistState(state)
      return {
        requestId,
        placementId: placement.placementId,
        decision: {
          result: 'blocked',
          reason: 'cooldown',
          intentScore,
        },
        ads: [],
      }
    }
  }

  if (placement.frequencyCap.maxPerSession > 0 && sessionId) {
    const sessionCapKey = getSessionPlacementKey(sessionId, placement.placementId)
    const count = runtimeMemory.perSessionPlacementCount.get(sessionCapKey) || 0
    if (count >= placement.frequencyCap.maxPerSession) {
      recordBlockedOrNoFill(placement)
      recordDecision({
        requestId,
        appId: request.appId || '',
        sessionId,
        turnId: request.turnId || '',
        event: request.event || '',
        placementId: placement.placementId,
        result: 'blocked',
        reason: 'frequency_cap_session',
        intentScore,
      })
      persistState(state)
      return {
        requestId,
        placementId: placement.placementId,
        decision: {
          result: 'blocked',
          reason: 'frequency_cap_session',
          intentScore,
        },
        ads: [],
      }
    }
  }

  if (placement.frequencyCap.maxPerUserPerDay > 0 && userId) {
    const userCapKey = getUserPlacementDayKey(userId, placement.placementId)
    const count = runtimeMemory.perUserPlacementDayCount.get(userCapKey) || 0
    if (count >= placement.frequencyCap.maxPerUserPerDay) {
      recordBlockedOrNoFill(placement)
      recordDecision({
        requestId,
        appId: request.appId || '',
        sessionId,
        turnId: request.turnId || '',
        event: request.event || '',
        placementId: placement.placementId,
        result: 'blocked',
        reason: 'frequency_cap_user_day',
        intentScore,
      })
      persistState(state)
      return {
        requestId,
        placementId: placement.placementId,
        decision: {
          result: 'blocked',
          reason: 'frequency_cap_user_day',
          intentScore,
        },
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
    recordBlockedOrNoFill(placement)
    recordDecision({
      requestId,
      appId: request.appId || '',
      sessionId,
      turnId: request.turnId || '',
      event: request.event || '',
      placementId: placement.placementId,
      result: 'no_fill',
      reason: 'revenue_below_min',
      intentScore,
    })
    persistState(state)
    return {
      requestId,
      placementId: placement.placementId,
      decision: {
        result: 'no_fill',
        reason: 'revenue_below_min',
        intentScore,
      },
      ads: [],
    }
  }

  const serveRevenue = round(0.03 + intentScore * 0.07, 4)
  recordServeCounters(placement, request, serveRevenue)

  const ads = [buildMockAd(placement, request, intentScore)]
  recordDecision({
    requestId,
    appId: request.appId || '',
    sessionId,
    turnId: request.turnId || '',
    event: request.event || '',
    placementId: placement.placementId,
    result: 'served',
    reason: 'eligible',
    intentScore,
  })

  persistState(state)

  return {
    requestId,
    placementId: placement.placementId,
    decision: {
      result: 'served',
      reason: 'eligible',
      intentScore,
    },
    ads,
  }
}

function applyPlacementPatch(placement, patch) {
  const next = normalizePlacement({
    ...placement,
    ...patch,
    trigger: {
      ...placement.trigger,
      ...(patch?.trigger && typeof patch.trigger === 'object' ? patch.trigger : {}),
    },
    frequencyCap: {
      ...placement.frequencyCap,
      ...(patch?.frequencyCap && typeof patch.frequencyCap === 'object' ? patch.frequencyCap : {}),
    },
  })

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
  return {
    metricsSummary: computeMetricsSummary(),
    metricsByDay: computeMetricsByDay(),
    metricsByPlacement: computeMetricsByPlacement(),
    placements: state.placements,
    decisionLogs: state.decisionLogs,
  }
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

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'simulator-gateway',
      updatedAt: state.updatedAt,
      now: nowIso(),
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
      applyPlacementPatch(target, payload)
      persistState(state)

      sendJson(res, 200, {
        placement: target,
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

    let rows = [...state.decisionLogs]

    if (result) {
      rows = rows.filter((row) => row.result === result)
    }

    if (placementId) {
      rows = rows.filter((row) => row.placementId === placementId)
    }

    sendJson(res, 200, { items: rows })
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

  if (pathname === '/api/v1/sdk/evaluate' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const request = normalizeAttachMvpPayload(payload, 'sdk/evaluate')
      const result = evaluateRequest({
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
      const request = normalizeAttachMvpPayload(payload, 'sdk/events')

      state.eventLogs = [
        {
          id: createId('event'),
          createdAt: nowIso(),
          appId: request.appId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          query: request.query,
          answerText: request.answerText,
          intentScore: request.intentScore,
          locale: request.locale,
          event: ATTACH_MVP_EVENT,
          placementKey: ATTACH_MVP_PLACEMENT_KEY,
        },
        ...state.eventLogs,
      ].slice(0, MAX_DECISION_LOGS)

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
