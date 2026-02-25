import path from 'node:path'

import {
  PROJECT_ROOT,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SCENARIO_SET_PATH,
  parseArgs,
  parsePlacements,
  toBoolean,
  toInteger,
  toNumber,
  clamp01,
  round,
  nowIso,
  nowTag,
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
  summarizeIssues,
  computeIssueDiff,
  readJsonIfExists,
  writeJson,
} from './lib/meyka-suite-utils.js'

const REPORT_DIR = path.join(PROJECT_ROOT, 'tests', 'reports', 'meyka-regression')
const REPORT_RUNS_DIR = path.join(REPORT_DIR, 'runs')
const LATEST_REPORT_PATH = path.join(REPORT_DIR, 'latest.json')
const DIFF_REPORT_PATH = path.join(REPORT_DIR, 'issue-diff-latest.json')

function createIssue(severity, code, scope, message, evidence = {}) {
  const normalizedScope = String(scope || 'global').trim() || 'global'
  const normalizedMessage = String(message || '').trim()
  const fingerprint = `${String(severity || '').toUpperCase()}|${code}|${normalizedScope}|${normalizedMessage}`
  return {
    fingerprint,
    severity: String(severity || 'P2').toUpperCase(),
    code,
    scope: normalizedScope,
    message: normalizedMessage,
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

function buildBidPayload({ scenario, placementId, sessionId, userId }) {
  return {
    userId,
    chatId: sessionId,
    placementId,
    messages: [
      { role: 'user', content: scenario.query },
      { role: 'assistant', content: scenario.answerText },
    ],
  }
}

function toAdIdentity(bid = {}) {
  const adId = String(bid?.bidId || bid?.item_id || bid?.itemId || bid?.adId || '').trim()
  const adUrl = String(bid?.url || bid?.target_url || bid?.targetUrl || '').trim()
  return { adId, adUrl }
}

async function runAuthPrecheck(baseUrl, runtimeHeaders, sampleBidPayload) {
  const issues = []

  const withoutKey = await requestJson(baseUrl, '/api/v2/bid', {
    method: 'POST',
    body: sampleBidPayload,
  })

  if (withoutKey.status !== 401) {
    issues.push(createIssue(
      'P0',
      'RUNTIME_AUTH_PRECHECK_NO_KEY_FAILED',
      'global',
      'request without key must return 401',
      { status: withoutKey.status, payload: withoutKey.payload },
    ))
  }

  if (!runtimeHeaders?.Authorization) {
    issues.push(createIssue(
      'P0',
      'RUNTIME_AUTH_PRECHECK_KEY_MISSING',
      'global',
      'runtime key is missing for authenticated precheck',
      {},
    ))
    return {
      issues,
      evidence: {
        noKeyStatus: withoutKey.status,
        withKeyStatus: 0,
      },
    }
  }

  const withKey = await requestJson(baseUrl, '/api/v2/bid', {
    method: 'POST',
    headers: runtimeHeaders,
    body: sampleBidPayload,
  })

  if (!withKey.ok || withKey.status !== 200) {
    issues.push(createIssue(
      'P0',
      'RUNTIME_AUTH_PRECHECK_WITH_KEY_FAILED',
      'global',
      'request with valid key must return 200',
      { status: withKey.status, payload: withKey.payload },
    ))
  }

  return {
    issues,
    evidence: {
      noKeyStatus: withoutKey.status,
      withKeyStatus: withKey.status,
      withKeyMessage: String(withKey.payload?.message || '').trim(),
    },
  }
}

async function runOneScenarioPlacement(baseUrl, scenario, placementId, options = {}) {
  const scope = `${scenario.key}:${placementId}`
  const issues = []

  const now = Date.now()
  const sessionId = `meyka_${scenario.key}_${placementId}_${now}`
  const turnId = `turn_${scenario.key}_${placementId}_${now}`
  const userId = `meyka_user_${scenario.key}`

  const bidPayload = buildBidPayload({ scenario, placementId, sessionId, userId })

  const beforeSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
    headers: options.dashboardHeaders,
  })
  if (!beforeSummary.ok) {
    issues.push(createIssue('P0', 'DASHBOARD_SUMMARY_UNAVAILABLE', scope, 'dashboard summary unavailable', {
      status: beforeSummary.status,
    }))
  }

  const beforeClicks = toNumber(beforeSummary.payload?.clicks, 0)
  const beforeRevenue = toNumber(beforeSummary.payload?.revenueUsd, 0)

  const bidRes = await requestJson(baseUrl, '/api/v2/bid', {
    method: 'POST',
    headers: options.runtimeHeaders,
    body: bidPayload,
  })

  if (!bidRes.ok) {
    issues.push(createIssue('P0', 'BID_FAILED', scope, 'v2 bid failed', {
      status: bidRes.status,
      payload: bidRes.payload,
    }))
    return {
      key: scenario.key,
      placementId,
      ok: false,
      issues,
      evidence: {
        stage: 'v2_bid',
        bidStatus: bidRes.status,
      },
    }
  }

  const requestId = String(bidRes.payload?.requestId || '').trim()
  const winnerBid = bidRes.payload?.data?.bid && typeof bidRes.payload.data.bid === 'object'
    ? bidRes.payload.data.bid
    : null
  const decisionResult = winnerBid ? 'served' : 'no_fill'
  const decisionReasonDetail = String(bidRes.payload?.message || '').trim()

  if (!requestId) {
    issues.push(createIssue('P0', 'MISSING_REQUEST_ID', scope, 'v2 bid response missing requestId', {
      bid: bidRes.payload,
    }))
  }

  if (!winnerBid) {
    issues.push(createIssue('P0', 'NO_AD_SERVED', scope, 'scenario returned no fill', {
      requestId,
      message: decisionReasonDetail,
    }))
  }

  const { adId, adUrl } = toAdIdentity(winnerBid || {})
  const decisionsRes = requestId
    ? await requestJson(baseUrl, `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}`, {
      headers: options.dashboardHeaders,
    })
    : { ok: false, status: 0, payload: {} }

  const decisionRows = decisionsRes.ok && Array.isArray(decisionsRes.payload?.items)
    ? decisionsRes.payload.items
    : []
  const decisionRow = decisionRows.find((item) => String(item?.requestId || '') === requestId)

  if (!decisionRow) {
    issues.push(createIssue('P0', 'DECISION_NOT_VISIBLE', scope, 'dashboard decision row not found', {
      requestId,
      status: decisionsRes.status,
    }))
  }

  let impressionRes = null
  let clickRes = null
  let postbackRes = null
  let duplicatePostbackRes = null
  let postbackPayload = null

  if (requestId && adId && winnerBid) {
    const impressionPayload = createSdkEventPayload({
      appId: options.appId,
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
      appId: options.appId,
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

    impressionRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: options.runtimeHeaders,
      body: impressionPayload,
    })

    clickRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: options.runtimeHeaders,
      body: clickPayload,
    })

    if (!impressionRes.ok) {
      issues.push(createIssue('P0', 'IMPRESSION_EVENT_FAILED', scope, 'impression event failed', {
        requestId,
        status: impressionRes.status,
      }))
    }
    if (!clickRes.ok) {
      issues.push(createIssue('P0', 'CLICK_EVENT_FAILED', scope, 'click event failed', {
        requestId,
        status: clickRes.status,
      }))
    }

    if (options.withPostback) {
      const pricing = winnerBid?.pricing && typeof winnerBid.pricing === 'object' ? winnerBid.pricing : {}
      const cpaUsd = toNumber(pricing.cpaUsd, NaN)
      const pConv = clamp01(pricing.pConv)
      const sampled = shouldSamplePostback(requestId, adId, turnId, pConv)

      if (sampled && Number.isFinite(cpaUsd) && cpaUsd > 0) {
        postbackPayload = {
          eventType: 'postback',
          appId: options.appId,
          accountId: options.accountId,
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

        postbackRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
          method: 'POST',
          headers: options.runtimeHeaders,
          body: postbackPayload,
        })

        if (!postbackRes.ok || postbackRes.payload?.ok !== true) {
          issues.push(createIssue('P0', 'POSTBACK_EVENT_FAILED', scope, 'postback event failed', {
            requestId,
            status: postbackRes.status,
            payload: postbackRes.payload,
          }))
        }

        duplicatePostbackRes = await requestJson(baseUrl, '/api/v1/sdk/events', {
          method: 'POST',
          headers: options.runtimeHeaders,
          body: postbackPayload,
        })

        if (!duplicatePostbackRes.ok || duplicatePostbackRes.payload?.duplicate !== true) {
          issues.push(createIssue('P0', 'POSTBACK_IDEMPOTENCY_FAILED', scope, 'duplicate postback should be idempotent', {
            requestId,
            status: duplicatePostbackRes.status,
            payload: duplicatePostbackRes.payload,
          }))
        }
      }
    }
  }

  const eventsRes = requestId
    ? await requestJson(baseUrl, `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}`, {
      headers: options.dashboardHeaders,
    })
    : { ok: false, status: 0, payload: {} }

  const eventRows = eventsRes.ok && Array.isArray(eventsRes.payload?.items)
    ? eventsRes.payload.items
    : []

  if (winnerBid) {
    const sdkRows = eventRows.filter((row) => String(row?.eventType || '') === 'sdk_event')
    const impressionRow = sdkRows.find((row) => String(row?.kind || row?.event || '').toLowerCase() === 'impression')
    const clickRow = sdkRows.find((row) => String(row?.kind || row?.event || '').toLowerCase() === 'click')

    if (!impressionRow) {
      issues.push(createIssue('P0', 'IMPRESSION_NOT_VISIBLE', scope, 'impression event missing in dashboard', { requestId }))
    }
    if (!clickRow) {
      issues.push(createIssue('P0', 'CLICK_NOT_VISIBLE', scope, 'click event missing in dashboard', { requestId }))
    }

    if (postbackPayload) {
      const postbackRows = eventRows.filter((row) => String(row?.eventType || '') === 'postback')
      const conversionRow = postbackRows.find((row) => String(row?.conversionId || '') === postbackPayload.conversionId)
      if (!conversionRow) {
        issues.push(createIssue('P0', 'POSTBACK_NOT_VISIBLE', scope, 'postback event missing in dashboard', {
          requestId,
          conversionId: postbackPayload.conversionId,
        }))
      }
    }
  }

  const afterSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
    headers: options.dashboardHeaders,
  })
  const afterClicks = toNumber(afterSummary.payload?.clicks, 0)
  const afterRevenue = toNumber(afterSummary.payload?.revenueUsd, 0)

  if (winnerBid && afterClicks <= beforeClicks) {
    issues.push(createIssue('P0', 'CLICK_COUNTER_NOT_UPDATED', scope, 'dashboard clicks did not increase after click', {
      requestId,
      beforeClicks,
      afterClicks,
    }))
  }

  if (postbackPayload) {
    const expectedRevenue = beforeRevenue + toNumber(postbackPayload.cpaUsd, 0)
    if (afterRevenue + 0.01 < expectedRevenue) {
      issues.push(createIssue('P0', 'POSTBACK_REVENUE_NOT_SETTLED', scope, 'postback revenue not reflected in summary', {
        requestId,
        expectedRevenue: round(expectedRevenue, 4),
        actualRevenue: round(afterRevenue, 4),
      }))
    }
  }

  let landingHealth = null
  if (winnerBid && adUrl && !options.skipLandingCheck) {
    landingHealth = await checkUrlHealth(adUrl)
    if (!landingHealth.ok) {
      issues.push(createIssue('P1', 'LANDING_PAGE_UNHEALTHY', scope, 'first ad landing page is unreachable or non-2xx/3xx', {
        requestId,
        adId,
        targetUrl: adUrl,
        urlHealth: landingHealth,
      }))
    }
  }

  const blockingIssueCount = issues.filter((item) => item.severity === 'P0').length
  return {
    key: scenario.key,
    placementId,
    ok: blockingIssueCount === 0,
    issues,
    payload: {
      sessionId,
      turnId,
      userId,
      query: scenario.query,
      answerText: scenario.answerText,
      intentClass: scenario.intentClass,
      intentScore: scenario.intentScore,
    },
    evidence: {
      requestId,
      decisionResult,
      decisionReasonDetail,
      adId,
      adUrl,
      eventCount: eventRows.length,
      beforeClicks,
      afterClicks,
      beforeRevenue: round(beforeRevenue, 4),
      afterRevenue: round(afterRevenue, 4),
      postback: postbackPayload
        ? {
            conversionId: postbackPayload.conversionId,
            cpaUsd: postbackPayload.cpaUsd,
            sampled: true,
            postbackStatus: postbackRes?.status || 0,
            duplicateStatus: duplicatePostbackRes?.status || 0,
            duplicate: Boolean(duplicatePostbackRes?.payload?.duplicate),
          }
        : {
            sampled: false,
          },
      pricing: winnerBid?.pricing || null,
      landingHealth,
      blockingIssueCount,
      warningIssueCount: Math.max(0, issues.length - blockingIssueCount),
    },
  }
}

async function collectGlobalIssues(baseUrl, dashboardHeaders) {
  const issues = []
  const networkRes = await requestJson(baseUrl, '/api/v1/dashboard/network-health', {
    headers: dashboardHeaders,
  })
  if (!networkRes.ok) {
    issues.push(createIssue('P2', 'NETWORK_HEALTH_UNAVAILABLE', 'global', 'network health endpoint unavailable', {
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
    issues.push(createIssue('P2', 'NETWORK_DEGRADED', 'global', `network ${network} is ${status}`, {
      network,
      status,
      consecutiveFailures: toInteger(state?.consecutiveFailures, 0),
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const externalGatewayUrl = String(args.gatewayUrl || '').trim()
  const port = toInteger(args.port, DEFAULT_PORT)
  const failOnNew = toBoolean(args.failOnNew, true)
  const failOnCurrent = toBoolean(args.failOnCurrent, false)
  const skipLandingCheck = toBoolean(args.skipLandingCheck, false)
  const skipReset = toBoolean(args.skipReset, false)
  const withPostback = toBoolean(args.withPostback, false)
  const placements = parsePlacements(args.placements)
  const scenarioSetPath = String(args.scenarioSet || DEFAULT_SCENARIO_SET_PATH).trim()

  const startedAt = nowIso()
  const baseUrl = externalGatewayUrl || `http://${DEFAULT_HOST}:${port}`
  const useExternalGateway = Boolean(externalGatewayUrl)

  let gatewayHandle = null
  try {
    if (!useExternalGateway) {
      gatewayHandle = startGatewayProcess(port, {
        SIMULATOR_STRICT_MANUAL_INTEGRATION: 'false',
        SIMULATOR_SETTLEMENT_STORAGE: 'state_file',
        SIMULATOR_REQUIRE_DURABLE_SETTLEMENT: 'false',
        SIMULATOR_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE: 'false',
        SIMULATOR_RUNTIME_AUTH_REQUIRED: 'true',
      })
    }

    await waitForGateway(baseUrl)

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

    const scenarioSet = await loadScenarioSet(scenarioSetPath)
    const sampleScenario = scenarioSet.scenarios[0]
    const precheck = await runAuthPrecheck(
      baseUrl,
      auth.runtimeHeaders,
      buildBidPayload({
        scenario: sampleScenario,
        placementId: placements[0],
        sessionId: `meyka_precheck_${Date.now()}`,
        userId: 'meyka_precheck_user',
      }),
    )

    const scenarioResults = []
    const currentIssues = [...precheck.issues]

    for (const scenario of scenarioSet.scenarios) {
      for (const placementId of placements) {
        try {
          const result = await runOneScenarioPlacement(baseUrl, scenario, placementId, {
            runtimeHeaders: auth.runtimeHeaders,
            dashboardHeaders: auth.dashboardHeaders,
            appId: auth.appId,
            accountId: auth.accountId,
            withPostback,
            skipLandingCheck,
          })
          scenarioResults.push(result)
          currentIssues.push(...result.issues)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'scenario_runtime_failed'
          const scope = `${scenario.key}:${placementId}`
          const issue = createIssue('P0', 'SCENARIO_RUNTIME_EXCEPTION', scope, `scenario execution crashed: ${message}`, {
            scenario: scenario.key,
            placementId,
          })
          scenarioResults.push({
            key: scenario.key,
            placementId,
            ok: false,
            issues: [issue],
            payload: {
              query: scenario.query,
              answerText: scenario.answerText,
            },
            evidence: {
              stage: 'scenario_exception',
              error: message,
            },
          })
          currentIssues.push(issue)
        }
      }
    }

    const globalCheck = await collectGlobalIssues(baseUrl, auth.dashboardHeaders)
    currentIssues.push(...globalCheck.issues)

    const previousReport = await readJsonIfExists(LATEST_REPORT_PATH)
    const previousIssues = Array.isArray(previousReport?.issues) ? previousReport.issues : []
    const diff = computeIssueDiff(previousIssues, currentIssues)

    const finishedAt = nowIso()
    const runId = `meyka_regression_${nowTag(new Date())}`
    const runReportPath = path.join(REPORT_RUNS_DIR, `${runId}.json`)

    const report = {
      runId,
      generatedAt: finishedAt,
      startedAt,
      finishedAt,
      gateway: baseUrl,
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
      precheck: precheck.evidence,
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
        skipLandingCheck,
        skipReset,
        withPostback,
        reportPaths: {
          latest: path.relative(PROJECT_ROOT, LATEST_REPORT_PATH),
          diffLatest: path.relative(PROJECT_ROOT, DIFF_REPORT_PATH),
        },
      },
    }

    await writeJson(runReportPath, report)
    await writeJson(LATEST_REPORT_PATH, report)
    await writeJson(DIFF_REPORT_PATH, {
      generatedAt: finishedAt,
      runId,
      newIssues: diff.newIssues,
      resolvedIssues: diff.resolvedIssues,
      newIssueSummary: summarizeIssues(diff.newIssues),
      resolvedIssueSummary: summarizeIssues(diff.resolvedIssues),
      currentIssueSummary: summarizeIssues(currentIssues),
    })

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

    const blockingCurrent = currentIssues.filter((item) => item.severity === 'P0')
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
