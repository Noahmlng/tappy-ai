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
const HEALTH_TIMEOUT_MS = (() => {
  const raw = Number(process.env.MEDIATION_TEST_HEALTH_TIMEOUT_MS || 12000)
  if (!Number.isFinite(raw) || raw <= 0) return 12000
  return Math.floor(raw)
})()
const REQUEST_TIMEOUT_MS = (() => {
  const raw = Number(process.env.MEDIATION_TEST_REQUEST_TIMEOUT_MS || HEALTH_TIMEOUT_MS)
  if (!Number.isFinite(raw) || raw <= 0) return HEALTH_TIMEOUT_MS
  return Math.floor(raw)
})()

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

test('quick start verifier runs config -> v2 bid -> events and returns evidence', async () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const scopedAccountId = `org_mediation_${suffix}`
  const scopedAppId = `sample-client-app-${suffix}`
  const port = 3850 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.status, 404)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: `quickstart-owner-${suffix}@example.com`,
      accountId: scopedAccountId,
      appId: scopedAppId,
    })
    const createKey = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
      method: 'POST',
      headers: dashboardHeaders,
      body: {
        accountId: scopedAccountId,
        appId: scopedAppId,
        environment: 'prod',
        name: 'quickstart-active-key',
      },
    })
    assert.equal(createKey.status, 201, `key create failed: ${JSON.stringify(createKey.payload)}`)

    const verify = await requestJson(baseUrl, '/api/v1/public/quick-start/verify', {
      method: 'POST',
      body: {
        accountId: scopedAccountId,
        appId: scopedAppId,
        environment: 'prod',
      },
    })
    assert.equal(verify.ok, true, `verify failed: ${JSON.stringify(verify.payload)}`)
    assert.equal(verify.payload?.ok, true)

    const requestId = String(verify.payload?.requestId || '')
    assert.equal(Boolean(requestId), true, 'verifier should return requestId')
    assert.equal(['served', 'blocked', 'no_fill', 'error'].includes(String(verify.payload?.status || '')), true)

    assert.equal(verify.payload?.evidence?.config?.status, 200)
    assert.equal(verify.payload?.evidence?.events?.ok, true)
    assert.equal(verify.payload?.evidence?.bid?.requestId, requestId)

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
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const scopedAccountId = `org_mediation_${suffix}`
  const scopedAppId = `sample-client-app-${suffix}`
  const port = 4050 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.status, 404)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: `quickstart-precondition-${suffix}@example.com`,
      accountId: scopedAccountId,
      appId: scopedAppId,
    })

    const createKey = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
      method: 'POST',
      headers: dashboardHeaders,
      body: {
        accountId: scopedAccountId,
        appId: scopedAppId,
        environment: 'prod',
        name: 'precondition-test-key',
      },
    })
    assert.equal(createKey.status, 201, `key create failed: ${JSON.stringify(createKey.payload)}`)

    const listKeys = await requestJson(baseUrl, `/api/v1/public/credentials/keys?appId=${encodeURIComponent(scopedAppId)}&environment=prod`, {
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
        accountId: scopedAccountId,
        appId: scopedAppId,
        environment: 'prod',
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

test('quick start verifier rejects placementId override in request body', async () => {
  const port = 4250 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const verify = await requestJson(baseUrl, '/api/v1/public/quick-start/verify', {
      method: 'POST',
      body: {
        accountId: 'org_demo',
        appId: 'app_demo',
        environment: 'prod',
        placementId: 'chat_from_answer_v1',
      },
    })
    assert.equal(verify.status, 400)
    assert.equal(verify.payload?.error?.code, 'QUICKSTART_PLACEMENT_ID_NOT_ALLOWED')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[quickstart-verifier-placement] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
