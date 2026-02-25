import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src', 'devtools', 'mediation', 'mediation-gateway.js')

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
      if (health.ok && health.payload?.ok === true) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`gateway health check timeout after ${HEALTH_TIMEOUT_MS}ms`)
}

function startGateway(port, envOverrides = {}) {
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
      ...envOverrides,
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
  if (!handle.child.killed) handle.child.kill('SIGKILL')
}

async function registerDashboardHeaders(baseUrl, input = {}) {
  const now = Date.now()
  const email = String(input.email || `owner_${now}@example.com`)
  const password = String(input.password || 'pass12345')
  const accountId = String(input.accountId || 'org_mediation')
  const appId = String(input.appId || 'sample-client-app')
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
  const accountId = String(input.accountId || 'org_mediation')
  const appId = String(input.appId || 'sample-client-app')
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

test('settlement durability: production mode fails fast without SUPABASE_DB_URL', async () => {
  const port = 7250 + Math.floor(Math.random() * 100)
  const gateway = startGateway(port, {
    MEDIATION_PRODUCTION_MODE: 'true',
    MEDIATION_REQUIRE_DURABLE_SETTLEMENT: 'true',
    MEDIATION_SETTLEMENT_STORAGE: 'supabase',
    SUPABASE_DB_URL: '',
  })

  try {
    const exitCode = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000)
      gateway.child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    assert.notEqual(exitCode, null, 'gateway should exit quickly when durable settlement precondition fails')
    assert.notEqual(Number(exitCode), 0, 'gateway should exit with non-zero status')
    const logs = gateway.getLogs()
    const combined = `${logs.stdout}\n${logs.stderr}`
    assert.equal(
      /durable settlement storage is required|settlement store init error/i.test(combined),
      true,
      `expected fail-fast message, got logs: ${combined}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('history retention: event logs are not hard-truncated when max limit is disabled', async () => {
  const port = 7350 + Math.floor(Math.random() * 100)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port, {
    MEDIATION_MAX_EVENT_LOGS: '0',
  })

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.status, 404)

    const accountId = `acct_history_${Date.now()}`
    const appId = `app_history_${Date.now()}`
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'history-retention@example.com',
      accountId,
      appId,
    })
    const runtimeHeaders = await issueRuntimeApiKeyHeaders(baseUrl, {
      accountId,
      appId,
    }, dashboardHeaders)

    const totalEvents = 520
    for (let i = 0; i < totalEvents; i += 1) {
      const emitted = await requestJson(baseUrl, '/api/v1/sdk/events', {
        method: 'POST',
        headers: runtimeHeaders,
        body: {
          appId,
          accountId,
          sessionId: `sess_history_${i}`,
          turnId: `turn_history_${i}`,
          query: `history query ${i}`,
          answerText: `history answer ${i}`,
          intentScore: 0.8,
          locale: 'en-US',
          placementId: 'chat_from_answer_v1',
          kind: 'click',
        },
      })
      assert.equal(emitted.ok, true, `sdk event failed at index=${i}: ${JSON.stringify(emitted.payload)}`)
    }

    const events = await requestJson(baseUrl, '/api/v1/dashboard/events?eventType=sdk_event', {
      headers: dashboardHeaders,
    })
    assert.equal(events.ok, true, `events query failed: ${JSON.stringify(events.payload)}`)
    const rows = Array.isArray(events.payload?.items) ? events.payload.items : []
    assert.equal(rows.length >= totalEvents, true, `expected >= ${totalEvents} rows, got ${rows.length}`)
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[durable-settlement-history] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
