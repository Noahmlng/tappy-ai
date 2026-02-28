function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function toPriorityValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return Number.MAX_SAFE_INTEGER
  return Math.floor(n)
}

function normalizeOption(input = {}) {
  const option = input && typeof input === 'object' ? input : {}
  const bid = option.bid && typeof option.bid === 'object' ? option.bid : null
  const bidPrice = bid ? toFiniteNumber(bid.price, 0) : toFiniteNumber(option.bidPrice, 0)
  const pricing = bid?.pricing && typeof bid.pricing === 'object' ? bid.pricing : null

  return {
    placementId: String(option.placementId || '').trim(),
    gatePassed: option.gatePassed === true,
    reasonCode: String(option.reasonCode || '').trim() || 'inventory_no_match',
    bid,
    bidPrice,
    ecpmUsd: toFiniteNumber(pricing?.ecpmUsd ?? option.ecpmUsd, 0),
    rankScore: toFiniteNumber(option.rankScore, 0),
    auctionScore: toFiniteNumber(option.auctionScore, 0),
    priority: toPriorityValue(option.priority),
    stageStatusMap: option.stageStatusMap && typeof option.stageStatusMap === 'object'
      ? { ...option.stageStatusMap }
      : {},
  }
}

function compareWinnerOptions(left, right) {
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

export function runGlobalPlacementAuction(input = {}) {
  const rawOptions = Array.isArray(input.options) ? input.options : []
  const options = rawOptions
    .map((item) => normalizeOption(item))
    .filter((item) => item.placementId)

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
    }
  }

  const winnerCandidates = options.filter((option) => option.bid)
  if (winnerCandidates.length > 0) {
    const winner = [...winnerCandidates].sort(compareWinnerOptions)[0]
    return {
      winner,
      winnerPlacementId: winner.placementId,
      selectedOption: winner,
      selectionReason: 'highest_bid_price',
      noBidReasonCode: '',
      loserSummary: {
        totalOptions: options.length,
        reasonCount: summarizeLosers(options, winner.placementId),
      },
    }
  }

  const selectedOption = [...options].sort(compareNoBidOptions)[0]
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
      totalOptions: options.length,
      reasonCount: summarizeLosers(options),
    },
  }
}
