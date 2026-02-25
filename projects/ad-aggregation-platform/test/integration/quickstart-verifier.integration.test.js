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

test('quick start verifier runs config -> v2 bid -> events and returns evidence', async () => {
  const port = 3850 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'quickstart-owner@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })
    const createKey = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
      method: 'POST',
      headers: dashboardHeaders,
      body: {
        accountId: 'org_simulator',
        appId: 'simulator-chatbot',
        environment: 'prod',
        name: 'quickstart-active-key',
      },
    })
    assert.equal(createKey.status, 201, `key create failed: ${JSON.stringify(createKey.payload)}`)

    const verify = await requestJson(baseUrl, '/api/v1/public/quick-start/verify', {
      method: 'POST',
      body: {
        accountId: 'org_simulator',
        appId: 'simulator-chatbot',
        environment: 'prod',
        placementId: 'chat_inline_v1',
      },
    })
    assert.equal(verify.ok, true, `verify failed: ${JSON.stringify(verify.payload)}`)
    assert.equal(verify.payload?.ok, true)

    const requestId = String(verify.payload?.requestId || '')
    assert.equal(Boolean(requestId), true, 'verifier should return requestId')
    assert.equal(['served', 'blocked', 'no_fill', 'error'].includes(String(verify.payload?.status || '')), true)

    assert.equal(verify.payload?.evidence?.config?.status, 200)
    assert.equal(verify.payload?.evidence?.events?.ok, true)
    assert.equal(verify.payload?.evidence?.evaluate?.requestId, requestId)

    const decisionRows = await requestJson(
      baseUrl,
      `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}`,
      { headers: dashboardHeaders },
    )
    assert.equal(decisionRows.ok, true, `decision query failed: ${JSON.stringify(decisionRows.payload)}`)
    assert.equal(Array.isArray(decisionRows.payload?.items), true)
    assert.equal(decisionRows.payload.items.length > 0, true, 'decision evidence should be persisted')

    const eventRows = await requestJson(
      baseUrl,
      `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}&eventType=sdk_event`,
      { headers: dashboardHeaders },
    )
    assert.equal(eventRows.ok, true, `event query failed: ${JSON.stringify(eventRows.payload)}`)
    assert.equal(Array.isArray(eventRows.payload?.items), true)
    assert.equal(eventRows.payload.items.length > 0, true, 'event evidence should be persisted')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[quickstart-verifier] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('quick start verifier returns precondition failed when app has no active key', async () => {
  const port = 4050 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'quickstart-precondition@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })

    const createKey = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
      method: 'POST',
      headers: dashboardHeaders,
      body: {
        accountId: 'org_simulator',
        appId: 'simulator-chatbot',
        environment: 'prod',
        name: 'precondition-test-key',
      },
    })
    assert.equal(createKey.status, 201, `key create failed: ${JSON.stringify(createKey.payload)}`)

    const listKeys = await requestJson(baseUrl, '/api/v1/public/credentials/keys?appId=simulator-chatbot&environment=prod', {
      headers: dashboardHeaders,
    })
    assert.equal(listKeys.ok, true, `key list failed: ${JSON.stringify(listKeys.payload)}`)
    const keys = Array.isArray(listKeys.payload?.keys) ? listKeys.payload.keys : []
    assert.equal(keys.length > 0, true, 'prod keys should exist after reset')

    for (const row of keys) {
      await requestJson(
        baseUrl,
        `/api/v1/public/credentials/keys/${encodeURIComponent(String(row.keyId || ''))}/revoke`,
        { method: 'POST', headers: dashboardHeaders },
      )
    }

    const verify = await requestJson(baseUrl, '/api/v1/public/quick-start/verify', {
      method: 'POST',
      body: {
        accountId: 'org_simulator',
        appId: 'simulator-chatbot',
        environment: 'prod',
        placementId: 'chat_inline_v1',
      },
    })
    assert.equal(verify.status, 409)
    assert.equal(verify.payload?.error?.code, 'PRECONDITION_FAILED')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[quickstart-verifier-precondition] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
