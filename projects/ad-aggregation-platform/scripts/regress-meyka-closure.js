import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src/devtools/simulator/simulator-gateway.js')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3213
const HEALTH_CHECK_TIMEOUT_MS = 15000
const REQUEST_TIMEOUT_MS = 30000

const REPORT_DIR = path.join(PROJECT_ROOT, 'tests', 'reports', 'meyka-regression')
const REPORT_RUNS_DIR = path.join(REPORT_DIR, 'runs')
const LATEST_REPORT_PATH = path.join(REPORT_DIR, 'latest.json')
const DIFF_REPORT_PATH = path.join(REPORT_DIR, 'issue-diff-latest.json')

const MEYKA_SCENARIOS = [
  {
    key: 'stocks',
    query: 'Recent upgrade trend for Amazon stock? Also compare broker tools for tracking analyst upgrades.',
    answerText: 'Track upgrade trend changes, compare broker scanners, and set alerts for analyst actions.',
    intentClass: 'product_exploration',
    intentScore: 0.82,
  },
  {
    key: 'grades',
    query: 'I need to improve my calculus grades quickly. What tutoring platforms and study products should I compare?',
    answerText: 'Compare tutoring platforms by teacher quality, speed, and practice depth before choosing.',
    intentClass: 'product_exploration',
    intentScore: 0.7,
  },
  {
    key: 'forecasts',
    query: 'What are good platforms for stock forecasts and portfolio projections for retail investors?',
    answerText: 'Compare forecast reliability, portfolio simulation, and backtesting support for retail workflows.',
    intentClass: 'product_exploration',
    intentScore: 0.9,
  },
  {
    key: 'market_news',
    query: 'Where can I get real-time market news alerts and earnings calendar updates with actionable tools?',
    answerText: 'Prioritize providers with low-latency alerts, earnings calendars, and execution-ready watchlists.',
    intentClass: 'product_exploration',
    intentScore: 0.82,
  },
]

function parseArgs(argv) {
  const options = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const index = arg.indexOf('=')
    if (index < 0) {
      options[arg.slice(2)] = 'true'
      continue
    }
    options[arg.slice(2, index)] = arg.slice(index + 1)
  }
  return options
}

function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

function toInteger(value, fallback) {
  const num = Number(value)
  if (Number.isFinite(num)) return Math.floor(num)
  return fallback
}

function nowIso() {
  return new Date().toISOString()
}

function nowTag(date = new Date()) {
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const sec = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const timeout = withTimeoutSignal(options.timeoutMs || REQUEST_TIMEOUT_MS)
  try {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: timeout.signal,
      })

      const payload = await response.json().catch(() => ({}))
      return {
        ok: response.ok,
        status: response.status,
        payload,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request_failed'
      return {
        ok: false,
        status: 0,
        payload: {
          error: {
            code: 'REQUEST_FAILED',
            message,
          },
        },
      }
    }
  } finally {
    timeout.clear()
  }
}

async function waitForGateway(baseUrl) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < HEALTH_CHECK_TIMEOUT_MS) {
    try {
      const response = await requestJson(baseUrl, '/api/health', { timeoutMs: 1200 })
      if (response.ok && response.payload?.ok === true) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`Gateway health check timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`)
}

function startGatewayProcess(port) {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', GATEWAY_ENTRY], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SIMULATOR_GATEWAY_HOST: DEFAULT_HOST,
      SIMULATOR_GATEWAY_PORT: String(port),
    },
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

  return {
    child,
    logs: () => ({ stdout, stderr }),
  }
}

async function stopGatewayProcess(handle) {
  if (!handle?.child) return
  handle.child.kill('SIGTERM')
  await sleep(200)
  if (!handle.child.killed) {
    handle.child.kill('SIGKILL')
  }
}

function createScenarioPayload(scenario) {
  const now = Date.now()
  return {
    appId: 'simulator-chatbot',
    sessionId: `meyka_${scenario.key}_${now}`,
    turnId: `turn_${scenario.key}_${now}`,
    userId: `meyka_user_${scenario.key}`,
    event: 'followup_generation',
    placementId: 'chat_followup_v1',
    placementKey: 'next_step.intent_card',
    context: {
      query: scenario.query,
      answerText: scenario.answerText,
      locale: 'en-US',
      intent_class: scenario.intentClass,
      intent_score: scenario.intentScore,
      preference_facets: [],
    },
  }
}

function createIssue(severity, code, scenarioKey, message, evidence = {}) {
  const scope = scenarioKey || 'global'
  const fingerprint = `${severity}|${code}|${scope}|${String(message || '').trim()}`
  return {
    fingerprint,
    severity,
    code,
    scope,
    message,
    evidence,
  }
}

async function checkUrlHealth(url) {
  const targetUrl = String(url || '').trim()
  if (!targetUrl) {
    return {
      ok: false,
      status: 0,
      finalUrl: '',
      error: 'missing_url',
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })

    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      finalUrl: response.url,
      error: '',
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: targetUrl,
      error: error instanceof Error ? error.message : 'url_check_failed',
    }
  }
}

async function ensureNextStepPlacementEnabled(baseUrl) {
  const placementsRes = await requestJson(baseUrl, '/api/v1/dashboard/placements')
  if (!placementsRes.ok) {
    throw new Error(`load placements failed: HTTP_${placementsRes.status}`)
  }

  const placements = Array.isArray(placementsRes.payload?.placements)
    ? placementsRes.payload.placements
    : []

  const placement = placements.find((item) => {
    const placementKey = String(item?.placementKey || '').trim()
    const placementId = String(item?.placementId || '').trim()
    return placementKey === 'next_step.intent_card' || placementId === 'chat_followup_v1'
  })

  if (!placement || !placement.placementId) {
    throw new Error('next_step placement not found')
  }

  if (placement.enabled === true) return

  const updateRes = await requestJson(
    baseUrl,
    `/api/v1/dashboard/placements/${encodeURIComponent(String(placement.placementId))}`,
    {
      method: 'PUT',
      body: { enabled: true },
    },
  )

  if (!updateRes.ok) {
    throw new Error(`enable placement failed: HTTP_${updateRes.status}`)
  }
}

async function runOneScenario(baseUrl, scenario, options = {}) {
  const issues = []
  const payload = createScenarioPayload(scenario)

  const beforeSummaryRes = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary')
  if (!beforeSummaryRes.ok) {
    issues.push(createIssue('P0', 'DASHBOARD_SUMMARY_UNAVAILABLE', scenario.key, 'dashboard summary unavailable', {
      status: beforeSummaryRes.status,
    }))
    return {
      key: scenario.key,
      ok: false,
      payload,
      issues,
      evidence: {
        stage: 'before_summary',
      },
    }
  }

  const beforeClicks = Number(beforeSummaryRes.payload?.clicks || 0)

  const bidRes = await requestJson(baseUrl, '/api/v2/bid', {
    method: 'POST',
    body: {
      userId: payload.userId,
      chatId: payload.sessionId,
      placementId: payload.placementId,
      messages: [
        { role: 'user', content: String(payload?.context?.query || '') },
        { role: 'assistant', content: String(payload?.context?.answerText || '') },
      ],
    },
  })

  if (!bidRes.ok) {
    issues.push(createIssue('P0', 'BID_FAILED', scenario.key, 'v2 bid failed', {
      status: bidRes.status,
      payload: bidRes.payload,
    }))
    return {
      key: scenario.key,
      ok: false,
      payload,
      issues,
      evidence: {
        stage: 'v2_bid',
        beforeClicks,
      },
    }
  }

  const requestId = String(bidRes.payload?.requestId || '').trim()
  const winnerBid = bidRes.payload?.data?.bid && typeof bidRes.payload.data.bid === 'object'
    ? bidRes.payload.data.bid
    : null
  const decisionResult = winnerBid ? 'served' : 'no_fill'
  const decisionReasonDetail = String(bidRes.payload?.message || '').trim()
  const ads = winnerBid ? [winnerBid] : []
  const firstAd = ads[0] || null
  const firstAdId = String(firstAd?.bidId || firstAd?.item_id || firstAd?.itemId || firstAd?.adId || '').trim()
  const firstAdUrl = String(firstAd?.url || firstAd?.target_url || firstAd?.targetUrl || '').trim()

  if (!requestId) {
    issues.push(createIssue('P0', 'MISSING_REQUEST_ID', scenario.key, 'v2 bid response missing requestId', {
      bid: bidRes.payload,
    }))
  }

  if (decisionResult !== 'served' || ads.length === 0) {
    issues.push(createIssue('P0', 'NO_AD_SERVED', scenario.key, 'next-step did not serve ads for scenario', {
      decisionResult,
      decisionReasonDetail,
      adCount: ads.length,
      requestId,
    }))
  }

  const decisionsRes = requestId
    ? await requestJson(baseUrl, `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}`)
    : { ok: false, status: 0, payload: {} }

  const decisionRows = decisionsRes.ok && Array.isArray(decisionsRes.payload?.items)
    ? decisionsRes.payload.items
    : []
  const decisionRow = decisionRows.find((row) => String(row?.requestId || '') === requestId)

  if (!decisionRow) {
    issues.push(createIssue('P0', 'DECISION_NOT_VISIBLE', scenario.key, 'dashboard decision row not found', {
      requestId,
      status: decisionsRes.status,
    }))
  }

  const impressionPayload = {
    ...payload,
    requestId,
    kind: 'impression',
    adId: firstAdId,
  }
  const clickPayload = {
    ...payload,
    requestId,
    kind: 'click',
    adId: firstAdId,
  }
  const dismissPayload = {
    ...payload,
    requestId,
    kind: 'dismiss',
    adId: firstAdId,
  }

  let eventImpressionRes = null
  let eventClickRes = null
  let eventDismissRes = null

  if (requestId && firstAdId && decisionResult === 'served') {
    eventImpressionRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      body: impressionPayload,
    })
    eventClickRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      body: clickPayload,
    })
    eventDismissRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      body: dismissPayload,
    })

    if (!eventImpressionRes.ok) {
      issues.push(createIssue('P0', 'IMPRESSION_EVENT_FAILED', scenario.key, 'impression event report failed', {
        requestId,
        status: eventImpressionRes.status,
      }))
    }
    if (!eventClickRes.ok) {
      issues.push(createIssue('P0', 'CLICK_EVENT_FAILED', scenario.key, 'click event report failed', {
        requestId,
        status: eventClickRes.status,
      }))
    }
    if (!eventDismissRes.ok) {
      issues.push(createIssue('P0', 'DISMISS_EVENT_FAILED', scenario.key, 'dismiss event report failed', {
        requestId,
        status: eventDismissRes.status,
      }))
    }
  }

  const eventsRes = requestId
    ? await requestJson(baseUrl, `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}&eventType=sdk_event`)
    : { ok: false, status: 0, payload: {} }
  const eventRows = eventsRes.ok && Array.isArray(eventsRes.payload?.items)
    ? eventsRes.payload.items
    : []

  const impressionRow = eventRows.find((row) => String(row?.kind || '') === 'impression')
  const clickRow = eventRows.find((row) => String(row?.kind || '') === 'click')
  const dismissRow = eventRows.find((row) => String(row?.kind || '') === 'dismiss')

  if (decisionResult === 'served') {
    if (!impressionRow) {
      issues.push(createIssue('P0', 'IMPRESSION_NOT_VISIBLE', scenario.key, 'impression event missing in dashboard', {
        requestId,
      }))
    }
    if (!clickRow) {
      issues.push(createIssue('P0', 'CLICK_NOT_VISIBLE', scenario.key, 'click event missing in dashboard', {
        requestId,
      }))
    }
    if (!dismissRow) {
      issues.push(createIssue('P0', 'DISMISS_NOT_VISIBLE', scenario.key, 'dismiss event missing in dashboard', {
        requestId,
      }))
    }
    if (eventRows.some((row) => String(row?.event || '') === 'answer_completed')) {
      issues.push(createIssue('P1', 'EVENT_SEMANTIC_POLLUTION', scenario.key, 'sdk_event should not reuse answer_completed', {
        requestId,
      }))
    }
  }

  const afterSummaryRes = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary')
  const afterClicks = Number(afterSummaryRes.payload?.clicks || 0)

  if (decisionResult === 'served' && afterClicks <= beforeClicks) {
    issues.push(createIssue('P0', 'CLICK_COUNTER_NOT_UPDATED', scenario.key, 'dashboard clicks did not increase after click event', {
      requestId,
      beforeClicks,
      afterClicks,
    }))
  }

  let landingHealth = null
  if (decisionResult === 'served' && firstAdUrl && !toBoolean(options.skipLandingCheck, false)) {
    landingHealth = await checkUrlHealth(firstAdUrl)
    if (!landingHealth.ok) {
      issues.push(createIssue('P1', 'LANDING_PAGE_UNHEALTHY', scenario.key, 'first ad landing page is unreachable or non-2xx/3xx', {
        requestId,
        adId: firstAdId,
        targetUrl: firstAdUrl,
        urlHealth: landingHealth,
      }))
    }
  }

  const blockingIssueCount = issues.filter((item) => String(item?.severity || '').toUpperCase() === 'P0').length

  return {
    key: scenario.key,
    ok: blockingIssueCount === 0,
    payload,
    issues,
    evidence: {
      requestId,
      decisionResult,
      decisionReasonDetail,
      adCount: ads.length,
      firstAdId,
      firstAdUrl,
      beforeClicks,
      afterClicks,
      decisionVisible: Boolean(decisionRow),
      eventKinds: eventRows.map((row) => String(row?.kind || '')).filter(Boolean),
      eventNames: eventRows.map((row) => String(row?.event || '')).filter(Boolean),
      landingHealth,
      blockingIssueCount,
      warningIssueCount: Math.max(0, issues.length - blockingIssueCount),
    },
  }
}

async function collectGlobalIssues(baseUrl) {
  const issues = []

  const networkRes = await requestJson(baseUrl, '/api/v1/dashboard/network-health')
  if (!networkRes.ok) {
    issues.push(createIssue('P2', 'NETWORK_HEALTH_UNAVAILABLE', '', 'network health endpoint unavailable', {
      status: networkRes.status,
    }))
    return { issues, evidence: { networkHealth: null } }
  }

  const networkHealth = networkRes.payload?.networkHealth && typeof networkRes.payload.networkHealth === 'object'
    ? networkRes.payload.networkHealth
    : {}

  for (const [network, state] of Object.entries(networkHealth)) {
    const status = String(state?.status || '').trim().toLowerCase()
    if (!status || status === 'healthy') continue
    issues.push(createIssue('P2', 'NETWORK_DEGRADED', '', `network ${network} is ${status}`, {
      network,
      status,
      consecutiveFailures: Number(state?.consecutiveFailures || 0),
      lastErrorCode: String(state?.lastErrorCode || ''),
      lastErrorMessage: String(state?.lastErrorMessage || ''),
    }))
  }

  return {
    issues,
    evidence: {
      networkHealth,
      networkHealthSummary: networkRes.payload?.networkHealthSummary || null,
      networkFlowStats: networkRes.payload?.networkFlowStats || null,
    },
  }
}

function computeIssueDiff(previousIssues, currentIssues) {
  const prev = Array.isArray(previousIssues) ? previousIssues : []
  const curr = Array.isArray(currentIssues) ? currentIssues : []

  const prevMap = new Map(prev.map((item) => [String(item?.fingerprint || ''), item]).filter(([key]) => key))
  const currMap = new Map(curr.map((item) => [String(item?.fingerprint || ''), item]).filter(([key]) => key))

  const newIssues = []
  const resolvedIssues = []

  for (const [fingerprint, item] of currMap.entries()) {
    if (!prevMap.has(fingerprint)) newIssues.push(item)
  }

  for (const [fingerprint, item] of prevMap.entries()) {
    if (!currMap.has(fingerprint)) resolvedIssues.push(item)
  }

  return {
    newIssues,
    resolvedIssues,
  }
}

function summarizeIssues(issues) {
  const rows = Array.isArray(issues) ? issues : []
  const bySeverity = {
    P0: 0,
    P1: 0,
    P2: 0,
  }

  for (const item of rows) {
    const severity = String(item?.severity || '').toUpperCase()
    if (Object.prototype.hasOwnProperty.call(bySeverity, severity)) {
      bySeverity[severity] += 1
    }
  }

  return {
    total: rows.length,
    bySeverity,
  }
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const externalGatewayUrl = String(args.gatewayUrl || '').trim()
  const port = toInteger(args.port, DEFAULT_PORT)
  const failOnNew = toBoolean(args.failOnNew, true)
  const failOnCurrent = toBoolean(args.failOnCurrent, false)

  const startedAt = nowIso()
  const baseUrl = externalGatewayUrl || `http://${DEFAULT_HOST}:${port}`
  const useExternalGateway = Boolean(externalGatewayUrl)

  let gatewayHandle = null

  try {
    if (!useExternalGateway) {
      gatewayHandle = startGatewayProcess(port)
    }

    await waitForGateway(baseUrl)

    const resetRes = await requestJson(baseUrl, '/api/v1/dev/reset', {
      method: 'POST',
    })
    if (!resetRes.ok) {
      throw new Error(`gateway reset failed: HTTP_${resetRes.status}`)
    }

    await ensureNextStepPlacementEnabled(baseUrl)

    const scenarioResults = []
    const currentIssues = []

    for (const scenario of MEYKA_SCENARIOS) {
      try {
        const scenarioResult = await runOneScenario(baseUrl, scenario, args)
        scenarioResults.push(scenarioResult)
        currentIssues.push(...scenarioResult.issues)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'scenario_runtime_failed'
        const fallbackIssue = createIssue(
          'P0',
          'SCENARIO_RUNTIME_EXCEPTION',
          scenario.key,
          `scenario execution crashed: ${message}`,
          { scenario: scenario.key },
        )
        scenarioResults.push({
          key: scenario.key,
          ok: false,
          payload: createScenarioPayload(scenario),
          issues: [fallbackIssue],
          evidence: {
            stage: 'scenario_exception',
            error: message,
          },
        })
        currentIssues.push(fallbackIssue)
      }
    }

    const globalCheck = await collectGlobalIssues(baseUrl)
    currentIssues.push(...globalCheck.issues)

    const previousReport = await readJsonIfExists(LATEST_REPORT_PATH)
    const previousIssues = Array.isArray(previousReport?.issues) ? previousReport.issues : []
    const diff = computeIssueDiff(previousIssues, currentIssues)

    const finishedAt = nowIso()
    const runId = `meyka_regression_${nowTag(new Date())}`

    const report = {
      runId,
      generatedAt: finishedAt,
      startedAt,
      finishedAt,
      gateway: baseUrl,
      scenarios: scenarioResults,
      globalEvidence: globalCheck.evidence,
      issues: currentIssues,
      issueSummary: summarizeIssues(currentIssues),
      newIssueSummary: summarizeIssues(diff.newIssues),
      resolvedIssueSummary: summarizeIssues(diff.resolvedIssues),
      diff: {
        newIssues: diff.newIssues,
        resolvedIssues: diff.resolvedIssues,
      },
      meta: {
        useExternalGateway,
        failOnNew,
        failOnCurrent,
        reportPaths: {
          latest: path.relative(PROJECT_ROOT, LATEST_REPORT_PATH),
          diffLatest: path.relative(PROJECT_ROOT, DIFF_REPORT_PATH),
        },
      },
    }

    const runReportPath = path.join(REPORT_RUNS_DIR, `${runId}.json`)

    await writeJson(runReportPath, report)
    await writeJson(LATEST_REPORT_PATH, report)
    await writeJson(
      DIFF_REPORT_PATH,
      {
        generatedAt: finishedAt,
        runId,
        newIssues: diff.newIssues,
        resolvedIssues: diff.resolvedIssues,
        newIssueSummary: summarizeIssues(diff.newIssues),
        resolvedIssueSummary: summarizeIssues(diff.resolvedIssues),
        currentIssueSummary: summarizeIssues(currentIssues),
      },
    )

    const blockingCurrent = currentIssues.filter((item) => String(item?.severity || '').toUpperCase() === 'P0')

    const output = {
      ok: currentIssues.length === 0,
      runId,
      gateway: baseUrl,
      scenarioSummary: {
        total: scenarioResults.length,
        passed: scenarioResults.filter((item) => item.ok).length,
        failed: scenarioResults.filter((item) => !item.ok).length,
      },
      issueSummary: summarizeIssues(currentIssues),
      newIssueSummary: summarizeIssues(diff.newIssues),
      resolvedIssueSummary: summarizeIssues(diff.resolvedIssues),
      outputFiles: {
        latest: path.relative(PROJECT_ROOT, LATEST_REPORT_PATH),
        diffLatest: path.relative(PROJECT_ROOT, DIFF_REPORT_PATH),
        runReport: path.relative(PROJECT_ROOT, runReportPath),
      },
    }

    console.log(JSON.stringify(output, null, 2))

    if ((failOnNew && diff.newIssues.length > 0) || (failOnCurrent && blockingCurrent.length > 0)) {
      process.exitCode = 1
    }
  } catch (error) {
    const details = gatewayHandle?.logs ? gatewayHandle.logs() : { stdout: '', stderr: '' }
    console.error(
      '[regress-meyka-closure] failed:',
      error instanceof Error ? error.message : String(error),
      '\n[gateway stdout]\n',
      details.stdout,
      '\n[gateway stderr]\n',
      details.stderr,
    )
    process.exitCode = 1
  } finally {
    if (gatewayHandle) {
      await stopGatewayProcess(gatewayHandle)
    }
  }
}

main()
