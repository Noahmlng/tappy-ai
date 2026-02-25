import fs from 'node:fs/promises'
import path from 'node:path'

import {
  PROJECT_ROOT,
  parseArgs,
  toNumber,
  round,
  percentile,
  requestJson,
  resolveAuthContext,
  writeJson,
} from './lib/meyka-suite-utils.js'

const DEFAULT_PERF_REPORT_DIR = path.join(PROJECT_ROOT, 'tests', 'performance-reports')
const DEFAULT_PRICING_CONFIG = path.join(PROJECT_ROOT, 'config', 'pricing-simulator.defaults.json')
const DEFAULT_OUTPUT_PATH = path.join(PROJECT_ROOT, 'tests', 'reports', 'meyka-suite', 'revenue-eval-latest.json')

const ACCEPTANCE = Object.freeze({
  ecpmDeviationPct: 15,
  priceP90Max: 25,
})

const CPA_RANGES = Object.freeze({
  house: { min: 6.6, max: 8.8 },
  partnerstack: { min: 1.8, max: 3.8 },
  cj: { min: 1.5, max: 3.2 },
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
    chat_inline_v1: toNumber(map.chat_inline_v1, 8),
    chat_followup_v1: toNumber(map.chat_followup_v1, 12),
  }
}

function normalizeUsageByPlacement(usagePayload = {}) {
  const rows = Array.isArray(usagePayload?.byPlacement) ? usagePayload.byPlacement : []
  const map = new Map()
  for (const row of rows) {
    const placementId = String(row?.placementId || '').trim()
    if (!placementId) continue

    const impressions = toNumber(row?.impressions, 0)
    const settledRevenueUsd = toNumber(row?.settledRevenueUsd, 0)
    const observedEcpm = impressions > 0
      ? (settledRevenueUsd / impressions) * 1000
      : toNumber(row?.ecpm, 0)

    map.set(placementId, {
      placementId,
      impressions,
      settledRevenueUsd,
      observedEcpm: round(observedEcpm, 4),
      settledConversions: toNumber(row?.settledConversions, 0),
      clicks: toNumber(row?.clicks, 0),
      requests: toNumber(row?.requests, 0),
      served: toNumber(row?.served, 0),
    })
  }
  return map
}

function evaluatePlacementEcpm(usageMap, targetByPlacement) {
  const placements = Object.keys(targetByPlacement)
  const evaluations = []

  for (const placementId of placements) {
    const targetRpm = toNumber(targetByPlacement[placementId], 0)
    const observed = usageMap.get(placementId) || {
      placementId,
      impressions: 0,
      settledRevenueUsd: 0,
      observedEcpm: 0,
      settledConversions: 0,
      clicks: 0,
      requests: 0,
      served: 0,
    }
    const deviationPct = targetRpm > 0
      ? Math.abs(observed.observedEcpm - targetRpm) / targetRpm * 100
      : 0

    evaluations.push({
      placementId,
      targetRpmUsd: round(targetRpm, 4),
      observedEcpmUsd: round(observed.observedEcpm, 4),
      deviationPct: round(deviationPct, 4),
      impressions: observed.impressions,
      settledRevenueUsd: round(observed.settledRevenueUsd, 4),
      pass: deviationPct <= ACCEPTANCE.ecpmDeviationPct,
    })
  }

  return evaluations
}

function evaluateOverallEcpm(usagePayload, targetByPlacement, placementEval) {
  const totals = usagePayload?.totals && typeof usagePayload.totals === 'object'
    ? usagePayload.totals
    : {}

  const observedEcpm = toNumber(
    totals.ecpm,
    (toNumber(totals.impressions, 0) > 0)
      ? (toNumber(totals.settledRevenueUsd, 0) / toNumber(totals.impressions, 1)) * 1000
      : 0,
  )

  let weightedTargetSum = 0
  let weightedImpressions = 0
  for (const item of placementEval) {
    const impressions = toNumber(item.impressions, 0)
    const target = toNumber(targetByPlacement[item.placementId], 0)
    weightedTargetSum += target * impressions
    weightedImpressions += impressions
  }

  const weightedTarget = weightedImpressions > 0
    ? weightedTargetSum / weightedImpressions
    : averageTarget(targetByPlacement)

  const deviationPct = weightedTarget > 0
    ? Math.abs(observedEcpm - weightedTarget) / weightedTarget * 100
    : 0

  return {
    observedEcpmUsd: round(observedEcpm, 4),
    weightedTargetRpmUsd: round(weightedTarget, 4),
    deviationPct: round(deviationPct, 4),
    pass: deviationPct <= ACCEPTANCE.ecpmDeviationPct,
  }
}

function averageTarget(targetByPlacement) {
  const values = Object.values(targetByPlacement)
    .map((item) => toNumber(item, 0))
    .filter((item) => item > 0)
  if (values.length === 0) return 0
  return values.reduce((sum, item) => sum + item, 0) / values.length
}

function evaluatePriceDistribution(perfReport = {}) {
  const samples = Array.isArray(perfReport?.pricing?.bidPriceSamples)
    ? perfReport.pricing.bidPriceSamples.map((item) => toNumber(item, NaN)).filter((item) => Number.isFinite(item) && item > 0)
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

function evaluateCpaRanges(perfReport = {}) {
  const byNetwork = perfReport?.pricing?.cpaSamplesByNetwork && typeof perfReport.pricing.cpaSamplesByNetwork === 'object'
    ? perfReport.pricing.cpaSamplesByNetwork
    : {}

  const rows = []
  for (const [network, range] of Object.entries(CPA_RANGES)) {
    const samples = Array.isArray(byNetwork[network])
      ? byNetwork[network].map((item) => toNumber(item, NaN)).filter((item) => Number.isFinite(item) && item > 0)
      : []

    const below = samples.filter((item) => item < range.min).length
    const above = samples.filter((item) => item > range.max).length

    rows.push({
      network,
      range,
      sampleCount: samples.length,
      minObserved: samples.length > 0 ? round(Math.min(...samples), 4) : 0,
      maxObserved: samples.length > 0 ? round(Math.max(...samples), 4) : 0,
      below,
      above,
      pass: below === 0 && above === 0,
    })
  }

  return rows
}

async function loadUsageAndPlacement(baseUrl, args, perfReport) {
  if (!baseUrl) {
    const snapshotRoot = perfReport?.dashboardSnapshot && typeof perfReport.dashboardSnapshot === 'object'
      ? perfReport.dashboardSnapshot
      : {}
    const deltaUsageSnapshot = snapshotRoot?.delta?.usageRevenue
    const usageSnapshot = deltaUsageSnapshot?.ok
      ? deltaUsageSnapshot
      : (snapshotRoot?.usageRevenue || snapshotRoot?.after?.usageRevenue)
    const byPlacementSnapshot = snapshotRoot?.after?.byPlacement || snapshotRoot?.byPlacement
    if (!usageSnapshot?.ok || !byPlacementSnapshot?.ok) {
      throw new Error('dashboard snapshot missing in perf report; provide --gatewayUrl for live fetch')
    }
    return {
      usageRevenue: usageSnapshot.payload,
      byPlacement: byPlacementSnapshot.payload,
      source: deltaUsageSnapshot?.ok ? 'perf_report_delta_snapshot' : 'perf_report_snapshot',
    }
  }

  const auth = await resolveAuthContext(baseUrl, args, { useExternalGateway: true })
  const [usageRes, placementRes] = await Promise.all([
    requestJson(baseUrl, '/api/v1/dashboard/usage-revenue', {
      headers: auth.dashboardHeaders,
    }),
    requestJson(baseUrl, '/api/v1/dashboard/metrics/by-placement', {
      headers: auth.dashboardHeaders,
    }),
  ])

  if (!usageRes.ok) {
    throw new Error(`load usage-revenue failed: HTTP_${usageRes.status}`)
  }
  if (!placementRes.ok) {
    throw new Error(`load metrics/by-placement failed: HTTP_${placementRes.status}`)
  }

  return {
    usageRevenue: usageRes.payload,
    byPlacement: placementRes.payload,
    source: 'live_dashboard',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const gatewayUrl = String(args.gatewayUrl || '').trim()

  const perfReportPath = String(args.perfReport || '').trim()
    ? path.resolve(process.cwd(), String(args.perfReport || '').trim())
    : await resolveLatestPerfReportPath()
  const pricingConfigPath = path.resolve(process.cwd(), String(args.pricingConfig || DEFAULT_PRICING_CONFIG))
  const outputPath = path.resolve(process.cwd(), String(args.output || DEFAULT_OUTPUT_PATH))

  const [perfReport, pricingConfig] = await Promise.all([
    readJson(perfReportPath),
    readJson(pricingConfigPath),
  ])

  const dashboardData = await loadUsageAndPlacement(gatewayUrl, args, perfReport)
  const targetByPlacement = getTargetRpmByPlacement(pricingConfig)
  const usageMap = normalizeUsageByPlacement(dashboardData.usageRevenue)

  const placementEcpm = evaluatePlacementEcpm(usageMap, targetByPlacement)
  const overallEcpm = evaluateOverallEcpm(dashboardData.usageRevenue, targetByPlacement, placementEcpm)
  const priceDistribution = evaluatePriceDistribution(perfReport)
  const cpaRanges = evaluateCpaRanges(perfReport)

  const totals = dashboardData?.usageRevenue?.totals && typeof dashboardData.usageRevenue.totals === 'object'
    ? dashboardData.usageRevenue.totals
    : {}

  const settledConversions = toNumber(totals?.settledConversions, 0)
  const settledRevenueUsd = toNumber(totals?.settledRevenueUsd, 0)
  const settlementPresence = {
    settledConversions,
    settledRevenueUsd: round(settledRevenueUsd, 4),
    pass: settledConversions > 0 && settledRevenueUsd > 0,
  }

  const finalPass = (
    placementEcpm.every((item) => item.pass)
    && overallEcpm.pass
    && priceDistribution.pass
    && cpaRanges.every((item) => item.pass)
    && settlementPresence.pass
  )

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      perfReport: path.relative(PROJECT_ROOT, perfReportPath),
      pricingConfig: path.relative(PROJECT_ROOT, pricingConfigPath),
      dashboard: dashboardData.source,
      gatewayUrl: gatewayUrl || null,
    },
    thresholds: {
      ecpmDeviationPct: ACCEPTANCE.ecpmDeviationPct,
      priceP90Max: ACCEPTANCE.priceP90Max,
      cpaRanges: CPA_RANGES,
    },
    results: {
      placementEcpm,
      overallEcpm,
      priceDistribution,
      cpaRanges,
      settlementPresence,
    },
    pass: finalPass,
  }

  await writeJson(outputPath, report)

  console.log(JSON.stringify({
    ok: true,
    pass: report.pass,
    output: path.relative(PROJECT_ROOT, outputPath),
    placementEcpm: report.results.placementEcpm.map((item) => ({
      placementId: item.placementId,
      deviationPct: item.deviationPct,
      pass: item.pass,
    })),
    overallDeviationPct: report.results.overallEcpm.deviationPct,
    priceP90: report.results.priceDistribution.p90Usd,
  }, null, 2))
}

main().catch((error) => {
  console.error('[evaluate-revenue-reasonableness] failed:', error?.message || error)
  process.exit(1)
})
