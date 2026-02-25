const DEFAULT_ADS_BASE_URL = import.meta.env.VITE_SIMULATOR_API_BASE_URL || '/api'
const ADS_BASE_URL = String(import.meta.env.VITE_ADS_BASE_URL || DEFAULT_ADS_BASE_URL).replace(/\/+$/, '')
const ADS_API_KEY = String(import.meta.env.VITE_ADS_API_KEY || '').trim()
const INLINE_PLACEMENT_ID = 'chat_inline_v1'
const FOLLOWUP_PLACEMENT_ID = 'chat_followup_v1'
const DEFAULT_PLACEMENT_IDS = (() => {
  const raw = String(
    import.meta.env.VITE_ADS_PLACEMENT_IDS
      || import.meta.env.VITE_ADS_PLACEMENT_ID
      || `${INLINE_PLACEMENT_ID},${FOLLOWUP_PLACEMENT_ID}`,
  )
  return raw
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean)
})()
const DEFAULT_PLACEMENT_ID = DEFAULT_PLACEMENT_IDS[0] || INLINE_PLACEMENT_ID
const ADS_BID_TIMEOUT_MS = Number.isFinite(Number(import.meta.env.VITE_ADS_BID_TIMEOUT_MS))
  ? Math.max(200, Number(import.meta.env.VITE_ADS_BID_TIMEOUT_MS))
  : 10000

function toAdsMessages(messages = []) {
  return messages
    .filter((message) => {
      if (!message || (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system')) {
        return false
      }

      if (message.kind === 'tool') return false
      return typeof message.content === 'string' && message.content.trim().length > 0
    })
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').trim(),
    }))
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function toIntentScore(query = '') {
  const tokenCount = String(query || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length

  if (tokenCount >= 10) return 0.9
  if (tokenCount >= 6) return 0.8
  if (tokenCount >= 3) return 0.7
  return 0.6
}

function normalizeBidPricing(raw) {
  if (!raw || typeof raw !== 'object') return null

  const cpaUsd = toFiniteNumber(raw.cpaUsd, NaN)
  const ecpmUsd = toFiniteNumber(raw.ecpmUsd, NaN)
  const pClick = toFiniteNumber(raw.pClick, NaN)
  const pConv = toFiniteNumber(raw.pConv, NaN)

  if (!Number.isFinite(cpaUsd) && !Number.isFinite(ecpmUsd) && !Number.isFinite(pConv)) {
    return null
  }

  return {
    modelVersion: sanitizeText(raw.modelVersion, 'rpm_v1'),
    targetRpmUsd: toFiniteNumber(raw.targetRpmUsd, 0),
    ecpmUsd: Number.isFinite(ecpmUsd) ? ecpmUsd : 0,
    cpaUsd: Number.isFinite(cpaUsd) ? cpaUsd : 0,
    pClick: clamp(Number.isFinite(pClick) ? pClick : 0, 0, 1),
    pConv: clamp(Number.isFinite(pConv) ? pConv : 0, 0, 1),
    network: sanitizeText(raw.network),
    rawSignal: raw.rawSignal && typeof raw.rawSignal === 'object'
      ? {
          rawBidValue: toFiniteNumber(raw.rawSignal.rawBidValue, 0),
          rawUnit: sanitizeText(raw.rawSignal.rawUnit, 'bid_value'),
          normalizedFactor: toFiniteNumber(raw.rawSignal.normalizedFactor, 1),
        }
      : null,
  }
}

function mapBidToAdCard(bidResponse, placementId) {
  const requestId = sanitizeText(bidResponse?.requestId)
  const bid = bidResponse?.data?.bid
  if (!bid || typeof bid !== 'object') return null

  const adId = sanitizeText(bid.bidId)
  const url = sanitizeText(bid.url)
  if (!requestId || !adId || !url) return null

  const advertiser = sanitizeText(bid.advertiser, 'Sponsored')
  const pricing = normalizeBidPricing(bid.pricing)

  return {
    requestId,
    placementId,
    adId,
    advertiser,
    headline: sanitizeText(bid.headline, advertiser),
    description: sanitizeText(bid.description),
    ctaText: sanitizeText(bid.cta_text, 'Learn More'),
    url,
    imageUrl: sanitizeText(bid.image_url),
    dsp: sanitizeText(bid.dsp),
    variant: sanitizeText(bid.variant, 'base'),
    price: Number.isFinite(Number(bid.price)) ? Number(bid.price) : null,
    pricing,
    impressionReported: false,
    clickReported: false,
    postbackReported: false,
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ADS_BID_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export function getAdsPlacementId() {
  return DEFAULT_PLACEMENT_ID
}

export function getAdsPlacementIds() {
  return [...DEFAULT_PLACEMENT_IDS]
}

export function getAdsIntentScore(query) {
  return toIntentScore(query)
}

export async function requestAdBid({ userId, chatId, messages, placementId = DEFAULT_PLACEMENT_ID }) {
  if (!ADS_API_KEY || !ADS_BASE_URL) return null

  const payload = {
    userId: sanitizeText(userId),
    chatId: sanitizeText(chatId),
    placementId: sanitizeText(placementId, INLINE_PLACEMENT_ID),
    messages: toAdsMessages(messages),
  }

  if (!payload.userId || !payload.chatId || payload.messages.length === 0) return null

  try {
    const response = await fetchWithTimeout(`${ADS_BASE_URL}/v2/bid`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(result?.message || `Ads bid request failed (${response.status})`)
    }

    const adCard = mapBidToAdCard(result, payload.placementId)
    if (!adCard) return null

    return {
      requestId: adCard.requestId,
      placementId: payload.placementId,
      adCard,
    }
  } catch (error) {
    console.warn('[ads] fail-open bid request:', error)
    return null
  }
}

export async function reportInlineAdEvent({
  requestId,
  sessionId,
  turnId,
  query,
  answerText,
  intentScore,
  locale,
  kind,
  placementId,
  adId,
}) {
  if (!ADS_API_KEY || !ADS_BASE_URL) return false

  const eventKind = kind === 'click' ? 'click' : 'impression'

  const payload = {
    requestId: sanitizeText(requestId),
    sessionId: sanitizeText(sessionId),
    turnId: sanitizeText(turnId),
    query: sanitizeText(query),
    answerText: sanitizeText(answerText),
    intentScore: Number.isFinite(Number(intentScore)) ? Number(intentScore) : toIntentScore(query),
    locale: sanitizeText(locale, 'en-US'),
    kind: eventKind,
    placementId: sanitizeText(placementId, INLINE_PLACEMENT_ID),
    adId: sanitizeText(adId),
  }

  if (!payload.requestId || !payload.sessionId || !payload.turnId || !payload.query || !payload.answerText || !payload.adId) {
    return false
  }

  try {
    const response = await fetch(`${ADS_BASE_URL}/v1/sdk/events`, {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${ADS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    return response.ok
  } catch (error) {
    console.warn(`[ads] fail-open ${eventKind} event:`, error)
    return false
  }
}

export async function reportAdPostbackEvent({
  requestId,
  sessionId,
  turnId,
  userId,
  placementId,
  adId,
  conversionId,
  cpaUsd,
  postbackStatus = 'success',
  currency = 'USD',
}) {
  if (!ADS_API_KEY || !ADS_BASE_URL) return false

  const normalizedStatus = postbackStatus === 'pending' || postbackStatus === 'failed'
    ? postbackStatus
    : 'success'
  const payout = toFiniteNumber(cpaUsd, NaN)
  const payload = {
    eventType: 'postback',
    requestId: sanitizeText(requestId),
    sessionId: sanitizeText(sessionId),
    turnId: sanitizeText(turnId),
    userId: sanitizeText(userId),
    placementId: sanitizeText(placementId, INLINE_PLACEMENT_ID),
    adId: sanitizeText(adId),
    postbackType: 'conversion',
    postbackStatus: normalizedStatus,
    conversionId: sanitizeText(conversionId),
    cpaUsd: Number.isFinite(payout) ? payout : undefined,
    currency: sanitizeText(currency, 'USD').toUpperCase(),
  }

  if (
    !payload.requestId
    || !payload.sessionId
    || !payload.turnId
    || !payload.placementId
    || !payload.adId
    || !payload.conversionId
  ) {
    return false
  }
  if (payload.postbackStatus === 'success' && !Number.isFinite(payload.cpaUsd)) {
    return false
  }
  if (payload.currency !== 'USD') return false

  try {
    const response = await fetch(`${ADS_BASE_URL}/v1/sdk/events`, {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${ADS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    return response.ok
  } catch (error) {
    console.warn('[ads] fail-open postback event:', error)
    return false
  }
}
