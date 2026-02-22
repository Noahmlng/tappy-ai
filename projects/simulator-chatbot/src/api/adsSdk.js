function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const API_BASE = (
  import.meta.env.VITE_SIMULATOR_API_BASE_URL ||
  import.meta.env.MEDIATION_API_BASE_URL ||
  '/api'
).replace(/\/+$/, '')
const MEDIATION_API_KEY = cleanText(
  import.meta.env.VITE_MEDIATION_API_KEY ||
  import.meta.env.MEDIATION_API_KEY ||
  ''
)
const MEDIATION_ENV = cleanText(
  import.meta.env.VITE_MEDIATION_ENV ||
  import.meta.env.MEDIATION_ENV ||
  'staging'
) || 'staging'
const DEFAULT_APP_ID = cleanText(
  import.meta.env.VITE_SIMULATOR_APP_ID ||
  import.meta.env.APP_ID ||
  'simulator-chatbot'
) || 'simulator-chatbot'
const DEFAULT_PLACEMENT_ID = cleanText(
  import.meta.env.VITE_SIMULATOR_PLACEMENT_ID ||
  import.meta.env.PLACEMENT_ID ||
  'chat_inline_v1'
) || 'chat_inline_v1'
const DEFAULT_SCHEMA_VERSION = cleanText(
  import.meta.env.VITE_MEDIATION_SCHEMA_VERSION ||
  import.meta.env.MEDIATION_SCHEMA_VERSION ||
  'schema_v1'
) || 'schema_v1'
const DEFAULT_SDK_VERSION = cleanText(
  import.meta.env.VITE_MEDIATION_SDK_VERSION ||
  import.meta.env.MEDIATION_SDK_VERSION ||
  '1.0.0'
) || '1.0.0'
const DEFAULT_TIMEOUT_MS = 4500

function withTimeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('Request timed out'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function requestJson(path, options = {}) {
  const { timeoutMs, acceptedStatuses, ...fetchOptions } = options
  const timeout = withTimeoutSignal(timeoutMs)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      signal: timeout.signal,
    })

    const body = await response.json().catch(() => ({}))
    const statusAllowed = Array.isArray(acceptedStatuses)
      ? acceptedStatuses.includes(response.status)
      : false
    if (!response.ok && !statusAllowed) {
      const message = body?.error?.message || `Request failed: ${response.status}`
      throw new Error(message)
    }

    return body
  } finally {
    timeout.clear()
  }
}

function withAuthorization(headers = {}) {
  if (!MEDIATION_API_KEY) return headers
  return {
    ...headers,
    Authorization: `Bearer ${MEDIATION_API_KEY}`,
  }
}

function normalizeMediationConfigResponse(payload = {}) {
  if (Array.isArray(payload?.placements)) return payload

  const placement = payload?.placement && typeof payload.placement === 'object'
    ? payload.placement
    : null

  if (!placement) return payload
  return {
    ...payload,
    placements: [placement],
  }
}

export async function fetchSdkConfig(appId, options = {}) {
  const normalizedAppId = String(appId || '').trim() || DEFAULT_APP_ID
  if (!normalizedAppId) {
    throw new Error('appId is required')
  }

  const placementId = String(options.placementId || DEFAULT_PLACEMENT_ID).trim() || DEFAULT_PLACEMENT_ID
  const requestAt = new Date().toISOString()
  const params = new URLSearchParams({
    appId: normalizedAppId,
    placementId,
    environment: MEDIATION_ENV,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    sdkVersion: DEFAULT_SDK_VERSION,
    requestAt,
  })

  const payload = await requestJson(`/v1/mediation/config?${params.toString()}`, {
    method: 'GET',
    headers: withAuthorization(),
    timeoutMs: 3000,
    acceptedStatuses: [200, 304],
  })
  return normalizeMediationConfigResponse(payload)
}

function normalizeAttachPayload(payload = {}) {
  return {
    requestId: String(payload.requestId || '').trim(),
    appId: String(payload.appId || '').trim(),
    sessionId: String(payload.sessionId || '').trim(),
    turnId: String(payload.turnId || '').trim(),
    query: String(payload.query || '').trim(),
    answerText: String(payload.answerText || '').trim(),
    intentScore: Number(payload.intentScore),
    locale: String(payload.locale || '').trim(),
  }
}

function normalizeNextStepIntentCardPayload(payload = {}) {
  const contextInput = payload.context && typeof payload.context === 'object' ? payload.context : {}
  const context = {
    query: String(contextInput.query || '').trim(),
    answerText: String(contextInput.answerText || '').trim(),
    locale: String(contextInput.locale || '').trim(),
    intent_class: String(contextInput.intent_class || '').trim(),
    intent_score: Number(contextInput.intent_score),
    preference_facets: Array.isArray(contextInput.preference_facets)
      ? contextInput.preference_facets
      : [],
  }

  if (Array.isArray(contextInput.recent_turns)) {
    context.recent_turns = contextInput.recent_turns
  }

  if (contextInput.constraints && typeof contextInput.constraints === 'object') {
    context.constraints = contextInput.constraints
  }

  return {
    requestId: String(payload.requestId || '').trim(),
    appId: String(payload.appId || '').trim(),
    sessionId: String(payload.sessionId || '').trim(),
    turnId: String(payload.turnId || '').trim(),
    userId: String(payload.userId || '').trim(),
    event: String(payload.event || 'followup_generation').trim(),
    placementId: String(payload.placementId || 'chat_followup_v1').trim(),
    placementKey: String(payload.placementKey || 'next_step.intent_card').trim(),
    context,
  }
}

export async function evaluateAttachPlacement(payload) {
  const body = normalizeAttachPayload(payload)
  return requestJson('/v1/sdk/evaluate', {
    method: 'POST',
    headers: withAuthorization({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(body),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })
}

export async function evaluateNextStepIntentCardPlacement(payload) {
  const body = normalizeNextStepIntentCardPayload(payload)
  return requestJson('/v1/sdk/evaluate', {
    method: 'POST',
    headers: withAuthorization({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(body),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })
}

export async function reportSdkEvent(payload) {
  const body = payload?.context ? normalizeNextStepIntentCardPayload(payload) : normalizeAttachPayload(payload)
  return requestJson('/v1/sdk/events', {
    method: 'POST',
    headers: withAuthorization({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(body),
    timeoutMs: 2500,
  })
}
