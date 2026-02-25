import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src', 'devtools', 'simulator', 'simulator-gateway.js')

const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 20000
const REQUEST_TIMEOUT_MS = 8000
const FAST_FIRST_GATEWAY_ENV = Object.freeze({
  SIMULATOR_SETTLEMENT_STORAGE: 'state_file',
  SIMULATOR_REQUIRE_DURABLE_SETTLEMENT: 'false',
  SIMULATOR_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE: 'false',
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeTimeoutSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const timeout = makeTimeoutSignal(options.timeoutMs || REQUEST_TIMEOUT_MS)

  try {
    let response
    try {
      response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: timeout.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`request failed for ${pathname}: ${message}`)
    }

    const payload = await response.json().catch(() => ({}))
    return {
      ok: response.ok,
      status: response.status,
      payload,
    }
  } finally {
    timeout.clear()
  }
}

async function waitForGateway(baseUrl) {
  const startedAt = Date.now()
  let lastError = null

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const health = await requestJson(baseUrl, '/api/health', { timeoutMs: 1500 })
      if (health.ok && health.payload?.ok === true) {
        return
      }
      lastError = new Error(`health endpoint returned ${health.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }

  throw new Error(`gateway health check timeout: ${lastError instanceof Error ? lastError.message : 'unknown error'}`)
}

function startGateway(port) {
  const child = spawn(process.execPath, [GATEWAY_ENTRY], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...FAST_FIRST_GATEWAY_ENV,
      SIMULATOR_GATEWAY_HOST: HOST,
      SIMULATOR_GATEWAY_PORT: String(port),
      OPENROUTER_API_KEY: '',
      OPENROUTER_MODEL: 'glm-5',
      CJ_TOKEN: 'mock-cj-token',
      PARTNERSTACK_API_KEY: 'mock-partnerstack-key',
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
    getLogs() {
      return { stdout, stderr }
    },
  }
}

async function stopGateway(handle) {
  if (!handle?.child) return
  handle.child.kill('SIGTERM')
  await sleep(200)
  if (!handle.child.killed) {
    handle.child.kill('SIGKILL')
  }
}

async function issueRuntimeApiKeyHeaders(baseUrl, input = {}, headers = {}) {
  const accountId = String(input.accountId || 'org_simulator')
  const appId = String(input.appId || 'simulator-chatbot')
  const environment = String(input.environment || 'prod')
  const created = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
    method: 'POST',
    headers,
    body: {
      accountId,
      appId,
      environment,
      name: `runtime-${environment}`,
    },
  })
  assert.equal(created.status, 201, `issue runtime key failed: ${JSON.stringify(created.payload)}`)
  const secret = String(created.payload?.secret || '').trim()
  assert.equal(Boolean(secret), true, 'runtime key create should return secret')
  return {
    Authorization: `Bearer ${secret}`,
  }
}

async function registerDashboardHeaders(baseUrl, input = {}) {
  const now = Date.now()
  const email = String(input.email || `owner_${now}@example.com`)
  const password = String(input.password || 'pass12345')
  const accountId = String(input.accountId || 'org_simulator')
  const appId = String(input.appId || 'simulator-chatbot')
  const register = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
    method: 'POST',
    body: {
      email,
      password,
      accountId,
      appId,
    },
  })
  assert.equal(register.status, 201, `dashboard register failed: ${JSON.stringify(register.payload)}`)
  const accessToken = String(register.payload?.session?.accessToken || '').trim()
  assert.equal(Boolean(accessToken), true, 'dashboard register should return access token')
  return {
    Authorization: `Bearer ${accessToken}`,
  }
}

function buildExternalEventPayload() {
  const now = Date.now()
  return {
    appId: 'simulator-chatbot',
    sessionId: `dash_v1_session_${now}`,
    turnId: `dash_v1_turn_${now}`,
    query: 'Recommend trail running shoes for rainy weather',
    answerText: 'Focus on grip and waterproof uppers.',
    // Keep this below threshold to make the happy path deterministic and fast.
    intentScore: 0.2,
    locale: 'en-US',
  }
}

function buildExternalBidPayload(eventPayload) {
  return {
    userId: String(eventPayload?.sessionId || ''),
    chatId: String(eventPayload?.sessionId || ''),
    placementId: 'chat_inline_v1',
    messages: [
      { role: 'user', content: String(eventPayload?.query || '') },
      { role: 'assistant', content: String(eventPayload?.answerText || '') },
    ],
  }
}

async function runExternalTurnFailOpen(baseUrl, bidPayload, eventPayload, failMode = 'none', runtimeHeaders = {}) {
  const primaryResponse = {
    ok: true,
    message: 'Primary assistant response is returned to user.',
  }
  const adResult = {
    attempted: true,
    evaluateStatus: 0,
    eventsStatus: 0,
    requestId: '',
    error: '',
  }

  try {
    if (failMode === 'network_error') {
      await requestJson('http://127.0.0.1:1', '/api/v2/bid', {
        method: 'POST',
        body: bidPayload,
        timeoutMs: 300,
      })
      throw new Error('expected network failure did not happen')
    }

    const requestPayload = failMode === 'invalid_payload'
      ? { placementId: String(bidPayload?.placementId || 'chat_inline_v1') }
      : bidPayload
    const bid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: requestPayload,
    })

    adResult.evaluateStatus = bid.status
    if (!bid.ok) {
      throw new Error(`bid_failed:${bid.status}`)
    }

    adResult.requestId = String(bid.payload?.requestId || '')
    const events = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        ...eventPayload,
        requestId: adResult.requestId,
      },
    })
    adResult.eventsStatus = events.status
    if (!events.ok || events.payload?.ok !== true) {
      throw new Error(`events_failed:${events.status}`)
    }

    return {
      primaryResponse,
      adResult,
      failOpenApplied: false,
    }
  } catch (error) {
    adResult.error = error instanceof Error ? error.message : String(error)
    return {
      primaryResponse,
      adResult,
      failOpenApplied: true,
    }
  }
}

test('dashboard v1 external e2e happy path: config -> v2 bid -> events', async () => {
  const port = 4600 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'dashboard-v1-owner@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })
    const runtimeHeaders = await issueRuntimeApiKeyHeaders(baseUrl, {
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    }, dashboardHeaders)

    const keys = await requestJson(
      baseUrl,
      '/api/v1/public/credentials/keys?appId=simulator-chatbot&environment=prod',
      { headers: dashboardHeaders },
    )
    assert.equal(keys.ok, true, `list keys failed: ${JSON.stringify(keys.payload)}`)
    const keyRows = Array.isArray(keys.payload?.keys) ? keys.payload.keys : []
    assert.equal(keyRows.length > 0, true, 'at least one active key should exist for onboarding')

    const config = await requestJson(
      baseUrl,
      '/api/v1/mediation/config?appId=simulator-chatbot&placementId=chat_inline_v1&environment=prod&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z',
      { headers: runtimeHeaders },
    )
    assert.equal(config.ok, true, `config failed: ${JSON.stringify(config.payload)}`)
    assert.equal(config.status, 200)
    assert.equal(String(config.payload?.placementId || ''), 'chat_inline_v1')
    assert.equal(Number.isFinite(config.payload?.configVersion), true)

    const eventPayload = buildExternalEventPayload()
    const bidPayload = buildExternalBidPayload(eventPayload)
    const bid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: bidPayload,
    })
    assert.equal(bid.ok, true, `v2 bid failed: ${JSON.stringify(bid.payload)}`)

    const requestId = String(bid.payload?.requestId || '').trim()
    const message = String(bid.payload?.message || '').trim()
    assert.equal(requestId.length > 0, true, 'v2 bid should return non-empty requestId')
    assert.equal(['Bid successful', 'No bid'].includes(message), true)

    const events = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        ...eventPayload,
        requestId,
      },
    })
    assert.equal(events.ok, true, `events failed: ${JSON.stringify(events.payload)}`)
    assert.equal(events.payload?.ok, true, 'events should return { ok: true }')

    const [decisions, sdkEvents, scopedDecisions, scopedEvents, mismatchScopeDecisions] = await Promise.all([
      requestJson(baseUrl, `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}`, { headers: dashboardHeaders }),
      requestJson(baseUrl, `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}&eventType=sdk_event`, { headers: dashboardHeaders }),
      requestJson(
        baseUrl,
        `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}&appId=simulator-chatbot&accountId=org_simulator`,
        { headers: dashboardHeaders },
      ),
      requestJson(
        baseUrl,
        `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}&eventType=sdk_event&appId=simulator-chatbot&accountId=org_simulator`,
        { headers: dashboardHeaders },
      ),
      requestJson(
        baseUrl,
        `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}&accountId=acct_missing&appId=simulator-chatbot-other`,
        { headers: dashboardHeaders },
      ),
    ])

    assert.equal(decisions.ok, true, `decision query failed: ${JSON.stringify(decisions.payload)}`)
    assert.equal(sdkEvents.ok, true, `events query failed: ${JSON.stringify(sdkEvents.payload)}`)

    const decisionRows = Array.isArray(decisions.payload?.items) ? decisions.payload.items : []
    const eventRows = Array.isArray(sdkEvents.payload?.items) ? sdkEvents.payload.items : []
    const scopedDecisionRows = Array.isArray(scopedDecisions.payload?.items) ? scopedDecisions.payload.items : []
    const scopedEventRows = Array.isArray(scopedEvents.payload?.items) ? scopedEvents.payload.items : []
    assert.equal(decisionRows.some((row) => String(row?.requestId || '') === requestId), true)
    assert.equal(eventRows.some((row) => String(row?.requestId || '') === requestId), true)
    assert.equal(scopedDecisionRows.some((row) => String(row?.requestId || '') === requestId), true)
    assert.equal(scopedEventRows.some((row) => String(row?.requestId || '') === requestId), true)
    assert.equal(mismatchScopeDecisions.status, 403)
    assert.equal(mismatchScopeDecisions.payload?.error?.code, 'DASHBOARD_SCOPE_VIOLATION')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[dashboard-v1-external-happy-path] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('dashboard v1 external e2e fail-open: ads failure does not block primary response', async () => {
  const port = 4800 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'dashboard-v1-failopen@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })
    const runtimeHeaders = await issueRuntimeApiKeyHeaders(baseUrl, {
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    }, dashboardHeaders)

    const resultOnInvalidPayload = await runExternalTurnFailOpen(
      baseUrl,
      buildExternalBidPayload(buildExternalEventPayload()),
      buildExternalEventPayload(),
      'invalid_payload',
      runtimeHeaders,
    )
    assert.equal(resultOnInvalidPayload.primaryResponse.ok, true, 'primary response should remain available')
    assert.equal(resultOnInvalidPayload.failOpenApplied, true, 'fail-open should trigger on v2 bid 400')
    assert.match(resultOnInvalidPayload.adResult.error, /bid_failed:400/)

    const resultOnNetworkError = await runExternalTurnFailOpen(
      baseUrl,
      buildExternalBidPayload(buildExternalEventPayload()),
      buildExternalEventPayload(),
      'network_error',
      runtimeHeaders,
    )
    assert.equal(resultOnNetworkError.primaryResponse.ok, true, 'primary response should remain available')
    assert.equal(resultOnNetworkError.failOpenApplied, true, 'fail-open should trigger on network error')
    assert.equal(resultOnNetworkError.adResult.error.length > 0, true)
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[dashboard-v1-external-fail-open] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
