export const TOOL_STATES = ['planning', 'running', 'done', 'error']

function defaultCreateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function defaultNow() {
  return Date.now()
}

export function getHostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function normalizeSourceItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!title || !url) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `source_${index}`,
    title,
    url,
    host: typeof raw.host === 'string' && raw.host ? raw.host : getHostFromUrl(url),
  }
}

export function normalizeFollowUpItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null

  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : text
  if (!text || !prompt) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `follow_up_${index}`,
    text,
    prompt,
    sourceTurnId: typeof raw.sourceTurnId === 'string' ? raw.sourceTurnId : '',
  }
}

export function normalizeToolResultItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const title = typeof raw.title === 'string' ? raw.title : ''
  const url = typeof raw.url === 'string' ? raw.url : ''
  const snippet = typeof raw.snippet === 'string' ? raw.snippet : ''
  if (!title || !url) return null

  return {
    id: typeof raw.id === 'string' ? raw.id : `tool_result_${index}`,
    title,
    url,
    snippet,
  }
}

export function normalizeTurnEvent(raw, index, options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : defaultNow
  if (!raw || typeof raw !== 'object') return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `event_${index}`,
    type: typeof raw.type === 'string' && raw.type ? raw.type : 'unknown_event',
    at: Number.isFinite(raw.at) ? raw.at : nowFn(),
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
  }
}

export function normalizeAdCard(raw) {
  if (!raw || typeof raw !== 'object') return null

  const requestId = typeof raw.requestId === 'string' ? raw.requestId.trim() : ''
  const adId = typeof raw.adId === 'string' ? raw.adId.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!requestId || !adId || !url) return null

  const pricing = raw.pricing && typeof raw.pricing === 'object'
    ? {
        modelVersion: typeof raw.pricing.modelVersion === 'string' ? raw.pricing.modelVersion : 'cpa_mock_v2',
        triggerType: typeof raw.pricing.triggerType === 'string' ? raw.pricing.triggerType : '',
        targetRpmUsd: Number.isFinite(Number(raw.pricing.targetRpmUsd)) ? Number(raw.pricing.targetRpmUsd) : 0,
        ecpmUsd: Number.isFinite(Number(raw.pricing.ecpmUsd)) ? Number(raw.pricing.ecpmUsd) : 0,
        cpaUsd: Number.isFinite(Number(raw.pricing.cpaUsd)) ? Number(raw.pricing.cpaUsd) : 0,
        pClick: Number.isFinite(Number(raw.pricing.pClick)) ? Number(raw.pricing.pClick) : 0,
        pConv: Number.isFinite(Number(raw.pricing.pConv)) ? Number(raw.pricing.pConv) : 0,
        network: typeof raw.pricing.network === 'string' ? raw.pricing.network : '',
        rawSignal: raw.pricing.rawSignal && typeof raw.pricing.rawSignal === 'object'
          ? {
              rawBidValue: Number.isFinite(Number(raw.pricing.rawSignal.rawBidValue)) ? Number(raw.pricing.rawSignal.rawBidValue) : 0,
              rawUnit: typeof raw.pricing.rawSignal.rawUnit === 'string' ? raw.pricing.rawSignal.rawUnit : 'bid_value',
              normalizedFactor: Number.isFinite(Number(raw.pricing.rawSignal.normalizedFactor)) ? Number(raw.pricing.rawSignal.normalizedFactor) : 1,
            }
          : null,
      }
    : null

  return {
    requestId,
    placementId: typeof raw.placementId === 'string' && raw.placementId.trim() ? raw.placementId.trim() : 'chat_from_answer_v1',
    adId,
    advertiser: typeof raw.advertiser === 'string' && raw.advertiser.trim() ? raw.advertiser.trim() : 'Sponsored',
    headline: typeof raw.headline === 'string' && raw.headline.trim() ? raw.headline.trim() : 'Sponsored',
    description: typeof raw.description === 'string' ? raw.description : '',
    ctaText: typeof raw.ctaText === 'string' && raw.ctaText.trim() ? raw.ctaText.trim() : 'Learn More',
    url,
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : '',
    dsp: typeof raw.dsp === 'string' ? raw.dsp : '',
    variant: typeof raw.variant === 'string' ? raw.variant : 'base',
    price: Number.isFinite(Number(raw.price)) ? Number(raw.price) : null,
    pricing,
    impressionReported: Boolean(raw.impressionReported),
    clickReported: Boolean(raw.clickReported),
    postbackReported: Boolean(raw.postbackReported),
    lastPostbackConversionId: typeof raw.lastPostbackConversionId === 'string' ? raw.lastPostbackConversionId : '',
  }
}

export function normalizeAdCards(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeAdCard(item)).filter(Boolean)
  }
  const legacy = normalizeAdCard(raw)
  return legacy ? [legacy] : []
}

export function normalizeMessage(raw, options = {}) {
  const createId = typeof options.createId === 'function' ? options.createId : defaultCreateId
  const toolStates = Array.isArray(options.toolStates) && options.toolStates.length
    ? options.toolStates
    : TOOL_STATES

  if (!raw || (raw.role !== 'user' && raw.role !== 'assistant')) return null

  const toolState = toolStates.includes(raw.toolState) ? raw.toolState : 'done'
  const toolResults = Array.isArray(raw.toolResults)
    ? raw.toolResults.map((item, index) => normalizeToolResultItem(item, index)).filter(Boolean)
    : []
  const normalizedAdCards = normalizeAdCards(raw.adCards?.length ? raw.adCards : raw.adCard)

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('msg'),
    role: raw.role,
    kind: raw.kind === 'tool' && raw.role === 'assistant' ? 'tool' : 'chat',
    content: typeof raw.content === 'string' ? raw.content : '',
    status: raw.status === 'reasoning' || raw.status === 'streaming' ? raw.status : 'done',
    toolName: typeof raw.toolName === 'string' ? raw.toolName : '',
    toolState,
    toolQuery: typeof raw.toolQuery === 'string' ? raw.toolQuery : '',
    toolResults,
    toolLatencyMs: Number.isFinite(raw.toolLatencyMs) ? raw.toolLatencyMs : null,
    toolError: typeof raw.toolError === 'string' ? raw.toolError : '',
    sources: Array.isArray(raw.sources)
      ? raw.sources.map((item, index) => normalizeSourceItem(item, index)).filter(Boolean)
      : [],
    sourceTurnId: typeof raw.sourceTurnId === 'string' ? raw.sourceTurnId : '',
    sourceUserContent: typeof raw.sourceUserContent === 'string' ? raw.sourceUserContent : '',
    retryCount: Number.isFinite(raw.retryCount) ? Math.max(0, raw.retryCount) : 0,
    followUps: Array.isArray(raw.followUps)
      ? raw.followUps.map((item, index) => normalizeFollowUpItem(item, index)).filter(Boolean)
      : [],
    adCards: normalizedAdCards,
    adCard: normalizeAdCard(raw.adCard) || normalizedAdCards[0] || null,
  }
}

export function normalizeSession(raw, options = {}) {
  const createId = typeof options.createId === 'function' ? options.createId : defaultCreateId
  const defaultSystemPrompt = typeof options.defaultSystemPrompt === 'string'
    ? options.defaultSystemPrompt
    : 'You are a helpful assistant. Be accurate, concise, and explicit about uncertainty.'
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : defaultNow

  if (!raw || typeof raw !== 'object') return null

  const messages = Array.isArray(raw.messages)
    ? raw.messages
      .map((item) => normalizeMessage(item, { createId, toolStates: options.toolStates }))
      .filter(Boolean)
    : []

  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : nowFn()
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('session'),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'New Chat',
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : defaultSystemPrompt,
    createdAt,
    updatedAt,
    messages,
  }
}

export function normalizeTurnLog(raw, options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : defaultNow

  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.turnId !== 'string' || !raw.turnId) return null
  if (typeof raw.sessionId !== 'string' || !raw.sessionId) return null

  const retryCount = Number.isFinite(raw.retryCount)
    ? Math.max(0, raw.retryCount)
    : Number.isFinite(raw?.events?.find?.((event) => event?.type === 'retry_policy_applied')?.payload?.retryCount)
      ? Math.max(0, raw.events.find((event) => event?.type === 'retry_policy_applied').payload.retryCount)
      : 0

  return {
    turnId: raw.turnId,
    traceId: typeof raw.traceId === 'string' ? raw.traceId : '',
    sessionId: raw.sessionId,
    userQuery: typeof raw.userQuery === 'string' ? raw.userQuery : '',
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : nowFn(),
    endedAt: Number.isFinite(raw.endedAt) ? raw.endedAt : null,
    toolUsed: Boolean(raw.toolUsed),
    retryCount,
    events: Array.isArray(raw.events)
      ? raw.events.map((event, index) => normalizeTurnEvent(event, index, { nowFn })).filter(Boolean)
      : [],
  }
}

export function normalizePromptKey(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function getLatestRetryCountForPrompt(session, prompt) {
  if (!session) return 0
  const targetKey = normalizePromptKey(prompt)
  if (!targetKey) return 0

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index]
    if (!message || message.role !== 'user') continue
    if (normalizePromptKey(message.content) !== targetKey) continue
    return Number.isFinite(message.retryCount) ? Math.max(0, message.retryCount) : 0
  }

  return 0
}

export function buildModelMessages(messages, webSearchContext, systemPrompt = '') {
  const modelMessages = []

  const normalizedSystemPrompt = typeof systemPrompt === 'string'
    ? systemPrompt.trim()
    : ''
  if (normalizedSystemPrompt) {
    modelMessages.push({
      role: 'system',
      content: normalizedSystemPrompt,
    })
  }

  const chatMessages = messages
    .filter((msg) => {
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return false
      if (msg.kind === 'tool') return false
      return typeof msg.content === 'string' && msg.content.trim().length > 0
    })
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))
  modelMessages.push(...chatMessages)

  if (webSearchContext) {
    const contextContent = `Additional web search context for grounding:\n${webSearchContext}`
    const lastUserIndex = modelMessages
      .map((item, idx) => (item.role === 'user' ? idx : -1))
      .filter((idx) => idx >= 0)
      .pop()

    if (lastUserIndex !== undefined && lastUserIndex >= 0) {
      const existing = modelMessages[lastUserIndex]
      const combined = `${existing.content}\n\n${contextContent}`
      modelMessages[lastUserIndex] = {
        role: 'user',
        content: combined.trim(),
      }
    } else {
      modelMessages.push({
        role: 'user',
        content: contextContent,
      })
    }
  }

  return modelMessages
}

export function clamp01(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  if (numeric <= 0) return 0
  if (numeric >= 1) return 1
  return numeric
}

export function hashToUnitInterval(seed = '') {
  let hash = 2166136261
  const text = String(seed || '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

export function buildStableConversionId(requestId, adId, turnId) {
  const seed = `${requestId}|${adId}|${turnId}`
  const unit = hashToUnitInterval(seed)
  const numeric = Math.floor(unit * 0xffffffff)
  return `conv_${numeric.toString(16).padStart(8, '0')}`
}

export function shouldSimulateSuccessfulPostback(message, adCard) {
  const pConv = clamp01(adCard?.pricing?.pConv)
  if (pConv <= 0) return false
  const turnId = typeof message?.sourceTurnId === 'string' ? message.sourceTurnId : ''
  const sample = hashToUnitInterval(`${adCard?.requestId || ''}|${adCard?.adId || ''}|${turnId}`)
  return sample < pConv
}
