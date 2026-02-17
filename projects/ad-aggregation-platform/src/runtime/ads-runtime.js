import { loadRuntimeConfig } from '../config/runtime-config.js'
import { createCjConnector } from '../connectors/cj/index.js'
import { createPartnerStackConnector } from '../connectors/partnerstack/index.js'
import { extractEntitiesWithLlm } from '../ner/index.js'
import { normalizeUnifiedOffers } from '../offers/index.js'

const DEFAULT_MAX_ADS = 20
const DEFAULT_PLACEMENT_ID = 'attach.post_answer_render'
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
    return { offer, score, matchedEntityText }
  })

  const matchedOnly = withScore.filter((item) => item.score > 0)
  const base = matchedOnly.length > 0 ? matchedOnly : withScore
  base.sort((a, b) => b.score - a.score)

  return {
    selected: base.slice(0, maxAds),
    invalidForTestAll: 0
  }
}

function createRequestId() {
  return `adreq_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

export async function runAdsRetrievalPipeline(adRequest, options = {}) {
  const request = normalizeAdRequest(adRequest)
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig()
  const maxAds = Number.isInteger(options.maxAds) ? options.maxAds : DEFAULT_MAX_ADS

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

  const [partnerstackResult, cjResult] = await Promise.allSettled([
    partnerstackConnector.fetchOffers({
      search: keywords,
      limit: request.context.debug.partnerstackLimit,
      limitPartnerships: request.context.debug.partnerstackLimitPartnerships,
      limitLinksPerPartnership: request.context.debug.partnerstackLimitLinks
    }),
    cjConnector.fetchOffers({
      keywords,
      limit: request.context.debug.cjLimit,
      page: request.context.debug.cjPage,
      websiteId: request.context.debug.cjWebsiteId,
      advertiserIds: request.context.debug.cjAdvertiserIds
    })
  ])

  const networkErrors = []
  const rawOffers = []

  if (partnerstackResult.status === 'fulfilled') {
    rawOffers.push(...(partnerstackResult.value?.offers || []))
  } else {
    networkErrors.push({
      network: 'partnerstack',
      message: partnerstackResult.reason?.message || 'Unknown error'
    })
  }

  if (cjResult.status === 'fulfilled') {
    rawOffers.push(...(cjResult.value?.offers || []))
  } else {
    networkErrors.push({
      network: 'cj',
      message: cjResult.reason?.message || 'Unknown error'
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

  return {
    adResponse: {
      requestId: createRequestId(),
      placementId: request.placementId,
      ads
    },
    debug: {
      entities,
      keywords,
      totalOffers: offers.length,
      selectedOffers: ads.length,
      invalidOffersDroppedByTestAllValidation: invalidForTestAll,
      networkErrors,
      testAllOffers: request.context.testAllOffers
    }
  }
}
