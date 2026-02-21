import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src', 'server', 'simulator-gateway.js')

const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 15000
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
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', GATEWAY_ENTRY], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SIMULATOR_GATEWAY_HOST: HOST,
      SIMULATOR_GATEWAY_PORT: String(port)
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
    appId: 'simulator-chatbot',
    sessionId: `e2e_closed_loop_session_${now}`,
    turnId: `e2e_closed_loop_turn_${now}`,
    query: 'Recommend trail running shoes for rainy weather',
    answerText: 'You can prioritize grip and waterproof materials.',
    intentScore: 0.91,
    locale: 'en-US'
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

  try {
    await waitForGateway(baseUrl)
    const patchResponse = await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_inline_v1', {
      method: 'PUT',
      body: {
        enabled: false
      }
    })
    assert.equal(patchResponse.ok, true, 'fail condition: chat_inline_v1 should be configurable for deterministic e2e')
    placementPatched = true

    const requestPayload = buildAttachMvpPayload()

    const deliveryResponse = await requestJson(baseUrl, '/api/v1/sdk/evaluate', {
      method: 'POST',
      body: requestPayload
    })

    assert.equal(deliveryResponse.ok, true, `delivery request failed: ${JSON.stringify(deliveryResponse.payload)}`)

    const requestId = String(deliveryResponse.payload?.requestId || '').trim()
    const deliveryResult = String(deliveryResponse.payload?.decision?.result || '').trim()

    assert.equal(requestId.length > 0, true, 'fail condition: request stage must return non-empty requestId')
    assert.equal(
      deliveryResult,
      'blocked',
      `fail condition: delivery.result must be blocked under forced placement disable, got ${deliveryResult || 'empty'}`
    )
    assert.equal(
      ['blocked', 'served', 'no_fill', 'error'].includes(deliveryResult),
      true,
      `fail condition: delivery.result must be one of blocked/served/no_fill/error, got ${deliveryResult || 'empty'}`
    )

    const eventResponse = await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      body: {
        ...requestPayload,
        requestId
      }
    })

    assert.equal(eventResponse.ok, true, `event request failed: ${JSON.stringify(eventResponse.payload)}`)
    assert.equal(eventResponse.payload?.ok, true, 'fail condition: event stage must return { ok: true }')

    const [decisionsResponse, eventsResponse] = await Promise.all([
      requestJson(baseUrl, `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}`),
      requestJson(baseUrl, `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}`)
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
      await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_inline_v1', {
        method: 'PUT',
        body: {
          enabled: true
        }
      }).catch(() => {})
    }
    await stopGateway(gateway)
  }
})
