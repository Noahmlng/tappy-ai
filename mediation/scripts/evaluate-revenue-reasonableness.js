import fs from 'node:fs/promises'
import path from 'node:path'

import {
  PROJECT_ROOT,
  parseArgs,
  toNumber,
  round,
  percentile,
  writeJson,
} from './lib/meyka-suite-utils.js'

const DEFAULT_PERF_REPORT_DIR = path.join(PROJECT_ROOT, 'tests', 'performance-reports')
const DEFAULT_PRICING_CONFIG = path.join(PROJECT_ROOT, 'config', 'pricing-mediation.defaults.json')
const DEFAULT_OUTPUT_PATH = path.join(PROJECT_ROOT, 'tests', 'reports', 'meyka-suite', 'revenue-eval-latest.json')

const ACCEPTANCE = Object.freeze({
  ecpmDeviationPct: 15,
  priceP90Max: 25,
})

const DEFAULT_PLACEMENT_TARGETS = Object.freeze({
  chat_from_answer_v1: 10,
  chat_intent_recommendation_v1: 10,
})

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function resolveLatestPerfReportPath() {
  const entries = await fs.readdir(DEFAULT_PERF_REPORT_DIR, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('perf-sdk-batch-') && entry.name.endsWith('.json'))
    .map((entry) => path.join(DEFAULT_PERF_REPORT_DIR, entry.name))

  if (candidates.length === 0) {
    throw new Error('no perf-sdk-batch report found')
  }

  const stats = await Promise.all(candidates.map(async (filePath) => ({
    filePath,
    stat: await fs.stat(filePath),
  })))

  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  return stats[0].filePath
}

function getTargetRpmByPlacement(config = {}) {
  const map = config?.targetRpmUsdByPlacement && typeof config.targetRpmUsdByPlacement === 'object'
    ? config.targetRpmUsdByPlacement
    : {}
  return {
    chat_from_answer_v1: toNumber(map.chat_from_answer_v1, DEFAULT_PLACEMENT_TARGETS.chat_from_answer_v1),
    chat_intent_recommendation_v1: toNumber(
      map.chat_intent_recommendation_v1,
      DEFAULT_PLACEMENT_TARGETS.chat_intent_recommendation_v1,
    ),
  }
}

function getCpaClamp(config = {}) {
  const range = config?.cpaClampUsd && typeof config.cpaClampUsd === 'object'
    ? config.cpaClampUsd
    : {}
  const min = toNumber(range.min, 1.8)
  const max = toNumber(range.max, 3.2)
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  }
}

function normalizeRunAggregates(perfReport = {}) {
  const runAggregates = perfReport?.runAggregates && typeof perfReport.runAggregates === 'object'
    ? perfReport.runAggregates
    : {}
  const byPlacement = Array.isArray(runAggregates.byPlacement) ? runAggregates.byPlacement : []
  const overall = runAggregates?.overall && typeof runAggregates.overall === 'object'
    ? runAggregates.overall
    : null
  return { byPlacement, overall }
}

function evaluatePlacementEcpm(runAggregates = {}, targetByPlacement = {}) {
  const targetPlacements = Object.keys(targetByPlacement)
  const rows = Array.isArray(runAggregates.byPlacement) ? runAggregates.byPlacement : []
  const evaluations = []

  for (const placementId of targetPlacements) {
    const targetRpmUsd = toNumber(targetByPlacement[placementId], 0)
    const row = rows.find((item) => String(item?.placementId || '').trim() === placementId) || {}
    const expectedEcpmUsd = toNumber(row.expectedEcpmUsd, 0)
    const realizedEcpmUsd = toNumber(row.realizedEcpmUsd, 0)
    const expectedDeviationPct = targetRpmUsd > 0
      ? Math.abs(expectedEcpmUsd - targetRpmUsd) / targetRpmUsd * 100
      : 0
    const realizedDeviationPct = targetRpmUsd > 0
      ? Math.abs(realizedEcpmUsd - targetRpmUsd) / targetRpmUsd * 100
      : 0

    evaluations.push({
      placementId,
      targetRpmUsd: round(targetRpmUsd, 4),
      expectedEcpmUsd: round(expectedEcpmUsd, 4),
      realizedEcpmUsd: round(realizedEcpmUsd, 4),
      expectedDeviationPct: round(expectedDeviationPct, 4),
      realizedDeviationPct: round(realizedDeviationPct, 4),
      impressions: toNumber(row.impressions, 0),
      settledConversions: toNumber(row.settledConversions, 0),
      settledRevenueUsd: round(toNumber(row.realizedRevenueUsd, 0), 4),
      passExpected: expectedDeviationPct <= ACCEPTANCE.ecpmDeviationPct,
      pass: expectedDeviationPct <= ACCEPTANCE.ecpmDeviationPct,
    })
  }

  return evaluations
}

function evaluateOverallEcpm(runAggregates = {}, targetByPlacement = {}, placementEcpm = []) {
  const overall = runAggregates?.overall && typeof runAggregates.overall === 'object'
    ? runAggregates.overall
    : {}

  let weightedTargetSum = 0
  let weightedImpressions = 0
  for (const item of placementEcpm) {
    const impressions = toNumber(item.impressions, 0)
    const targetRpmUsd = toNumber(targetByPlacement[item.placementId], 0)
    weightedTargetSum += impressions * targetRpmUsd
    weightedImpressions += impressions
  }

  const weightedTargetRpmUsd = weightedImpressions > 0
    ? weightedTargetSum / weightedImpressions
    : (() => {
      const values = Object.values(targetByPlacement)
        .map((value) => toNumber(value, 0))
        .filter((value) => value > 0)
      if (values.length === 0) return 0
      return values.reduce((sum, value) => sum + value, 0) / values.length
    })()

  const expectedEcpmUsd = toNumber(overall.expectedEcpmUsd, 0)
  const realizedEcpmUsd = toNumber(overall.realizedEcpmUsd, 0)
  const expectedDeviationPct = weightedTargetRpmUsd > 0
    ? Math.abs(expectedEcpmUsd - weightedTargetRpmUsd) / weightedTargetRpmUsd * 100
    : 0
  const realizedDeviationPct = weightedTargetRpmUsd > 0
    ? Math.abs(realizedEcpmUsd - weightedTargetRpmUsd) / weightedTargetRpmUsd * 100
    : 0

  return {
    weightedTargetRpmUsd: round(weightedTargetRpmUsd, 4),
    expectedEcpmUsd: round(expectedEcpmUsd, 4),
    realizedEcpmUsd: round(realizedEcpmUsd, 4),
    expectedDeviationPct: round(expectedDeviationPct, 4),
    realizedDeviationPct: round(realizedDeviationPct, 4),
    impressions: toNumber(overall.impressions, 0),
    settledConversions: toNumber(overall.settledConversions, 0),
    settledRevenueUsd: round(toNumber(overall.realizedRevenueUsd, 0), 4),
    passExpected: expectedDeviationPct <= ACCEPTANCE.ecpmDeviationPct,
    pass: expectedDeviationPct <= ACCEPTANCE.ecpmDeviationPct,
  }
}

function evaluatePriceDistribution(perfReport = {}) {
  const samples = Array.isArray(perfReport?.pricing?.bidPriceSamples)
    ? perfReport.pricing.bidPriceSamples
      .map((item) => toNumber(item, NaN))
      .filter((item) => Number.isFinite(item) && item > 0)
    : []

  const p90 = round(
    Number.isFinite(toNumber(perfReport?.pricing?.bidPriceDistribution?.p90, NaN))
      ? toNumber(perfReport?.pricing?.bidPriceDistribution?.p90, 0)
      : percentile(samples, 0.9),
    4,
  )

  return {
    sampleCount: samples.length,
    p90Usd: p90,
    pass: p90 < ACCEPTANCE.priceP90Max,
  }
}

function evaluateCpaClamp(perfReport = {}, cpaClamp = { min: 1.8, max: 3.2 }) {
  const byNetwork = perfReport?.pricing?.cpaSamplesByNetwork && typeof perfReport.pricing.cpaSamplesByNetwork === 'object'
    ? perfReport.pricing.cpaSamplesByNetwork
    : {}
  const samples = Object.values(byNetwork).flatMap((rows) => (
    Array.isArray(rows)
      ? rows.map((item) => toNumber(item, NaN)).filter((item) => Number.isFinite(item) && item > 0)
      : []
  ))

  const below = samples.filter((item) => item < cpaClamp.min).length
  const above = samples.filter((item) => item > cpaClamp.max).length
  const minObserved = samples.length > 0 ? round(Math.min(...samples), 4) : 0
  const maxObserved = samples.length > 0 ? round(Math.max(...samples), 4) : 0

  return {
    range: cpaClamp,
    sampleCount: samples.length,
    minObserved,
    maxObserved,
    below,
    above,
    pass: below === 0 && above === 0,
  }
}

function evaluateSettlementPresence(runAggregates = {}) {
  const overall = runAggregates?.overall && typeof runAggregates.overall === 'object'
    ? runAggregates.overall
    : {}
  const settledConversions = toNumber(overall.settledConversions, 0)
  const settledRevenueUsd = toNumber(overall.realizedRevenueUsd, 0)
  return {
    settledConversions,
    settledRevenueUsd: round(settledRevenueUsd, 4),
    pass: settledConversions > 0 && settledRevenueUsd > 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const perfReportPath = String(args.perfReport || '').trim()
    ? path.resolve(process.cwd(), String(args.perfReport || '').trim())
    : await resolveLatestPerfReportPath()
  const pricingConfigPath = path.resolve(process.cwd(), String(args.pricingConfig || DEFAULT_PRICING_CONFIG))
  const outputPath = path.resolve(process.cwd(), String(args.output || DEFAULT_OUTPUT_PATH))

  const [perfReport, pricingConfig] = await Promise.all([
    readJson(perfReportPath),
    readJson(pricingConfigPath),
  ])

  const targetByPlacement = getTargetRpmByPlacement(pricingConfig)
  const cpaClamp = getCpaClamp(pricingConfig)
  const runAggregates = normalizeRunAggregates(perfReport)

  const placementEcpm = evaluatePlacementEcpm(runAggregates, targetByPlacement)
  const overallEcpm = evaluateOverallEcpm(runAggregates, targetByPlacement, placementEcpm)
  const priceDistribution = evaluatePriceDistribution(perfReport)
  const cpaClampCheck = evaluateCpaClamp(perfReport, cpaClamp)
  const settlementPresence = evaluateSettlementPresence(runAggregates)

  const pass = (
    placementEcpm.every((item) => item.pass)
    && overallEcpm.pass
    && priceDistribution.pass
    && cpaClampCheck.pass
    && settlementPresence.pass
  )

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      perfReport: path.relative(PROJECT_ROOT, perfReportPath),
      pricingConfig: path.relative(PROJECT_ROOT, pricingConfigPath),
      metricScope: 'run_aggregates',
    },
    thresholds: {
      ecpmDeviationPct: ACCEPTANCE.ecpmDeviationPct,
      priceP90Max: ACCEPTANCE.priceP90Max,
      cpaClampUsd: cpaClamp,
    },
    results: {
      placementEcpm,
      overallEcpm,
      priceDistribution,
      cpaClamp: cpaClampCheck,
      settlementPresence,
    },
    pass,
  }

  await writeJson(outputPath, report)

  console.log(JSON.stringify({
    ok: true,
    pass,
    output: path.relative(PROJECT_ROOT, outputPath),
    placementEcpm: placementEcpm.map((item) => ({
      placementId: item.placementId,
      expectedDeviationPct: item.expectedDeviationPct,
      realizedDeviationPct: item.realizedDeviationPct,
      pass: item.pass,
    })),
    overallExpectedDeviationPct: overallEcpm.expectedDeviationPct,
    overallRealizedDeviationPct: overallEcpm.realizedDeviationPct,
    priceP90: priceDistribution.p90Usd,
  }, null, 2))
}

main().catch((error) => {
  console.error('[evaluate-revenue-reasonableness] failed:', error?.message || error)
  process.exit(1)
})
