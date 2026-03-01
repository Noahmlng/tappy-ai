import { DEFAULT_THRESHOLDS_BY_PLACEMENT } from './relevance-model.js'

const DEFAULT_FILL_DROP_LIMIT = 0.03
const DEFAULT_DISMISS_WINDOW_MS = 5 * 60 * 1000
const GRID_MIN = 0.2
const GRID_MAX = 0.9
const GRID_STEP = 0.01

function cleanText(value) {
  return String(value || '').trim()
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function clamp01(value, fallback = 0) {
  const n = toFiniteNumber(value, fallback)
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function round(value, digits = 6) {
  return Number(clamp01(value).toFixed(digits))
}

function normalizeThresholdRow(input = {}, fallback = { strict: 0.6, relaxed: 0.46 }) {
  const strict = clamp01(input.strict ?? input.strictThreshold, fallback.strict)
  const relaxedRaw = clamp01(input.relaxed ?? input.relaxedThreshold, fallback.relaxed)
  return {
    strict: round(strict),
    relaxed: round(Math.min(strict, relaxedRaw)),
  }
}

export function normalizeThresholdMap(input = {}, fallback = DEFAULT_THRESHOLDS_BY_PLACEMENT) {
  const source = input && typeof input === 'object' ? input : {}
  const normalized = {}
  const placementIds = new Set([...Object.keys(fallback || {}), ...Object.keys(source)])

  for (const placementId of placementIds) {
    const fallbackRow = fallback?.[placementId] && typeof fallback[placementId] === 'object'
      ? fallback[placementId]
      : { strict: 0.6, relaxed: 0.46 }
    const sourceRow = source?.[placementId] && typeof source[placementId] === 'object'
      ? source[placementId]
      : {}
    normalized[placementId] = normalizeThresholdRow(sourceRow, fallbackRow)
  }

  return normalized
}

function toTimestamp(value) {
  const text = cleanText(value)
  if (!text) return NaN
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : NaN
}

function isImpressionEvent(event = {}) {
  const kind = cleanText(event.kind || event.event || event.eventType).toLowerCase()
  return kind === 'impression'
}

function isClickEvent(event = {}) {
  const kind = cleanText(event.kind || event.event || event.eventType).toLowerCase()
  return kind === 'click'
}

function isDismissEvent(event = {}) {
  const kind = cleanText(event.kind || event.event || event.eventType).toLowerCase()
  return kind === 'dismiss' || kind === 'close' || kind === 'hide'
}

export function buildWeakLabelIndex(events = [], options = {}) {
  const rows = Array.isArray(events) ? events : []
  const dismissWindowMs = Math.max(1, Math.floor(toFiniteNumber(options.dismissWindowMs, DEFAULT_DISMISS_WINDOW_MS)))
  const byRequest = new Map()

  for (const row of rows) {
    const requestId = cleanText(row?.requestId || row?.request_id)
    if (!requestId) continue
    const ts = toTimestamp(row?.createdAt || row?.created_at)
    const bucket = byRequest.get(requestId) || {
      impressionTs: [],
      clickTs: [],
      dismissTs: [],
    }
    if (isImpressionEvent(row)) bucket.impressionTs.push(ts)
    if (isClickEvent(row)) bucket.clickTs.push(ts)
    if (isDismissEvent(row)) bucket.dismissTs.push(ts)
    byRequest.set(requestId, bucket)
  }

  const index = new Map()
  for (const [requestId, bucket] of byRequest.entries()) {
    const firstImpressionTs = bucket.impressionTs
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0]
    const hasImpression = Number.isFinite(firstImpressionTs)
    const hasClick = hasImpression
      ? bucket.clickTs.some((ts) => Number.isFinite(ts) && ts >= firstImpressionTs)
      : false
    const hasShortDismiss = hasImpression
      ? bucket.dismissTs.some((ts) => (
        Number.isFinite(ts)
        && ts >= firstImpressionTs
        && ts - firstImpressionTs <= dismissWindowMs
      ))
      : false

    const label = !hasImpression
      ? 'missing_impression'
      : (hasClick ? 'positive' : (hasShortDismiss ? 'negative' : 'unlabeled'))
    index.set(requestId, {
      requestId,
      label,
      hasImpression,
      hasClick,
      hasShortDismiss,
      firstImpressionTs: Number.isFinite(firstImpressionTs) ? firstImpressionTs : null,
    })
  }
  return index
}

function resolveDecisionRelevance(decision = {}) {
  const runtime = decision?.runtime && typeof decision.runtime === 'object'
    ? decision.runtime
    : {}
  const relevance = runtime?.relevance && typeof runtime.relevance === 'object'
    ? runtime.relevance
    : (runtime?.rankingDebug?.relevanceDebug && typeof runtime.rankingDebug.relevanceDebug === 'object'
      ? runtime.rankingDebug.relevanceDebug
      : {})
  const score = toFiniteNumber(relevance?.relevanceScore, NaN)
  if (!Number.isFinite(score)) return null

  const verticalDecision = relevance?.verticalDecision && typeof relevance.verticalDecision === 'object'
    ? relevance.verticalDecision
    : {}
  const vertical = cleanText(
    verticalDecision.targetVertical
    || verticalDecision.queryVertical
    || verticalDecision.candidateVertical
    || 'general',
  ).toLowerCase() || 'general'
  return {
    relevanceScore: clamp01(score),
    vertical,
  }
}

function resolveDecisionReason(decision = {}) {
  const runtimeReason = cleanText(decision?.runtime?.reasonCode)
  if (runtimeReason) return runtimeReason
  const reasonDetail = cleanText(decision?.reasonDetail || decision?.reason_detail)
  if (reasonDetail) return reasonDetail
  const reason = cleanText(decision?.reason)
  return reason || 'unknown'
}

export function extractWeakLabelSamples(decisions = [], events = [], options = {}) {
  const rows = Array.isArray(decisions) ? decisions : []
  const labelIndex = buildWeakLabelIndex(events, options)
  const samples = []

  for (const row of rows) {
    const requestId = cleanText(row?.requestId || row?.request_id)
    const placementId = cleanText(row?.placementId || row?.placement_id)
    if (!requestId || !placementId) continue
    const relevance = resolveDecisionRelevance(row)
    if (!relevance) continue

    const labelRow = labelIndex.get(requestId)
    if (!labelRow?.hasImpression) continue
    const label = labelRow.label
    samples.push({
      requestId,
      placementId,
      vertical: relevance.vertical,
      relevanceScore: relevance.relevanceScore,
      label,
      reasonCode: resolveDecisionReason(row),
    })
  }

  return samples
}

function groupSamples(samples = [], keyFn = () => '') {
  const groups = new Map()
  for (const sample of samples) {
    const key = keyFn(sample)
    if (!key) continue
    const bucket = groups.get(key) || []
    bucket.push(sample)
    groups.set(key, bucket)
  }
  return groups
}

function rateAtOrAbove(scores = [], threshold = 0) {
  if (!Array.isArray(scores) || scores.length <= 0) return 0
  const hit = scores.filter((score) => score >= threshold).length
  return hit / scores.length
}

function clampDelta(value, base, maxDelta) {
  const lower = clamp01(base - maxDelta, 0)
  const upper = clamp01(base + maxDelta, 1)
  return clamp01(Math.min(upper, Math.max(lower, value)), base)
}

function buildGridValues({ min = GRID_MIN, max = GRID_MAX, step = GRID_STEP } = {}) {
  const output = []
  for (let cursor = min; cursor <= max + 1e-9; cursor += step) {
    output.push(round(cursor, 4))
  }
  return output
}

function calibrateSingleGroup({
  samples = [],
  currentThreshold = { strict: 0.6, relaxed: 0.46 },
  minSamples = 200,
  maxDeltaPerDay = 0.03,
  fillDropLimit = DEFAULT_FILL_DROP_LIMIT,
}) {
  const allScores = samples.map((item) => clamp01(item.relevanceScore))
  const positiveScores = samples.filter((item) => item.label === 'positive').map((item) => clamp01(item.relevanceScore))
  const negativeScores = samples.filter((item) => item.label === 'negative').map((item) => clamp01(item.relevanceScore))
  const labeledCount = positiveScores.length + negativeScores.length

  const baselineFill = rateAtOrAbove(allScores, currentThreshold.relaxed)
  const baselineNegativePassRate = rateAtOrAbove(negativeScores, currentThreshold.relaxed)
  const insufficient = labeledCount < minSamples || positiveScores.length <= 0 || negativeScores.length <= 0

  if (insufficient) {
    return {
      thresholds: { ...currentThreshold },
      status: 'frozen_sample_insufficient',
      metrics: {
        sampleCount: samples.length,
        labeledCount,
        positiveCount: positiveScores.length,
        negativeCount: negativeScores.length,
        baselineFillRate: round(baselineFill, 6),
        projectedFillRate: round(baselineFill, 6),
        fillDropRate: 0,
        weakNegativePassRate: round(baselineNegativePassRate, 6),
      },
    }
  }

  const grid = buildGridValues()
  const baselineDenominator = baselineFill > 0 ? baselineFill : 1
  let best = null

  for (const strict of grid) {
    for (const relaxed of grid) {
      if (relaxed > strict) continue
      const projectedFill = rateAtOrAbove(allScores, relaxed)
      const fillDrop = Math.max(0, (baselineFill - projectedFill) / baselineDenominator)
      if (fillDrop > fillDropLimit) continue
      const weakNegativePassRate = rateAtOrAbove(negativeScores, relaxed)
      const weakNegativeStrictPassRate = rateAtOrAbove(negativeScores, strict)
      const candidate = {
        strict,
        relaxed,
        projectedFill,
        fillDrop,
        weakNegativePassRate,
        weakNegativeStrictPassRate,
      }
      if (!best) {
        best = candidate
        continue
      }
      if (candidate.weakNegativePassRate < best.weakNegativePassRate) {
        best = candidate
        continue
      }
      if (candidate.weakNegativePassRate > best.weakNegativePassRate) continue
      if (candidate.fillDrop < best.fillDrop) {
        best = candidate
        continue
      }
      if (candidate.fillDrop > best.fillDrop) continue
      if (candidate.relaxed > best.relaxed) {
        best = candidate
        continue
      }
      if (candidate.relaxed < best.relaxed) continue
      if (candidate.strict > best.strict) {
        best = candidate
      }
    }
  }

  if (!best) {
    return {
      thresholds: { ...currentThreshold },
      status: 'frozen_no_feasible_threshold',
      metrics: {
        sampleCount: samples.length,
        labeledCount,
        positiveCount: positiveScores.length,
        negativeCount: negativeScores.length,
        baselineFillRate: round(baselineFill, 6),
        projectedFillRate: round(baselineFill, 6),
        fillDropRate: 0,
        weakNegativePassRate: round(baselineNegativePassRate, 6),
      },
    }
  }

  const strict = clampDelta(best.strict, currentThreshold.strict, maxDeltaPerDay)
  const relaxed = Math.min(strict, clampDelta(best.relaxed, currentThreshold.relaxed, maxDeltaPerDay))
  const projectedFill = rateAtOrAbove(allScores, relaxed)
  const fillDropRate = Math.max(0, (baselineFill - projectedFill) / baselineDenominator)
  const weakNegativePassRate = rateAtOrAbove(negativeScores, relaxed)

  return {
    thresholds: {
      strict: round(strict),
      relaxed: round(relaxed),
    },
    status: 'updated',
    metrics: {
      sampleCount: samples.length,
      labeledCount,
      positiveCount: positiveScores.length,
      negativeCount: negativeScores.length,
      baselineFillRate: round(baselineFill, 6),
      projectedFillRate: round(projectedFill, 6),
      fillDropRate: round(fillDropRate, 6),
      weakNegativePassRate: round(weakNegativePassRate, 6),
      weakNegativeStrictPassRate: round(rateAtOrAbove(negativeScores, strict), 6),
      strictRaw: round(best.strict),
      relaxedRaw: round(best.relaxed),
    },
  }
}

function toVerticalSnapshot(groups = new Map(), currentThresholds = {}, options = {}) {
  const rows = {}
  for (const [key, samples] of groups.entries()) {
    const [placementId, vertical] = String(key).split('::')
    const current = currentThresholds[placementId] && typeof currentThresholds[placementId] === 'object'
      ? currentThresholds[placementId]
      : { strict: 0.6, relaxed: 0.46 }
    const result = calibrateSingleGroup({
      samples,
      currentThreshold: current,
      ...options,
    })
    if (!rows[placementId]) rows[placementId] = {}
    rows[placementId][vertical] = {
      ...result.thresholds,
      status: result.status,
      ...result.metrics,
    }
  }
  return rows
}

function toPlacementSnapshot(groups = new Map(), currentThresholds = {}, options = {}) {
  const rows = {}
  for (const [placementId, samples] of groups.entries()) {
    const current = currentThresholds[placementId] && typeof currentThresholds[placementId] === 'object'
      ? currentThresholds[placementId]
      : { strict: 0.6, relaxed: 0.46 }
    const result = calibrateSingleGroup({
      samples,
      currentThreshold: current,
      ...options,
    })
    rows[placementId] = {
      ...result.thresholds,
      status: result.status,
      ...result.metrics,
    }
  }
  return rows
}

export function calibrateRelevanceThresholds(input = {}) {
  const samples = extractWeakLabelSamples(input.decisions, input.events, {
    dismissWindowMs: input.dismissWindowMs,
  })
  const currentThresholds = normalizeThresholdMap(
    input.currentThresholdsByPlacement,
    DEFAULT_THRESHOLDS_BY_PLACEMENT,
  )
  const minSamples = Math.max(1, Math.floor(toFiniteNumber(input.minSamples, 200)))
  const maxDeltaPerDay = clamp01(input.maxDeltaPerDay, 0.03)
  const fillDropLimit = clamp01(input.fillDropLimit, DEFAULT_FILL_DROP_LIMIT)

  const placementGroups = groupSamples(samples, (sample) => sample.placementId)
  const placementVerticalGroups = groupSamples(samples, (sample) => `${sample.placementId}::${sample.vertical}`)
  const byPlacement = toPlacementSnapshot(placementGroups, currentThresholds, {
    minSamples,
    maxDeltaPerDay,
    fillDropLimit,
  })
  const byPlacementVertical = toVerticalSnapshot(placementVerticalGroups, currentThresholds, {
    minSamples,
    maxDeltaPerDay,
    fillDropLimit,
  })

  const runtimeThresholds = {}
  for (const [placementId, row] of Object.entries(byPlacement)) {
    runtimeThresholds[placementId] = {
      strict: round(row.strict),
      relaxed: round(Math.min(row.strict, row.relaxed)),
    }
  }

  return {
    samples,
    currentThresholds,
    runtimeThresholds,
    byPlacement,
    byPlacementVertical,
    calibrationConfig: {
      minSamples,
      maxDeltaPerDay,
      fillDropLimit,
      dismissWindowMs: Math.max(1, Math.floor(toFiniteNumber(input.dismissWindowMs, DEFAULT_DISMISS_WINDOW_MS))),
    },
  }
}
