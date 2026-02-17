const UNIFIED_ENTITY_TYPES = new Set(['product', 'brand', 'service'])
const UNIFIED_SOURCE_TYPES = new Set(['offer', 'product', 'link', 'program', 'campaign'])
const SOURCE_TYPE_PRIORITY = {
  product: 5,
  offer: 4,
  link: 3,
  program: 2,
  campaign: 1
}
const TRACKING_QUERY_KEY_EXACT = new Set([
  'sid',
  'subid',
  'sub_id',
  'clickid',
  'click_id',
  'irclickid',
  'gclid',
  'fbclid',
  'msclkid'
])
const TRACKING_QUERY_KEY_PREFIXES = ['utm_', 'aff_', 'affid', 'partner_']

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const cleaned = cleanText(value)
      if (cleaned) return cleaned
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ''
}

function normalizeDedupeToken(value) {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized
}

function shouldDropTrackingParam(paramName) {
  const key = cleanText(paramName).toLowerCase()
  if (!key) return false
  if (TRACKING_QUERY_KEY_EXACT.has(key)) return true
  return TRACKING_QUERY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function normalizeUrl(value, options = {}) {
  const text = cleanText(value)
  if (!text) return ''

  try {
    const url = new URL(text)
    const stripTracking = options.stripTracking === true

    url.hash = ''
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()

    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = ''
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    }

    const params = [...url.searchParams.entries()]
      .filter(([key]) => !stripTracking || !shouldDropTrackingParam(key))
      .sort(([a], [b]) => a.localeCompare(b))

    url.search = ''
    for (const [key, paramValue] of params) {
      url.searchParams.append(key, paramValue)
    }

    return url.toString()
  } catch {
    return ''
  }
}

function normalizeEntityType(value, fallback = 'service') {
  const normalized = cleanText(String(value || '')).toLowerCase()
  if (UNIFIED_ENTITY_TYPES.has(normalized)) return normalized
  return fallback
}

function normalizeSourceType(value, fallback = 'offer') {
  const normalized = cleanText(String(value || '')).toLowerCase()
  if (UNIFIED_SOURCE_TYPES.has(normalized)) return normalized
  return fallback
}

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 1e12 ? value : value * 1000
    const date = new Date(timestamp)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
    return ''
  }

  const text = cleanText(String(value))
  if (!text) return ''
  const timestamp = Date.parse(text)
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toISOString()
  }
  return ''
}

function defaultOfferId(network, sourceType, sourceId) {
  const safeNetwork = cleanText(network || 'unknown') || 'unknown'
  const safeSourceType = cleanText(sourceType || 'offer') || 'offer'
  const safeSourceId = cleanText(sourceId)
  if (safeSourceId) return `${safeNetwork}:${safeSourceType}:${safeSourceId}`
  return `${safeNetwork}:${safeSourceType}:${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function normalizeLocale(value) {
  const cleaned = cleanText(value)
  if (!cleaned) return ''
  return cleaned.replace('_', '-')
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...value }
}

function dedupeKeyForOffer(offer) {
  if (offer.normalizedMerchantName && offer.normalizedProductName) {
    return `merchant_product::${offer.normalizedMerchantName}::${offer.normalizedProductName}`
  }

  if (offer.canonicalTargetUrl) {
    return `canonical_target::${offer.canonicalTargetUrl}`
  }

  if (offer.canonicalTrackingUrl) {
    return `canonical_tracking::${offer.canonicalTrackingUrl}`
  }

  return `fallback::${offer.sourceNetwork}::${offer.offerId}`
}

function offerPriorityScore(offer) {
  const sourceTypePriority = SOURCE_TYPE_PRIORITY[offer.sourceType] || 0
  const quality = Number.isFinite(offer.qualityScore) ? offer.qualityScore : -1
  const bid = Number.isFinite(offer.bidValue) ? offer.bidValue : -1
  const active = cleanText(offer.availability).toLowerCase() === 'active' ? 1 : 0
  return active * 1000 + sourceTypePriority * 100 + quality * 10 + bid
}

function pickBestOffer(current, candidate) {
  if (!current) return candidate

  const currentScore = offerPriorityScore(current)
  const candidateScore = offerPriorityScore(candidate)
  if (candidateScore > currentScore) return candidate

  return current
}

export function normalizeUnifiedOffer(input = {}) {
  const network = cleanText(input.sourceNetwork || input.network || '')
  const sourceType = normalizeSourceType(input.sourceType, 'offer')
  const sourceId = pickFirst(input.sourceId, input.id, input.offerId)
  const title = pickFirst(input.title, input.name, 'Untitled Offer')
  const description = pickFirst(input.description, '')
  const targetUrl = normalizeUrl(input.targetUrl || input.destinationUrl || input.url, {
    stripTracking: false
  })
  const trackingUrl =
    normalizeUrl(input.trackingUrl || input.clickUrl || targetUrl, {
      stripTracking: false
    }) || targetUrl
  const canonicalTargetUrl = normalizeUrl(targetUrl, { stripTracking: true }) || targetUrl
  const canonicalTrackingUrl =
    normalizeUrl(trackingUrl, {
      stripTracking: true
    }) || canonicalTargetUrl
  const entityText = pickFirst(input.entityText, input.entityName, title)
  const normalizedEntityText = cleanText(input.normalizedEntityText || entityText).toLowerCase()
  const entityType = normalizeEntityType(input.entityType, sourceType === 'product' ? 'product' : 'service')
  const merchantName = pickFirst(input.merchantName, input.advertiserName)
  const normalizedMerchantName = normalizeDedupeToken(merchantName)
  const productName = pickFirst(input.productName, input.entityText, input.entityName, input.title)
  const normalizedProductName = normalizeDedupeToken(productName)

  if (!network || !targetUrl) {
    return null
  }

  const offerId = cleanText(input.offerId) || defaultOfferId(network, sourceType, sourceId)
  const currency = cleanText(input.currency || '')
  const locale = normalizeLocale(input.locale || '')
  const market = cleanText(input.market || '')
  const availability = cleanText(input.availability || input.status || 'active') || 'active'
  const qualityScore = normalizeNumber(input.qualityScore)
  const bidValue = normalizeNumber(input.bidValue)
  const updatedAt = normalizeTimestamp(
    input.updatedAt || input.updated_at || input.lastUpdated || input.last_updated || input.modifiedAt
  )

  return {
    offerId,
    sourceNetwork: network,
    sourceType,
    sourceId: sourceId || '',
    title,
    description,
    targetUrl,
    trackingUrl,
    canonicalTargetUrl,
    canonicalTrackingUrl,
    entityText,
    normalizedEntityText,
    entityType,
    merchantName,
    normalizedMerchantName,
    productName,
    normalizedProductName,
    locale,
    market,
    currency,
    availability,
    updatedAt,
    qualityScore,
    bidValue,
    metadata: normalizeMetadata(input.metadata),
    raw: input.raw ?? null
  }
}

export function normalizeUnifiedOffers(items = []) {
  const list = Array.isArray(items) ? items : []
  const dedupe = new Map()

  for (const item of list) {
    const normalized = normalizeUnifiedOffer(item)
    if (!normalized) continue
    const key = dedupeKeyForOffer(normalized)
    const existing = dedupe.get(key)
    dedupe.set(key, pickBestOffer(existing, normalized))
  }

  return [...dedupe.values()]
}

export { UNIFIED_ENTITY_TYPES, UNIFIED_SOURCE_TYPES }
