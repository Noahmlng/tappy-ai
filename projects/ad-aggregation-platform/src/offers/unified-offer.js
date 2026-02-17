const UNIFIED_ENTITY_TYPES = new Set(['product', 'brand', 'service'])
const UNIFIED_SOURCE_TYPES = new Set(['offer', 'product', 'link', 'program', 'campaign'])

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

function normalizeUrl(value) {
  const text = cleanText(value)
  if (!text) return ''
  try {
    return new URL(text).toString()
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

export function normalizeUnifiedOffer(input = {}) {
  const network = cleanText(input.sourceNetwork || input.network || '')
  const sourceType = normalizeSourceType(input.sourceType, 'offer')
  const sourceId = pickFirst(input.sourceId, input.id, input.offerId)
  const title = pickFirst(input.title, input.name, 'Untitled Offer')
  const description = pickFirst(input.description, '')
  const targetUrl = normalizeUrl(input.targetUrl || input.destinationUrl || input.url)
  const trackingUrl = normalizeUrl(input.trackingUrl || input.clickUrl || targetUrl) || targetUrl
  const entityText = pickFirst(input.entityText, input.entityName, title)
  const normalizedEntityText = cleanText(input.normalizedEntityText || entityText).toLowerCase()
  const entityType = normalizeEntityType(input.entityType, sourceType === 'product' ? 'product' : 'service')

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

  return {
    offerId,
    sourceNetwork: network,
    sourceType,
    sourceId: sourceId || '',
    title,
    description,
    targetUrl,
    trackingUrl,
    entityText,
    normalizedEntityText,
    entityType,
    locale,
    market,
    currency,
    availability,
    qualityScore,
    bidValue,
    metadata: normalizeMetadata(input.metadata),
    raw: input.raw ?? null
  }
}

export function normalizeUnifiedOffers(items = []) {
  const list = Array.isArray(items) ? items : []
  const dedupe = new Set()
  const output = []

  for (const item of list) {
    const normalized = normalizeUnifiedOffer(item)
    if (!normalized) continue
    const key = `${normalized.sourceNetwork}::${normalized.sourceType}::${normalized.trackingUrl || normalized.targetUrl}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    output.push(normalized)
  }

  return output
}

export { UNIFIED_ENTITY_TYPES, UNIFIED_SOURCE_TYPES }
