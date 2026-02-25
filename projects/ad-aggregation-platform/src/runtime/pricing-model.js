import pricingSimulatorDefaults from '../../config/pricing-simulator.defaults.json' with { type: 'json' }

const DEFAULT_PLACEMENT_ID = 'chat_inline_v1'
const DEFAULT_NETWORK = 'house'

function cleanText(value) {
  return String(value || '').trim()
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value) {
  return clamp(toFiniteNumber(value, 0), 0, 1)
}

function round(value, digits = 6) {
  const n = toFiniteNumber(value, 0)
  return Number(n.toFixed(digits))
}

function normalizeNetwork(value) {
  const network = cleanText(value).toLowerCase()
  if (network === 'partnerstack' || network === 'cj' || network === 'house') return network
  return DEFAULT_NETWORK
}

function normalizePlacementId(value) {
  const placementId = cleanText(value)
  return placementId || DEFAULT_PLACEMENT_ID
}

function normalizeWeights(defaults) {
  const rankWeightRaw = clamp01(defaults?.rankWeight ?? 0.8)
  const economicWeightRaw = clamp01(defaults?.economicWeight ?? 0.2)
  const sum = rankWeightRaw + economicWeightRaw
  if (sum <= 0) {
    return {
      rankWeight: 0.8,
      economicWeight: 0.2,
    }
  }
  return {
    rankWeight: round(rankWeightRaw / sum, 6),
    economicWeight: round(economicWeightRaw / sum, 6),
  }
}

function normalizeRange(rawRange, fallback) {
  const min = toFiniteNumber(rawRange?.min, fallback.min)
  const max = toFiniteNumber(rawRange?.max, fallback.max)
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  }
}

function normalizeDefaults(input = {}) {
  const weights = normalizeWeights(input)
  const rawSignalFactorRanges = {
    house: normalizeRange(input?.rawSignalFactorRanges?.house, { min: 0.9, max: 1.1 }),
    partnerstack: normalizeRange(input?.rawSignalFactorRanges?.partnerstack, { min: 0.7, max: 1.3 }),
    cj: normalizeRange(input?.rawSignalFactorRanges?.cj, { min: 0.7, max: 1.3 }),
  }

  return Object.freeze({
    modelVersion: cleanText(input.modelVersion) || 'rpm_v1',
    rankWeight: weights.rankWeight,
    economicWeight: weights.economicWeight,
    targetRpmUsdByPlacement: {
      ...(input.targetRpmUsdByPlacement && typeof input.targetRpmUsdByPlacement === 'object'
        ? input.targetRpmUsdByPlacement
        : {}),
    },
    networkRevenueShareByPlacement: {
      ...(input.networkRevenueShareByPlacement && typeof input.networkRevenueShareByPlacement === 'object'
        ? input.networkRevenueShareByPlacement
        : {}),
    },
    networkRevenueShareDefault: {
      house: clamp01(input?.networkRevenueShareDefault?.house ?? 0.5),
      partnerstack: clamp01(input?.networkRevenueShareDefault?.partnerstack ?? 0.3),
      cj: clamp01(input?.networkRevenueShareDefault?.cj ?? 0.2),
    },
    baseCtrByPlacement: {
      ...(input.baseCtrByPlacement && typeof input.baseCtrByPlacement === 'object'
        ? input.baseCtrByPlacement
        : {}),
    },
    baseCtrDefault: clamp(toFiniteNumber(input.baseCtrDefault, 0.018), 1e-6, 0.5),
    baseCvrByNetwork: {
      house: clamp(toFiniteNumber(input?.baseCvrByNetwork?.house, 0.03), 1e-6, 0.5),
      partnerstack: clamp(toFiniteNumber(input?.baseCvrByNetwork?.partnerstack, 0.05), 1e-6, 0.5),
      cj: clamp(toFiniteNumber(input?.baseCvrByNetwork?.cj, 0.04), 1e-6, 0.5),
    },
    baseCvrDefault: clamp(toFiniteNumber(input.baseCvrDefault, 0.03), 1e-6, 0.5),
    cjDefaultAovUsd: clamp(toFiniteNumber(input.cjDefaultAovUsd, 80), 1, 100000),
    rawSignalFactorRanges,
  })
}

const DEFAULTS = normalizeDefaults(pricingSimulatorDefaults)

function toQualityNorm(value) {
  const numeric = toFiniteNumber(value, 0)
  if (numeric <= 0) return 0
  if (numeric <= 1) return clamp01(numeric)
  return clamp01(numeric / 100)
}

function resolveTargetRpmUsd(defaults, placementId) {
  const key = normalizePlacementId(placementId)
  const byPlacement = defaults.targetRpmUsdByPlacement || {}
  const value = toFiniteNumber(byPlacement[key], NaN)
  if (Number.isFinite(value) && value > 0) return value
  return toFiniteNumber(byPlacement[DEFAULT_PLACEMENT_ID], 8) || 8
}

function resolveBaseCtr(defaults, placementId) {
  const key = normalizePlacementId(placementId)
  const byPlacement = defaults.baseCtrByPlacement || {}
  const value = toFiniteNumber(byPlacement[key], NaN)
  if (Number.isFinite(value) && value > 0) return clamp(value, 1e-6, 0.5)
  return defaults.baseCtrDefault
}

function resolveNetworkShare(defaults, placementId, network) {
  const placementShares = defaults.networkRevenueShareByPlacement?.[normalizePlacementId(placementId)]
  const defaultShares = defaults.networkRevenueShareDefault
  const value = toFiniteNumber(placementShares?.[network], NaN)
  if (Number.isFinite(value)) return clamp01(value)
  return clamp01(defaultShares?.[network] ?? 0)
}

function mapRawSignalToFactor(defaults, network, rawBidValue) {
  const numeric = toFiniteNumber(rawBidValue, NaN)
  const range = defaults.rawSignalFactorRanges[network] || { min: 0.7, max: 1.3 }

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return {
      rawBidValue: Number.isFinite(numeric) ? round(numeric, 4) : 0,
      rawUnit: network === 'house' ? 'discount_pct' : 'bid_value',
      normalizedFactor: 1,
    }
  }

  if (network === 'house') {
    const normalized = clamp(numeric / 40, 0, 1)
    const factor = range.min + ((range.max - range.min) * normalized)
    return {
      rawBidValue: round(numeric, 4),
      rawUnit: 'discount_pct',
      normalizedFactor: round(clamp(factor, range.min, range.max), 4),
    }
  }

  if (network === 'partnerstack') {
    const normalized = clamp(numeric / 10, 0, 1)
    const factor = range.min + ((range.max - range.min) * normalized)
    return {
      rawBidValue: round(numeric, 4),
      rawUnit: 'base_rate_or_bid_value',
      normalizedFactor: round(clamp(factor, range.min, range.max), 4),
    }
  }

  if (network === 'cj') {
    const asUsd = numeric > 0 && numeric <= 1
      ? numeric * defaults.cjDefaultAovUsd
      : numeric
    const normalized = clamp(asUsd / 40, 0, 1)
    const factor = range.min + ((range.max - range.min) * normalized)
    return {
      rawBidValue: round(numeric, 4),
      rawUnit: numeric > 0 && numeric <= 1 ? 'commission_ratio' : 'commission_usd',
      normalizedFactor: round(clamp(factor, range.min, range.max), 4),
    }
  }

  return {
    rawBidValue: round(numeric, 4),
    rawUnit: 'bid_value',
    normalizedFactor: 1,
  }
}

export function getPricingSimulatorDefaults() {
  return DEFAULTS
}

export function computeCandidateEconomicPricing(input = {}) {
  const candidate = input.candidate && typeof input.candidate === 'object' ? input.candidate : {}
  const defaults = input.defaults || DEFAULTS
  const placementId = normalizePlacementId(input.placementId)
  const network = normalizeNetwork(candidate.network)

  const fusedScore = clamp01(candidate.fusedScore)
  const qualityNorm = toQualityNorm(candidate.quality)
  const targetRpmUsd = resolveTargetRpmUsd(defaults, placementId)
  const baseCtr = resolveBaseCtr(defaults, placementId)
  const baseCvr = clamp(
    toFiniteNumber(defaults.baseCvrByNetwork?.[network], defaults.baseCvrDefault),
    1e-6,
    0.5,
  )
  const share = resolveNetworkShare(defaults, placementId, network)
  const pConvBase = clamp(baseCtr * baseCvr, 1e-6, 0.2)

  const rawSignal = mapRawSignalToFactor(defaults, network, candidate.bidHint)
  const cpaBase = (targetRpmUsd * share / 1000) / Math.max(pConvBase, 1e-6)
  const cpaUsd = clamp(cpaBase * rawSignal.normalizedFactor, 1e-6, 10000)

  const relevanceFactor = clamp(0.6 + fusedScore, 0.5, 1.6)
  const qualityFactor = clamp(0.7 + qualityNorm, 0.6, 1.5)
  const pClick = clamp(baseCtr * relevanceFactor, 1e-6, 0.6)
  const pConv = clamp(pConvBase * relevanceFactor * qualityFactor, 1e-6, 0.2)
  const ecpmUsd = clamp(1000 * pConv * cpaUsd, 1e-6, 100000)
  const economicScore = ecpmUsd / (ecpmUsd + targetRpmUsd)

  return {
    modelVersion: defaults.modelVersion,
    targetRpmUsd: round(targetRpmUsd, 4),
    ecpmUsd: round(ecpmUsd, 4),
    cpaUsd: round(cpaUsd, 4),
    pClick: round(pClick, 6),
    pConv: round(pConv, 6),
    network,
    economicScore: round(economicScore, 6),
    rawSignal,
  }
}

export function getPricingModelWeights() {
  return {
    rankWeight: DEFAULTS.rankWeight,
    economicWeight: DEFAULTS.economicWeight,
  }
}
