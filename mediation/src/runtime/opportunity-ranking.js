import {
  computeCandidateEconomicPricing,
  getPricingModelWeights,
  getPricingMediationDefaults,
} from './pricing-model.js'

const DEFAULT_SCORE_FLOOR = 0.32
const DEFAULT_INTENT_MIN_LEXICAL_SCORE = 0.02
const DEFAULT_INTENT_MIN_VECTOR_SCORE = 0.35
const INTENT_RELEVANCE_GATED_PLACEMENT = 'chat_intent_recommendation_v1'

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function shouldApplyRelevanceGate(placementId = '') {
  return cleanText(placementId) === INTENT_RELEVANCE_GATED_PLACEMENT
}

function normalizeQuality(value) {
  const n = toFiniteNumber(value, 0)
  if (n <= 0) return 0
  if (n <= 1) return clamp01(n)
  return clamp01(n / 100)
}

function normalizePolicyWeight(value) {
  const n = toFiniteNumber(value, 0)
  return clamp01((n + 2) / 4)
}

function freshnessScore(value) {
  const text = cleanText(value)
  if (!text) return 0.45
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) return 0.45

  const ageHours = Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60))
  if (ageHours <= 24) return 1
  if (ageHours <= 72) return 0.8
  if (ageHours <= 7 * 24) return 0.55
  if (ageHours <= 14 * 24) return 0.35
  return 0.15
}

function containsBlockedTopic(text, blockedTopics = []) {
  const corpus = cleanText(text).toLowerCase()
  if (!corpus) return ''
  for (const topic of blockedTopics) {
    const normalizedTopic = cleanText(topic).toLowerCase()
    if (!normalizedTopic) continue
    if (corpus.includes(normalizedTopic)) return normalizedTopic
  }
  return ''
}

function resolveBidImageUrl(candidate = {}) {
  const metadata = candidate?.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {}
  return cleanText(
    metadata.image_url
    || metadata.imageUrl
    || metadata.brand_image_url
    || metadata.brandImageUrl
    || metadata.icon_url
    || metadata.iconUrl,
  )
}

function resolveCampaignId(candidate = {}) {
  const metadata = candidate?.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {}
  return cleanText(
    metadata.campaignId
    || metadata.campaign_id
    || metadata.programId
    || metadata.program_id
    || metadata.advertiserId
    || metadata.advertiser_id,
  )
}

function resolveAdvertiserName(candidate = {}) {
  const metadata = candidate?.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {}
  const prioritized = [
    metadata.merchant,
    metadata.merchantName,
    metadata.advertiserName,
    metadata.partnerName,
    metadata.brandName,
    metadata.brand_name,
    metadata.brandId,
    metadata.brand_id,
  ]

  for (const value of prioritized) {
    const advertiser = cleanText(value)
    if (advertiser) return advertiser
  }

  return cleanText(candidate.network || 'inventory') || 'inventory'
}

function toBid(candidate = {}, context = {}) {
  const title = cleanText(candidate.title)
  const targetUrl = cleanText(candidate.targetUrl)
  if (!title || !targetUrl) return null

  const bidId = cleanText(candidate.offerId) || `bid_${Date.now()}`
  const pricing = candidate?.pricing && typeof candidate.pricing === 'object' ? candidate.pricing : null
  const price = Math.max(0, toFiniteNumber(pricing?.cpcUsd ?? candidate.bidHint, 0))
  const campaignId = resolveCampaignId(candidate)

  return {
    price,
    advertiser: resolveAdvertiserName(candidate),
    headline: title,
    description: cleanText(candidate.description) || title,
    cta_text: 'Learn More',
    url: targetUrl,
    image_url: resolveBidImageUrl(candidate),
    dsp: cleanText(candidate.network),
    bidId,
    ...(campaignId ? { campaignId } : {}),
    placement: cleanText(context.placement || 'block') || 'block',
    variant: 'opportunity_first_v1',
    pricing: pricing
      ? {
          modelVersion: cleanText(pricing.modelVersion),
          pricingSemanticsVersion: cleanText(pricing.pricingSemanticsVersion),
          billingUnit: cleanText(pricing.billingUnit).toLowerCase() || 'cpc',
          targetRpmUsd: toFiniteNumber(pricing.targetRpmUsd, 0),
          ecpmUsd: toFiniteNumber(pricing.ecpmUsd, 0),
          cpcUsd: toFiniteNumber(pricing.cpcUsd, 0),
          cpaUsd: toFiniteNumber(pricing.cpaUsd, 0),
          pClick: toFiniteNumber(pricing.pClick, 0),
          pConv: toFiniteNumber(pricing.pConv, 0),
          triggerType: cleanText(pricing.triggerType),
          network: cleanText(pricing.network || candidate.network || ''),
          rawSignal: pricing.rawSignal && typeof pricing.rawSignal === 'object'
            ? {
                rawBidValue: toFiniteNumber(pricing.rawSignal.rawBidValue, 0),
                rawUnit: cleanText(pricing.rawSignal.rawUnit),
                normalizedFactor: toFiniteNumber(pricing.rawSignal.normalizedFactor, 1),
              }
            : {
                rawBidValue: Math.max(0, toFiniteNumber(candidate.bidHint, 0)),
                rawUnit: 'bid_hint',
                normalizedFactor: 1,
              },
        }
      : undefined,
  }
}

function scoreCandidate(candidate = {}, input = {}) {
  const intentScore = clamp01(input.intentScore)
  const similarity = clamp01(Math.max(toFiniteNumber(candidate.fusedScore), toFiniteNumber(candidate.vectorScore), toFiniteNumber(candidate.lexicalScore)))
  const quality = normalizeQuality(candidate.quality)
  const policyWeight = normalizePolicyWeight(candidate.policyWeight)
  const freshness = freshnessScore(candidate.freshnessAt || candidate.updatedAt)
  const availability = cleanText(candidate.availability).toLowerCase() === 'active' ? 1 : 0

  const rankScore = Number((
    similarity * 0.35
    + intentScore * 0.25
    + quality * 0.15
    + policyWeight * 0.1
    + freshness * 0.1
    + availability * 0.05
  ).toFixed(6))
  const pricing = computeCandidateEconomicPricing({
    candidate,
    placementId: input.placementId,
    triggerType: input.triggerType,
  })
  const weights = getPricingModelWeights()
  const auctionScore = Number((
    rankScore * weights.rankWeight
    + pricing.economicScore * weights.economicWeight
  ).toFixed(6))

  return {
    ...candidate,
    rankScore,
    auctionScore,
    pricing,
    rankFeatures: {
      intentScore,
      similarity,
      quality,
      policyWeight,
      freshness,
      availability,
    },
  }
}

export function rankOpportunityCandidates(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : []
  const pricingDefaults = getPricingMediationDefaults()
  const weights = getPricingModelWeights()
  const placementId = cleanText(input.placementId)
  const relevanceGateApplied = shouldApplyRelevanceGate(placementId)
  const minLexicalScore = clamp01(
    input.minLexicalScore ?? DEFAULT_INTENT_MIN_LEXICAL_SCORE,
    DEFAULT_INTENT_MIN_LEXICAL_SCORE,
  )
  const minVectorScore = clamp01(
    input.minVectorScore ?? DEFAULT_INTENT_MIN_VECTOR_SCORE,
    DEFAULT_INTENT_MIN_VECTOR_SCORE,
  )
  const scoreFloor = clamp01(input.scoreFloor ?? DEFAULT_SCORE_FLOOR)
  const baseRelevanceGate = {
    applied: relevanceGateApplied,
    placementId: placementId || '',
    minLexicalScore,
    minVectorScore,
    baseEligibleCount: 0,
    filteredCount: 0,
    eligibleCount: 0,
    triggered: false,
  }
  const blockedTopics = Array.isArray(input.blockedTopics)
    ? input.blockedTopics.map((item) => cleanText(item)).filter(Boolean)
    : []
  const query = cleanText(input.query)
  const answerText = cleanText(input.answerText)

  const blockedTopic = containsBlockedTopic(`${query} ${answerText}`, blockedTopics)
  if (blockedTopic) {
    return {
      winner: null,
      ranked: [],
      reasonCode: 'policy_blocked',
      debug: {
        policyBlockedTopic: blockedTopic,
        candidateCount: candidates.length,
        scoreFloor,
        relevanceGate: baseRelevanceGate,
        relevanceFilteredCount: 0,
        pricingModel: pricingDefaults.modelVersion,
      },
    }
  }

  if (candidates.length === 0) {
    return {
      winner: null,
      ranked: [],
      reasonCode: 'inventory_no_match',
      debug: {
        candidateCount: 0,
        scoreFloor,
        relevanceGate: baseRelevanceGate,
        relevanceFilteredCount: 0,
        pricingModel: pricingDefaults.modelVersion,
      },
    }
  }

  const baseEligible = candidates
    .filter((item) => cleanText(item?.title) && cleanText(item?.targetUrl))
    .filter((item) => cleanText(item?.availability || 'active').toLowerCase() === 'active')
  const eligible = relevanceGateApplied
    ? baseEligible.filter((item) => (
      toFiniteNumber(item?.lexicalScore, 0) >= minLexicalScore
      || toFiniteNumber(item?.vectorScore, 0) >= minVectorScore
    ))
    : baseEligible
  const relevanceFilteredCount = Math.max(0, baseEligible.length - eligible.length)
  const relevanceGate = {
    ...baseRelevanceGate,
    baseEligibleCount: baseEligible.length,
    filteredCount: relevanceFilteredCount,
    eligibleCount: eligible.length,
    triggered: relevanceGateApplied && relevanceFilteredCount > 0,
  }

  if (eligible.length === 0) {
    return {
      winner: null,
      ranked: [],
      reasonCode: relevanceGateApplied ? 'inventory_no_match' : 'policy_blocked',
      debug: {
        candidateCount: candidates.length,
        eligibleCount: 0,
        scoreFloor,
        relevanceGate,
        relevanceFilteredCount,
        pricingModel: pricingDefaults.modelVersion,
      },
    }
  }

  const scored = eligible
    .map((candidate) => scoreCandidate(candidate, {
      intentScore: input.intentScore,
      placementId: input.placementId,
      triggerType: input.triggerType,
    }))
  const ranked = [...scored]
    .sort((a, b) => {
      if (b.auctionScore !== a.auctionScore) return b.auctionScore - a.auctionScore
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore
      if (b.fusedScore !== a.fusedScore) return b.fusedScore - a.fusedScore
      return String(a.offerId || '').localeCompare(String(b.offerId || ''))
    })

  const auctionWinner = ranked[0] || null
  const topRankCandidate = [...scored].sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore
    if (b.auctionScore !== a.auctionScore) return b.auctionScore - a.auctionScore
    return String(a.offerId || '').localeCompare(String(b.offerId || ''))
  })[0] || null
  const rankDominanceFloor = clamp01(pricingDefaults.rankDominanceFloor ?? 0.5)
  const rankDominanceMargin = clamp01(pricingDefaults.rankDominanceMargin ?? 0.1)
  const scoreFloorOrGuard = Math.max(scoreFloor, rankDominanceFloor)
  const shouldProtectRankWinner = Boolean(
    auctionWinner
    && topRankCandidate
    && auctionWinner.offerId !== topRankCandidate.offerId
    && topRankCandidate.rankScore >= scoreFloorOrGuard
    && (topRankCandidate.rankScore - auctionWinner.rankScore) >= rankDominanceMargin,
  )
  const winner = shouldProtectRankWinner ? topRankCandidate : auctionWinner
  const relevanceGateWithWinner = {
    ...relevanceGate,
    winnerLexicalScore: winner ? toFiniteNumber(winner.lexicalScore, 0) : 0,
    winnerVectorScore: winner ? toFiniteNumber(winner.vectorScore, 0) : 0,
  }

  if (!winner || winner.rankScore < scoreFloor) {
    return {
      winner: null,
      ranked,
      reasonCode: 'rank_below_floor',
      debug: {
        candidateCount: candidates.length,
        eligibleCount: eligible.length,
        topRankScore: winner ? winner.rankScore : 0,
        topAuctionScore: winner ? winner.auctionScore : 0,
        topEconomicScore: winner?.pricing ? winner.pricing.economicScore : 0,
        rankDominanceApplied: false,
        scoreFloor,
        relevanceGate: relevanceGateWithWinner,
        relevanceFilteredCount,
        pricingModel: pricingDefaults.modelVersion,
        pricingWeights: weights,
      },
    }
  }

  return {
    winner: {
      ...winner,
      bid: toBid(winner, {
        placement: input.placement,
      }),
    },
    ranked,
    reasonCode: 'served',
    debug: {
      candidateCount: candidates.length,
      eligibleCount: eligible.length,
      topRankScore: winner.rankScore,
      topAuctionScore: winner.auctionScore,
      topEconomicScore: winner?.pricing ? winner.pricing.economicScore : 0,
      rankDominanceApplied: shouldProtectRankWinner,
      rankDominanceFloor,
      rankDominanceMargin,
      scoreFloor,
      relevanceGate: relevanceGateWithWinner,
      relevanceFilteredCount,
      pricingModel: pricingDefaults.modelVersion,
      pricingWeights: weights,
    },
  }
}

export { toBid as mapRankedCandidateToBid }
