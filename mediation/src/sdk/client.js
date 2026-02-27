const DEFAULT_TIMEOUT_MS = Object.freeze({
  config: 1200,
  bid: 1200,
  events: 800,
})

const ATTACH_DEFAULTS = Object.freeze({
  placementId: 'chat_from_answer_v1',
  placementKey: 'attach.post_answer_render',
  environment: 'prod',
  schemaVersion: 'schema_v1',
  sdkVersion: '1.0.0',
})

const NEXT_STEP_DEFAULTS = Object.freeze({
  placementId: 'chat_intent_recommendation_v1',
  placementKey: 'next_step.intent_card',
  environment: 'prod',
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

function isPromiseLike(value) {
  return Boolean(value && typeof value.then === 'function')
}

function isTimeoutLikeError(error) {
  if (!error || typeof error !== 'object') return false
  if (error.name === 'AbortError') return true
  const message = String(error.message || '').toLowerCase()
  return message.includes('timeout') || message.includes('timed out') || message.includes('abort')
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    const asNumber = Number(value)
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber
  }
  return 0
}

function classifyBidProbeStatus(flow) {
  const evaluateEvidence = flow?.evidence?.evaluate && typeof flow.evidence.evaluate === 'object'
    ? flow.evidence.evaluate
    : {}
  if (evaluateEvidence.ok === true) return 'seen'
  if (evaluateEvidence.ok === false) {
    const errorHint = String(evaluateEvidence.error || '').toLowerCase()
    if (errorHint.includes('timeout') || errorHint.includes('timed out') || errorHint.includes('abort')) {
      return 'timeout'
    }
    return 'seen'
  }
  const timeoutHint = String(
    evaluateEvidence.error
    || flow?.error
    || flow?.decision?.reasonDetail
    || '',
  ).toLowerCase()
  if (timeoutHint.includes('timeout') || timeoutHint.includes('timed out') || timeoutHint.includes('abort')) {
    return 'timeout'
  }
  return 'not_started_before_case_end'
}

function classifyOutcomeCategory(flow, bidProbeStatus, diagnostics) {
  const decisionResult = cleanText(flow?.decision?.result).toLowerCase()
  const hasAd = Array.isArray(flow?.ads) && flow.ads.length > 0
  if (decisionResult === 'served' && hasAd) {
    return diagnostics?.timestamps?.uiRenderTs ? 'ui_fill' : 'bid_fill_only'
  }
  if (decisionResult === 'no_fill') {
    return bidProbeStatus === 'timeout' ? 'pre_bid_timeout' : 'no_fill_confirmed'
  }
  if (decisionResult === 'error') {
    return bidProbeStatus === 'timeout' ? 'pre_bid_timeout' : 'other_error'
  }
  return 'other_error'
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

function normalizeBidMessages(messages) {
  if (!Array.isArray(messages)) return []
  const allowedRoles = new Set(['user', 'assistant', 'system'])
  return messages
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const role = cleanText(String(item.role || '').toLowerCase())
      const content = cleanText(item.content)
      const timestamp = cleanText(item.timestamp)
      if (!allowedRoles.has(role) || !content) return null
      return {
        role,
        content,
        ...(timestamp ? { timestamp } : {}),
      }
    })
    .filter(Boolean)
}

function deriveSignalsFromMessages(messages = []) {
  const normalized = normalizeBidMessages(messages)
  let query = ''
  let answerText = ''
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const row = normalized[index]
    if (!query && row.role === 'user') query = row.content
    if (!answerText && row.role === 'assistant') answerText = row.content
    if (query && answerText) break
  }
  return {
    normalized,
    query,
    answerText,
    recentTurns: normalized.slice(-8),
  }
}

function normalizeV2BidResponse(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const bid = input?.data?.bid && typeof input.data.bid === 'object'
    ? input.data.bid
    : null

  return {
    requestId: cleanText(input.requestId),
    timestamp: cleanText(input.timestamp),
    status: cleanText(input.status || 'success') || 'success',
    message: cleanText(input.message || (bid ? 'Bid successful' : 'No bid')),
    data: {
      bid: bid
        ? {
            price: toFiniteNumber(bid.price, 0),
            advertiser: cleanText(bid.advertiser),
            headline: cleanText(bid.headline),
            description: cleanText(bid.description),
            cta_text: cleanText(bid.cta_text || bid.ctaText),
            url: cleanText(bid.url),
            image_url: cleanText(bid.image_url || bid.imageUrl),
            dsp: cleanText(bid.dsp),
            bidId: cleanText(bid.bidId),
            placement: cleanText(bid.placement),
            variant: cleanText(bid.variant),
          }
        : null,
    },
  }
}

function normalizeAds(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const adId = cleanText(item.adId || item.item_id || item.itemId) || `ad_${index}`
      const targetUrl = cleanText(item.targetUrl || item.target_url)
      return {
        adId,
        itemId: adId,
        title: cleanText(item.title),
        description: cleanText(item.description || item.snippet),
        targetUrl,
        disclosure: cleanText(item.disclosure) || 'Sponsored',
        reason: cleanText(item.reason),
        tracking: item.tracking && typeof item.tracking === 'object'
          ? {
              clickUrl: cleanText(item.tracking.clickUrl || item.tracking.click_url) || targetUrl,
            }
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
    skipped: false,
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
    bid: toFiniteNumber(options.timeouts?.bid, DEFAULT_TIMEOUT_MS.bid) || DEFAULT_TIMEOUT_MS.bid,
    events: toFiniteNumber(options.timeouts?.events, DEFAULT_TIMEOUT_MS.events) || DEFAULT_TIMEOUT_MS.events,
  }
  const defaultFastPath = options.fastPath !== false
  const defaultOnDiagnostics = typeof options.onDiagnostics === 'function'
    ? options.onDiagnostics
    : null

  if (typeof fetchImpl !== 'function') {
    throw new Error('createAdsSdkClient requires a fetch implementation')
  }

  async function requestJson(pathname, req = {}) {
    const startedAt = Date.now()
    const timeoutMs = Math.max(1, toFiniteNumber(req.timeoutMs, DEFAULT_TIMEOUT_MS.bid))

    async function executeRequest(includeAuthorization) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const headers = {
          ...(req.headers && typeof req.headers === 'object' ? req.headers : {}),
        }
        if (includeAuthorization && apiKey) {
          headers.Authorization = `Bearer ${apiKey}`
        }

        const response = await fetchImpl(buildUrl(apiBaseUrl, pathname, req.query), {
          method: req.method || 'GET',
          headers,
          body: req.body,
          signal: controller.signal,
        })

        const payload = await parseResponsePayload(response)
        return {
          ok: response.ok,
          status: response.status,
          payload,
        }
      } finally {
        clearTimeout(timer)
      }
    }

    const result = await executeRequest(Boolean(apiKey))

    return {
      ...result,
      latencyMs: Math.max(0, Date.now() - startedAt),
    }
  }

  async function fetchConfig(input = {}) {
    const appId = cleanText(input.appId)

    const query = {
      placementId: cleanText(input.placementId),
      environment: cleanText(input.environment),
      schemaVersion: cleanText(input.schemaVersion),
      sdkVersion: cleanText(input.sdkVersion),
      requestAt: cleanText(input.requestAt) || new Date().toISOString(),
    }
    if (appId) {
      query.appId = appId
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

  async function requestBid(input = {}, reqOptions = {}) {
    const userId = cleanText(input.userId)
    const chatId = cleanText(input.chatId)
    const placementId = cleanText(input.placementId)
    const messageSignals = deriveSignalsFromMessages(input.messages)

    if (!userId) {
      throw new Error('requestBid requires userId')
    }
    if (!chatId) {
      throw new Error('requestBid requires chatId')
    }
    if (!placementId) {
      throw new Error('requestBid requires placementId')
    }
    if (messageSignals.normalized.length === 0) {
      throw new Error('requestBid requires at least one valid message')
    }

    const payload = {
      userId,
      chatId,
      placementId,
      messages: messageSignals.normalized,
    }

    const response = await requestJson('/v2/bid', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeoutMs: toFiniteNumber(reqOptions.timeoutMs, timeouts.bid),
    })

    if (!response.ok) {
      const message = response?.payload?.error?.message || `bid_failed:${response.status}`
      const error = new Error(message)
      error.status = response.status
      error.payload = response.payload
      throw error
    }

    return {
      ...normalizeV2BidResponse(response.payload),
      _sdkSignals: {
        query: messageSignals.query,
        answerText: messageSignals.answerText,
        recentTurns: messageSignals.recentTurns,
      },
      evidence: {
        latencyMs: response.latencyMs,
        status: response.status,
      },
    }
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

  function normalizeFlowAdsFromBid(bid) {
    if (!bid || typeof bid !== 'object') return []
    const adId = cleanText(bid.bidId || bid.item_id || bid.itemId)
    const targetUrl = cleanText(bid.url)
    if (!adId || !targetUrl) return []
    return [
      {
        adId,
        itemId: adId,
        title: cleanText(bid.headline),
        description: cleanText(bid.description),
        targetUrl,
        disclosure: 'Sponsored',
        reason: cleanText(bid.dsp),
        tracking: {
          clickUrl: targetUrl,
        },
        sourceNetwork: cleanText(bid.dsp),
      },
    ]
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
    const bidTimeoutMs = toFiniteNumber(
      input.bidTimeoutMs,
      toFiniteNumber(input.evaluateTimeoutMs, timeouts.bid),
    )
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

    const rawBidPayload = input.bidPayload && typeof input.bidPayload === 'object'
      ? input.bidPayload
      : null
    if (!rawBidPayload) {
      flow.failOpenApplied = true
      flow.error = 'missing_bid_payload'
      flow.decision = normalizeDecision({
        result: 'error',
        reason: 'error',
        reasonDetail: 'missing_bid_payload',
        intentScore: toFiniteNumber(input.intentScore, 0),
      })
      return flow
    }

    const bidPayload = {
      userId: cleanText(rawBidPayload.userId || input.userId || input.sessionId),
      chatId: cleanText(rawBidPayload.chatId || input.chatId || input.sessionId),
      placementId: cleanText(rawBidPayload.placementId || flow.placementId || placementId),
      messages: Array.isArray(rawBidPayload.messages) ? rawBidPayload.messages : [],
    }

    if (bidPayload.messages.length === 0 && Array.isArray(input.messages)) {
      bidPayload.messages = input.messages
    }
    if (bidPayload.messages.length === 0) {
      const query = cleanText(rawBidPayload.query || input.query)
      const answerText = cleanText(rawBidPayload.answerText || input.answerText)
      const fallbackMessages = []
      if (query) fallbackMessages.push({ role: 'user', content: query })
      if (answerText) fallbackMessages.push({ role: 'assistant', content: answerText })
      bidPayload.messages = fallbackMessages
    }

    const evaluatePayload = input.evaluatePayload && typeof input.evaluatePayload === 'object'
      ? input.evaluatePayload
      : null
    let bidResponse = null
    try {
      bidResponse = await requestBid(bidPayload, { timeoutMs: bidTimeoutMs })
      const winnerBid = bidResponse?.data?.bid && typeof bidResponse.data.bid === 'object'
        ? bidResponse.data.bid
        : null
      flow.requestId = cleanText(bidResponse?.requestId)
      flow.placementId = cleanText(bidPayload.placementId || flow.placementId)
      flow.decision = normalizeDecision(winnerBid
        ? {
          result: 'served',
          reason: 'served',
          reasonDetail: 'v2_bid_served',
          intentScore: toFiniteNumber(input.intentScore, 0),
        }
        : {
          result: 'no_fill',
          reason: 'no_fill',
          reasonDetail: 'v2_bid_no_fill',
          intentScore: toFiniteNumber(input.intentScore, 0),
        })
      flow.ads = winnerBid ? normalizeFlowAdsFromBid(winnerBid) : []
      flow.evidence.evaluate = {
        ok: true,
        status: toFiniteNumber(bidResponse?.evidence?.status, 200),
        latencyMs: toFiniteNumber(bidResponse?.evidence?.latencyMs, 0),
        requestId: flow.requestId,
        result: flow.decision.result,
        reasonDetail: flow.decision.reasonDetail,
        error: '',
      }
    } catch (error) {
      flow.failOpenApplied = true
      flow.error = error instanceof Error ? error.message : 'bid_failed'
      flow.evidence.evaluate = {
        ...buildEvaluateEvidence(),
        ok: false,
        error: flow.error,
      }
      const failOpenOnBidError = input.failOpenOnBidError !== false
      flow.decision = normalizeDecision(failOpenOnBidError
        ? {
          result: 'no_fill',
          reason: 'no_fill',
          reasonDetail: isTimeoutLikeError(error) ? 'bid_timeout_fail_open' : 'bid_error_fail_open',
          intentScore: toFiniteNumber(input.intentScore, 0),
        }
        : {
          result: 'error',
          reason: 'error',
          reasonDetail: 'bid_failed',
          intentScore: toFiniteNumber(input.intentScore, 0),
        })
      return flow
    }

    const eventFactoryInput = {
      requestId: flow.requestId,
      bidPayload,
      bidResponse,
      evaluatePayload: evaluatePayload || bidPayload,
      evaluateResponse: {
        requestId: flow.requestId,
        decision: flow.decision,
        ads: flow.ads,
        data: bidResponse?.data || {},
      },
      decision: flow.decision,
      ads: flow.ads,
    }

    const eventPayload = input.eventPayloadFactory && typeof input.eventPayloadFactory === 'function'
      ? input.eventPayloadFactory(eventFactoryInput)
      : null

    if (eventPayload === null || eventPayload === undefined) {
      flow.evidence.events = {
        ...buildEventsEvidence(),
        ok: true,
        status: 204,
        skipped: true,
      }
      return flow
    }

    if (typeof eventPayload !== 'object') {
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
        skipped: false,
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

  async function runChatTurnWithAd(input = {}) {
    const clickTs = toTimestamp(input.clickTs) || Date.now()
    const fastPath = typeof input.fastPath === 'boolean'
      ? input.fastPath
      : defaultFastPath !== false
    const chatDonePromise = isPromiseLike(input.chatDonePromise) ? input.chatDonePromise : null
    const diagnostics = {
      fastPath,
      bidProbeStatus: 'not_started_before_case_end',
      outcomeCategory: 'other_error',
      timestamps: {
        clickTs,
        bidStartTs: 0,
        bidEndTs: 0,
        uiRenderTs: 0,
        chatDoneTs: toTimestamp(input.chatDoneTs),
      },
      stageDurationsMs: {
        ttfAssistantPlaceholder: 0,
        ttfFirstToken: 0,
        chatDone: 0,
        bidStartDeltaFromClick: 0,
        bidLatency: 0,
        uiCardRender: 0,
      },
    }

    const placeholderTs = toTimestamp(input.assistantPlaceholderTs)
    const firstTokenTs = toTimestamp(input.firstTokenTs)
    if (placeholderTs > 0) {
      diagnostics.stageDurationsMs.ttfAssistantPlaceholder = Math.max(0, placeholderTs - clickTs)
    }
    if (firstTokenTs > 0) {
      diagnostics.stageDurationsMs.ttfFirstToken = Math.max(0, firstTokenTs - clickTs)
    }

    if (!fastPath && chatDonePromise) {
      try {
        await chatDonePromise
      } catch {
        // Chat promise failure should not block ad flow.
      } finally {
        diagnostics.timestamps.chatDoneTs = diagnostics.timestamps.chatDoneTs || Date.now()
      }
    }

    diagnostics.timestamps.bidStartTs = Date.now()
    const flow = await runManagedFlow({
      ...input,
      failOpenOnBidError: input.failOpenOnBidError,
    })
    diagnostics.timestamps.bidEndTs = Date.now()

    diagnostics.stageDurationsMs.bidStartDeltaFromClick = Math.max(0, diagnostics.timestamps.bidStartTs - clickTs)
    diagnostics.stageDurationsMs.bidLatency = Math.max(
      0,
      diagnostics.timestamps.bidEndTs - diagnostics.timestamps.bidStartTs,
    )

    if (flow?.decision?.result === 'served' && Array.isArray(flow?.ads) && flow.ads.length > 0) {
      const renderCallback = typeof input.renderAd === 'function' ? input.renderAd : null
      if (renderCallback) {
        await Promise.resolve(renderCallback(flow.ads[0], flow))
        diagnostics.timestamps.uiRenderTs = Date.now()
        diagnostics.stageDurationsMs.uiCardRender = Math.max(0, diagnostics.timestamps.uiRenderTs - clickTs)
      }
    }

    if (chatDonePromise && diagnostics.timestamps.chatDoneTs === 0) {
      try {
        await chatDonePromise
      } catch {
        // Chat promise failure should not block ad diagnostics.
      } finally {
        diagnostics.timestamps.chatDoneTs = Date.now()
      }
    }
    if (diagnostics.timestamps.chatDoneTs > 0) {
      diagnostics.stageDurationsMs.chatDone = Math.max(0, diagnostics.timestamps.chatDoneTs - clickTs)
    }

    diagnostics.bidProbeStatus = classifyBidProbeStatus(flow)
    diagnostics.outcomeCategory = classifyOutcomeCategory(flow, diagnostics.bidProbeStatus, diagnostics)

    const onDiagnostics = typeof input.onDiagnostics === 'function'
      ? input.onDiagnostics
      : defaultOnDiagnostics
    if (onDiagnostics) {
      await Promise.resolve(onDiagnostics(diagnostics, flow))
    }

    return {
      ...flow,
      diagnostics,
    }
  }

  async function runAttachFlow(input = {}) {
    const appId = cleanText(input.appId)
    const placementId = cleanText(input.placementId || ATTACH_DEFAULTS.placementId) || ATTACH_DEFAULTS.placementId
    const placementKey = cleanText(input.placementKey || ATTACH_DEFAULTS.placementKey) || ATTACH_DEFAULTS.placementKey
    const eventPayload = {
      sessionId: cleanText(input.sessionId),
      turnId: cleanText(input.turnId),
      query: cleanText(input.query),
      answerText: cleanText(input.answerText),
      intentScore: toFiniteNumber(input.intentScore, 0),
      locale: cleanText(input.locale) || 'en-US',
    }
    const bidPayload = {
      userId: cleanText(input.userId || input.sessionId),
      chatId: cleanText(input.chatId || input.sessionId),
      placementId,
      messages: Array.isArray(input.messages) ? input.messages : [],
    }
    if (bidPayload.messages.length === 0) {
      const fallback = []
      if (eventPayload.query) fallback.push({ role: 'user', content: eventPayload.query })
      if (eventPayload.answerText) fallback.push({ role: 'assistant', content: eventPayload.answerText })
      bidPayload.messages = fallback
    }
    if (appId) {
      eventPayload.appId = appId
    }

    return runManagedFlow({
      appId,
      placementId,
      placementKey,
      environment: cleanText(input.environment || ATTACH_DEFAULTS.environment) || ATTACH_DEFAULTS.environment,
      schemaVersion: cleanText(input.schemaVersion || ATTACH_DEFAULTS.schemaVersion) || ATTACH_DEFAULTS.schemaVersion,
      sdkVersion: cleanText(input.sdkVersion || ATTACH_DEFAULTS.sdkVersion) || ATTACH_DEFAULTS.sdkVersion,
      requestAt: cleanText(input.requestAt) || new Date().toISOString(),
      bidPayload,
      evaluatePayload: eventPayload,
      intentScore: eventPayload.intentScore,
      eventPayloadFactory: ({ requestId, decision, ads }) => {
        const decisionResult = cleanText(decision?.result).toLowerCase()
        const firstAdId = cleanText(Array.isArray(ads) ? ads[0]?.adId : '')
        if (decisionResult !== 'served' || !firstAdId) {
          return null
        }
        return {
          ...eventPayload,
          requestId,
          kind: 'impression',
          placementId,
          adId: firstAdId,
        }
      },
      configTimeoutMs: input.configTimeoutMs,
      bidTimeoutMs: input.bidTimeoutMs || input.evaluateTimeoutMs,
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

    const eventPayload = {
      sessionId: cleanText(input.sessionId),
      turnId: cleanText(input.turnId),
      userId: cleanText(input.userId),
      event: cleanText(input.event || 'followup_generation') || 'followup_generation',
      placementId,
      placementKey,
      context,
    }
    const bidPayload = {
      userId: cleanText(input.userId || input.sessionId),
      chatId: cleanText(input.chatId || input.sessionId),
      placementId,
      messages: Array.isArray(input.messages) ? input.messages : [],
    }
    if (bidPayload.messages.length === 0 && Array.isArray(context.recent_turns)) {
      bidPayload.messages = context.recent_turns
    }
    if (bidPayload.messages.length === 0) {
      const fallback = []
      if (context.query) fallback.push({ role: 'user', content: context.query })
      if (context.answerText) fallback.push({ role: 'assistant', content: context.answerText })
      bidPayload.messages = fallback
    }
    if (appId) {
      eventPayload.appId = appId
    }

    return runManagedFlow({
      appId,
      placementId,
      placementKey,
      environment: cleanText(input.environment || NEXT_STEP_DEFAULTS.environment) || NEXT_STEP_DEFAULTS.environment,
      schemaVersion: cleanText(input.schemaVersion || NEXT_STEP_DEFAULTS.schemaVersion) || NEXT_STEP_DEFAULTS.schemaVersion,
      sdkVersion: cleanText(input.sdkVersion || NEXT_STEP_DEFAULTS.sdkVersion) || NEXT_STEP_DEFAULTS.sdkVersion,
      requestAt: cleanText(input.requestAt) || new Date().toISOString(),
      bidPayload,
      evaluatePayload: eventPayload,
      intentScore: context.intent_score,
      eventPayloadFactory: ({ requestId, decision, ads }) => {
        const decisionResult = cleanText(decision?.result).toLowerCase()
        const firstAdId = cleanText(
          ads[0]?.adId
            || ads[0]?.item_id
            || ads[0]?.itemId,
        )

        if (decisionResult !== 'served' || !firstAdId) {
          return null
        }

        return {
          ...eventPayload,
          requestId,
          kind: 'impression',
          adId: firstAdId,
          placementId,
          placementKey,
        }
      },
      configTimeoutMs: input.configTimeoutMs,
      bidTimeoutMs: input.bidTimeoutMs || input.evaluateTimeoutMs,
      eventsTimeoutMs: input.eventsTimeoutMs,
    })
  }

  return {
    fetchConfig,
    requestBid,
    reportEvent,
    runManagedFlow,
    runChatTurnWithAd,
    runAttachFlow,
    runNextStepFlow,
  }
}
