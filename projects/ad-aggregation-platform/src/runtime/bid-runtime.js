import { createHash } from 'node:crypto'

import { loadRuntimeConfig } from '../config/runtime-config.js'
import { createCjConnector } from '../connectors/cj/index.js'
import { createHouseConnector } from '../connectors/house/index.js'
import { createPartnerStackConnector } from '../connectors/partnerstack/index.js'
import { normalizeUnifiedOffers } from '../offers/index.js'

const DEFAULT_MAX_FANOUT = 3
const DEFAULT_GLOBAL_TIMEOUT_MS = 1200
const DEFAULT_BIDDER_TIMEOUT_MS = 800
const DEFAULT_LIMIT = 20
const SUPPORTED_ROLES = new Set(['user', 'assistant', 'system'])

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function toPositiveInteger(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric)
  }
  return fallback
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric === 'number' && Number.isFinite(numeric)) return numeric
  return fallback
}

function normalizeMessages(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const role = cleanText(String(item.role || '').toLowerCase())
      const content = cleanText(item.content)
      if (!SUPPORTED_ROLES.has(role) || !content) return null
      const timestamp = cleanText(item.timestamp)
      return {
        role,
        content,
        ...(timestamp ? { timestamp } : {}),
      }
    })
    .filter(Boolean)
}

function deriveMessageSignals(messages = []) {
  const normalized = normalizeMessages(messages)
  let query = ''
  let answerText = ''

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const item = normalized[index]
    if (!query && item.role === 'user') {
      query = item.content
    }
    if (!answerText && item.role === 'assistant') {
      answerText = item.content
    }
    if (query && answerText) break
  }

  const recentTurns = normalized.slice(-8)
  return {
    query,
    answerText,
    recentTurns,
    messages: normalized,
  }
}

function buildBidId(seed) {
  return `v2_bid_${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`
}

function makeBidFromOffer(offer, context = {}) {
  const normalizedOffer = offer && typeof offer === 'object' ? offer : null
  if (!normalizedOffer) return null

  const url = cleanText(normalizedOffer.trackingUrl || normalizedOffer.targetUrl)
  const title = cleanText(normalizedOffer.title)
  if (!url || !title) return null

  const networkId = cleanText(context.networkId || normalizedOffer.sourceNetwork || 'network')
  const advertiser = cleanText(normalizedOffer.merchantName || normalizedOffer.entityText || networkId) || networkId
  const price = Math.max(0, toFiniteNumber(normalizedOffer.bidValue, 0))
  const bidId = buildBidId(`${context.requestId || ''}|${networkId}|${normalizedOffer.offerId || title}`)

  return {
    price,
    advertiser,
    headline: title,
    description: cleanText(normalizedOffer.description) || title,
    cta_text: 'Learn More',
    url,
    image_url: cleanText(normalizedOffer.metadata?.imageUrl || normalizedOffer.metadata?.image_url),
    dsp: networkId,
    bidId,
    placement: cleanText(context.placement || 'block') || 'block',
    variant: cleanText(context.variant || 'base') || 'base',
    __rank: {
      networkId,
      price,
      policyScore: toFiniteNumber(context.policyScore, 0),
      qualityScore: toFiniteNumber(normalizedOffer.qualityScore, 0),
    },
    __offer: normalizedOffer,
  }
}

function timeoutError(networkId, timeoutMs) {
  const error = new Error(`${networkId} timeout after ${timeoutMs}ms`)
  error.code = 'BIDDER_TIMEOUT'
  return error
}

async function withTimeout(task, timeoutMs, networkId) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(timeoutError(networkId, timeoutMs))
    }, timeoutMs)

    Promise.resolve()
      .then(task)
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function normalizeBidderConfig(value) {
  if (!value || typeof value !== 'object') return null
  const networkId = cleanText(value.networkId || value.network_id).toLowerCase()
  if (!networkId) return null

  return {
    networkId,
    endpoint: cleanText(value.endpoint),
    timeoutMs: toPositiveInteger(value.timeoutMs ?? value.timeout_ms, DEFAULT_BIDDER_TIMEOUT_MS),
    enabled: value.enabled !== false,
    policyWeight: toFiniteNumber(value.policyWeight ?? value.policy_weight, 0),
  }
}

function normalizeBidders(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeBidderConfig(item))
    .filter((item) => item && item.enabled)
}

function sortBidsForWinner(items = []) {
  const ranked = [...items]
  ranked.sort((a, b) => {
    if (b.__rank.price !== a.__rank.price) return b.__rank.price - a.__rank.price
    if (b.__rank.policyScore !== a.__rank.policyScore) return b.__rank.policyScore - a.__rank.policyScore
    if (b.__rank.qualityScore !== a.__rank.qualityScore) return b.__rank.qualityScore - a.__rank.qualityScore
    return a.__rank.networkId.localeCompare(b.__rank.networkId)
  })
  return ranked
}

function removeInternalRankFields(bid) {
  if (!bid || typeof bid !== 'object') return null
  const output = { ...bid }
  delete output.__rank
  delete output.__offer
  if (!output.image_url) delete output.image_url
  return output
}

function buildConnectors(runtimeConfig, bidderConfigs = []) {
  const byNetwork = new Map()

  for (const config of bidderConfigs) {
    if (!config || !config.networkId || byNetwork.has(config.networkId)) continue
    if (config.networkId === 'partnerstack') {
      byNetwork.set(config.networkId, createPartnerStackConnector({
        runtimeConfig,
        timeoutMs: config.timeoutMs,
        maxRetries: 0,
        ...(config.endpoint ? { baseUrl: config.endpoint } : {}),
      }))
      continue
    }

    if (config.networkId === 'cj') {
      byNetwork.set(config.networkId, createCjConnector({
        runtimeConfig,
        timeoutMs: config.timeoutMs,
        maxRetries: 0,
        ...(config.endpoint ? { offerBaseUrl: config.endpoint } : {}),
      }))
      continue
    }

    if (config.networkId === 'house') {
      byNetwork.set(config.networkId, createHouseConnector({ runtimeConfig }))
    }
  }

  if (!byNetwork.has('house')) {
    byNetwork.set('house', createHouseConnector({ runtimeConfig }))
  }

  return byNetwork
}

function buildNetworkQueryParams(networkId, messageSignals, request = {}) {
  const search = cleanText(request.searchQuery || messageSignals.query)
  if (networkId === 'partnerstack') {
    return {
      search,
      limit: DEFAULT_LIMIT,
      limitPartnerships: DEFAULT_LIMIT,
      limitLinksPerPartnership: 20,
    }
  }

  if (networkId === 'cj') {
    return {
      keywords: search,
      limit: DEFAULT_LIMIT,
      page: 1,
    }
  }

  if (networkId === 'house') {
    return {
      keywords: search,
      query: search,
      locale: cleanText(request.locale) || 'en-US',
      limit: DEFAULT_LIMIT,
    }
  }

  return {
    search,
    query: search,
    keywords: search,
    limit: DEFAULT_LIMIT,
  }
}

async function fetchNetworkOffers(networkId, connector, messageSignals, request = {}, placementId = '') {
  if (!connector || typeof connector !== 'object') {
    return {
      offers: [],
      debug: { mode: `${networkId}_connector_missing` },
    }
  }

  const params = buildNetworkQueryParams(networkId, messageSignals, request)
  const isFollowupPlacement = placementId === 'chat_followup_v1'

  if (networkId === 'house' && typeof connector.fetchProductOffersCatalog === 'function') {
    return await connector.fetchProductOffersCatalog(params)
  }

  if (isFollowupPlacement && typeof connector.fetchLinksCatalog === 'function') {
    return await connector.fetchLinksCatalog(params)
  }

  if (typeof connector.fetchOffers === 'function') {
    return await connector.fetchOffers(params)
  }

  if (typeof connector.fetchLinksCatalog === 'function') {
    return await connector.fetchLinksCatalog(params)
  }

  return {
    offers: [],
    debug: { mode: `${networkId}_fetch_method_missing` },
  }
}

function toWinnerCandidateBids(offers, bidderConfig, context = {}) {
  const normalized = normalizeUnifiedOffers(offers)
  return normalized
    .map((offer) => makeBidFromOffer(offer, {
      networkId: bidderConfig.networkId,
      requestId: context.requestId,
      placement: context.placement,
      variant: 'base',
      policyScore: bidderConfig.policyWeight,
    }))
    .filter(Boolean)
}

export async function runBidAggregationPipeline(input = {}, options = {}) {
  const startedAt = Date.now()
  const request = input && typeof input === 'object' ? input : {}
  const placement = request.placement && typeof request.placement === 'object' ? request.placement : {}
  const messageSignals = deriveMessageSignals(request.messages)

  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig(process.env, { strict: false })
  const maxFanout = toPositiveInteger(placement.maxFanout, DEFAULT_MAX_FANOUT)
  const globalTimeoutMs = toPositiveInteger(placement.globalTimeoutMs, DEFAULT_GLOBAL_TIMEOUT_MS)
  const bidderConfigs = normalizeBidders(placement.bidders)
    .filter((item) => item.networkId !== 'house')
    .slice(0, maxFanout)

  const connectors = options.connectors instanceof Map
    ? options.connectors
    : buildConnectors(runtimeConfig, [...bidderConfigs, { networkId: 'house', enabled: true }])
  const bidderResults = []
  const allCandidates = []

  for (const bidderConfig of bidderConfigs) {
    const timeoutMs = Math.max(100, Math.min(globalTimeoutMs, bidderConfig.timeoutMs || DEFAULT_BIDDER_TIMEOUT_MS))
    const connector = connectors.get(bidderConfig.networkId)

    try {
      const payload = await withTimeout(
        () => fetchNetworkOffers(bidderConfig.networkId, connector, messageSignals, request, placement.placementId),
        timeoutMs,
        bidderConfig.networkId,
      )
      const offers = Array.isArray(payload?.offers) ? payload.offers : []
      const bids = toWinnerCandidateBids(offers, bidderConfig, {
        requestId: request.requestId,
        placement: 'block',
      })

      allCandidates.push(...bids)
      bidderResults.push({
        networkId: bidderConfig.networkId,
        ok: true,
        timeout: false,
        bidCount: bids.length,
      })
    } catch (error) {
      bidderResults.push({
        networkId: bidderConfig.networkId,
        ok: false,
        timeout: error?.code === 'BIDDER_TIMEOUT' || error?.name === 'AbortError',
        bidCount: 0,
        error: error instanceof Error ? error.message : 'bidder_failed',
      })
    }
  }

  const ranked = sortBidsForWinner(allCandidates)
  let winner = ranked[0] || null
  let storeFallbackUsed = false

  const storeConfig = placement?.fallback?.store && typeof placement.fallback.store === 'object'
    ? placement.fallback.store
    : {}
  const storeEnabled = storeConfig.enabled === true
  const storeFloorPrice = Math.max(0, toFiniteNumber(storeConfig.floorPrice, 0))

  if (!winner && storeEnabled) {
    const houseConnector = connectors.get('house') || createHouseConnector({ runtimeConfig })
    try {
      const houseResult = await withTimeout(
        () => fetchNetworkOffers('house', houseConnector, messageSignals, request, placement.placementId),
        Math.max(100, Math.min(globalTimeoutMs, DEFAULT_BIDDER_TIMEOUT_MS)),
        'house',
      )
      const fallbackBids = toWinnerCandidateBids(
        Array.isArray(houseResult?.offers) ? houseResult.offers : [],
        {
          networkId: 'house',
          policyWeight: -1,
          timeoutMs: DEFAULT_BIDDER_TIMEOUT_MS,
          enabled: true,
        },
        {
          requestId: request.requestId,
          placement: 'block',
        },
      ).filter((item) => item.__rank.price >= storeFloorPrice)

      const fallbackRanked = sortBidsForWinner(fallbackBids)
      if (fallbackRanked.length > 0) {
        winner = fallbackRanked[0]
        storeFallbackUsed = true
      }
    } catch {
      // Ignore store fallback errors and continue as no-bid.
    }
  }

  return {
    requestId: cleanText(request.requestId),
    placementId: cleanText(placement.placementId || request.placementId),
    winnerBid: winner ? removeInternalRankFields(winner) : null,
    diagnostics: {
      fanoutCount: bidderConfigs.length,
      timeoutCount: bidderResults.filter((item) => item.timeout).length,
      noBid: winner === null,
      storeFallbackUsed,
      winnerNetwork: winner ? winner.__rank.networkId : '',
      bidders: bidderResults,
      bidLatencyMs: Math.max(0, Date.now() - startedAt),
      messageSignals: {
        query: messageSignals.query,
        answerText: messageSignals.answerText,
        recentTurns: messageSignals.recentTurns,
      },
    },
  }
}
