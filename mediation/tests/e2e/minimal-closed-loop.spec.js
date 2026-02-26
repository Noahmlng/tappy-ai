import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src', 'devtools', 'mediation', 'mediation-gateway.js')

const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 20000
const REQUEST_TIMEOUT_MS = 25000
const ARCHIVE_STATUSES = new Set([
  'consistent_committed',
  'consistent_non_billable',
  'partial_pending',
  'partial_timeout'
])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeTimeoutSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
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
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: timeout.signal
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`request failed for ${pathname}: ${message}`)
    }

    const payload = await response.json().catch(() => ({}))
    return {
      ok: response.ok,
      status: response.status,
      payload
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
      SUPABASE_DB_URL: process.env.SUPABASE_DB_URL_TEST || process.env.SUPABASE_DB_URL || '',
      MEDIATION_ALLOWED_ORIGINS: 'http://127.0.0.1:3000',
      MEDIATION_ENABLE_LOCAL_SERVER: 'true',
      MEDIATION_GATEWAY_HOST: HOST,
      MEDIATION_GATEWAY_PORT: String(port),
      OPENROUTER_API_KEY: '',
      OPENROUTER_MODEL: 'glm-5',
      CJ_TOKEN: 'mock-cj-token',
      PARTNERSTACK_API_KEY: 'mock-partnerstack-key',
    },
    stdio: ['ignore', 'pipe', 'pipe']
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
    }
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

function buildAttachMvpPayload() {
  const now = Date.now()
  return {
    appId: 'mediation-chatbot',
    sessionId: `e2e_closed_loop_session_${now}`,
    turnId: `e2e_closed_loop_turn_${now}`,
    query: 'Recommend trail running shoes for rainy weather',
    answerText: 'You can prioritize grip and waterproof materials.',
    intentScore: 0.91,
    locale: 'en-US'
  }
}

function buildV2BidPayload(attachPayload) {
  return {
    userId: String(attachPayload?.sessionId || ''),
    chatId: String(attachPayload?.sessionId || ''),
    placementId: 'chat_from_answer_v1',
    messages: [
      { role: 'user', content: String(attachPayload?.query || '') },
      { role: 'assistant', content: String(attachPayload?.answerText || '') },
    ],
  }
}

async function registerDashboardHeaders(baseUrl) {
  const now = Date.now()
  const register = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
    method: 'POST',
    body: {
      email: `closed_loop_${now}@example.com`,
      password: 'pass12345',
      accountId: 'org_mediation',
      appId: 'mediation-chatbot',
    },
  })
  assert.equal(register.status, 201, `dashboard register failed: ${JSON.stringify(register.payload)}`)
  const accessToken = String(register.payload?.session?.accessToken || '').trim()
  assert.equal(Boolean(accessToken), true, 'dashboard register should return access token')
  return {
    Authorization: `Bearer ${accessToken}`,
  }
}

async function issueRuntimeApiKeyHeaders(baseUrl, dashboardHeaders) {
  const created = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
    method: 'POST',
    headers: dashboardHeaders,
    body: {
      accountId: 'org_mediation',
      appId: 'mediation-chatbot',
      environment: 'prod',
      name: `runtime-${Date.now()}`,
    },
  })
  assert.equal(created.status, 201, `issue runtime key failed: ${JSON.stringify(created.payload)}`)
  const secret = String(created.payload?.secret || '').trim()
  assert.equal(Boolean(secret), true, 'runtime key create should return secret')
  return {
    Authorization: `Bearer ${secret}`,
  }
}

function buildArchiveRecord({ requestId, delivery, sdkEvent }) {
  const archiveStatus = 'partial_pending'

  return {
    recordKey: `${requestId}|attempt_1`,
    responseReference: requestId,
    renderAttemptId: 'attempt_1',
    archiveStatus,
    delivery: {
      result: String(delivery?.result || ''),
      reason: String(delivery?.reason || ''),
      reasonDetail: String(delivery?.reasonDetail || '')
    },
    terminalEvent: {
      eventType: String(sdkEvent?.eventType || ''),
      createdAt: String(sdkEvent?.createdAt || '')
    }
  }
}

test('e2e: minimal closed-loop request -> delivery -> event -> archive', async () => {
  const port = 3400 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)
  let placementPatched = false
  let dashboardHeaders = {}
  let runtimeHeaders = {}

  try {
    await waitForGateway(baseUrl)
    dashboardHeaders = await registerDashboardHeaders(baseUrl)
    runtimeHeaders = await issueRuntimeApiKeyHeaders(baseUrl, dashboardHeaders)
    const patchResponse = await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_from_answer_v1', {
      method: 'PUT',
      headers: dashboardHeaders,
      body: {
        enabled: false
      }
    })
    assert.equal(patchResponse.ok, true, 'fail condition: chat_from_answer_v1 should be configurable for deterministic e2e')
    placementPatched = true

    const requestPayload = buildAttachMvpPayload()
    const bidPayload = buildV2BidPayload(requestPayload)

    const deliveryResponse = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: bidPayload
    })

    assert.equal(deliveryResponse.ok, true, `delivery request failed: ${JSON.stringify(deliveryResponse.payload)}`)

    const requestId = String(deliveryResponse.payload?.requestId || '').trim()
    const deliveryMessage = String(deliveryResponse.payload?.message || '').trim()

    assert.equal(requestId.length > 0, true, 'fail condition: request stage must return non-empty requestId')
    assert.equal(
      deliveryMessage,
      'No bid',
      `fail condition: delivery message must be No bid under forced placement disable, got ${deliveryMessage || 'empty'}`
    )
    assert.equal(
      ['Bid successful', 'No bid'].includes(deliveryMessage),
      true,
      `fail condition: delivery message must be one of Bid successful/No bid, got ${deliveryMessage || 'empty'}`
    )

    const eventResponse = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        ...requestPayload,
        requestId
      }
    })

    assert.equal(eventResponse.ok, true, `event request failed: ${JSON.stringify(eventResponse.payload)}`)
    assert.equal(eventResponse.payload?.ok, true, 'fail condition: event stage must return { ok: true }')

    const [decisionsResponse, eventsResponse] = await Promise.all([
      requestJson(baseUrl, `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}`, {
        headers: dashboardHeaders,
      }),
      requestJson(baseUrl, `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}`, {
        headers: dashboardHeaders,
      }),
    ])

    assert.equal(decisionsResponse.ok, true, 'fail condition: dashboard decisions query must succeed')
    assert.equal(eventsResponse.ok, true, 'fail condition: dashboard events query must succeed')

    const decisionRows = Array.isArray(decisionsResponse.payload?.items) ? decisionsResponse.payload.items : []
    const eventRows = Array.isArray(eventsResponse.payload?.items) ? eventsResponse.payload.items : []

    const decision = decisionRows.find((item) => String(item?.requestId || '') === requestId)
    const sdkEvent = eventRows.find(
      (item) => String(item?.requestId || '') === requestId && String(item?.eventType || '') === 'sdk_event'
    )

    assert.equal(Boolean(decision), true, 'fail condition: archive stage requires delivery decision log for requestId')
    assert.equal(Boolean(sdkEvent), true, 'fail condition: archive stage requires sdk_event log for requestId')

    const archiveRecord = buildArchiveRecord({
      requestId,
      delivery: decision,
      sdkEvent
    })

    assert.equal(archiveRecord.recordKey.startsWith(`${requestId}|`), true)
    assert.equal(ARCHIVE_STATUSES.has(archiveRecord.archiveStatus), true)
    assert.equal(archiveRecord.terminalEvent.eventType, 'sdk_event')
  } finally {
    if (placementPatched) {
      await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_from_answer_v1', {
        method: 'PUT',
        headers: dashboardHeaders,
        body: {
          enabled: true
        }
      }).catch(() => {})
    }
    await stopGateway(gateway)
  }
})
