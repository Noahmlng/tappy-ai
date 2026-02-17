const API_BASE = (import.meta.env.VITE_SIMULATOR_API_BASE_URL || '/api').replace(/\/+$/, '')
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
  const { timeoutMs, ...fetchOptions } = options
  const timeout = withTimeoutSignal(timeoutMs)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      signal: timeout.signal,
    })

    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = body?.error?.message || `Request failed: ${response.status}`
      throw new Error(message)
    }

    return body
  } finally {
    timeout.clear()
  }
}

export async function fetchSdkConfig(appId) {
  const normalizedAppId = String(appId || '').trim()
  if (!normalizedAppId) {
    throw new Error('appId is required')
  }

  return requestJson(`/v1/sdk/config?appId=${encodeURIComponent(normalizedAppId)}`, {
    method: 'GET',
    timeoutMs: 3000,
  })
}

function normalizeAttachPayload(payload = {}) {
  return {
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
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })
}

export async function evaluateNextStepIntentCardPlacement(payload) {
  const body = normalizeNextStepIntentCardPayload(payload)
  return requestJson('/v1/sdk/evaluate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })
}

export async function reportSdkEvent(payload) {
  const body = payload?.context ? normalizeNextStepIntentCardPayload(payload) : normalizeAttachPayload(payload)
  return requestJson('/v1/sdk/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 2500,
  })
}
