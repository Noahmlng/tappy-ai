import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src', 'server', 'simulator-gateway.js')

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
      OPENROUTER_MODEL: '',
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

test('next-step reason priority: intent_non_commercial wins over threshold when both apply', async () => {
  const port = 3450 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const enablePlacement = await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_followup_v1', {
      method: 'PUT',
      body: {
        enabled: true,
      },
    })
    assert.equal(enablePlacement.ok, true, 'chat_followup_v1 should be enabled for next-step checks')

    const evaluate = await requestJson(baseUrl, '/api/v1/sdk/evaluate', {
      method: 'POST',
      body: {
        appId: 'simulator-chatbot',
        sessionId: `reason_priority_session_${Date.now()}`,
        turnId: `reason_priority_turn_${Date.now()}`,
        userId: 'reason_priority_user',
        event: 'followup_generation',
        placementId: 'chat_followup_v1',
        placementKey: 'next_step.intent_card',
        context: {
          // With intent fallback enabled, the server resolves this as non-commercial with score=0.
          // This means both non_commercial and below-threshold conditions are true.
          query: 'Explain why the sky is blue in simple physics terms.',
          answerText: 'Rayleigh scattering causes shorter wavelengths to scatter more.',
          locale: 'en-US',
          intent_class: 'shopping',
          intent_score: 0.99,
          preference_facets: [],
        },
      },
    })

    assert.equal(evaluate.ok, true, `evaluate failed: ${JSON.stringify(evaluate.payload)}`)
    assert.equal(evaluate.payload?.decision?.result, 'blocked')
    assert.equal(evaluate.payload?.decision?.reasonDetail, 'intent_non_commercial')
    assert.notEqual(evaluate.payload?.decision?.reasonDetail, 'intent_below_threshold')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[next-step-reason-priority] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
