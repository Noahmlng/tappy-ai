const DEFAULT_TIMEOUT_MS = Object.freeze({
  config: 3000,
  evaluate: 20000,
  events: 2500,
})

const ATTACH_DEFAULTS = Object.freeze({
  placementId: 'chat_inline_v1',
  placementKey: 'attach.post_answer_render',
  environment: 'staging',
  schemaVersion: 'schema_v1',
  sdkVersion: '1.0.0',
})

const NEXT_STEP_DEFAULTS = Object.freeze({
  placementId: 'chat_followup_v1',
  placementKey: 'next_step.intent_card',
  environment: 'staging',
  schemaVersion: 'schema_v1',
  sdkVersion: '1.0.0',
})

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function toFiniteNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeApiBaseUrl(value) {
  const fallback = '/api'
  const input = cleanText(value)
  if (!input) return fallback
  return input.replace(/\/+$/, '')
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value)
}

function buildUrl(apiBaseUrl, pathname, query = null) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  const absoluteBase = isAbsoluteUrl(apiBaseUrl)
  const url = absoluteBase
    ? new URL(`${apiBaseUrl}${normalizedPath}`)
    : new URL(`${apiBaseUrl}${normalizedPath}`, 'http://localhost')

  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  return absoluteBase ? url.toString() : `${url.pathname}${url.search}`
}

function normalizeDecision(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const allowed = new Set(['served', 'no_fill', 'blocked', 'error'])
  const result = allowed.has(String(input.result || '').trim()) ? String(input.result) : 'error'
  const reason = allowed.has(String(input.reason || '').trim()) ? String(input.reason) : result
  const reasonDetail = cleanText(input.reasonDetail || input.reason_detail || '')
  return {
    result,
    reason,
    reasonDetail: reasonDetail || reason,
    intentScore: toFiniteNumber(input.intentScore, 0),
  }
}

function normalizeAds(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      return {
        adId: cleanText(item.adId) || `ad_${index}`,
        title: cleanText(item.title),
        description: cleanText(item.description),
        targetUrl: cleanText(item.targetUrl),
        disclosure: cleanText(item.disclosure) || 'Sponsored',
        reason: cleanText(item.reason),
        tracking: item.tracking && typeof item.tracking === 'object'
          ? { clickUrl: cleanText(item.tracking.clickUrl) }
          : {},
        sourceNetwork: cleanText(item.sourceNetwork),
        entityText: cleanText(item.entityText),
        entityType: cleanText(item.entityType),
      }
    })
    .filter((item) => item && (item.title || item.targetUrl || item.entityText))
}

function resolvePlacement(configPayload, placementId) {
  if (!configPayload || typeof configPayload !== 'object') return null

  const placements = Array.isArray(configPayload.placements)
    ? configPayload.placements
    : (configPayload.placement && typeof configPayload.placement === 'object'
      ? [configPayload.placement]
      : [])

  if (placements.length === 0) return null
  const wantedId = cleanText(placementId)
  if (!wantedId) return placements[0] || null
  return placements.find((item) => cleanText(item?.placementId) === wantedId) || null
}

function buildConfigEvidence() {
  return {
    ok: false,
    status: 0,
    latencyMs: 0,
    placementEnabled: true,
    placementId: '',
    placementKey: '',
    error: '',
  }
}

function buildEvaluateEvidence() {
  return {
    ok: false,
    status: 0,
    latencyMs: 0,
    requestId: '',
    result: 'error',
    reasonDetail: '',
    error: '',
  }
}

function buildEventsEvidence() {
  return {
    ok: false,
    status: 0,
    latencyMs: 0,
    error: '',
  }
}

async function parseResponsePayload(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (response.status === 204) return {}
  if (contentType.includes('application/json')) {
    return await response.json().catch(() => ({}))
  }
  return await response.text().catch(() => '')
}

export function createAdsSdkClient(options = {}) {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl || '/api')
  const apiKey = cleanText(options.apiKey || '')
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const timeouts = {
    config: toFiniteNumber(options.timeouts?.config, DEFAULT_TIMEOUT_MS.config) || DEFAULT_TIMEOUT_MS.config,
    evaluate: toFiniteNumber(options.timeouts?.evaluate, DEFAULT_TIMEOUT_MS.evaluate) || DEFAULT_TIMEOUT_MS.evaluate,
    events: toFiniteNumber(options.timeouts?.events, DEFAULT_TIMEOUT_MS.events) || DEFAULT_TIMEOUT_MS.events,
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('createAdsSdkClient requires a fetch implementation')
  }

  async function requestJson(pathname, req = {}) {
    const controller = new AbortController()
    const timeoutMs = Math.max(1, toFiniteNumber(req.timeoutMs, DEFAULT_TIMEOUT_MS.evaluate))
    const startedAt = Date.now()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers = {
        ...(req.headers && typeof req.headers === 'object' ? req.headers : {}),
      }
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`
      }

      const response = await fetchImpl(buildUrl(apiBaseUrl, pathname, req.query), {
        method: req.method || 'GET',
        headers,
        body: req.body,
        signal: controller.signal,
      })

      const payload = await parseResponsePayload(response)
      const latencyMs = Math.max(0, Date.now() - startedAt)
      return {
        ok: response.ok,
        status: response.status,
        payload,
        latencyMs,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function fetchConfig(input = {}) {
    const appId = cleanText(input.appId)
    if (!appId) throw new Error('fetchConfig requires appId')

    const query = {
      appId,
      placementId: cleanText(input.placementId),
      environment: cleanText(input.environment),
      schemaVersion: cleanText(input.schemaVersion),
      sdkVersion: cleanText(input.sdkVersion),
      requestAt: cleanText(input.requestAt) || new Date().toISOString(),
    }

    const response = await requestJson('/v1/mediation/config', {
      method: 'GET',
      query,
      timeoutMs: toFiniteNumber(input.timeoutMs, timeouts.config),
    })

    if (!response.ok && response.status !== 304) {
      const message = response?.payload?.error?.message || `config_failed:${response.status}`
      const error = new Error(message)
      error.status = response.status
      error.payload = response.payload
      throw error
    }
    return response
  }

  async function evaluate(payload, options = {}) {
    const body = JSON.stringify(payload && typeof payload === 'object' ? payload : {})
    const response = await requestJson('/v1/sdk/evaluate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      timeoutMs: toFiniteNumber(options.timeoutMs, timeouts.evaluate),
    })
    if (!response.ok) {
      const message = response?.payload?.error?.message || `evaluate_failed:${response.status}`
      const error = new Error(message)
      error.status = response.status
      error.payload = response.payload
      throw error
    }
    return response
  }

  async function reportEvent(payload, options = {}) {
    const body = JSON.stringify(payload && typeof payload === 'object' ? payload : {})
    const response = await requestJson('/v1/sdk/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      timeoutMs: toFiniteNumber(options.timeoutMs, timeouts.events),
    })
    if (!response.ok) {
      const message = response?.payload?.error?.message || `events_failed:${response.status}`
      const error = new Error(message)
      error.status = response.status
      error.payload = response.payload
      throw error
    }
    return response
  }

  function buildDefaultFlowResult(placementId, placementKey) {
    return {
      failOpenApplied: false,
      skipped: false,
      skipReason: '',
      requestId: '',
      placementId: cleanText(placementId),
      placementKey: cleanText(placementKey),
      decision: normalizeDecision({
        result: 'error',
        reason: 'error',
        reasonDetail: 'sdk_flow_not_executed',
        intentScore: 0,
      }),
      ads: [],
      evidence: {
        config: buildConfigEvidence(),
        evaluate: buildEvaluateEvidence(),
        events: buildEventsEvidence(),
      },
      error: '',
    }
  }

  async function runManagedFlow(input = {}) {
    const appId = cleanText(input.appId)
    const placementId = cleanText(input.placementId)
    const placementKey = cleanText(input.placementKey)
    const environment = cleanText(input.environment)
    const schemaVersion = cleanText(input.schemaVersion)
    const sdkVersion = cleanText(input.sdkVersion)
    const configTimeoutMs = toFiniteNumber(input.configTimeoutMs, timeouts.config)
    const evaluateTimeoutMs = toFiniteNumber(input.evaluateTimeoutMs, timeouts.evaluate)
    const eventsTimeoutMs = toFiniteNumber(input.eventsTimeoutMs, timeouts.events)

    const flow = buildDefaultFlowResult(placementId, placementKey)

    const configInput = {
      appId,
      placementId,
      environment,
      schemaVersion,
      sdkVersion,
      requestAt: cleanText(input.requestAt) || new Date().toISOString(),
      timeoutMs: configTimeoutMs,
    }

    try {
      const configResponse = await fetchConfig(configInput)
      const placement = resolvePlacement(configResponse.payload, placementId)
      flow.evidence.config = {
        ok: true,
        status: configResponse.status,
        latencyMs: configResponse.latencyMs,
        placementEnabled: placement ? placement.enabled !== false : true,
        placementId: cleanText(placement?.placementId || placementId),
        placementKey: cleanText(placement?.placementKey || placementKey),
        error: '',
      }

      if (flow.evidence.config.placementId) {
        flow.placementId = flow.evidence.config.placementId
      }
      if (flow.evidence.config.placementKey) {
        flow.placementKey = flow.evidence.config.placementKey
      }

      if (flow.evidence.config.placementEnabled === false) {
        flow.skipped = true
        flow.skipReason = 'placement_disabled'
        flow.decision = normalizeDecision({
          result: 'blocked',
          reason: 'blocked',
          reasonDetail: 'placement_disabled',
          intentScore: toFiniteNumber(input.intentScore, 0),
        })
        return flow
      }
    } catch (error) {
      flow.failOpenApplied = true
      flow.error = error instanceof Error ? error.message : 'config_failed'
      flow.evidence.config = {
        ...buildConfigEvidence(),
        ok: false,
        error: flow.error,
      }
      flow.decision = normalizeDecision({
        result: 'error',
        reason: 'error',
        reasonDetail: 'config_fetch_failed',
        intentScore: toFiniteNumber(input.intentScore, 0),
      })
      return flow
    }

    const evaluatePayload = input.evaluatePayload && typeof input.evaluatePayload === 'object'
      ? input.evaluatePayload
      : null
    if (!evaluatePayload) {
      flow.failOpenApplied = true
      flow.error = 'missing_evaluate_payload'
      flow.decision = normalizeDecision({
        result: 'error',
        reason: 'error',
        reasonDetail: 'missing_evaluate_payload',
        intentScore: toFiniteNumber(input.intentScore, 0),
      })
      return flow
    }

    let evaluateResponse = null
    try {
      evaluateResponse = await evaluate(evaluatePayload, { timeoutMs: evaluateTimeoutMs })
      const payload = evaluateResponse.payload && typeof evaluateResponse.payload === 'object'
        ? evaluateResponse.payload
        : {}
      flow.requestId = cleanText(payload.requestId)
      flow.placementId = cleanText(payload.placementId || flow.placementId)
      flow.decision = normalizeDecision(payload.decision)
      flow.ads = normalizeAds(payload.ads)
      flow.evidence.evaluate = {
        ok: true,
        status: evaluateResponse.status,
        latencyMs: evaluateResponse.latencyMs,
        requestId: flow.requestId,
        result: flow.decision.result,
        reasonDetail: flow.decision.reasonDetail,
        error: '',
      }
    } catch (error) {
      flow.failOpenApplied = true
      flow.error = error instanceof Error ? error.message : 'evaluate_failed'
      flow.evidence.evaluate = {
        ...buildEvaluateEvidence(),
        ok: false,
        error: flow.error,
      }
      flow.decision = normalizeDecision({
        result: 'error',
        reason: 'error',
        reasonDetail: 'evaluate_failed',
        intentScore: toFiniteNumber(input.intentScore, 0),
      })
      return flow
    }

    const eventPayload = input.eventPayloadFactory && typeof input.eventPayloadFactory === 'function'
      ? input.eventPayloadFactory({
        requestId: flow.requestId,
        evaluatePayload,
        evaluateResponse: evaluateResponse?.payload || {},
        decision: flow.decision,
        ads: flow.ads,
      })
      : null

    if (!eventPayload || typeof eventPayload !== 'object') {
      flow.evidence.events = {
        ...buildEventsEvidence(),
        ok: false,
        error: 'event_payload_missing',
      }
      flow.failOpenApplied = true
      return flow
    }

    try {
      const eventsResponse = await reportEvent(eventPayload, { timeoutMs: eventsTimeoutMs })
      flow.evidence.events = {
        ok: true,
        status: eventsResponse.status,
        latencyMs: eventsResponse.latencyMs,
        error: '',
      }
      return flow
    } catch (error) {
      flow.failOpenApplied = true
      flow.evidence.events = {
        ...buildEventsEvidence(),
        ok: false,
        error: error instanceof Error ? error.message : 'events_failed',
      }
      return flow
    }
  }

  async function runAttachFlow(input = {}) {
    const appId = cleanText(input.appId)
    const placementId = cleanText(input.placementId || ATTACH_DEFAULTS.placementId) || ATTACH_DEFAULTS.placementId
    const placementKey = cleanText(input.placementKey || ATTACH_DEFAULTS.placementKey) || ATTACH_DEFAULTS.placementKey
    const evaluatePayload = {
      appId,
      sessionId: cleanText(input.sessionId),
      turnId: cleanText(input.turnId),
      query: cleanText(input.query),
      answerText: cleanText(input.answerText),
      intentScore: toFiniteNumber(input.intentScore, 0),
      locale: cleanText(input.locale) || 'en-US',
    }

    return runManagedFlow({
      appId,
      placementId,
      placementKey,
      environment: cleanText(input.environment || ATTACH_DEFAULTS.environment) || ATTACH_DEFAULTS.environment,
      schemaVersion: cleanText(input.schemaVersion || ATTACH_DEFAULTS.schemaVersion) || ATTACH_DEFAULTS.schemaVersion,
      sdkVersion: cleanText(input.sdkVersion || ATTACH_DEFAULTS.sdkVersion) || ATTACH_DEFAULTS.sdkVersion,
      requestAt: cleanText(input.requestAt) || new Date().toISOString(),
      evaluatePayload,
      intentScore: evaluatePayload.intentScore,
      eventPayloadFactory: ({ requestId }) => ({
        ...evaluatePayload,
        requestId,
      }),
      configTimeoutMs: input.configTimeoutMs,
      evaluateTimeoutMs: input.evaluateTimeoutMs,
      eventsTimeoutMs: input.eventsTimeoutMs,
    })
  }

  async function runNextStepFlow(input = {}) {
    const appId = cleanText(input.appId)
    const placementId = cleanText(input.placementId || NEXT_STEP_DEFAULTS.placementId) || NEXT_STEP_DEFAULTS.placementId
    const placementKey = cleanText(input.placementKey || NEXT_STEP_DEFAULTS.placementKey) || NEXT_STEP_DEFAULTS.placementKey
    const contextInput = input.context && typeof input.context === 'object' ? input.context : {}

    const context = {
      query: cleanText(contextInput.query),
      answerText: cleanText(contextInput.answerText),
      locale: cleanText(contextInput.locale) || 'en-US',
      intent_class: cleanText(contextInput.intent_class),
      intent_score: toFiniteNumber(contextInput.intent_score, 0),
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

    const evaluatePayload = {
      appId,
      sessionId: cleanText(input.sessionId),
      turnId: cleanText(input.turnId),
      userId: cleanText(input.userId),
      event: cleanText(input.event || 'followup_generation') || 'followup_generation',
      placementId,
      placementKey,
      context,
    }

    return runManagedFlow({
      appId,
      placementId,
      placementKey,
      environment: cleanText(input.environment || NEXT_STEP_DEFAULTS.environment) || NEXT_STEP_DEFAULTS.environment,
      schemaVersion: cleanText(input.schemaVersion || NEXT_STEP_DEFAULTS.schemaVersion) || NEXT_STEP_DEFAULTS.schemaVersion,
      sdkVersion: cleanText(input.sdkVersion || NEXT_STEP_DEFAULTS.sdkVersion) || NEXT_STEP_DEFAULTS.sdkVersion,
      requestAt: cleanText(input.requestAt) || new Date().toISOString(),
      evaluatePayload,
      intentScore: context.intent_score,
      eventPayloadFactory: ({ requestId }) => ({
        ...evaluatePayload,
        requestId,
      }),
      configTimeoutMs: input.configTimeoutMs,
      evaluateTimeoutMs: input.evaluateTimeoutMs,
      eventsTimeoutMs: input.eventsTimeoutMs,
    })
  }

  return {
    fetchConfig,
    evaluate,
    reportEvent,
    runManagedFlow,
    runAttachFlow,
    runNextStepFlow,
  }
}
