function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function round(value, precision = 6) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Number(n.toFixed(precision))
}

function toPriorityValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return Number.MAX_SAFE_INTEGER
  return Math.floor(n)
}

const GLOBAL_AUCTION_SCORING = Object.freeze({
  relevanceWeight: 0.95,
  bidWeight: 0.05,
  bidNormalization: 'log1p_max',
})

function normalizeOption(input = {}) {
  const option = input && typeof input === 'object' ? input : {}
  const bid = option.bid && typeof option.bid === 'object' ? option.bid : null
  const bidPrice = bid ? toFiniteNumber(bid.price, 0) : toFiniteNumber(option.bidPrice, 0)
  const pricing = bid?.pricing && typeof bid.pricing === 'object' ? bid.pricing : null
  const relevanceScoreRaw = Number(option.relevanceScore)

  return {
    placementId: String(option.placementId || '').trim(),
    gatePassed: option.gatePassed === true,
    reasonCode: String(option.reasonCode || '').trim() || 'inventory_no_match',
    bid,
    bidPrice,
    ecpmUsd: toFiniteNumber(pricing?.ecpmUsd ?? option.ecpmUsd, 0),
    relevanceScore: Number.isFinite(relevanceScoreRaw) ? relevanceScoreRaw : Number.NaN,
    rankScore: toFiniteNumber(option.rankScore, 0),
    auctionScore: toFiniteNumber(option.auctionScore, 0),
    priority: toPriorityValue(option.priority),
    stageStatusMap: option.stageStatusMap && typeof option.stageStatusMap === 'object'
      ? { ...option.stageStatusMap }
      : {},
  }
}

function compareWinnerOptions(left, right) {
  if (right.compositeScore !== left.compositeScore) return right.compositeScore - left.compositeScore
  if (right.relevanceScore !== left.relevanceScore) return right.relevanceScore - left.relevanceScore
  if (right.bidNormalizedScore !== left.bidNormalizedScore) return right.bidNormalizedScore - left.bidNormalizedScore
  if (right.bidPrice !== left.bidPrice) return right.bidPrice - left.bidPrice
  if (right.ecpmUsd !== left.ecpmUsd) return right.ecpmUsd - left.ecpmUsd
  if (right.rankScore !== left.rankScore) return right.rankScore - left.rankScore
  if (right.auctionScore !== left.auctionScore) return right.auctionScore - left.auctionScore
  if (left.priority !== right.priority) return left.priority - right.priority
  return left.placementId.localeCompare(right.placementId)
}

const NO_BID_REASON_PRIORITY = Object.freeze({
  budget_unconfigured: 0,
  budget_exhausted: 1,
  risk_blocked: 2,
  inventory_empty: 0,
  relevance_blocked_strict: 3,
  relevance_blocked_cross_vertical: 4,
  rank_below_floor: 3,
  inventory_no_match: 4,
  upstream_timeout: 5,
  upstream_error: 6,
  policy_blocked: 7,
  placement_unavailable: 8,
})

function compareNoBidOptions(left, right) {
  if (left.gatePassed !== right.gatePassed) return left.gatePassed ? -1 : 1
  const leftPriority = Object.prototype.hasOwnProperty.call(NO_BID_REASON_PRIORITY, left.reasonCode)
    ? NO_BID_REASON_PRIORITY[left.reasonCode]
    : 99
  const rightPriority = Object.prototype.hasOwnProperty.call(NO_BID_REASON_PRIORITY, right.reasonCode)
    ? NO_BID_REASON_PRIORITY[right.reasonCode]
    : 99
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  if (left.priority !== right.priority) return left.priority - right.priority
  return left.placementId.localeCompare(right.placementId)
}

function summarizeLosers(options = [], winnerPlacementId = '') {
  const reasonCount = {}
  for (const option of options) {
    if (winnerPlacementId && option.placementId === winnerPlacementId) continue
    const reasonCode = String(option.reasonCode || '').trim() || 'unknown'
    reasonCount[reasonCode] = (reasonCount[reasonCode] || 0) + 1
  }
  return reasonCount
}

function scoreOptions(options = []) {
  const winnerCandidates = options.filter((option) => option.bid)
  const maxBidPrice = winnerCandidates.reduce((maxValue, option) => (
    Math.max(maxValue, Math.max(0, toFiniteNumber(option.bidPrice, 0)))
  ), 0)
  const maxBidPriceLog = maxBidPrice > 0 ? Math.log1p(maxBidPrice) : 0
  const scoredOptions = options.map((option) => {
    const relevanceScore = clamp01(
      Number.isFinite(option.relevanceScore)
        ? option.relevanceScore
        : option.rankScore,
    )
    const bidNormalizedScore = option.bid && maxBidPriceLog > 0
      ? clamp01(Math.log1p(Math.max(0, toFiniteNumber(option.bidPrice, 0))) / maxBidPriceLog)
      : 0
    const compositeScore = round(
      relevanceScore * GLOBAL_AUCTION_SCORING.relevanceWeight
      + bidNormalizedScore * GLOBAL_AUCTION_SCORING.bidWeight,
      6,
    )
    return {
      ...option,
      relevanceScore,
      bidNormalizedScore,
      compositeScore,
    }
  })

  return {
    scoredOptions,
    scoring: {
      ...GLOBAL_AUCTION_SCORING,
      maxBidPrice: round(maxBidPrice, 6),
    },
  }
}

export function runGlobalPlacementAuction(input = {}) {
  const rawOptions = Array.isArray(input.options) ? input.options : []
  const options = rawOptions
    .map((item) => normalizeOption(item))
    .filter((item) => item.placementId)
  const scoredResult = scoreOptions(options)
  const scoredOptions = scoredResult.scoredOptions
  const scoring = scoredResult.scoring

  if (options.length === 0) {
    return {
      winner: null,
      winnerPlacementId: '',
      selectedOption: null,
      selectionReason: 'no_placement_options',
      noBidReasonCode: 'placement_unavailable',
      loserSummary: {
        totalOptions: 0,
        reasonCount: {},
      },
      scoring,
      scoredOptions,
    }
  }

  const winnerCandidates = scoredOptions.filter((option) => option.bid)
  if (winnerCandidates.length > 0) {
    const winner = [...winnerCandidates].sort(compareWinnerOptions)[0]
    return {
      winner,
      winnerPlacementId: winner.placementId,
      selectedOption: winner,
      selectionReason: 'weighted_relevance_bid',
      noBidReasonCode: '',
      loserSummary: {
        totalOptions: scoredOptions.length,
        reasonCount: summarizeLosers(scoredOptions, winner.placementId),
      },
      scoring,
      scoredOptions,
    }
  }

  const selectedOption = [...scoredOptions].sort(compareNoBidOptions)[0]
  const selectedReasonCode = String(selectedOption?.reasonCode || '').trim() || 'inventory_no_match'

  return {
    winner: null,
    winnerPlacementId: '',
    selectedOption,
    selectionReason: selectedOption?.gatePassed
      ? 'best_no_fill_after_gate'
      : 'all_gate_blocked_or_unavailable',
    noBidReasonCode: selectedReasonCode,
    loserSummary: {
      totalOptions: scoredOptions.length,
      reasonCount: summarizeLosers(scoredOptions),
    },
    scoring,
    scoredOptions,
  }
}
