import { loadRuntimeConfig } from '../config/runtime-config.js'
import { createCjConnector } from '../connectors/cj/index.js'
import { createPartnerStackConnector } from '../connectors/partnerstack/index.js'
import { extractEntitiesWithLlm } from '../ner/index.js'
import { normalizeUnifiedOffers } from '../offers/index.js'
import { offerSnapshotCache, queryCache } from '../cache/runtime-caches.js'

const DEFAULT_MAX_ADS = 20
const DEFAULT_PLACEMENT_ID = 'attach.post_answer_render'
const DEFAULT_NETWORK_ORDER = ['partnerstack', 'cj']
const DEFAULT_QUERY_CACHE_TTL_MS = 15000
const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 120000
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

function buildSearchKeywords(request, entities = []) {
  const terms = [
    request.context.query,
    ...entities.map((entity) => entity.normalizedText),
    ...entities.map((entity) => entity.entityText)
  ]
  return uniqueStrings(terms).slice(0, 12).join(' ')
}

function buildEntityMatcher(entities = []) {
  const normalized = uniqueStrings(
    entities.flatMap((entity) => [entity.entityText, entity.normalizedText])
  ).map((item) => item.toLowerCase())

  return function scoreOffer(offer) {
    if (normalized.length === 0) return { score: 0, matchedEntityText: '' }

    const candidateFields = [
      cleanText(offer.entityText).toLowerCase(),
      cleanText(offer.normalizedEntityText).toLowerCase(),
      cleanText(offer.title).toLowerCase(),
      cleanText(offer.description).toLowerCase()
    ]

    let score = 0
    let matchedEntityText = ''

    for (const token of normalized) {
      if (!token) continue
      if (candidateFields.some((field) => field.includes(token))) {
        score += token.length
        if (!matchedEntityText) matchedEntityText = token
      }
    }

    return { score, matchedEntityText }
  }
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

  return {
    adId: cleanText(offer.offerId) || `${offer.sourceNetwork}_${Date.now()}`,
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
  const withScore = offers.map((offer) => {
    const { score, matchedEntityText } = scoreOffer(offer)
    return {
      offer,
      score,
      matchedEntityText,
      availabilityScore: availabilityRank(offer.availability),
      freshnessScore: freshnessRank(offer.updatedAt)
    }
  })

  withScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.availabilityScore !== a.availabilityScore) return b.availabilityScore - a.availabilityScore
    if (b.freshnessScore !== a.freshnessScore) return b.freshnessScore - a.freshnessScore
    return 0
  })

  return {
    selected: withScore.slice(0, maxAds),
    invalidForTestAll: 0
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

function buildQueryCacheKey(request, maxAds) {
  const debug = request.context.debug || {}
  const payload = {
    v: QUERY_CACHE_VERSION,
    appId: request.appId,
    placementId: DEFAULT_PLACEMENT_ID,
    query: request.context.query,
    answerText: request.context.answerText,
    locale: request.context.locale,
    testAllOffers: request.context.testAllOffers,
    maxAds,
    debug: {
      partnerstackLimit: debug.partnerstackLimit,
      partnerstackLimitPartnerships: debug.partnerstackLimitPartnerships,
      partnerstackLimitLinks: debug.partnerstackLimitLinks,
      cjLimit: debug.cjLimit,
      cjPage: debug.cjPage,
      cjWebsiteId: debug.cjWebsiteId,
      cjAdvertiserIds: debug.cjAdvertiserIds
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
    snapshotCacheEnabled,
    snapshotCacheTtlMs
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

  try {
    const liveResult = await fetcher()
    const liveOffers = Array.isArray(liveResult?.offers) ? liveResult.offers : []

    if (liveOffers.length > 0) {
      setSnapshot(liveOffers)
      return {
        offers: liveOffers,
        snapshotUsed: false,
        cacheStatus: 'live',
        error: null
      }
    }

    const snapshot = getSnapshot()
    if (snapshot && Array.isArray(snapshot.offers) && snapshot.offers.length > 0) {
      return {
        offers: snapshot.offers,
        snapshotUsed: true,
        cacheStatus: 'snapshot_fallback_empty',
        error: null
      }
    }

    return {
      offers: [],
      snapshotUsed: false,
      cacheStatus: 'live_empty',
      error: null
    }
  } catch (error) {
    const snapshot = getSnapshot()
    if (snapshot && Array.isArray(snapshot.offers) && snapshot.offers.length > 0) {
      return {
        offers: snapshot.offers,
        snapshotUsed: true,
        cacheStatus: 'snapshot_fallback_error',
        error: {
          errorCode: resolveErrorCode(error),
          message: error?.message || 'Unknown error'
        }
      }
    }

    return {
      offers: [],
      snapshotUsed: false,
      cacheStatus: 'live_error',
      error: {
        errorCode: resolveErrorCode(error),
        message: error?.message || 'Unknown error'
      }
    }
  }
}

export async function runAdsRetrievalPipeline(adRequest, options = {}) {
  const request = normalizeAdRequest(adRequest)
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig()
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
  const queryCacheKey = buildQueryCacheKey(request, maxAds)

  if (queryCacheEnabled) {
    const cached = queryCache.get(queryCacheKey)
    if (cached) {
      const adResponse = {
        requestId,
        placementId: DEFAULT_PLACEMENT_ID,
        ads: deepClone(cached.ads)
      }
      const debug = deepClone(cached.debug)
      debug.cache = {
        queryCacheHit: true,
        queryCacheTtlMs,
        snapshotCacheEnabled
      }

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
        placementId: DEFAULT_PLACEMENT_ID,
        entities: entitySummaries,
        networkHits: debug.networkHits || { partnerstack: 0, cj: 0 },
        adCount: adResponse.ads.length,
        errorCodes: (debug.networkErrors || []).map((item) => item.errorCode),
        queryCacheHit: true
      })

      return { adResponse, debug }
    }
  }

  const partnerstackConnector =
    options.partnerstackConnector || createPartnerStackConnector({ runtimeConfig })
  const cjConnector = options.cjConnector || createCjConnector({ runtimeConfig })
  const nerExtractor = options.nerExtractor || extractEntitiesWithLlm

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

  const entities = Array.isArray(nerResult?.entities) ? nerResult.entities : []
  const keywords = buildSearchKeywords(request, entities)
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

  const [partnerstackResult, cjResult] = await Promise.all([
    fetchOffersWithSnapshot({
      network: 'partnerstack',
      queryParams: partnerstackQueryParams,
      fetcher: () => partnerstackConnector.fetchOffers(partnerstackQueryParams),
      snapshotCacheEnabled,
      snapshotCacheTtlMs
    }),
    fetchOffersWithSnapshot({
      network: 'cj',
      queryParams: cjQueryParams,
      fetcher: () => cjConnector.fetchOffers(cjQueryParams),
      snapshotCacheEnabled,
      snapshotCacheTtlMs
    })
  ])

  const networkErrors = []
  const rawOffers = []
  const networkHits = {
    partnerstack: 0,
    cj: 0
  }
  const snapshotUsage = {
    partnerstack: partnerstackResult.snapshotUsed,
    cj: cjResult.snapshotUsed
  }

  networkHits.partnerstack = partnerstackResult.offers.length
  networkHits.cj = cjResult.offers.length
  rawOffers.push(...partnerstackResult.offers, ...cjResult.offers)

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

  const offers = normalizeUnifiedOffers(rawOffers)
  const { selected, invalidForTestAll } = rankAndSelectOffers(offers, entities, request.context, maxAds)
  const ads = selected.map((item) =>
    toAdRecord(item.offer, {
      reason: request.context.testAllOffers
        ? 'test_all_offers'
        : item.score > 0
          ? 'entity_match'
          : 'network_offer',
      entityText: item.matchedEntityText
    })
  )
  const orderedAds = groupAdsByNetworkOrder(ads)
  const entitySummaries = entities.map((entity) => ({
    entityText: entity.entityText,
    entityType: entity.entityType,
    confidence: entity.confidence
  }))

  safeLog(logger, 'info', {
    event: 'ads_pipeline_result',
    requestId,
    placementId: DEFAULT_PLACEMENT_ID,
    entities: entitySummaries,
    networkHits,
    adCount: orderedAds.length,
    errorCodes: networkErrors.map((item) => item.errorCode),
    queryCacheHit: false,
    snapshotUsage
  })

  const debug = {
    entities,
    keywords,
    totalOffers: offers.length,
    selectedOffers: orderedAds.length,
    invalidOffersDroppedByTestAllValidation: invalidForTestAll,
    networkOrder: DEFAULT_NETWORK_ORDER,
    networkHits,
    networkErrors,
    snapshotUsage,
    snapshotCacheStatus: {
      partnerstack: partnerstackResult.cacheStatus,
      cj: cjResult.cacheStatus
    },
    cache: {
      queryCacheHit: false,
      queryCacheEnabled,
      queryCacheTtlMs,
      snapshotCacheEnabled,
      snapshotCacheTtlMs
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
      placementId: DEFAULT_PLACEMENT_ID,
      ads: orderedAds
    },
    debug
  }
}
