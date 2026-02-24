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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeoutSignal(timeoutMs = 5000) {
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
      SIMULATOR_RUNTIME_AUTH_REQUIRED: 'false',
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

test('v2 bid API returns unified response and legacy evaluate returns migration hint', async () => {
  const port = 3950 + Math.floor(Math.random() * 120)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const bid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      body: {
        userId: 'user_v2_001',
        chatId: 'chat_v2_001',
        placementId: 'chat_inline_v1',
        messages: [
          { role: 'user', content: 'i want to buy a gift to my girlfriend' },
          { role: 'assistant', content: 'what kind of gift do you prefer?' },
          { role: 'user', content: 'camera for vlogging' },
        ],
      },
      timeoutMs: 12000,
    })

    assert.equal(bid.ok, true, `v2 bid failed: ${JSON.stringify(bid.payload)}`)
    assert.equal(bid.payload?.status, 'success')
    assert.equal(typeof bid.payload?.requestId, 'string')
    assert.equal(typeof bid.payload?.timestamp, 'string')
    assert.equal(Boolean(bid.payload?.data), true)

    const winner = bid.payload?.data?.bid
    if (winner) {
      assert.equal(typeof winner.price, 'number')
      assert.equal(typeof winner.headline, 'string')
      assert.equal(typeof winner.url, 'string')
      assert.equal(typeof winner.bidId, 'string')
    } else {
      assert.equal(bid.payload?.message, 'No bid')
    }

    const legacyEvaluate = await requestJson(baseUrl, '/api/v1/sdk/evaluate', {
      method: 'POST',
      body: {
        sessionId: 'legacy_sess_001',
        turnId: 'legacy_turn_001',
        query: 'legacy evaluate request',
        answerText: 'legacy answer',
        intentScore: 0.8,
        locale: 'en-US',
        placementId: 'chat_inline_v1',
      },
    })

    assert.equal(legacyEvaluate.ok, true)
    assert.equal(legacyEvaluate.payload?.status, 'deprecated')
    assert.equal(legacyEvaluate.payload?.migration?.endpoint, '/api/v2/bid')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[v2-bid-api] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`)
  } finally {
    await stopGateway(gateway)
  }
})
