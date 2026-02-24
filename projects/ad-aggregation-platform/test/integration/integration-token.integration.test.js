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

test('integration token: issues one-time token with short ttl and audit log', async () => {
  const port = 4950 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const authHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'integration-admin@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })

    const issue = await requestJson(baseUrl, '/api/v1/public/agent/integration-token', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'x-dashboard-actor': 'agent-admin',
      },
      body: {
        appId: 'simulator-chatbot',
        environment: 'staging',
        placementId: 'chat_inline_v1',
        ttlMinutes: 12,
      },
    })

    assert.equal(issue.status, 201, `issue token failed: ${JSON.stringify(issue.payload)}`)
    assert.equal(issue.payload?.tokenType, 'integration_token')
    assert.equal(issue.payload?.oneTime, true)
    assert.equal(issue.payload?.ttlSeconds, 12 * 60)
    assert.equal(typeof issue.payload?.integrationToken, 'string')
    assert.match(issue.payload.integrationToken, /^itk_staging_[a-z0-9]+$/)
    assert.equal(typeof issue.payload?.tokenId, 'string')
    assert.equal(issue.payload.tokenId.length > 0, true)

    const issuedAtMs = Date.parse(String(issue.payload?.issuedAt || ''))
    const expiresAtMs = Date.parse(String(issue.payload?.expiresAt || ''))
    assert.equal(Number.isFinite(issuedAtMs), true)
    assert.equal(Number.isFinite(expiresAtMs), true)
    assert.equal(expiresAtMs > issuedAtMs, true)
    assert.equal(expiresAtMs - issuedAtMs <= 12 * 60 * 1000 + 2000, true)

    const auditRows = await requestJson(
      baseUrl,
      `/api/v1/public/audit/logs?action=integration_token_issue&resourceType=integration_token&resourceId=${encodeURIComponent(issue.payload.tokenId)}`,
    )
    assert.equal(auditRows.ok, true, `audit query failed: ${JSON.stringify(auditRows.payload)}`)
    const items = Array.isArray(auditRows.payload?.items) ? auditRows.payload.items : []
    assert.equal(items.length > 0, true, 'issue action should be audited')
    assert.equal(items[0]?.actor, 'agent-admin')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[integration-token-issue] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('integration token: enforces ttl range and active-key precondition', async () => {
  const port = 5150 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const authHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'integration-policy@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })

    const invalidTtl = await requestJson(baseUrl, '/api/v1/public/agent/integration-token', {
      method: 'POST',
      headers: authHeaders,
      body: {
        appId: 'simulator-chatbot',
        environment: 'staging',
        ttlMinutes: 30,
      },
    })
    assert.equal(invalidTtl.status, 400)
    assert.equal(invalidTtl.payload?.error?.code, 'INVALID_REQUEST')

    const listKeys = await requestJson(
      baseUrl,
      '/api/v1/public/credentials/keys?appId=simulator-chatbot&environment=staging',
      { headers: authHeaders },
    )
    assert.equal(listKeys.ok, true, `list keys failed: ${JSON.stringify(listKeys.payload)}`)
    const keys = Array.isArray(listKeys.payload?.keys) ? listKeys.payload.keys : []
    assert.equal(keys.length > 0, true, 'staging keys should exist after reset')

    for (const row of keys) {
      await requestJson(
        baseUrl,
        `/api/v1/public/credentials/keys/${encodeURIComponent(String(row.keyId || ''))}/revoke`,
        { method: 'POST', headers: authHeaders },
      )
    }

    const withoutKey = await requestJson(baseUrl, '/api/v1/public/agent/integration-token', {
      method: 'POST',
      headers: authHeaders,
      body: {
        appId: 'simulator-chatbot',
        environment: 'staging',
        ttlMinutes: 10,
      },
    })
    assert.equal(withoutKey.status, 409)
    assert.equal(withoutKey.payload?.error?.code, 'PRECONDITION_FAILED')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[integration-token-policy] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
