import { loadRuntimeConfig } from '../config/runtime-config.js'
import { createCjConnector } from '../connectors/cj/index.js'
import { createHouseConnector } from '../connectors/house/index.js'
import { createPartnerStackConnector } from '../connectors/partnerstack/index.js'
import { extractEntitiesWithLlm } from '../providers/ner/index.js'
import { normalizeUnifiedOffers } from '../offers/index.js'
import {
  createIntentCardVectorIndex,
  enrichOffersWithIntentCardCatalog,
  normalizeIntentCardCatalog,
  retrieveIntentCardTopK,
  summarizeIntentCardCatalog,
} from '../providers/intent-card/index.js'
import { offerSnapshotCache, queryCache } from '../cache/runtime-caches.js'
import {
  getAllNetworkHealth,
  normalizeHealthPolicy,
  recordHealthCheckResult,
  recordNetworkFailure,
  recordNetworkSuccess,
  shouldRunHealthCheck,
  shouldSkipNetworkFetch
} from './network-health-state.js'

const DEFAULT_MAX_ADS = 20
const DEFAULT_PLACEMENT_ID = 'attach.post_answer_render'
const DEFAULT_NETWORK_ORDER = ['partnerstack', 'cj']
const DEFAULT_QUERY_CACHE_TTL_MS = 15000
const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 120000
const DEFAULT_INTENT_CARD_RETRIEVAL_MIN_SCORE = 0.08
const QUERY_CACHE_VERSION = 'v1'
const INACTIVE_OFFER_STATUSES = new Set([
  'inactive',
  'disabled',
  'paused',
  'expired',
  'deleted',
  'archived',
  'rejected',
  'blocked'
])
const HEURISTIC_ENTITY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'best',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'our',
  'the',
  'this',
  'to',
  'try',
  'use',
  'we',
  'with',
  'you',
  'your'
])
const ENTITY_MATCH_GENERIC_TOKENS = new Set([
  'cloud',
  'service',
  'services',
  'platform',
  'platforms',
  'tool',
  'tools',
  'software',
  'solution',
  'solutions',
  'system',
  'systems',
  'assistant',
  'agents',
  'agent',
])
const FINANCE_INTENT_HINT_TOKENS = new Set([
  'stock',
  'stocks',
  'share',
  'shares',
  'equity',
  'equities',
  'ticker',
  'market',
  'markets',
  'forecast',
  'forecasts',
  'earnings',
  'analyst',
  'analysts',
  'upgrade',
  'downgrade',
  'broker',
  'brokers',
  'brokerage',
  'trading',
  'trade',
  'portfolio',
  'etf',
  'crypto',
  'finance',
  'financial',
  'invest',
  'investing',
  'investment',
])
const FINANCE_OFFER_SIGNAL_TOKENS = new Set([
  'stock',
  'stocks',
  'share',
  'shares',
  'equity',
  'equities',
  'broker',
  'brokers',
  'brokerage',
  'trading',
  'trade',
  'invest',
  'investing',
  'investment',
  'investor',
  'portfolio',
  'etf',
  'crypto',
  'exchange',
  'wallet',
  'finance',
  'financial',
  'bank',
  'banking',
  'wealth',
  'retirement',
  'tax',
  'loan',
  'credit',
  'fintech',
])

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function getLogger(options = {}) {
  const candidate = options.logger
  if (candidate && (typeof candidate.info === 'function' || typeof candidate.error === 'function')) {
    return candidate
  }
  return console
}

function safeLog(logger, level, payload) {
  if (!logger || typeof logger[level] !== 'function') return
  try {
    logger[level](payload)
  } catch {
    // Intentionally ignore logging failures.
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueStrings(values) {
  const seen = new Set()
  const output = []

  for (const value of values) {
    const item = cleanText(value)
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

function tokenizeAlphanumeric(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
}

function normalizeForMatching(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function toPositiveNumber(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0) {
    return numeric
  }
  return fallback
}

function toPositiveInteger(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric)
  }
  return fallback
}

function normalizeAdRequest(adRequest) {
  const input = adRequest && typeof adRequest === 'object' ? adRequest : {}
  const context = input.context && typeof input.context === 'object' ? input.context : {}
  const intentScore = isFiniteNumber(context.intentScore) ? context.intentScore : 0

  return {
    appId: cleanText(input.appId),
    sessionId: cleanText(input.sessionId),
    userId: cleanText(input.userId),
    placementId: cleanText(input.placementId) || DEFAULT_PLACEMENT_ID,
    context: {
      query: cleanText(context.query),
      answerText: cleanText(context.answerText),
      locale: cleanText(context.locale) || 'en-US',
      testAllOffers: Boolean(context.testAllOffers),
      debug: context.debug && typeof context.debug === 'object' ? context.debug : {},
      intentScore
    }
  }
}

function buildSearchKeywords(request, entities = [], options = {}) {
  const includeQuery = options.includeQuery === true
  const terms = [
    ...(includeQuery ? [request.context.query] : []),
    ...entities.map((entity) => entity.normalizedText),
    ...entities.map((entity) => entity.entityText)
  ]
  return uniqueStrings(terms).slice(0, 12).join(' ')
}

function normalizeHeuristicEntity(text) {
  const normalized = cleanText(text).replace(/[^a-z0-9]+/gi, ' ').trim()
  if (!normalized) return ''
  return normalized.toLowerCase()
}

function isValidHeuristicEntity(candidate) {
  const normalized = normalizeHeuristicEntity(candidate)
  if (!normalized) return false

  const parts = normalized.split(/\s+/g).filter(Boolean)
  if (parts.length === 0) return false
  if (parts.every((part) => HEURISTIC_ENTITY_STOPWORDS.has(part))) return false
  if (parts.length === 1) {
    const token = parts[0]
    if (token.length < 4) return false
    if (HEURISTIC_ENTITY_STOPWORDS.has(token)) return false
  }
  return true
}

function extractHeuristicEntities(query = '', answerText = '') {
  const corpus = `${cleanText(query)}\n${cleanText(answerText)}`
  if (!corpus.trim()) return []

  const patterns = [
    /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g,
    /\b[A-Z][A-Za-z0-9&.+-]*(?:\s+[A-Z][A-Za-z0-9&.+-]*){0,2}\s+AI\b/g,
    /\b[A-Z][A-Za-z0-9&.+-]*(?:\s+[A-Z][A-Za-z0-9&.+-]*){1,2}\b/g
  ]

  const seen = new Set()
  const entities = []

  for (const pattern of patterns) {
    const matches = corpus.match(pattern)
    if (!Array.isArray(matches)) continue

    for (const rawMatch of matches) {
      const entityText = cleanText(rawMatch)
      if (!isValidHeuristicEntity(entityText)) continue

      const normalizedText = normalizeHeuristicEntity(entityText)
      if (!normalizedText) continue
      if (seen.has(normalizedText)) continue
      seen.add(normalizedText)

      entities.push({
        entityText,
        normalizedText,
        entityType: 'service',
        confidence: 0.35
      })
    }
  }

  return entities.slice(0, 8)
}

function extractKeywordEntitiesFromQuery(query = '') {
  const text = cleanText(query).toLowerCase()
  if (!text) return []

  const latinTokens = text
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !HEURISTIC_ENTITY_STOPWORDS.has(item))
  const cjkTokens = Array.from(
    new Set((text.match(/[\u4e00-\u9fff]{2,}/g) || []).map((item) => item.trim()).filter(Boolean))
  )
  const tokens = [...latinTokens, ...cjkTokens]

  const unique = uniqueStrings(tokens).slice(0, 8)
  return unique.map((token) => ({
    entityText: token,
    normalizedText: token,
    entityType: 'service',
    confidence: 0.2
  }))
}

function buildEntityMatcher(entities = []) {
  const tokens = uniqueStrings(
    entities.flatMap((entity) => [entity.entityText, entity.normalizedText])
  )
    .filter((item) => {
      const normalized = cleanText(item).toLowerCase()
      if (!normalized) return false
      if (normalized.includes(' ')) return true
      if (normalized.length < 3) return false
      return !ENTITY_MATCH_GENERIC_TOKENS.has(normalized)
    })
    .map((item) => ({
      raw: item.toLowerCase(),
      compact: normalizeForMatching(item)
    }))

  return function scoreOffer(offer) {
    if (tokens.length === 0) return { score: 0, matchedEntityText: '' }

    const intentCardCatalog =
      offer?.metadata && typeof offer.metadata === 'object' ? offer.metadata.intentCardCatalog : null
    const intentCardTags = Array.isArray(intentCardCatalog?.tags) ? intentCardCatalog.tags.join(' ') : ''

    const candidateFields = [
      cleanText(offer.entityText),
      cleanText(offer.normalizedEntityText),
      cleanText(offer.title),
      cleanText(offer.description),
      cleanText(offer.targetUrl),
      cleanText(offer.trackingUrl),
      cleanText(intentCardCatalog?.category),
      cleanText(intentCardTags),
    ]
      .map((field) => ({
        raw: field.toLowerCase(),
        compact: normalizeForMatching(field)
      }))
      .filter((field) => field.raw || field.compact)

    let score = 0
    let matchedEntityText = ''

    for (const token of tokens) {
      if (!token.raw && !token.compact) continue

      const matched = candidateFields.some((field) => {
        if (token.raw && field.raw.includes(token.raw)) return true
        if (!token.compact || !field.compact) return false
        return field.compact.includes(token.compact)
      })

      if (matched) {
        score += Math.max(token.raw.length, token.compact.length)
        if (!matchedEntityText) matchedEntityText = token.raw || token.compact
      }
    }

    return { score, matchedEntityText }
  }
}

function isFinanceIntentRequest(requestContext = {}) {
  const corpus = `${cleanText(requestContext.query)} ${cleanText(requestContext.answerText)}`
  if (!corpus) return false
  return tokenizeAlphanumeric(corpus).some((token) => FINANCE_INTENT_HINT_TOKENS.has(token))
}

function buildOfferSemanticCorpus(offer = {}) {
  const metadata = offer?.metadata && typeof offer.metadata === 'object' ? offer.metadata : {}
  return cleanText(
    [
      offer.title,
      offer.description,
      offer.entityText,
      offer.normalizedEntityText,
      offer.merchantName,
      offer.productName,
      offer.targetUrl,
      offer.trackingUrl,
      metadata?.programId,
      metadata?.campaignId,
    ].join(' ')
  ).toLowerCase()
}

function hasFinanceOfferSignal(offer = {}) {
  const corpus = buildOfferSemanticCorpus(offer)
  if (!corpus) return false
  const tokens = new Set(tokenizeAlphanumeric(corpus))
  for (const token of FINANCE_OFFER_SIGNAL_TOKENS) {
    if (tokens.has(token)) return true
  }
  return false
}

function toTrackingObject(offer) {
  const tracking = {}
  const clickUrl = cleanText(offer.trackingUrl || offer.targetUrl)
  if (clickUrl) tracking.clickUrl = clickUrl
  return tracking
}

function toAdRecord(offer, options = {}) {
  const reason = options.reason || 'network_offer'
  const entityText = cleanText(options.entityText || offer.entityText || offer.normalizedEntityText)
  const entityType = cleanText(offer.entityType || 'service').toLowerCase()
  const catalogItemId = cleanText(offer?.metadata?.intentCardCatalog?.item_id)

  return {
    adId: catalogItemId || cleanText(offer.offerId) || `${offer.sourceNetwork}_${Date.now()}`,
    title: cleanText(offer.title) || 'Offer',
    description: cleanText(offer.description),
    targetUrl: cleanText(offer.targetUrl),
    disclosure: 'Sponsored',
    reason,
    tracking: toTrackingObject(offer),
    sourceNetwork: cleanText(offer.sourceNetwork),
    entityText,
    entityType: entityType || 'service'
  }
}

function networkRank(network) {
  const normalized = cleanText(network).toLowerCase()
  const index = DEFAULT_NETWORK_ORDER.indexOf(normalized)
  if (index === -1) return DEFAULT_NETWORK_ORDER.length
  return index
}

function groupAdsByNetworkOrder(ads = []) {
  const list = Array.isArray(ads) ? ads : []
  return list
    .map((ad, index) => ({ ad, index }))
    .sort((a, b) => {
      const aRank = networkRank(a.ad.sourceNetwork)
      const bRank = networkRank(b.ad.sourceNetwork)
      if (aRank !== bRank) return aRank - bRank
      return a.index - b.index
    })
    .map((item) => item.ad)
}

function isValidUrl(value) {
  const url = cleanText(value)
  if (!url) return false
  try {
    // Validate URL format only.
    new URL(url)
    return true
  } catch {
    return false
  }
}

function isOfferValidForTestAll(offer) {
  const offerId = cleanText(offer.offerId)
  const targetUrl = cleanText(offer.targetUrl)
  const availability = cleanText(offer.availability).toLowerCase()

  if (!offerId) return false
  if (!isValidUrl(targetUrl)) return false
  if (!availability || INACTIVE_OFFER_STATUSES.has(availability)) return false
  return true
}

function availabilityRank(availability) {
  const value = cleanText(availability).toLowerCase()
  if (!value) return 1
  if (value === 'active') return 3
  if (value === 'available') return 2
  if (value === 'limited') return 1
  if (INACTIVE_OFFER_STATUSES.has(value)) return 0
  return 1
}

function freshnessRank(updatedAt) {
  const text = cleanText(updatedAt)
  if (!text) return 0
  const timestamp = Date.parse(text)
  if (Number.isNaN(timestamp)) return 0
  return timestamp
}

function normalizeRankingNumber(value, fallback = -1) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function qualityRank(offer) {
  return normalizeRankingNumber(offer?.qualityScore, -1)
}

function commercialSignalRank(offer) {
  const metadata =
    offer?.metadata && typeof offer.metadata === 'object' && !Array.isArray(offer.metadata)
      ? offer.metadata
      : {}

  const candidates = [
    offer?.bidValue,
    metadata?.commercialSignal,
    metadata?.estimatedRevenue,
    metadata?.epc,
    metadata?.cpc,
  ]

  for (const value of candidates) {
    const normalized = normalizeRankingNumber(value, Number.NaN)
    if (Number.isFinite(normalized)) return normalized
  }

  return -1
}

function rankAndSelectOffers(offers, entities, requestContext, maxAds) {
  if (requestContext.testAllOffers) {
    const selected = []
    let invalidForTestAll = 0

    for (const offer of offers) {
      if (isOfferValidForTestAll(offer)) {
        selected.push({ offer, score: 0, matchedEntityText: '' })
      } else {
        invalidForTestAll += 1
      }
    }

    return { selected, invalidForTestAll }
  }

  const scoreOffer = buildEntityMatcher(entities)
  const financeIntentRequest = isFinanceIntentRequest(requestContext)
  const withScore = offers.map((offer) => {
    const { score, matchedEntityText } = scoreOffer(offer)
    const semanticAllowed = financeIntentRequest ? hasFinanceOfferSignal(offer) : true
    return {
      offer,
      score,
      matchedEntityText,
      semanticAllowed,
      qualityScore: qualityRank(offer),
      commercialSignal: commercialSignalRank(offer),
      availabilityScore: availabilityRank(offer.availability),
      freshnessScore: freshnessRank(offer.updatedAt)
    }
  })

  withScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore
    if (b.commercialSignal !== a.commercialSignal) return b.commercialSignal - a.commercialSignal
    if (b.availabilityScore !== a.availabilityScore) return b.availabilityScore - a.availabilityScore
    if (b.freshnessScore !== a.freshnessScore) return b.freshnessScore - a.freshnessScore
    return 0
  })

  const matched = withScore.filter((item) => item.score > 0 && item.semanticAllowed)
  const semanticFilteredOut = financeIntentRequest
    ? withScore.filter((item) => item.score > 0 && !item.semanticAllowed).length
    : 0

  return {
    selected: matched.slice(0, maxAds),
    invalidForTestAll: 0,
    matchedCandidates: matched.length,
    unmatchedOffers: Math.max(0, withScore.length - matched.length),
    semanticFilteredOut
  }
}

function normalizePreferenceFacetsForIntentCard(facets = []) {
  if (!Array.isArray(facets)) return []

  return facets
    .map((facet) => {
      if (!facet || typeof facet !== 'object') return null

      const facetKey = cleanText(facet.facetKey || facet.facet_key).toLowerCase()
      const facetValue = cleanText(facet.facetValue || facet.facet_value)
      if (!facetKey || !facetValue) return null

      return {
        facet_key: facetKey,
        facet_value: facetValue,
        confidence: clampNumber(facet.confidence, 0, 1, 0.6),
      }
    })
    .filter(Boolean)
}

function buildIntentCardOfferLookup(offers = []) {
  const lookup = new Map()

  for (const offer of Array.isArray(offers) ? offers : []) {
    const itemId = cleanText(offer?.metadata?.intentCardCatalog?.item_id)
    if (!itemId || lookup.has(itemId)) continue
    lookup.set(itemId, offer)
  }

  return lookup
}

function fallbackSelectOffersByIntentCardVector({ offers = [], catalog = [], requestContext = {}, maxAds = 3 }) {
  const query = cleanText(requestContext.query)
  if (!query || !Array.isArray(catalog) || catalog.length === 0) {
    return {
      selected: [],
      retrieval: null,
      indexStats: null,
    }
  }

  const vectorIndex = createIntentCardVectorIndex(catalog)
  const retrieval = retrieveIntentCardTopK(vectorIndex, {
    query,
    facets: normalizePreferenceFacetsForIntentCard(requestContext.preferenceFacets),
    topK: maxAds,
    minScore: DEFAULT_INTENT_CARD_RETRIEVAL_MIN_SCORE,
  })

  if (!Array.isArray(retrieval?.items) || retrieval.items.length === 0) {
    return {
      selected: [],
      retrieval,
      indexStats: {
        itemCount: vectorIndex.items.length,
        vocabularySize: vectorIndex.vocabularySize,
      },
    }
  }

  const offerLookup = buildIntentCardOfferLookup(offers)
  const selected = []

  for (const item of retrieval.items) {
    const itemId = cleanText(item?.item_id)
    if (!itemId) continue

    const offer = offerLookup.get(itemId)
    if (!offer) continue

    selected.push({
      offer,
      score: typeof item.score === 'number' ? item.score : 0,
      matchedEntityText: cleanText(item.title) || cleanText(offer.entityText),
      matchSource: 'intent_card_vector',
    })

    if (selected.length >= maxAds) break
  }

  return {
    selected,
    retrieval,
    indexStats: {
      itemCount: vectorIndex.items.length,
      vocabularySize: vectorIndex.vocabularySize,
    },
  }
}

function createRequestId() {
  return `adreq_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

function resolveErrorCode(error) {
  if (!error || typeof error !== 'object') return 'UNKNOWN'
  if (typeof error.statusCode === 'number') return `HTTP_${error.statusCode}`
  if (typeof error.code === 'string' && cleanText(error.code)) return cleanText(error.code)
  if (typeof error.name === 'string' && cleanText(error.name)) return cleanText(error.name).toUpperCase()
  return 'UNKNOWN'
}

function buildQueryCacheKey(request, maxAds, entitySignature = '') {
  const debug = request.context.debug || {}
  const payload = {
    v: QUERY_CACHE_VERSION,
    appId: request.appId,
    placementId: request.placementId || DEFAULT_PLACEMENT_ID,
    query: request.context.query,
    answerText: request.context.answerText,
    locale: request.context.locale,
    testAllOffers: request.context.testAllOffers,
    entitySignature,
    maxAds,
    debug: {
      partnerstackLimit: debug.partnerstackLimit,
      partnerstackLimitPartnerships: debug.partnerstackLimitPartnerships,
      partnerstackLimitLinks: debug.partnerstackLimitLinks,
      cjLimit: debug.cjLimit,
      cjPage: debug.cjPage,
      cjWebsiteId: debug.cjWebsiteId,
      cjAdvertiserIds: debug.cjAdvertiserIds,
      houseLimit: debug.houseLimit,
      houseMarket: debug.houseMarket,
      disableNetworkDegradation: debug.disableNetworkDegradation,
      healthFailureThreshold: debug.healthFailureThreshold,
      circuitOpenMs: debug.circuitOpenMs,
      healthCheckIntervalMs: debug.healthCheckIntervalMs
    }
  }
  return JSON.stringify(payload)
}

function buildSnapshotCacheKey(network, queryParams) {
  return JSON.stringify({
    network,
    queryParams
  })
}

async function fetchOffersWithSnapshot(config) {
  const {
    network,
    queryParams,
    fetcher,
    healthCheck,
    snapshotCacheEnabled,
    snapshotCacheTtlMs,
    degradationEnabled,
    healthPolicy
  } = config
  const snapshotKey = buildSnapshotCacheKey(network, queryParams)
  const getSnapshot = () => {
    if (!snapshotCacheEnabled) return null
    return offerSnapshotCache.get(snapshotKey)
  }
  const setSnapshot = (offers) => {
    if (!snapshotCacheEnabled) return
    offerSnapshotCache.set(snapshotKey, { offers }, snapshotCacheTtlMs)
  }
  const snapshotResult = (cacheStatus, error = null, sourceDebug = null) => {
    const snapshot = getSnapshot()
    if (snapshot && Array.isArray(snapshot.offers) && snapshot.offers.length > 0) {
      return {
        offers: snapshot.offers,
        snapshotUsed: true,
        cacheStatus,
        error,
        sourceDebug
      }
    }

    return {
      offers: [],
      snapshotUsed: false,
      cacheStatus,
      error,
      sourceDebug
    }
  }
  const runConnectorHealthCheck = async () => {
    if (typeof healthCheck !== 'function') {
      return {
        ok: true,
        network,
        errorCode: '',
        message: ''
      }
    }

    try {
      const result = await healthCheck()
      if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
        return result
      }
      return {
        ok: true,
        network,
        errorCode: '',
        message: ''
      }
    } catch (error) {
      return {
        ok: false,
        network,
        errorCode: resolveErrorCode(error),
        message: error?.message || 'Health check failed'
      }
    }
  }

  if (degradationEnabled) {
    const gate = shouldSkipNetworkFetch(network, healthPolicy)
    if (gate.skip) {
      return snapshotResult('circuit_open', {
        errorCode: 'CIRCUIT_OPEN',
        message: `Circuit open for ${network}, retry in ${gate.retryAfterMs}ms`
      })
    }

    if (gate.reason === 'cooldown_elapsed' && shouldRunHealthCheck(network, healthPolicy)) {
      const healthCheckResult = await runConnectorHealthCheck()
      recordHealthCheckResult(network, healthCheckResult, healthPolicy)

      if (!healthCheckResult.ok) {
        return snapshotResult('healthcheck_failed', {
          errorCode: healthCheckResult.errorCode || 'HEALTHCHECK_FAILED',
          message: healthCheckResult.message || 'Health check failed'
        })
      }
    }
  }

  try {
    const liveResult = await fetcher()
    const liveOffers = Array.isArray(liveResult?.offers) ? liveResult.offers : []
    const sourceDebug = liveResult?.debug && typeof liveResult.debug === 'object'
      ? liveResult.debug
      : null

    if (liveOffers.length > 0) {
      setSnapshot(liveOffers)
      if (degradationEnabled) {
        recordNetworkSuccess(network)
      }
      return {
        offers: liveOffers,
        snapshotUsed: false,
        cacheStatus: 'live',
        error: null,
        sourceDebug
      }
    }

    if (degradationEnabled) {
      recordNetworkSuccess(network)
    }
    return snapshotResult('snapshot_fallback_empty', null, sourceDebug)
  } catch (error) {
    const normalizedError = {
      errorCode: resolveErrorCode(error),
      message: error?.message || 'Unknown error'
    }
    if (degradationEnabled) {
      recordNetworkFailure(network, normalizedError, healthPolicy)
    }
    return snapshotResult('snapshot_fallback_error', normalizedError, null)
  }
}

export async function runAdsRetrievalPipeline(adRequest, options = {}) {
  const request = normalizeAdRequest(adRequest)
  const placementId = request.placementId || DEFAULT_PLACEMENT_ID
  const isNextStepIntentCard = placementId === 'next_step.intent_card'
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig(process.env, { strict: false })
  const maxAds = Number.isInteger(options.maxAds) ? options.maxAds : DEFAULT_MAX_ADS
  const requestId = createRequestId()
  const logger = getLogger(options)
  const queryCacheTtlMs = toPositiveNumber(
    options.queryCacheTtlMs ?? request.context.debug.queryCacheTtlMs,
    DEFAULT_QUERY_CACHE_TTL_MS
  )
  const snapshotCacheTtlMs = toPositiveNumber(
    options.snapshotCacheTtlMs ?? request.context.debug.snapshotCacheTtlMs,
    DEFAULT_SNAPSHOT_CACHE_TTL_MS
  )
  const queryCacheEnabled = !Boolean(options.disableQueryCache ?? request.context.debug.disableQueryCache)
  const snapshotCacheEnabled = !Boolean(
    options.disableOfferSnapshotCache ?? request.context.debug.disableOfferSnapshotCache
  )
  const degradationEnabled = !Boolean(
    options.disableNetworkDegradation ?? request.context.debug.disableNetworkDegradation
  )
  const healthPolicy = normalizeHealthPolicy({
    failureThreshold: toPositiveInteger(
      options.healthFailureThreshold ?? request.context.debug.healthFailureThreshold,
      2
    ),
    circuitOpenMs: toPositiveInteger(options.circuitOpenMs ?? request.context.debug.circuitOpenMs, 30000),
    healthCheckIntervalMs: toPositiveInteger(
      options.healthCheckIntervalMs ?? request.context.debug.healthCheckIntervalMs,
      10000
    )
  })
  const partnerstackConnector =
    options.partnerstackConnector || createPartnerStackConnector({ runtimeConfig })
  const cjConnector = options.cjConnector || createCjConnector({ runtimeConfig })
  const houseConnector = options.houseConnector || createHouseConnector({ runtimeConfig })
  const nerExtractor = options.nerExtractor || extractEntitiesWithLlm

  let entities = []
  let nerInfo = {
    status: 'skipped',
    message: 'openrouter_config_missing'
  }

  const hasOpenrouterConfig =
    cleanText(runtimeConfig?.openrouter?.apiKey).length > 0 &&
    cleanText(runtimeConfig?.openrouter?.model).length > 0

  if (hasOpenrouterConfig) {
    try {
      const nerResult = await nerExtractor(
        {
          query: request.context.query,
          answerText: request.context.answerText,
          locale: request.context.locale
        },
        {
          runtimeConfig
        }
      )

      entities = Array.isArray(nerResult?.entities) ? nerResult.entities : []
      nerInfo = {
        status: 'ok',
        message: '',
        model: cleanText(runtimeConfig?.openrouter?.model)
      }
    } catch (error) {
      nerInfo = {
        status: 'error',
        message: error instanceof Error ? error.message : 'ner_failed'
      }
      safeLog(logger, 'error', {
        event: 'ads_pipeline_ner_error',
        requestId,
        placementId,
        message: nerInfo.message
      })
    }
  }

  if (entities.length === 0) {
    const heuristicEntities = extractHeuristicEntities(request.context.query, request.context.answerText)
    if (heuristicEntities.length > 0) {
      entities = heuristicEntities
      nerInfo = {
        ...nerInfo,
        status: nerInfo.status === 'ok' ? 'ok_with_fallback' : 'fallback',
        message: nerInfo.status === 'ok'
          ? 'llm_no_entities_used_heuristic_fallback'
          : `${cleanText(nerInfo.message) || 'ner_failed'}; used_heuristic_fallback`
      }
    }
  }

  if (isNextStepIntentCard && entities.length === 0) {
    const keywordEntities = extractKeywordEntitiesFromQuery(request.context.query)
    if (keywordEntities.length > 0) {
      entities = keywordEntities
      nerInfo = {
        ...nerInfo,
        status: nerInfo.status === 'ok' ? 'ok_with_keyword_fallback' : 'keyword_fallback',
        message: nerInfo.status === 'ok'
          ? 'llm_no_entities_used_keyword_fallback'
          : `${cleanText(nerInfo.message) || 'ner_failed'}; used_keyword_fallback`
      }
    }
  }

  const strictEntityMode = !request.context.testAllOffers && !isNextStepIntentCard
  const keywords = buildSearchKeywords(request, entities, {
    includeQuery: !strictEntityMode || isNextStepIntentCard
  })
  const entitySignature = entities
    .map((entity) => `${cleanText(entity.entityType).toLowerCase()}:${cleanText(entity.normalizedText).toLowerCase()}`)
    .filter(Boolean)
    .sort()
    .join('|')

  if (strictEntityMode && entities.length === 0) {
    const debug = {
      entities,
      ner: nerInfo,
      keywords,
      noFillReason: 'ner_no_entities',
      totalOffers: 0,
      selectedOffers: 0,
      invalidOffersDroppedByTestAllValidation: 0,
      networkOrder: DEFAULT_NETWORK_ORDER,
      networkHits: { partnerstack: 0, cj: 0 },
      networkErrors: [],
      snapshotUsage: {},
      snapshotCacheStatus: {
        partnerstack: 'skipped',
        cj: 'skipped'
      },
      networkHealth: getAllNetworkHealth(),
      cache: {
        queryCacheHit: false,
        queryCacheEnabled,
        queryCacheTtlMs,
        snapshotCacheEnabled,
        snapshotCacheTtlMs,
        degradationEnabled,
        healthPolicy
      },
      testAllOffers: request.context.testAllOffers
    }

    safeLog(logger, 'info', {
      event: 'ads_pipeline_result',
      requestId,
      placementId,
      entities: [],
      networkHits: { partnerstack: 0, cj: 0 },
      adCount: 0,
      errorCodes: [],
      queryCacheHit: false
    })

    return {
      adResponse: {
        requestId,
        placementId,
        ads: []
      },
      debug
    }
  }

  const queryCacheKey = buildQueryCacheKey(request, maxAds, entitySignature)

  if (queryCacheEnabled) {
    const cached = queryCache.get(queryCacheKey)
    if (cached) {
      const adResponse = {
        requestId,
        placementId,
        ads: deepClone(cached.ads)
      }
      const debug = deepClone(cached.debug)
      debug.cache = {
        queryCacheHit: true,
        queryCacheTtlMs,
        snapshotCacheEnabled,
        degradationEnabled,
        healthPolicy
      }
      debug.networkHealth = getAllNetworkHealth()

      const entitySummaries = Array.isArray(debug.entities)
        ? debug.entities.map((entity) => ({
            entityText: entity.entityText,
            entityType: entity.entityType,
            confidence: entity.confidence
          }))
        : []
      safeLog(logger, 'info', {
        event: 'ads_pipeline_result',
        requestId,
        placementId,
        entities: entitySummaries,
        networkHits: debug.networkHits || { partnerstack: 0, cj: 0 },
        adCount: adResponse.ads.length,
        errorCodes: (debug.networkErrors || []).map((item) => item.errorCode),
        queryCacheHit: true
      })

      return { adResponse, debug }
    }
  }

  const partnerstackQueryParams = {
    search: keywords,
    limit: request.context.debug.partnerstackLimit,
    limitPartnerships: request.context.debug.partnerstackLimitPartnerships,
    limitLinksPerPartnership: request.context.debug.partnerstackLimitLinks
  }
  const cjQueryParams = {
    keywords,
    limit: request.context.debug.cjLimit,
    page: request.context.debug.cjPage,
    websiteId: request.context.debug.cjWebsiteId,
    advertiserIds: request.context.debug.cjAdvertiserIds
  }
  const houseQueryParams = {
    keywords,
    query: request.context.query,
    locale: request.context.locale,
    market: request.context.debug.houseMarket || '',
    limit: request.context.debug.houseLimit
  }

  const [partnerstackResult, cjResult, houseResult] = await Promise.all([
    fetchOffersWithSnapshot({
      network: 'partnerstack',
      queryParams: partnerstackQueryParams,
      fetcher: () => (
        isNextStepIntentCard && typeof partnerstackConnector.fetchLinksCatalog === 'function'
          ? partnerstackConnector.fetchLinksCatalog(partnerstackQueryParams)
          : partnerstackConnector.fetchOffers(partnerstackQueryParams)
      ),
      healthCheck: partnerstackConnector.healthCheck,
      snapshotCacheEnabled,
      snapshotCacheTtlMs,
      degradationEnabled,
      healthPolicy
    }),
    fetchOffersWithSnapshot({
      network: 'cj',
      queryParams: cjQueryParams,
      fetcher: () => (
        isNextStepIntentCard && typeof cjConnector.fetchLinksCatalog === 'function'
          ? cjConnector.fetchLinksCatalog(cjQueryParams)
          : cjConnector.fetchOffers(cjQueryParams)
      ),
      healthCheck: cjConnector.healthCheck,
      snapshotCacheEnabled,
      snapshotCacheTtlMs,
      degradationEnabled,
      healthPolicy
    }),
    isNextStepIntentCard
      ? fetchOffersWithSnapshot({
          network: 'house',
          queryParams: houseQueryParams,
          fetcher: () => (
            typeof houseConnector.fetchProductOffersCatalog === 'function'
              ? houseConnector.fetchProductOffersCatalog(houseQueryParams)
              : houseConnector.fetchOffers(houseQueryParams)
          ),
          healthCheck: houseConnector.healthCheck,
          snapshotCacheEnabled,
          snapshotCacheTtlMs,
          degradationEnabled,
          healthPolicy
        })
      : Promise.resolve({
          offers: [],
          snapshotUsed: false,
          cacheStatus: 'skipped',
          error: null,
          sourceDebug: null
        })
  ])

  const networkHits = isNextStepIntentCard
    ? {
        partnerstack: 0,
        cj: 0,
        house: 0
      }
    : {
        partnerstack: 0,
        cj: 0
      }
  const snapshotUsage = isNextStepIntentCard
    ? {
        partnerstack: partnerstackResult.snapshotUsed,
        cj: cjResult.snapshotUsed,
        house: houseResult.snapshotUsed
      }
    : {
        partnerstack: partnerstackResult.snapshotUsed,
        cj: cjResult.snapshotUsed
      }

  const rawOffers = []
  const networkErrors = []

  networkHits.partnerstack = partnerstackResult.offers.length
  networkHits.cj = cjResult.offers.length
  rawOffers.push(...partnerstackResult.offers, ...cjResult.offers)

  if (isNextStepIntentCard) {
    networkHits.house = houseResult.offers.length
    rawOffers.push(...houseResult.offers)
  }

  if (partnerstackResult.error) {
    networkErrors.push({
      network: 'partnerstack',
      errorCode: partnerstackResult.error.errorCode,
      message: partnerstackResult.error.message
    })
  }
  if (cjResult.error) {
    networkErrors.push({
      network: 'cj',
      errorCode: cjResult.error.errorCode,
      message: cjResult.error.message
    })
  }
  if (isNextStepIntentCard && houseResult.error) {
    networkErrors.push({
      network: 'house',
      errorCode: houseResult.error.errorCode,
      message: houseResult.error.message
    })
  }

  const offers = normalizeUnifiedOffers(rawOffers)
  const intentCardCatalog = isNextStepIntentCard ? normalizeIntentCardCatalog(offers) : []
  const offersForRanking = isNextStepIntentCard
    ? enrichOffersWithIntentCardCatalog(offers, intentCardCatalog)
    : offers
  const selection = rankAndSelectOffers(offersForRanking, entities, request.context, maxAds)
  let selected = Array.isArray(selection.selected) ? selection.selected : []
  const invalidForTestAll = Number.isFinite(selection.invalidForTestAll) ? selection.invalidForTestAll : 0
  const matchedCandidates = Number.isFinite(selection.matchedCandidates) ? selection.matchedCandidates : 0
  const unmatchedOffers = Number.isFinite(selection.unmatchedOffers) ? selection.unmatchedOffers : 0
  const semanticFilteredOut = Number.isFinite(selection.semanticFilteredOut) ? selection.semanticFilteredOut : 0
  let intentCardVectorFallbackUsed = false
  let intentCardVectorFallbackSelected = 0
  let intentCardVectorFallbackMeta = null

  if (isNextStepIntentCard && selected.length === 0 && !request.context.testAllOffers) {
    const vectorFallback = fallbackSelectOffersByIntentCardVector({
      offers: offersForRanking,
      catalog: intentCardCatalog,
      requestContext: request.context,
      maxAds,
    })

    if (Array.isArray(vectorFallback.selected) && vectorFallback.selected.length > 0) {
      selected = vectorFallback.selected
      intentCardVectorFallbackUsed = true
      intentCardVectorFallbackSelected = vectorFallback.selected.length
    }

    if (vectorFallback.retrieval || vectorFallback.indexStats) {
      intentCardVectorFallbackMeta = {
        ...(vectorFallback.indexStats || {}),
        candidateCount: Number(vectorFallback.retrieval?.meta?.candidateCount || 0),
        topK: Number(vectorFallback.retrieval?.meta?.topK || 0),
        minScore: Number(
          vectorFallback.retrieval?.meta?.minScore ?? DEFAULT_INTENT_CARD_RETRIEVAL_MIN_SCORE
        ),
      }
    }
  }

  const ads = selected.map((item) =>
    toAdRecord(item.offer, {
      reason: request.context.testAllOffers
        ? 'test_all_offers'
        : item.matchSource === 'intent_card_vector'
          ? 'intent_card_vector'
          : 'entity_match',
      entityText: item.matchedEntityText
    })
  )
  const orderedAds = isNextStepIntentCard ? ads : groupAdsByNetworkOrder(ads)
  const entitySummaries = entities.map((entity) => ({
    entityText: entity.entityText,
    entityType: entity.entityType,
    confidence: entity.confidence
  }))

  safeLog(logger, 'info', {
    event: 'ads_pipeline_result',
    requestId,
    placementId,
    entities: entitySummaries,
    networkHits,
    adCount: orderedAds.length,
    errorCodes: networkErrors.map((item) => item.errorCode),
    queryCacheHit: false,
    snapshotUsage,
    networkHealth: getAllNetworkHealth()
  })

  const debug = {
    entities,
    ner: nerInfo,
    keywords,
    entitySignature,
    totalOffers: offers.length,
    selectedOffers: orderedAds.length,
    matchedCandidates,
    unmatchedOffers,
    semanticFilteredOut,
    intentCardVectorFallbackUsed,
    intentCardVectorFallbackSelected,
    intentCardVectorFallbackMeta,
    invalidOffersDroppedByTestAllValidation: invalidForTestAll,
    networkOrder: DEFAULT_NETWORK_ORDER,
    networkHits,
    networkErrors,
    snapshotUsage,
    snapshotCacheStatus: isNextStepIntentCard
      ? {
          partnerstack: partnerstackResult.cacheStatus,
          cj: cjResult.cacheStatus,
          house: houseResult.cacheStatus
        }
      : {
          partnerstack: partnerstackResult.cacheStatus,
          cj: cjResult.cacheStatus
        },
    sourceModes: isNextStepIntentCard
      ? {
          partnerstack: 'links_catalog',
          cj: 'links_catalog',
          house: 'product_offers_catalog'
        }
      : {
          partnerstack: 'offers_catalog',
          cj: 'offers_catalog'
        },
    sourceDebug: isNextStepIntentCard
      ? {
          partnerstack: partnerstackResult.sourceDebug || {},
          cj: cjResult.sourceDebug || {},
          house: houseResult.sourceDebug || {}
        }
      : {
          partnerstack: partnerstackResult.sourceDebug || {},
          cj: cjResult.sourceDebug || {}
        },
    intentCardCatalog: isNextStepIntentCard ? summarizeIntentCardCatalog(intentCardCatalog) : null,
    networkHealth: getAllNetworkHealth(),
    cache: {
      queryCacheHit: false,
      queryCacheEnabled,
      queryCacheTtlMs,
      snapshotCacheEnabled,
      snapshotCacheTtlMs,
      degradationEnabled,
      healthPolicy
    },
    testAllOffers: request.context.testAllOffers
  }

  if (queryCacheEnabled) {
    queryCache.set(
      queryCacheKey,
      {
        ads: deepClone(orderedAds),
        debug: deepClone(debug)
      },
      queryCacheTtlMs
    )
  }

  return {
    adResponse: {
      requestId,
      placementId,
      ads: orderedAds
    },
    debug
  }
}
