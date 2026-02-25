import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

import {
  PROJECT_ROOT,
  DEFAULT_SCENARIO_SET_PATH,
  parseArgs,
  parsePlacements,
  toBoolean,
  toInteger,
  nowIso,
  nowTag,
  writeJson,
} from './lib/meyka-suite-utils.js'

const REPORT_DIR = path.join(PROJECT_ROOT, 'tests', 'reports', 'meyka-suite')
const RUNS_DIR = path.join(REPORT_DIR, 'runs')
const LATEST_PATH = path.join(REPORT_DIR, 'latest.json')

function asCliArgs(options = {}) {
  const entries = Object.entries(options)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
  return entries.map(([key, value]) => `--${key}=${value}`)
}

async function runNodeScript(scriptRelativePath, args = []) {
  const scriptPath = path.join(PROJECT_ROOT, scriptRelativePath)
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(Number.isInteger(code) ? code : 1)
    })
  })

  if (exitCode !== 0) {
    throw new Error(
      `${path.basename(scriptRelativePath)} failed with code ${exitCode}\n[stdout]\n${stdout}\n[stderr]\n${stderr}`,
    )
  }

  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new Error(`${path.basename(scriptRelativePath)} returned empty output`)
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(`${path.basename(scriptRelativePath)} returned non-JSON output:\n${trimmed}`)
  }
}

async function readReportByRelativePath(relativePath) {
  const absolutePath = path.resolve(PROJECT_ROOT, relativePath)
  const raw = await fs.readFile(absolutePath, 'utf8')
  return JSON.parse(raw)
}

function evaluateConnectivity(regressionReport = {}) {
  const issueSummary = regressionReport?.issueSummary || { bySeverity: { P0: 0 } }
  const p0Count = Number(issueSummary?.bySeverity?.P0 || 0)
  const scenarios = Array.isArray(regressionReport?.scenarios) ? regressionReport.scenarios : []

  const servedRows = scenarios.filter((item) => String(item?.evidence?.decisionResult || '') === 'served')
  const servedVisibilityPass = servedRows.filter((item) => {
    const issues = Array.isArray(item?.issues) ? item.issues : []
    return !issues.some((row) => {
      const code = String(row?.code || '')
      return (
        code === 'DECISION_NOT_VISIBLE'
        || code === 'IMPRESSION_NOT_VISIBLE'
        || code === 'CLICK_NOT_VISIBLE'
        || code === 'POSTBACK_NOT_VISIBLE'
      )
    })
  }).length

  const servedVisibilityRatio = servedRows.length > 0
    ? (servedVisibilityPass / servedRows.length) * 100
    : 100

  const postbackIdempotencyPass = !scenarios.some((item) => {
    const issues = Array.isArray(item?.issues) ? item.issues : []
    return issues.some((issue) => String(issue?.code || '') === 'POSTBACK_IDEMPOTENCY_FAILED')
  })

  return {
    p0Count,
    servedCount: servedRows.length,
    servedVisibilityRatio,
    postbackIdempotencyPass,
    pass: p0Count === 0 && servedVisibilityRatio === 100 && postbackIdempotencyPass,
  }
}

function evaluateCapacity(perfReport = {}) {
  const phases = Array.isArray(perfReport?.phases) ? perfReport.phases : []
  const steady = phases.find((item) => String(item?.name || '') === 'steady')
  const burst = phases.find((item) => String(item?.name || '') === 'burst')
  const overallErrorRatePct = Number(perfReport?.overall?.errorRatePct || 0)

  const steadyActualRpm = Number(steady?.actualRpm || 0)
  const burstActualRpm = Number(burst?.actualRpm || 0)
  const steadyP95BidMs = Number(steady?.bidLatencyMs?.p95 || 0)
  const burstP95BidMs = Number(burst?.bidLatencyMs?.p95 || 0)

  return {
    steadyActualRpm,
    burstActualRpm,
    overallErrorRatePct,
    steadyP95BidMs,
    burstP95BidMs,
    pass: (
      steadyActualRpm >= 114
      && burstActualRpm >= 270
      && overallErrorRatePct <= 2.5
      && steadyP95BidMs <= 5000
      && burstP95BidMs <= 8000
    ),
  }
}

function evaluateRevenue(revenueEval = {}) {
  const placementEcpm = Array.isArray(revenueEval?.results?.placementEcpm)
    ? revenueEval.results.placementEcpm
    : []
  const overall = revenueEval?.results?.overallEcpm || {}
  const priceDistribution = revenueEval?.results?.priceDistribution || {}
  const cpaRanges = Array.isArray(revenueEval?.results?.cpaRanges) ? revenueEval.results.cpaRanges : []
  const settlementPresence = revenueEval?.results?.settlementPresence || {}

  return {
    placementPass: placementEcpm.every((item) => item?.pass === true),
    overallPass: overall?.pass === true,
    pricePass: priceDistribution?.pass === true,
    cpaRangePass: cpaRanges.every((item) => item?.pass === true),
    settlementPass: settlementPresence?.pass === true,
    pass: revenueEval?.pass === true,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const envName = String(args.env || 'local').trim().toLowerCase()
  if (envName !== 'local' && envName !== 'staging') {
    throw new Error('env must be local or staging')
  }

  const startedAt = nowIso()
  const scenarioSet = String(args.scenarioSet || DEFAULT_SCENARIO_SET_PATH).trim()
  const placements = parsePlacements(args.placements).join(',')
  const gatewayUrl = String(args.gatewayUrl || '').trim()
  const localPort = toInteger(args.port, 3400 + Math.floor(Math.random() * 400))
  const withPostback = toBoolean(args.withPostback, true)
  const skipLandingCheck = toBoolean(args.skipLandingCheck, true)
  const skipResetDefault = envName === 'staging'
  const skipReset = toBoolean(args.skipReset, skipResetDefault)

  const shared = {
    scenarioSet,
    placements,
    withPostback,
    accountId: args.accountId,
    appId: args.appId,
    environment: args.environment,
    runtimeKey: args.runtimeKey,
    dashboardToken: args.dashboardToken,
    autoRegisterDashboard: args.autoRegisterDashboard,
  }

  if (gatewayUrl) {
    shared.gatewayUrl = gatewayUrl
  } else {
    shared.port = localPort
  }

  const regressionArgs = asCliArgs({
    ...shared,
    skipLandingCheck,
    skipReset,
    failOnNew: false,
    failOnCurrent: false,
  })

  const perfArgs = asCliArgs({
    ...shared,
    skipReset,
    phaseProfile: String(args.phaseProfile || envName),
    maxInflight: args.maxInflight,
    timeoutMs: args.timeoutMs,
    rssSampleIntervalSec: args.rssSampleIntervalSec,
    reportFile: args.perfReportFile,
  })

  const runId = `meyka_suite_${envName}_${nowTag(new Date())}`
  const runReportPath = path.join(RUNS_DIR, `${runId}.json`)
  const revenueOutputPath = path.join(REPORT_DIR, `revenue-eval-${runId}.json`)

  const regressionSummary = await runNodeScript('scripts/regress-meyka-closure.js', regressionArgs)
  const regressionReport = await readReportByRelativePath(regressionSummary.outputFiles.runReport)

  const perfSummary = await runNodeScript('scripts/perf-sdk-batch.js', perfArgs)
  const perfReport = await readReportByRelativePath(perfSummary.reportPath)

  const revenueSummary = await runNodeScript('scripts/evaluate-revenue-reasonableness.js', asCliArgs({
    perfReport: path.join(PROJECT_ROOT, perfSummary.reportPath),
    pricingConfig: args.pricingConfig,
    output: revenueOutputPath,
  }))
  const revenueReport = await readReportByRelativePath(path.relative(PROJECT_ROOT, revenueOutputPath))

  const connectivity = evaluateConnectivity(regressionReport)
  const capacity = evaluateCapacity(perfReport)
  const revenue = evaluateRevenue(revenueReport)

  const suitePass = connectivity.pass && capacity.pass && revenue.pass

  const suiteReport = {
    runId,
    env: envName,
    startedAt,
    finishedAt: nowIso(),
    options: {
      gatewayUrl: gatewayUrl || null,
      scenarioSet,
      placements: placements.split(','),
      withPostback,
      skipLandingCheck,
      skipReset,
    },
    steps: {
      regression: {
        summary: regressionSummary,
        reportPath: regressionSummary.outputFiles.runReport,
      },
      perf: {
        summary: perfSummary,
        reportPath: perfSummary.reportPath,
      },
      revenue: {
        summary: revenueSummary,
        reportPath: path.relative(PROJECT_ROOT, revenueOutputPath),
      },
    },
    acceptance: {
      connectivity,
      capacity,
      revenue,
      pass: suitePass,
    },
  }

  await writeJson(runReportPath, suiteReport)
  await writeJson(LATEST_PATH, suiteReport)

  console.log(JSON.stringify({
    ok: true,
    pass: suitePass,
    runId,
    reportPath: path.relative(PROJECT_ROOT, runReportPath),
    latestPath: path.relative(PROJECT_ROOT, LATEST_PATH),
    acceptance: suiteReport.acceptance,
  }, null, 2))
}

main().catch((error) => {
  console.error('[run-meyka-suite] failed:', error?.message || error)
  process.exit(1)
})
