import path from 'node:path'
import { spawn } from 'node:child_process'

import {
  PROJECT_ROOT,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SCENARIO_SET_PATH,
  parseArgs,
  parsePlacements,
  parseSettlementStorage,
  parseInventoryNetworks,
  toBoolean,
  toInteger,
  toNumber,
  clamp01,
  round,
  nowIso,
  nowTag,
  sleep,
  requestJson,
  waitForGateway,
  startGatewayProcess,
  stopGatewayProcess,
  loadScenarioSet,
  createSdkEventPayload,
  shouldSamplePostback,
  buildStableConversionId,
  resolveAuthContext,
  ensurePlacementsEnabled,
  ensureInventoryReady,
  percentile,
  average,
  writeJson,
} from './lib/meyka-suite-utils.js'

const REPORT_DIR = path.join(PROJECT_ROOT, 'tests', 'performance-reports')
const PLACEMENT_TRIGGER_TYPE_MAP = Object.freeze({
  chat_from_answer_v1: 'from_answer',
  chat_intent_recommendation_v1: 'intent_recommendation',
})
const TARGET_RPM_BY_PLACEMENT = Object.freeze({
  chat_from_answer_v1: 10,
  chat_intent_recommendation_v1: 10,
})

function resolveTriggerType(placementId = '', rawTriggerType = '') {
  const triggerType = String(rawTriggerType || '').trim().toLowerCase()
  if (triggerType === 'from_answer' || triggerType === 'intent_recommendation') return triggerType
  return String(PLACEMENT_TRIGGER_TYPE_MAP[String(placementId || '').trim()] || 'from_answer')
}

const PHASE_PROFILES = Object.freeze({
  local: [
    { name: 'warmup', rpm: 60, durationSec: 120 },
    { name: 'steady', rpm: 120, durationSec: 600 },
    { name: 'burst', rpm: 300, durationSec: 120 },
  ],
  staging: [
    { name: 'warmup', rpm: 60, durationSec: 60 },
    { name: 'steady', rpm: 120, durationSec: 300 },
    { name: 'burst', rpm: 300, durationSec: 60 },
  ],
  smoke: [
    { name: 'warmup', rpm: 30, durationSec: 15 },
    { name: 'steady', rpm: 60, durationSec: 20 },
    { name: 'burst', rpm: 120, durationSec: 15 },
  ],
})

function parsePhaseConfigs(args = {}, profileName = 'local') {
  const custom = String(args.phaseConfigs || '').trim()
  if (custom) {
    const parsed = JSON.parse(custom)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('phaseConfigs must be a non-empty JSON array')
    }
    return parsed.map((item, index) => ({
      name: String(item?.name || `phase_${index + 1}`).trim(),
      rpm: Math.max(1, toNumber(item?.rpm, 1)),
      durationSec: Math.max(1, toNumber(item?.durationSec, 1)),
    }))
  }

  const picked = PHASE_PROFILES[profileName] || PHASE_PROFILES.local
  return picked.map((item) => ({ ...item }))
}

function toAdIdentity(bid = {}) {
  const adId = String(bid?.bidId || bid?.item_id || bid?.itemId || bid?.adId || '').trim()
  const adUrl = String(bid?.url || bid?.target_url || bid?.targetUrl || '').trim()
  return { adId, adUrl }
}

function buildBidPayload({ scenario, placementId, sessionId, userId }) {
  const messages = Array.isArray(scenario.messages) && scenario.messages.length > 0
    ? scenario.messages
    : [
        { role: 'user', content: scenario.query },
        { role: 'assistant', content: scenario.answerText },
      ]
  return {
    userId,
    chatId: sessionId,
    placementId,
    messages,
  }
}

async function readProcessRssMb(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null
  return await new Promise((resolve) => {
    const child = spawn('ps', ['-o', 'rss=', '-p', String(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })

    child.on('error', () => resolve(null))
    child.on('close', () => {
      const kb = Number(String(output || '').trim())
      if (!Number.isFinite(kb) || kb <= 0) {
        resolve(null)
        return
      }
      resolve(round(kb / 1024, 3))
    })
  })
}

function startRssSampler(pid, intervalSec = 30) {
  const samples = []
  const intervalMs = Math.max(1000, Math.floor(toNumber(intervalSec, 30) * 1000))
  let timer = null
  let stopped = false

  const sample = async () => {
    if (stopped) return
    const rssMb = await readProcessRssMb(pid)
    if (Number.isFinite(rssMb)) {
      samples.push({ at: nowIso(), rssMb })
    }
  }

  timer = setInterval(() => {
    sample().catch(() => {})
  }, intervalMs)

  sample().catch(() => {})

  return {
    async stop() {
      stopped = true
      if (timer) clearInterval(timer)
      const rssMb = await readProcessRssMb(pid)
      if (Number.isFinite(rssMb)) {
        samples.push({ at: nowIso(), rssMb })
      }

      const startMb = samples.length > 0 ? toNumber(samples[0].rssMb, 0) : 0
      const endMb = samples.length > 0 ? toNumber(samples[samples.length - 1].rssMb, 0) : 0
      const growthMb = round(endMb - startMb, 3)
      const growthPct = startMb > 0 ? round((growthMb / startMb) * 100, 4) : 0
      return {
        samples,
        summary: {
          startMb,
          endMb,
          growthMb,
          growthPct,
        },
      }
    },
  }
}

async function runClosedLoopRequest(context = {}, sequence = 0) {
  const { baseUrl, runtimeHeaders, scenario, placementId, timeoutMs, withPostback, appId, accountId } = context

  const now = Date.now()
  const sessionId = `perf_${context.phaseName}_${sequence}_${now}`
  const turnId = `turn_perf_${context.phaseName}_${sequence}_${now}`
  const userId = `perf_user_${scenario.key}_${sequence}`

  const bidPayload = buildBidPayload({ scenario, placementId, sessionId, userId })
  const bidRes = await requestJson(baseUrl, '/api/v2/bid', {
    method: 'POST',
    headers: runtimeHeaders,
    body: bidPayload,
    timeoutMs,
  })

  if (!bidRes.ok) {
    return {
      ok: false,
      served: false,
      noFill: false,
      placementId,
      triggerType: resolveTriggerType(placementId, ''),
      pricingVersion: '',
      requestId: String(bidRes.payload?.requestId || '').trim(),
      status: bidRes.status,
      reason: 'bid_failed',
      reasonCode: '',
      retrievalMode: '',
      retrievalHitCount: 0,
      intentThreshold: NaN,
      intentScore: NaN,
      bidLatencyMs: bidRes.elapsedMs,
      impressionLatencyMs: 0,
      clickLatencyMs: 0,
      postbackLatencyMs: 0,
      postbackAttempted: false,
      postbackReported: false,
      conversionRevenueUsd: 0,
      winner: null,
    }
  }

  const requestId = String(bidRes.payload?.requestId || '').trim()
  const bidDiagnostics = bidRes.payload?.diagnostics && typeof bidRes.payload.diagnostics === 'object'
    ? bidRes.payload.diagnostics
    : {}
  const reasonCode = String(
    bidDiagnostics.reasonCode
    || bidRes.payload?.decisionTrace?.reasonCode
    || '',
  ).trim() || 'no_fill'
  const retrievalMode = String(
    bidDiagnostics.retrievalMode
    || bidDiagnostics.retrievalDebug?.mode
    || '',
  ).trim()
  const retrievalHitCount = toNumber(
    bidDiagnostics.retrievalHitCount
    ?? bidDiagnostics.retrievalDebug?.fusedHitCount,
    0,
  )
  const intentThreshold = toNumber(bidDiagnostics.intentThreshold, NaN)
  const intentScoreObserved = toNumber(bidRes.payload?.intent?.score, NaN)
  const triggerType = resolveTriggerType(placementId, bidDiagnostics.triggerType)
  const pricingVersion = String(bidDiagnostics.pricingVersion || '').trim()
  const winnerBid = bidRes.payload?.data?.bid && typeof bidRes.payload.data.bid === 'object'
    ? bidRes.payload.data.bid
    : null

  if (!winnerBid) {
    return {
      ok: true,
      served: false,
      noFill: true,
      placementId,
      triggerType,
      pricingVersion,
      requestId,
      status: bidRes.status,
      reason: reasonCode,
      reasonCode,
      retrievalMode,
      retrievalHitCount,
      intentThreshold,
      intentScore: intentScoreObserved,
      bidLatencyMs: bidRes.elapsedMs,
      impressionLatencyMs: 0,
      clickLatencyMs: 0,
      postbackLatencyMs: 0,
      postbackAttempted: false,
      postbackReported: false,
      conversionRevenueUsd: 0,
      winner: null,
    }
  }

  const { adId } = toAdIdentity(winnerBid)
  if (!requestId || !adId) {
    return {
      ok: false,
      served: true,
      noFill: false,
      placementId,
      triggerType,
      pricingVersion,
      requestId,
      status: bidRes.status,
      reason: 'missing_request_or_ad_id',
      reasonCode,
      retrievalMode,
      retrievalHitCount,
      intentThreshold,
      intentScore: intentScoreObserved,
      bidLatencyMs: bidRes.elapsedMs,
      impressionLatencyMs: 0,
      clickLatencyMs: 0,
      postbackLatencyMs: 0,
      postbackAttempted: false,
      postbackReported: false,
      conversionRevenueUsd: 0,
      winner: null,
    }
  }

  const impressionPayload = createSdkEventPayload({
    appId,
    scenario,
    query: scenario.query,
    answerText: scenario.answerText,
    intentClass: scenario.intentClass,
    intentScore: scenario.intentScore,
    preferenceFacets: scenario.preferenceFacets,
    locale: scenario.locale,
    requestId,
    adId,
    sessionId,
    turnId,
    userId,
    placementId,
    kind: 'impression',
  })

  const clickPayload = createSdkEventPayload({
    appId,
    scenario,
    query: scenario.query,
    answerText: scenario.answerText,
    intentClass: scenario.intentClass,
    intentScore: scenario.intentScore,
    preferenceFacets: scenario.preferenceFacets,
    locale: scenario.locale,
    requestId,
    adId,
    sessionId,
    turnId,
    userId,
    placementId,
    kind: 'click',
  })

  const impressionRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
    method: 'POST',
    headers: runtimeHeaders,
    body: impressionPayload,
    timeoutMs,
  })

  const clickRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
    method: 'POST',
    headers: runtimeHeaders,
    body: clickPayload,
    timeoutMs,
  })

  let postbackAttempted = false
  let postbackReported = false
  let postbackLatencyMs = 0
  let conversionRevenueUsd = 0

  const pricing = winnerBid?.pricing && typeof winnerBid.pricing === 'object' ? winnerBid.pricing : {}
  const cpaUsd = toNumber(pricing?.cpaUsd, NaN)
  const pConv = clamp01(pricing?.pConv)

  if (withPostback && clickRes.ok && Number.isFinite(cpaUsd) && cpaUsd > 0) {
    const sampled = shouldSamplePostback(requestId, adId, turnId, pConv)
    if (sampled) {
      postbackAttempted = true
      const postbackPayload = {
        eventType: 'postback',
        appId,
        accountId,
        requestId,
        sessionId,
        turnId,
        userId,
        placementId,
        adId,
        postbackType: 'conversion',
        postbackStatus: 'success',
        conversionId: buildStableConversionId(requestId, adId, turnId),
        cpaUsd: round(cpaUsd, 4),
        currency: 'USD',
      }

      const postbackRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
        method: 'POST',
        headers: runtimeHeaders,
        body: postbackPayload,
        timeoutMs,
      })
      postbackLatencyMs = postbackRes.elapsedMs
      postbackReported = postbackRes.ok && postbackRes.payload?.ok === true
      if (postbackReported) {
        conversionRevenueUsd = round(cpaUsd, 4)
      }
    }
  }

  const ok = impressionRes.ok && clickRes.ok && (!postbackAttempted || postbackReported)

  return {
    ok,
    served: true,
    noFill: false,
    placementId,
    triggerType,
    pricingVersion: String(pricing?.modelVersion || pricingVersion || '').trim(),
    requestId,
    status: 200,
    reason: ok ? 'closed_loop_ok' : 'event_failed',
    reasonCode,
    retrievalMode,
    retrievalHitCount,
    intentThreshold,
    intentScore: intentScoreObserved,
    bidLatencyMs: bidRes.elapsedMs,
    impressionLatencyMs: impressionRes.elapsedMs,
    clickLatencyMs: clickRes.elapsedMs,
    postbackLatencyMs,
    postbackAttempted,
    postbackReported,
    conversionRevenueUsd,
    winner: {
      network: String(pricing?.network || winnerBid?.dsp || '').trim().toLowerCase(),
      priceUsd: toNumber(winnerBid?.price, NaN),
      ecpmUsd: toNumber(pricing?.ecpmUsd, NaN),
      cpaUsd: toNumber(pricing?.cpaUsd, NaN),
      pConv,
      triggerType: String(pricing?.triggerType || triggerType || '').trim(),
    },
  }
}

function createRevenueAggregate(seed = {}) {
  return {
    ...seed,
    impressions: 0,
    settledConversions: 0,
    expectedRevenueUsd: 0,
    realizedRevenueUsd: 0,
    targetRpmUsd: Number.isFinite(toNumber(seed.targetRpmUsd, NaN)) ? toNumber(seed.targetRpmUsd, 0) : 0,
  }
}

function finalizeRevenueAggregate(row = {}) {
  const impressions = toNumber(row.impressions, 0)
  const expectedRevenueUsd = toNumber(row.expectedRevenueUsd, 0)
  const realizedRevenueUsd = toNumber(row.realizedRevenueUsd, 0)
  return {
    ...row,
    impressions,
    settledConversions: toNumber(row.settledConversions, 0),
    expectedRevenueUsd: round(expectedRevenueUsd, 4),
    realizedRevenueUsd: round(realizedRevenueUsd, 4),
    expectedEcpmUsd: impressions > 0 ? round((expectedRevenueUsd / impressions) * 1000, 4) : 0,
    realizedEcpmUsd: impressions > 0 ? round((realizedRevenueUsd / impressions) * 1000, 4) : 0,
  }
}

function applyRevenueObservation(target, row = {}) {
  if (!target) return
  const winner = row?.winner && typeof row.winner === 'object' ? row.winner : {}
  const expectedEcpm = toNumber(winner.ecpmUsd, 0)
  const realizedRevenueUsd = toNumber(row.conversionRevenueUsd, 0)
  target.impressions += 1
  target.expectedRevenueUsd += Math.max(0, expectedEcpm) / 1000
  target.realizedRevenueUsd += Math.max(0, realizedRevenueUsd)
  if (toBoolean(row.postbackReported, false)) {
    target.settledConversions += 1
  }
}

function summarizePhaseResults(results = [], phaseConfig = {}, durationActualSec = 0) {
  const rows = Array.isArray(results) ? results : []
  const total = rows.length
  const servedRows = rows.filter((item) => item.served)
  const noFillRows = rows.filter((item) => item.noFill)
  const failedRows = rows.filter((item) => !item.ok)

  const bidLatencies = rows.map((item) => item.bidLatencyMs).filter((item) => Number.isFinite(item) && item > 0)
  const impressionLatencies = rows
    .map((item) => item.impressionLatencyMs)
    .filter((item) => Number.isFinite(item) && item > 0)
  const clickLatencies = rows
    .map((item) => item.clickLatencyMs)
    .filter((item) => Number.isFinite(item) && item > 0)
  const postbackLatencies = rows
    .map((item) => item.postbackLatencyMs)
    .filter((item) => Number.isFinite(item) && item > 0)

  const priceSamples = []
  const cpaByNetwork = {
    house: [],
    partnerstack: [],
    cj: [],
    other: [],
  }

  for (const row of servedRows) {
    const winner = row?.winner && typeof row.winner === 'object' ? row.winner : null
    if (!winner) continue
    const price = toNumber(winner.priceUsd, NaN)
    if (Number.isFinite(price) && price > 0) priceSamples.push(price)

    const cpa = toNumber(winner.cpaUsd, NaN)
    if (!Number.isFinite(cpa) || cpa <= 0) continue
    const network = winner.network === 'house' || winner.network === 'partnerstack' || winner.network === 'cj'
      ? winner.network
      : 'other'
    cpaByNetwork[network].push(cpa)
  }

  const postbackAttempted = rows.filter((item) => item.postbackAttempted).length
  const postbackReported = rows.filter((item) => item.postbackReported).length
  const actualRpm = durationActualSec > 0 ? (total / durationActualSec) * 60 : 0
  const servedRate = total > 0 ? (servedRows.length / total) * 100 : 0
  const reasonCode = {}
  const retrievalMode = {}
  const intentThresholdSamples = []
  const intentScoreSamples = []
  const placementAggregates = new Map()
  const triggerAggregates = new Map()
  const overallAggregate = createRevenueAggregate({
    targetRpmUsd: round(average(Object.values(TARGET_RPM_BY_PLACEMENT)), 4),
  })

  for (const row of rows) {
    const reason = String(row?.reasonCode || row?.reason || '').trim()
    if (reason) reasonCode[reason] = (reasonCode[reason] || 0) + 1
    const mode = String(row?.retrievalMode || '').trim()
    if (mode) retrievalMode[mode] = (retrievalMode[mode] || 0) + 1
    const threshold = toNumber(row?.intentThreshold, NaN)
    if (Number.isFinite(threshold)) intentThresholdSamples.push(threshold)
    const score = toNumber(row?.intentScore, NaN)
    if (Number.isFinite(score)) intentScoreSamples.push(score)
  }

  for (const row of servedRows) {
    const placementId = String(row?.placementId || '').trim()
    const triggerType = resolveTriggerType(placementId, row?.triggerType || row?.winner?.triggerType)
    const targetRpmUsd = toNumber(TARGET_RPM_BY_PLACEMENT[placementId], 10)
    if (placementId) {
      if (!placementAggregates.has(placementId)) {
        placementAggregates.set(placementId, createRevenueAggregate({
          placementId,
          triggerType,
          targetRpmUsd,
        }))
      }
      applyRevenueObservation(placementAggregates.get(placementId), row)
    }
    if (!triggerAggregates.has(triggerType)) {
      triggerAggregates.set(triggerType, createRevenueAggregate({
        triggerType,
        targetRpmUsd: 10,
      }))
    }
    applyRevenueObservation(triggerAggregates.get(triggerType), row)
    applyRevenueObservation(overallAggregate, row)
  }

  const summarizeList = (list = []) => ({
    count: list.length,
    min: list.length > 0 ? round(Math.min(...list), 4) : 0,
    max: list.length > 0 ? round(Math.max(...list), 4) : 0,
    mean: round(average(list), 4),
    p50: round(percentile(list, 0.5), 4),
    p90: round(percentile(list, 0.9), 4),
    p99: round(percentile(list, 0.99), 4),
  })

  return {
    name: phaseConfig.name,
    rpmTarget: phaseConfig.rpm,
    durationTargetSec: phaseConfig.durationSec,
    durationActualSec: round(durationActualSec, 3),
    totalClosedLoop: total,
    passedClosedLoop: total - failedRows.length,
    failedClosedLoop: failedRows.length,
    servedClosedLoop: servedRows.length,
    noFillClosedLoop: noFillRows.length,
    errorRatePct: round(total > 0 ? (failedRows.length / total) * 100 : 0, 4),
    actualRpm: round(actualRpm, 4),
    servedRatePct: round(servedRate, 4),
    postbackAttempted,
    postbackReported,
    postbackHitRatePct: round(postbackAttempted > 0 ? (postbackReported / postbackAttempted) * 100 : 0, 4),
    diagnostics: {
      reasonCode,
      retrievalMode,
      intentThreshold: {
        count: intentThresholdSamples.length,
        p50: round(percentile(intentThresholdSamples, 0.5), 4),
        p95: round(percentile(intentThresholdSamples, 0.95), 4),
      },
      intentScore: {
        count: intentScoreSamples.length,
        p50: round(percentile(intentScoreSamples, 0.5), 4),
        p95: round(percentile(intentScoreSamples, 0.95), 4),
      },
    },
    bidLatencyMs: {
      count: bidLatencies.length,
      mean: round(average(bidLatencies), 3),
      p50: round(percentile(bidLatencies, 0.5), 3),
      p95: round(percentile(bidLatencies, 0.95), 3),
      p99: round(percentile(bidLatencies, 0.99), 3),
      min: round(bidLatencies.length > 0 ? Math.min(...bidLatencies) : 0, 3),
      max: round(bidLatencies.length > 0 ? Math.max(...bidLatencies) : 0, 3),
    },
    eventLatencyMs: {
      impression: {
        count: impressionLatencies.length,
        mean: round(average(impressionLatencies), 3),
        p95: round(percentile(impressionLatencies, 0.95), 3),
        p99: round(percentile(impressionLatencies, 0.99), 3),
      },
      click: {
        count: clickLatencies.length,
        mean: round(average(clickLatencies), 3),
        p95: round(percentile(clickLatencies, 0.95), 3),
        p99: round(percentile(clickLatencies, 0.99), 3),
      },
      postback: {
        count: postbackLatencies.length,
        mean: round(average(postbackLatencies), 3),
        p95: round(percentile(postbackLatencies, 0.95), 3),
        p99: round(percentile(postbackLatencies, 0.99), 3),
      },
    },
    pricingSamples: {
      priceUsd: priceSamples,
      cpaUsdByNetwork: cpaByNetwork,
      distributions: {
        priceUsd: summarizeList(priceSamples),
        cpaUsdByNetwork: {
          house: summarizeList(cpaByNetwork.house),
          partnerstack: summarizeList(cpaByNetwork.partnerstack),
          cj: summarizeList(cpaByNetwork.cj),
          other: summarizeList(cpaByNetwork.other),
        },
      },
    },
    errorSamples: failedRows.slice(0, 20).map((row) => ({
      requestId: row.requestId,
      status: row.status,
      reason: row.reason,
      bidLatencyMs: row.bidLatencyMs,
    })),
    runAggregates: {
      byPlacement: Array.from(placementAggregates.values()).map((row) => finalizeRevenueAggregate(row)),
      byTriggerType: Array.from(triggerAggregates.values()).map((row) => finalizeRevenueAggregate(row)),
      overall: finalizeRevenueAggregate(overallAggregate),
    },
  }
}

async function runPhase(input = {}) {
  const phase = input.phase
  const scenarios = input.scenarios
  const placements = input.placements
  const startedAt = Date.now()
  const durationMs = Math.max(1000, Math.floor(toNumber(phase.durationSec, 1) * 1000))
  const intervalMs = Math.max(1, Math.floor(60000 / Math.max(1, toNumber(phase.rpm, 1))))

  let sequence = 0
  let launched = 0
  let droppedByInflightLimit = 0
  let nextAt = startedAt
  const inFlight = new Set()
  const results = []

  while (Date.now() - startedAt < durationMs) {
    const now = Date.now()
    while (now >= nextAt && nextAt - startedAt < durationMs) {
      if (inFlight.size >= input.maxInflight) {
        droppedByInflightLimit += 1
        nextAt += intervalMs
        continue
      }

      const selectedScenario = scenarios[sequence % scenarios.length]
      const selectedPlacement = placements[sequence % placements.length]
      sequence += 1
      launched += 1

      let task = null
      task = runClosedLoopRequest({
        baseUrl: input.baseUrl,
        runtimeHeaders: input.runtimeHeaders,
        appId: input.appId,
        accountId: input.accountId,
        timeoutMs: input.timeoutMs,
        withPostback: input.withPostback,
        scenario: selectedScenario,
        placementId: selectedPlacement,
        phaseName: phase.name,
      }, sequence)
        .then((result) => {
          results.push(result)
        })
        .catch((error) => {
          results.push({
            ok: false,
            served: false,
            noFill: false,
            placementId: selectedPlacement,
            triggerType: resolveTriggerType(selectedPlacement, ''),
            pricingVersion: '',
            requestId: '',
            status: 0,
            reason: error instanceof Error ? error.message : 'closed_loop_exception',
            reasonCode: '',
            retrievalMode: '',
            retrievalHitCount: 0,
            intentThreshold: NaN,
            intentScore: NaN,
            bidLatencyMs: 0,
            impressionLatencyMs: 0,
            clickLatencyMs: 0,
            postbackLatencyMs: 0,
            postbackAttempted: false,
            postbackReported: false,
            conversionRevenueUsd: 0,
            winner: null,
          })
        })
        .finally(() => {
          inFlight.delete(task)
        })

      inFlight.add(task)
      nextAt += intervalMs
    }
    await sleep(5)
  }

  await Promise.allSettled([...inFlight])
  const endedAt = Date.now()
  const durationActualSec = (endedAt - startedAt) / 1000

  const summary = summarizePhaseResults(results, phase, durationActualSec)
  summary.launched = launched
  summary.completed = results.length
  summary.droppedByInflightLimit = droppedByInflightLimit
  return summary
}

function mergePricingSamples(phases = []) {
  const merged = {
    priceUsd: [],
    cpaUsdByNetwork: {
      house: [],
      partnerstack: [],
      cj: [],
      other: [],
    },
  }

  for (const phase of phases) {
    const samples = phase?.pricingSamples || {}
    const prices = Array.isArray(samples.priceUsd) ? samples.priceUsd : []
    merged.priceUsd.push(...prices)

    const networkMap = samples.cpaUsdByNetwork && typeof samples.cpaUsdByNetwork === 'object'
      ? samples.cpaUsdByNetwork
      : {}
    for (const key of Object.keys(merged.cpaUsdByNetwork)) {
      const values = Array.isArray(networkMap[key]) ? networkMap[key] : []
      merged.cpaUsdByNetwork[key].push(...values)
    }
  }

  return merged
}

function summarizeDiagnosticsByPhase(phases = []) {
  const reasonCode = {}
  const retrievalMode = {}

  for (const phase of Array.isArray(phases) ? phases : []) {
    const diagnostics = phase?.diagnostics && typeof phase.diagnostics === 'object' ? phase.diagnostics : {}
    const reasonMap = diagnostics.reasonCode && typeof diagnostics.reasonCode === 'object' ? diagnostics.reasonCode : {}
    const modeMap = diagnostics.retrievalMode && typeof diagnostics.retrievalMode === 'object'
      ? diagnostics.retrievalMode
      : {}

    for (const [key, value] of Object.entries(reasonMap)) {
      reasonCode[key] = (reasonCode[key] || 0) + toNumber(value, 0)
    }
    for (const [key, value] of Object.entries(modeMap)) {
      retrievalMode[key] = (retrievalMode[key] || 0) + toNumber(value, 0)
    }
  }

  return {
    reasonCode,
    retrievalMode,
  }
}

function mergeRevenueAggregateRows(rows = []) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const placementId = String(row?.placementId || '').trim()
    const triggerType = String(row?.triggerType || '').trim()
    const key = placementId || triggerType
    if (!key) continue
    if (!map.has(key)) {
      map.set(key, createRevenueAggregate({
        placementId,
        triggerType,
        targetRpmUsd: toNumber(row?.targetRpmUsd, 0),
      }))
    }
    const target = map.get(key)
    target.impressions += toNumber(row?.impressions, 0)
    target.settledConversions += toNumber(row?.settledConversions, 0)
    target.expectedRevenueUsd += toNumber(row?.expectedRevenueUsd, 0)
    target.realizedRevenueUsd += toNumber(row?.realizedRevenueUsd, 0)
  }
  return Array.from(map.values()).map((row) => finalizeRevenueAggregate(row))
}

function mergeRunAggregatesFromPhases(phases = []) {
  const phaseRows = Array.isArray(phases) ? phases : []
  const byPlacement = mergeRevenueAggregateRows(
    phaseRows.flatMap((phase) => Array.isArray(phase?.runAggregates?.byPlacement) ? phase.runAggregates.byPlacement : []),
  )
  const byTriggerType = mergeRevenueAggregateRows(
    phaseRows.flatMap((phase) => Array.isArray(phase?.runAggregates?.byTriggerType) ? phase.runAggregates.byTriggerType : []),
  )

  const overallSeed = createRevenueAggregate({
    targetRpmUsd: round(average(Object.values(TARGET_RPM_BY_PLACEMENT)), 4),
  })
  for (const phase of phaseRows) {
    const row = phase?.runAggregates?.overall && typeof phase.runAggregates.overall === 'object'
      ? phase.runAggregates.overall
      : null
    if (!row) continue
    overallSeed.impressions += toNumber(row.impressions, 0)
    overallSeed.settledConversions += toNumber(row.settledConversions, 0)
    overallSeed.expectedRevenueUsd += toNumber(row.expectedRevenueUsd, 0)
    overallSeed.realizedRevenueUsd += toNumber(row.realizedRevenueUsd, 0)
  }

  return {
    byPlacement,
    byTriggerType,
    overall: finalizeRevenueAggregate(overallSeed),
  }
}

async function fetchDashboardSnapshot(baseUrl, dashboardAuthHeaders = {}) {
  const [summaryRes, byPlacementRes, usageRes] = await Promise.all([
    requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', { headers: dashboardAuthHeaders }),
    requestJson(baseUrl, '/api/v1/dashboard/metrics/by-placement', { headers: dashboardAuthHeaders }),
    requestJson(baseUrl, '/api/v1/dashboard/usage-revenue', { headers: dashboardAuthHeaders }),
  ])

  return {
    summary: {
      ok: summaryRes.ok,
      status: summaryRes.status,
      payload: summaryRes.payload,
    },
    byPlacement: {
      ok: byPlacementRes.ok,
      status: byPlacementRes.status,
      payload: byPlacementRes.payload,
    },
    usageRevenue: {
      ok: usageRes.ok,
      status: usageRes.status,
      payload: usageRes.payload,
    },
  }
}

function toUsageRowMap(usagePayload = {}) {
  const rows = Array.isArray(usagePayload?.byPlacement) ? usagePayload.byPlacement : []
  const map = new Map()
  for (const row of rows) {
    const placementId = String(row?.placementId || '').trim()
    if (!placementId) continue
    map.set(placementId, {
      placementId,
      layer: String(row?.layer || '').trim(),
      requests: toNumber(row?.requests, 0),
      served: toNumber(row?.served, 0),
      impressions: toNumber(row?.impressions, 0),
      clicks: toNumber(row?.clicks, 0),
      settledConversions: toNumber(row?.settledConversions, 0),
      settledRevenueUsd: toNumber(row?.settledRevenueUsd, 0),
    })
  }
  return map
}

function usageRowDelta(afterRow = {}, beforeRow = {}) {
  const requests = toNumber(afterRow.requests, 0) - toNumber(beforeRow.requests, 0)
  const served = toNumber(afterRow.served, 0) - toNumber(beforeRow.served, 0)
  const impressions = toNumber(afterRow.impressions, 0) - toNumber(beforeRow.impressions, 0)
  const clicks = toNumber(afterRow.clicks, 0) - toNumber(beforeRow.clicks, 0)
  const settledConversions = toNumber(afterRow.settledConversions, 0) - toNumber(beforeRow.settledConversions, 0)
  const settledRevenueUsd = toNumber(afterRow.settledRevenueUsd, 0) - toNumber(beforeRow.settledRevenueUsd, 0)

  return {
    requests,
    served,
    impressions,
    clicks,
    settledConversions,
    settledRevenueUsd: round(settledRevenueUsd, 4),
    ctr: impressions > 0 ? round(clicks / impressions, 4) : 0,
    fillRate: requests > 0 ? round(served / requests, 4) : 0,
    ecpm: impressions > 0 ? round((settledRevenueUsd / impressions) * 1000, 4) : 0,
    cpa: settledConversions > 0 ? round(settledRevenueUsd / settledConversions, 4) : 0,
  }
}

function computeUsageRevenueDelta(beforePayload = {}, afterPayload = {}) {
  const beforeTotals = beforePayload?.totals && typeof beforePayload.totals === 'object' ? beforePayload.totals : {}
  const afterTotals = afterPayload?.totals && typeof afterPayload.totals === 'object' ? afterPayload.totals : {}

  const beforeMap = toUsageRowMap(beforePayload)
  const afterMap = toUsageRowMap(afterPayload)
  const placementIds = new Set([...beforeMap.keys(), ...afterMap.keys()])
  const byPlacement = []

  for (const placementId of placementIds) {
    const delta = usageRowDelta(afterMap.get(placementId) || {}, beforeMap.get(placementId) || {})
    byPlacement.push({
      placementId,
      layer: String((afterMap.get(placementId) || beforeMap.get(placementId) || {}).layer || '').trim(),
      ...delta,
    })
  }

  const totals = usageRowDelta(afterTotals, beforeTotals)

  return {
    settlementModel: String(afterPayload?.settlementModel || beforePayload?.settlementModel || 'CPA'),
    currency: String(afterPayload?.currency || beforePayload?.currency || 'USD'),
    totals,
    byPlacement,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const externalGatewayUrl = String(args.gatewayUrl || '').trim()
  const port = toInteger(args.port, DEFAULT_PORT)
  const useExternalGateway = Boolean(externalGatewayUrl)

  const profileName = String(args.phaseProfile || (useExternalGateway ? 'staging' : 'local')).trim().toLowerCase()
  const phaseConfigs = parsePhaseConfigs(args, profileName)
  const maxInflight = Math.max(1, toInteger(args.maxInflight, 100))
  const timeoutMs = Math.max(200, toInteger(args.timeoutMs, 12000))
  const rssSampleIntervalSec = Math.max(1, toInteger(args.rssSampleIntervalSec, 30))
  const skipReset = toBoolean(args.skipReset, false)
  const withPostback = toBoolean(args.withPostback, true)
  const settlementStorage = parseSettlementStorage(args.settlementStorage, 'auto')
  const inventoryPrewarm = toBoolean(args.inventoryPrewarm, true)
  const fallbackWhenInventoryUnavailable = toBoolean(args.fallbackWhenInventoryUnavailable, true)
  const inventoryNetworks = parseInventoryNetworks(args.inventoryNetworks)
  const placements = parsePlacements(args.placements)
  const scenarioSetPath = String(args.scenarioSet || DEFAULT_SCENARIO_SET_PATH).trim()

  const startedAtIso = nowIso()
  const baseUrl = externalGatewayUrl || `http://${DEFAULT_HOST}:${port}`
  let effectiveSettlementStorage = settlementStorage

  let gatewayHandle = null
  let rssSampler = null

  try {
    if (!useExternalGateway) {
      gatewayHandle = startGatewayProcess(port, {
        SIMULATOR_STRICT_MANUAL_INTEGRATION: 'false',
        SIMULATOR_SETTLEMENT_STORAGE: effectiveSettlementStorage,
        SIMULATOR_REQUIRE_DURABLE_SETTLEMENT: 'false',
        SIMULATOR_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE: 'false',
        SIMULATOR_RUNTIME_AUTH_REQUIRED: 'true',
        SIMULATOR_V2_INVENTORY_FALLBACK: fallbackWhenInventoryUnavailable ? 'true' : 'false',
      })
    }
    try {
      await waitForGateway(baseUrl)
    } catch (error) {
      if (!useExternalGateway && settlementStorage === 'auto') {
        await stopGatewayProcess(gatewayHandle)
        effectiveSettlementStorage = 'state_file'
        gatewayHandle = startGatewayProcess(port, {
          SIMULATOR_STRICT_MANUAL_INTEGRATION: 'false',
          SIMULATOR_SETTLEMENT_STORAGE: effectiveSettlementStorage,
          SIMULATOR_REQUIRE_DURABLE_SETTLEMENT: 'false',
          SIMULATOR_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE: 'false',
          SIMULATOR_RUNTIME_AUTH_REQUIRED: 'true',
          SIMULATOR_V2_INVENTORY_FALLBACK: fallbackWhenInventoryUnavailable ? 'true' : 'false',
        })
        await waitForGateway(baseUrl)
      } else {
        throw error
      }
    }

    if (!skipReset) {
      const resetRes = await requestJson(baseUrl, '/api/v1/dev/reset', {
        method: 'POST',
      })
      if (!resetRes.ok) {
        throw new Error(`gateway reset failed: HTTP_${resetRes.status}`)
      }
    }

    const auth = await resolveAuthContext(baseUrl, args, { useExternalGateway })

    await ensurePlacementsEnabled(baseUrl, placements, auth.dashboardHeaders)

    const inventoryReadiness = await ensureInventoryReady(baseUrl, {
      inventoryPrewarm,
      fallbackWhenInventoryUnavailable,
      networks: inventoryNetworks,
    })
    if (!inventoryReadiness.ok && inventoryReadiness.fatal) {
      throw new Error(
        `inventory readiness failed (${inventoryReadiness.code}): mode=${inventoryReadiness.mode || 'unknown'} status=${inventoryReadiness.status || 0}`,
      )
    }

    if (gatewayHandle?.child?.pid) {
      rssSampler = startRssSampler(gatewayHandle.child.pid, rssSampleIntervalSec)
    }

    const scenarioSet = await loadScenarioSet(scenarioSetPath)
    const dashboardBefore = await fetchDashboardSnapshot(baseUrl, auth.dashboardHeaders)
    const phaseResults = []

    for (const phase of phaseConfigs) {
      const phaseResult = await runPhase({
        phase,
        baseUrl,
        runtimeHeaders: auth.runtimeHeaders,
        appId: auth.appId,
        accountId: auth.accountId,
        maxInflight,
        timeoutMs,
        withPostback,
        scenarios: scenarioSet.scenarios,
        placements,
      })
      phaseResults.push(phaseResult)
    }

    const pricingSamples = mergePricingSamples(phaseResults)
    const bidPriceSamples = pricingSamples.priceUsd
    const cpaSamplesByNetwork = pricingSamples.cpaUsdByNetwork

    const totalClosedLoop = phaseResults.reduce((sum, item) => sum + toNumber(item.totalClosedLoop, 0), 0)
    const servedClosedLoop = phaseResults.reduce((sum, item) => sum + toNumber(item.servedClosedLoop, 0), 0)
    const failedClosedLoop = phaseResults.reduce((sum, item) => sum + toNumber(item.failedClosedLoop, 0), 0)
    const diagnosticsSummary = summarizeDiagnosticsByPhase(phaseResults)
    const runAggregates = mergeRunAggregatesFromPhases(phaseResults)

    const dashboardAfter = await fetchDashboardSnapshot(baseUrl, auth.dashboardHeaders)
    const dashboardDelta = {
      summary: null,
      byPlacement: null,
      usageRevenue: null,
    }
    if (dashboardBefore.usageRevenue.ok && dashboardAfter.usageRevenue.ok) {
      dashboardDelta.usageRevenue = {
        ok: true,
        status: 200,
        payload: computeUsageRevenueDelta(dashboardBefore.usageRevenue.payload, dashboardAfter.usageRevenue.payload),
      }
    }
    const rss = rssSampler ? await rssSampler.stop() : { samples: [], summary: null }

    const report = {
      runId: `perf_sdk_batch_${nowTag(new Date())}`,
      startedAt: startedAtIso,
      endedAt: nowIso(),
      options: {
        baseUrl,
        profileName,
        maxInflight,
        timeoutMs,
        rssSampleIntervalSec,
        withPostback,
        skipReset,
        settlementStorage,
        effectiveSettlementStorage,
        inventoryPrewarm,
        fallbackWhenInventoryUnavailable,
        inventoryNetworks,
        placements,
        scenarioSet: {
          id: scenarioSet.scenarioSet,
          sourcePath: path.relative(PROJECT_ROOT, scenarioSet.sourcePath),
          scenarioCount: scenarioSet.scenarios.length,
        },
        auth: {
          accountId: auth.accountId,
          appId: auth.appId,
          environment: auth.environment,
          hasRuntimeKey: Boolean(auth.runtimeKey),
          hasDashboardToken: Boolean(auth.dashboardToken),
        },
        phaseConfigs,
        inventoryReadiness,
      },
      phases: phaseResults,
      overall: {
        totalClosedLoop,
        servedClosedLoop,
        servedRatePct: round(totalClosedLoop > 0 ? (servedClosedLoop / totalClosedLoop) * 100 : 0, 4),
        failedClosedLoop,
        errorRatePct: round(totalClosedLoop > 0 ? (failedClosedLoop / totalClosedLoop) * 100 : 0, 4),
      },
      diagnostics: diagnosticsSummary,
      runAggregates,
      pricing: {
        bidPriceSamples,
        cpaSamplesByNetwork,
        bidPriceDistribution: {
          count: bidPriceSamples.length,
          min: bidPriceSamples.length > 0 ? round(Math.min(...bidPriceSamples), 4) : 0,
          max: bidPriceSamples.length > 0 ? round(Math.max(...bidPriceSamples), 4) : 0,
          p50: round(percentile(bidPriceSamples, 0.5), 4),
          p90: round(percentile(bidPriceSamples, 0.9), 4),
          p99: round(percentile(bidPriceSamples, 0.99), 4),
        },
      },
      dashboardSnapshot: {
        before: dashboardBefore,
        after: dashboardAfter,
        delta: dashboardDelta,
      },
      rss,
    }

    const fileName = String(args.reportFile || `perf-sdk-batch-${new Date().toISOString().replace(/[:.]/g, '-')}.json`).trim()
    const reportPath = path.isAbsolute(fileName)
      ? fileName
      : path.join(REPORT_DIR, fileName)

    await writeJson(reportPath, report)

    console.log(JSON.stringify({
      ok: true,
      runId: report.runId,
      reportPath: path.relative(PROJECT_ROOT, reportPath),
      overall: report.overall,
      bidPriceP90: report.pricing.bidPriceDistribution.p90,
      runAggregates: report.runAggregates,
    }, null, 2))
  } catch (error) {
    const details = gatewayHandle?.logs ? gatewayHandle.logs() : { stdout: '', stderr: '' }
    console.error(
      '[perf-sdk-batch] failed:',
      error instanceof Error ? error.message : String(error),
      '\n[gateway stdout]\n',
      details.stdout,
      '\n[gateway stderr]\n',
      details.stderr,
    )
    process.exitCode = 1
  } finally {
    if (rssSampler) {
      await rssSampler.stop().catch(() => {})
    }
    if (gatewayHandle) {
      await stopGatewayProcess(gatewayHandle)
    }
  }
}

main()
