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

function buildNextStepEventPayload(overrides = {}) {
  const base = {
    requestId: `adreq_next_step_event_${Date.now()}`,
    appId: 'simulator-chatbot',
    sessionId: `session_next_step_event_${Date.now()}`,
    turnId: `turn_next_step_event_${Date.now()}`,
    userId: 'next_step_event_user',
    event: 'followup_generation',
    placementId: 'chat_followup_v1',
    placementKey: 'next_step.intent_card',
    kind: 'impression',
    adId: 'next_item_001',
    context: {
      query: 'I want to buy a running shoe',
      answerText: 'Compare cushioning and price before buying.',
      locale: 'en-US',
      intent_class: 'shopping',
      intent_score: 0.92,
      preference_facets: [],
    },
  }
  return {
    ...base,
    ...overrides,
    context: {
      ...base.context,
      ...(overrides.context && typeof overrides.context === 'object' ? overrides.context : {}),
    },
  }
}

test('next-step sdk events: click/dismiss carry kind+adId and click updates dashboard metrics', async () => {
  const port = 3650 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'next-step-event-semantics@example.com',
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
    assert.equal(beforeSummary.status, 200, `metrics summary failed: ${JSON.stringify(beforeSummary.payload)}`)
    const beforeClicks = Number(beforeSummary.payload?.clicks || 0)

    const clickRequestId = `adreq_next_step_click_${Date.now()}`
    const clickEvent = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: buildNextStepEventPayload({
        requestId: clickRequestId,
        kind: 'click',
        adId: 'next_item_click_001',
      }),
    })
    assert.equal(clickEvent.ok, true, `click event failed: ${JSON.stringify(clickEvent.payload)}`)

    const afterClickSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
      headers: dashboardHeaders,
    })
    assert.equal(afterClickSummary.status, 200, `metrics summary failed: ${JSON.stringify(afterClickSummary.payload)}`)
    const afterClickCount = Number(afterClickSummary.payload?.clicks || 0)
    assert.equal(afterClickCount, beforeClicks + 1)

    const clickLogs = await requestJson(
      baseUrl,
      `/api/v1/dashboard/events?requestId=${encodeURIComponent(clickRequestId)}&eventType=sdk_event`,
      { headers: dashboardHeaders },
    )
    assert.equal(clickLogs.ok, true)
    const clickRows = Array.isArray(clickLogs.payload?.items) ? clickLogs.payload.items : []
    const clickRow = clickRows.find((item) => String(item?.requestId || '') === clickRequestId)
    assert.equal(Boolean(clickRow), true, 'click sdk_event must be stored')
    assert.equal(clickRows.some((item) => String(item?.event || '') === 'answer_completed'), false)
    assert.equal(clickRow.event, 'click')
    assert.equal(clickRow.kind, 'click')
    assert.equal(clickRow.adId, 'next_item_click_001')
    assert.equal(clickRow.placementKey, 'next_step.intent_card')

    const dismissRequestId = `adreq_next_step_dismiss_${Date.now()}`
    const dismissEvent = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: buildNextStepEventPayload({
        requestId: dismissRequestId,
        kind: 'dismiss',
        adId: 'next_item_dismiss_001',
      }),
    })
    assert.equal(dismissEvent.ok, true, `dismiss event failed: ${JSON.stringify(dismissEvent.payload)}`)

    const afterDismissSummary = await requestJson(baseUrl, '/api/v1/dashboard/metrics/summary', {
      headers: dashboardHeaders,
    })
    assert.equal(afterDismissSummary.status, 200, `metrics summary failed: ${JSON.stringify(afterDismissSummary.payload)}`)
    const afterDismissClicks = Number(afterDismissSummary.payload?.clicks || 0)
    assert.equal(afterDismissClicks, afterClickCount)

    const dismissLogs = await requestJson(
      baseUrl,
      `/api/v1/dashboard/events?requestId=${encodeURIComponent(dismissRequestId)}&eventType=sdk_event`,
      { headers: dashboardHeaders },
    )
    assert.equal(dismissLogs.ok, true)
    const dismissRows = Array.isArray(dismissLogs.payload?.items) ? dismissLogs.payload.items : []
    const dismissRow = dismissRows.find((item) => String(item?.requestId || '') === dismissRequestId)
    assert.equal(Boolean(dismissRow), true, 'dismiss sdk_event must be stored')
    assert.equal(dismissRows.some((item) => String(item?.event || '') === 'answer_completed'), false)
    assert.equal(dismissRow.event, 'dismiss')
    assert.equal(dismissRow.kind, 'dismiss')
    assert.equal(dismissRow.adId, 'next_item_dismiss_001')
    assert.equal(dismissRow.placementKey, 'next_step.intent_card')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[next-step-event-semantics] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
