import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src', 'devtools', 'simulator', 'simulator-gateway.js')

const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 12000
const REQUEST_TIMEOUT_MS = 5000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeoutSignal(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(Number(value || 0) * factor) / factor
}

async function requestJson(baseUrl, pathname, options = {}) {
  const timeout = withTimeoutSignal(options.timeoutMs)

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
  } finally {
    timeout.clear()
  }
}

async function waitForGateway(baseUrl) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const health = await requestJson(baseUrl, '/api/health', { timeoutMs: 1200 })
      if (health.ok && health.payload?.ok === true) {
        return
      }
    } catch {
      // retry
    }
    await sleep(250)
  }

  throw new Error(`gateway health check timeout after ${HEALTH_TIMEOUT_MS}ms`)
}

function startGateway(port) {
  const child = spawn(process.execPath, [GATEWAY_ENTRY], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
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

test('CPA postback facts drive dashboard revenue metrics and replace serve estimation', async () => {
  const port = 3920 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const beforeSummaryUnauthorized = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary')
    assert.equal(beforeSummaryUnauthorized.status, 401)
    assert.equal(beforeSummaryUnauthorized.payload?.error?.code, 'DASHBOARD_AUTH_REQUIRED')

    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'owner-cpa@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })
    const runtimeHeaders = await issueRuntimeApiKeyHeaders(baseUrl, {
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    }, dashboardHeaders)

    const beforeSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
      headers: dashboardHeaders,
    })
    assert.equal(beforeSummary.ok, true)
    assert.equal(round(beforeSummary.payload?.revenueUsd), 0)

    const now = Date.now()
    const runtimePayload = {
      appId: 'simulator-chatbot',
      sessionId: `cpa_session_${now}`,
      turnId: `cpa_turn_${now}`,
      query: 'Recommend a budget friendly mechanical keyboard',
      answerText: 'Focus on switch type and layout first.',
      intentScore: 0.86,
      locale: 'en-US',
      placementId: 'chat_inline_v1',
    }
    const bidPayload = {
      userId: runtimePayload.sessionId,
      chatId: runtimePayload.sessionId,
      placementId: runtimePayload.placementId,
      messages: [
        { role: 'user', content: runtimePayload.query },
        { role: 'assistant', content: runtimePayload.answerText },
      ],
    }

    const bidUnauthorized = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      body: bidPayload,
    })
    assert.equal(bidUnauthorized.status, 401)
    assert.equal(bidUnauthorized.payload?.error?.code, 'RUNTIME_AUTH_REQUIRED')

    const bid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: bidPayload,
    })
    assert.equal(bid.ok, true, `v2 bid failed: ${JSON.stringify(bid.payload)}`)
    const requestId = String(bid.payload?.requestId || '').trim()
    assert.equal(Boolean(requestId), true, 'v2 bid should return requestId')

    const sdkEvent = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        ...runtimePayload,
        requestId,
        kind: 'impression',
      },
    })
    assert.equal(sdkEvent.ok, true, `sdk event failed: ${JSON.stringify(sdkEvent.payload)}`)

    const afterSdkEventSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
      headers: dashboardHeaders,
    })
    assert.equal(afterSdkEventSummary.ok, true)
    assert.equal(
      round(afterSdkEventSummary.payload?.revenueUsd),
      0,
      'serve/impression flow should not write revenue without postback fact',
    )

    const conversionId = `conv_${now}`
    const successPostbackPayload = {
      eventType: 'postback',
      appId: runtimePayload.appId,
      accountId: 'org_simulator',
      sessionId: runtimePayload.sessionId,
      turnId: runtimePayload.turnId,
      requestId,
      placementId: 'chat_inline_v1',
      adId: 'offer_001',
      postbackType: 'conversion',
      postbackStatus: 'success',
      conversionId,
      cpaUsd: 2.75,
      currency: 'USD',
    }

    const successPostback = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: successPostbackPayload,
    })
    assert.equal(successPostback.ok, true, `postback failed: ${JSON.stringify(successPostback.payload)}`)
    assert.equal(successPostback.payload?.ok, true)
    assert.equal(successPostback.payload?.duplicate, false)

    const afterPostbackSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
      headers: dashboardHeaders,
    })
    assert.equal(afterPostbackSummary.ok, true)
    assert.equal(round(afterPostbackSummary.payload?.revenueUsd), 2.75)

    const scopedSummary = await requestJson(
      baseUrl,
      '/api/v1/dashboard/metrics/summary?appId=simulator-chatbot&accountId=org_simulator',
      { headers: dashboardHeaders },
    )
    assert.equal(scopedSummary.ok, true)
    assert.equal(round(scopedSummary.payload?.revenueUsd), 2.75)

    const mismatchSummary = await requestJson(
      baseUrl,
      '/api/v1/dashboard/metrics/summary?accountId=acct_missing',
      { headers: dashboardHeaders },
    )
    assert.equal(mismatchSummary.ok, true)
    assert.equal(round(mismatchSummary.payload?.revenueUsd), 2.75)

    const byPlacement = await requestJson(baseUrl, '/api/v1/dashboard/metrics/by-placement', {
      headers: dashboardHeaders,
    })
    assert.equal(byPlacement.ok, true)
    const placementRows = Array.isArray(byPlacement.payload?.items) ? byPlacement.payload.items : []
    const inlineRow = placementRows.find((row) => String(row?.placementId || '') === 'chat_inline_v1')
    assert.equal(Boolean(inlineRow), true)
    assert.equal(round(inlineRow.revenueUsd), 2.75)

    const byDay = await requestJson(baseUrl, '/api/v1/dashboard/metrics/by-day', {
      headers: dashboardHeaders,
    })
    assert.equal(byDay.ok, true)
    const dayRows = Array.isArray(byDay.payload?.items) ? byDay.payload.items : []
    const totalDayRevenue = round(dayRows.reduce((sum, row) => sum + Number(row?.revenueUsd || 0), 0))
    assert.equal(totalDayRevenue, 2.75)

    const duplicatedPostback = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: successPostbackPayload,
    })
    assert.equal(duplicatedPostback.ok, true)
    assert.equal(duplicatedPostback.payload?.duplicate, true)

    const afterDuplicateSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
      headers: dashboardHeaders,
    })
    assert.equal(afterDuplicateSummary.ok, true)
    assert.equal(round(afterDuplicateSummary.payload?.revenueUsd), 2.75)

    const pendingPostback = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        ...successPostbackPayload,
        conversionId: `${conversionId}_pending`,
        postbackStatus: 'pending',
        cpaUsd: 8.5,
      },
    })
    assert.equal(pendingPostback.ok, true)

    const afterPendingSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
      headers: dashboardHeaders,
    })
    assert.equal(afterPendingSummary.ok, true)
    assert.equal(round(afterPendingSummary.payload?.revenueUsd), 2.75)

    const postbackLogs = await requestJson(
      baseUrl,
      `/api/v1/dashboard/events?eventType=postback&requestId=${encodeURIComponent(requestId)}`,
      { headers: dashboardHeaders },
    )
    assert.equal(postbackLogs.ok, true)
    const postbackRows = Array.isArray(postbackLogs.payload?.items) ? postbackLogs.payload.items : []
    const successRow = postbackRows.find((row) => String(row?.conversionId || '') === conversionId)
    assert.equal(Boolean(successRow), true)
    assert.equal(String(successRow.postbackStatus || ''), 'success')
    assert.equal(typeof successRow.factId, 'string')
    assert.equal(Boolean(successRow.factId), true)
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[cpa-postback-metrics] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
