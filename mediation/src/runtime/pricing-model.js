import pricingMediationDefaults from '../../config/pricing-mediation.defaults.json' with { type: 'json' }

const DEFAULT_PLACEMENT_ID = 'chat_from_answer_v1'
const DEFAULT_NETWORK = 'house'
const DEFAULT_TRIGGER_TYPE = 'from_answer'
const DEFAULT_PRICING_SEMANTICS_VERSION = 'cpc_v1'
const DEFAULT_BILLING_UNIT = 'cpc'
const KNOWN_TRIGGER_TYPES = new Set(['from_answer', 'intent_recommendation'])
const TRIGGER_TYPE_BY_PLACEMENT = Object.freeze({
  chat_from_answer_v1: 'from_answer',
  chat_intent_recommendation_v1: 'intent_recommendation',
})

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

function normalizeTriggerType(value) {
  const triggerType = cleanText(value).toLowerCase()
  if (KNOWN_TRIGGER_TYPES.has(triggerType)) return triggerType
  return ''
}

function normalizeWeights(defaults) {
  const rankWeightRaw = clamp01(defaults?.rankWeight ?? 0.65)
  const economicWeightRaw = clamp01(defaults?.economicWeight ?? 0.35)
  const sum = rankWeightRaw + economicWeightRaw
  if (sum <= 0) {
    return {
      rankWeight: 0.65,
      economicWeight: 0.35,
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
    modelVersion: cleanText(input.modelVersion) || 'cpa_mock_v2',
    pricingSemanticsVersion: cleanText(input.pricingSemanticsVersion) || DEFAULT_PRICING_SEMANTICS_VERSION,
    billingUnit: cleanText(input.billingUnit).toLowerCase() === 'cpc' ? 'cpc' : DEFAULT_BILLING_UNIT,
    rankWeight: weights.rankWeight,
    economicWeight: weights.economicWeight,
    rankDominanceFloor: clamp(toFiniteNumber(input.rankDominanceFloor, 0.5), 0, 1),
    rankDominanceMargin: clamp(toFiniteNumber(input.rankDominanceMargin, 0.1), 0, 1),
    triggerTypeByPlacement: {
      ...TRIGGER_TYPE_BY_PLACEMENT,
      ...(input.triggerTypeByPlacement && typeof input.triggerTypeByPlacement === 'object'
        ? input.triggerTypeByPlacement
        : {}),
    },
    defaultTriggerType: normalizeTriggerType(input.defaultTriggerType) || DEFAULT_TRIGGER_TYPE,
    targetRpmUsdByPlacement: {
      ...(input.targetRpmUsdByPlacement && typeof input.targetRpmUsdByPlacement === 'object'
        ? input.targetRpmUsdByPlacement
        : {}),
    },
    targetRpmUsdByTriggerType: {
      from_answer: clamp(toFiniteNumber(input?.targetRpmUsdByTriggerType?.from_answer, 10), 1e-6, 100000),
      intent_recommendation: clamp(toFiniteNumber(input?.targetRpmUsdByTriggerType?.intent_recommendation, 10), 1e-6, 100000),
    },
    baseCtrByPlacement: {
      ...(input.baseCtrByPlacement && typeof input.baseCtrByPlacement === 'object'
        ? input.baseCtrByPlacement
        : {}),
    },
    baseCtrByTriggerType: {
      from_answer: clamp(toFiniteNumber(input?.baseCtrByTriggerType?.from_answer, 0.05), 1e-6, 0.5),
      intent_recommendation: clamp(toFiniteNumber(input?.baseCtrByTriggerType?.intent_recommendation, 0.05), 1e-6, 0.5),
    },
    baseCtrDefault: clamp(toFiniteNumber(input.baseCtrDefault, 0.05), 1e-6, 0.5),
    baseCvrByNetwork: {
      house: clamp(toFiniteNumber(input?.baseCvrByNetwork?.house, 0.08), 1e-6, 0.5),
      partnerstack: clamp(toFiniteNumber(input?.baseCvrByNetwork?.partnerstack, 0.08), 1e-6, 0.5),
      cj: clamp(toFiniteNumber(input?.baseCvrByNetwork?.cj, 0.08), 1e-6, 0.5),
    },
    baseCvrDefault: clamp(toFiniteNumber(input.baseCvrDefault, 0.08), 1e-6, 0.5),
    triggerFactorByType: {
      from_answer: clamp(toFiniteNumber(input?.triggerFactorByType?.from_answer, 1), 0.1, 5),
      intent_recommendation: clamp(toFiniteNumber(input?.triggerFactorByType?.intent_recommendation, 1.08), 0.1, 5),
    },
    cpaClampUsd: normalizeRange(input.cpaClampUsd, { min: 1.8, max: 3.2 }),
    cjDefaultAovUsd: clamp(toFiniteNumber(input.cjDefaultAovUsd, 80), 1, 100000),
    rawSignalFactorRanges,
  })
}

const DEFAULTS = normalizeDefaults(pricingMediationDefaults)

function toQualityNorm(value) {
  const numeric = toFiniteNumber(value, 0)
  if (numeric <= 0) return 0
  if (numeric <= 1) return clamp01(numeric)
  return clamp01(numeric / 100)
}

function resolveTargetRpmUsd(defaults, placementId) {
  const triggerType = resolveTriggerType(defaults, '', placementId)
  return resolveTargetRpmUsdWithTrigger(defaults, placementId, triggerType)
}

function resolveTargetRpmUsdWithTrigger(defaults, placementId, triggerType) {
  const key = normalizePlacementId(placementId)
  const normalizedTriggerType = normalizeTriggerType(triggerType)
  const byPlacement = defaults.targetRpmUsdByPlacement || {}
  const value = toFiniteNumber(byPlacement[key], NaN)
  if (Number.isFinite(value) && value > 0) return value
  const byTriggerType = defaults.targetRpmUsdByTriggerType || {}
  const triggerValue = toFiniteNumber(byTriggerType[normalizedTriggerType], NaN)
  if (Number.isFinite(triggerValue) && triggerValue > 0) return triggerValue
  return toFiniteNumber(byPlacement[DEFAULT_PLACEMENT_ID], 10) || 10
}

function resolveBaseCtr(defaults, placementId) {
  const triggerType = resolveTriggerType(defaults, '', placementId)
  return resolveBaseCtrWithTrigger(defaults, placementId, triggerType)
}

function resolveBaseCtrWithTrigger(defaults, placementId, triggerType) {
  const key = normalizePlacementId(placementId)
  const normalizedTriggerType = normalizeTriggerType(triggerType)
  const byPlacement = defaults.baseCtrByPlacement || {}
  const value = toFiniteNumber(byPlacement[key], NaN)
  if (Number.isFinite(value) && value > 0) return clamp(value, 1e-6, 0.5)
  const byTriggerType = defaults.baseCtrByTriggerType || {}
  const triggerValue = toFiniteNumber(byTriggerType[normalizedTriggerType], NaN)
  if (Number.isFinite(triggerValue) && triggerValue > 0) return clamp(triggerValue, 1e-6, 0.5)
  return defaults.baseCtrDefault
}

function resolveTriggerType(defaults, triggerType, placementId) {
  const direct = normalizeTriggerType(triggerType)
  if (direct) return direct
  const placement = normalizePlacementId(placementId)
  const byPlacement = defaults.triggerTypeByPlacement || {}
  const fromPlacement = normalizeTriggerType(byPlacement[placement] || TRIGGER_TYPE_BY_PLACEMENT[placement])
  if (fromPlacement) return fromPlacement
  return normalizeTriggerType(defaults.defaultTriggerType) || DEFAULT_TRIGGER_TYPE
}

function resolveTriggerFactor(defaults, triggerType) {
  const normalizedTriggerType = normalizeTriggerType(triggerType)
  const byType = defaults.triggerFactorByType || {}
  const value = toFiniteNumber(byType[normalizedTriggerType], NaN)
  if (Number.isFinite(value) && value > 0) return clamp(value, 0.1, 5)
  return 1
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

export function getPricingMediationDefaults() {
  return DEFAULTS
}

export function computeCandidateEconomicPricing(input = {}) {
  const candidate = input.candidate && typeof input.candidate === 'object' ? input.candidate : {}
  const defaults = input.defaults || DEFAULTS
  const placementId = normalizePlacementId(input.placementId)
  const network = normalizeNetwork(candidate.network)
  const triggerType = resolveTriggerType(defaults, input.triggerType, placementId)

  const fusedScore = clamp01(candidate.fusedScore)
  const qualityNorm = toQualityNorm(candidate.quality)
  const targetRpmUsd = resolveTargetRpmUsdWithTrigger(defaults, placementId, triggerType)
  const baseCtr = resolveBaseCtrWithTrigger(defaults, placementId, triggerType)
  const baseCvr = clamp(
    toFiniteNumber(defaults.baseCvrByNetwork?.[network], defaults.baseCvrDefault),
    1e-6,
    0.5,
  )
  const pConvBase = clamp(baseCtr * baseCvr, 1e-6, 0.2)

  const rawSignal = mapRawSignalToFactor(defaults, network, candidate.bidHint)
  const cpaBase = (targetRpmUsd / 1000) / Math.max(pConvBase, 1e-6)
  const cpaUsdRaw = cpaBase * rawSignal.normalizedFactor
  const cpaUsd = clamp(
    cpaUsdRaw,
    toFiniteNumber(defaults.cpaClampUsd?.min, 1.8),
    toFiniteNumber(defaults.cpaClampUsd?.max, 3.2),
  )

  const relevanceFactor = clamp(0.6 + fusedScore, 0.5, 1.6)
  const qualityFactor = clamp(0.7 + qualityNorm, 0.6, 1.5)
  const triggerFactor = resolveTriggerFactor(defaults, triggerType)
  const pClick = clamp(baseCtr * relevanceFactor, 1e-6, 0.6)
  const pConv = clamp(pConvBase * relevanceFactor * qualityFactor * triggerFactor, 1e-6, 0.2)
  const ecpmUsd = clamp(1000 * pConv * cpaUsd, 1e-6, 100000)
  const cpcUsd = clamp(
    ecpmUsd / Math.max(1000 * pClick, 1e-6),
    1e-6,
    100000,
  )
  const economicScore = ecpmUsd / (ecpmUsd + targetRpmUsd)

  return {
    modelVersion: defaults.modelVersion,
    pricingSemanticsVersion: defaults.pricingSemanticsVersion || DEFAULT_PRICING_SEMANTICS_VERSION,
    billingUnit: defaults.billingUnit || DEFAULT_BILLING_UNIT,
    triggerType,
    targetRpmUsd: round(targetRpmUsd, 4),
    ecpmUsd: round(ecpmUsd, 4),
    cpcUsd: round(cpcUsd, 4),
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
    rankDominanceFloor: DEFAULTS.rankDominanceFloor,
    rankDominanceMargin: DEFAULTS.rankDominanceMargin,
  }
}
