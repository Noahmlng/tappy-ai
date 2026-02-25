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

test('token exchange: exchanges one-time integration token into short-lived scoped access token', async () => {
  const port = 5350 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const authHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'exchange-owner@example.com',
      accountId: 'org_mediation',
      appId: 'sample-client-app',
    })

    const issue = await requestJson(baseUrl, '/api/v1/public/agent/integration-token', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'x-dashboard-actor': 'agent-admin',
      },
      body: {
        appId: 'sample-client-app',
        environment: 'prod',
        placementId: 'chat_from_answer_v1',
        ttlMinutes: 10,
      },
    })
    assert.equal(issue.status, 201, `issue token failed: ${JSON.stringify(issue.payload)}`)
    const integrationToken = String(issue.payload?.integrationToken || '')
    assert.equal(integrationToken.length > 0, true, 'integration token should be returned on issue')

    const exchange = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      headers: {
        'x-dashboard-actor': 'agent-runtime',
      },
      body: {
        integrationToken,
      },
    })
    assert.equal(exchange.status, 201, `exchange failed: ${JSON.stringify(exchange.payload)}`)
    assert.equal(exchange.payload?.tokenType, 'agent_access_token')
    assert.equal(typeof exchange.payload?.accessToken, 'string')
    assert.match(exchange.payload.accessToken, /^atk_prod_[a-z0-9]+$/)
    assert.equal(exchange.payload?.ttlSeconds, 300)
    assert.equal(exchange.payload?.scope?.mediationConfigRead, true)
    assert.equal(exchange.payload?.scope?.sdkEvaluate, true)
    assert.equal(exchange.payload?.scope?.sdkEvents, true)
    assert.equal(exchange.payload?.scope?.dashboardRead, undefined)
    assert.equal(String(exchange.payload?.sourceTokenId || '').length > 0, true)

    const replay = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {
        integrationToken,
      },
    })
    assert.equal(replay.status, 409, `replay should be rejected: ${JSON.stringify(replay.payload)}`)
    assert.equal(replay.payload?.error?.code, 'INTEGRATION_TOKEN_ALREADY_USED')

    const auditRows = await requestJson(
      baseUrl,
      `/api/v1/public/audit/logs?action=integration_token_exchange&resourceType=agent_access_token&resourceId=${encodeURIComponent(String(exchange.payload?.tokenId || ''))}`,
    )
    assert.equal(auditRows.ok, true, `audit query failed: ${JSON.stringify(auditRows.payload)}`)
    const items = Array.isArray(auditRows.payload?.items) ? auditRows.payload.items : []
    assert.equal(items.length > 0, true, 'exchange action should be audited')
    assert.equal(items[0]?.actor, 'agent-runtime')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[token-exchange-scoped] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('token exchange: rejects invalid payload and invalid integration token', async () => {
  const port = 5550 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const missingPayload = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {},
    })
    assert.equal(missingPayload.status, 400)
    assert.equal(missingPayload.payload?.error?.code, 'INVALID_REQUEST')

    const invalidToken = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {
        integrationToken: 'itk_prod_invalidtoken123',
      },
    })
    assert.equal(invalidToken.status, 401)
    assert.equal(invalidToken.payload?.error?.code, 'INVALID_INTEGRATION_TOKEN')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[token-exchange-invalid] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
