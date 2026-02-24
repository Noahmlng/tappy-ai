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
      if (health.ok && health.payload?.ok === true) return
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
  if (!handle.child.killed) handle.child.kill('SIGKILL')
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

async function issueIntegrationToken(baseUrl, authHeaders = {}) {
  const issue = await requestJson(baseUrl, '/api/v1/public/agent/integration-token', {
    method: 'POST',
    headers: {
      ...authHeaders,
      'x-dashboard-actor': 'security-admin',
    },
    body: {
      appId: 'simulator-chatbot',
      environment: 'staging',
      placementId: 'chat_inline_v1',
      ttlMinutes: 10,
    },
  })
  assert.equal(issue.status, 201, `issue token failed: ${JSON.stringify(issue.payload)}`)
  return {
    tokenId: String(issue.payload?.tokenId || ''),
    token: String(issue.payload?.integrationToken || ''),
  }
}

async function querySecurityAudit(baseUrl, params) {
  const query = new URLSearchParams(params)
  const rows = await requestJson(baseUrl, `/api/v1/public/audit/logs?${query.toString()}`)
  assert.equal(rows.ok, true, `audit query failed: ${JSON.stringify(rows.payload)}`)
  const items = Array.isArray(rows.payload?.items) ? rows.payload.items : []
  return items
}

test('token security: rejects ttl out of range and writes deny audit', async () => {
  const port = 5650 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const authHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'token-security-ttl@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })
    const issued = await issueIntegrationToken(baseUrl, authHeaders)

    const invalidTtl = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {
        integrationToken: issued.token,
        ttlSeconds: 901,
      },
    })
    assert.equal(invalidTtl.status, 400)
    assert.equal(invalidTtl.payload?.error?.code, 'INVALID_TTL_SECONDS')

    const denyItems = await querySecurityAudit(baseUrl, {
      action: 'integration_token_exchange_deny',
      resourceType: 'integration_token',
      resourceId: issued.tokenId,
      limit: '20',
    })
    const matched = denyItems.find((row) => row?.metadata?.reason === 'ttl_out_of_range')
    assert.equal(Boolean(matched), true, 'ttl deny audit should be recorded')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[token-security-ttl] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('token security: blocks privilege escalation fields and replay, both audited', async () => {
  const port = 5850 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const authHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'token-security-scope@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })
    const issued = await issueIntegrationToken(baseUrl, authHeaders)
    const scopeEscalation = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {
        integrationToken: issued.token,
        appId: 'another-app',
        scope: {
          dashboardRead: true,
        },
      },
    })
    assert.equal(scopeEscalation.status, 403)
    assert.equal(scopeEscalation.payload?.error?.code, 'TOKEN_EXCHANGE_SCOPE_VIOLATION')

    const exchange = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {
        integrationToken: issued.token,
      },
    })
    assert.equal(exchange.status, 201, `exchange failed: ${JSON.stringify(exchange.payload)}`)

    const replay = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {
        integrationToken: issued.token,
      },
    })
    assert.equal(replay.status, 409)
    assert.equal(replay.payload?.error?.code, 'INTEGRATION_TOKEN_ALREADY_USED')

    const denyItems = await querySecurityAudit(baseUrl, {
      action: 'integration_token_exchange_deny',
      resourceType: 'integration_token',
      resourceId: issued.tokenId,
      limit: '40',
    })
    const hasEscalationAudit = denyItems.some((row) => row?.metadata?.reason === 'privilege_escalation_attempt')
    const hasReplayAudit = denyItems.some((row) => row?.metadata?.reason === 'integration_token_replay')
    assert.equal(hasEscalationAudit, true, 'privilege escalation deny audit should be recorded')
    assert.equal(hasReplayAudit, true, 'replay deny audit should be recorded')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[token-security-replay-scope] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('token security: agent access token enforces placement scope and audits deny', async () => {
  const port = 6050 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const authHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'token-security-placement@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })
    const issued = await issueIntegrationToken(baseUrl, authHeaders)
    const exchange = await requestJson(baseUrl, '/api/v1/public/agent/token-exchange', {
      method: 'POST',
      body: {
        integrationToken: issued.token,
      },
    })
    assert.equal(exchange.status, 201, `exchange failed: ${JSON.stringify(exchange.payload)}`)
    const accessToken = String(exchange.payload?.accessToken || '')
    const accessTokenId = String(exchange.payload?.tokenId || '')
    assert.equal(accessToken.length > 0, true)

    const allowedConfig = await requestJson(
      baseUrl,
      '/api/v1/mediation/config?appId=simulator-chatbot&placementId=chat_inline_v1&environment=staging&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )
    assert.equal(allowedConfig.status, 200, `allowed config failed: ${JSON.stringify(allowedConfig.payload)}`)

    const deniedConfig = await requestJson(
      baseUrl,
      '/api/v1/mediation/config?appId=simulator-chatbot&placementId=chat_followup_v1&environment=staging&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )
    assert.equal(deniedConfig.status, 403)
    assert.equal(deniedConfig.payload?.error?.code, 'ACCESS_TOKEN_SCOPE_VIOLATION')

    const deniedBid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        userId: 'scope_user',
        chatId: `scope_session_${Date.now()}`,
        placementId: 'chat_followup_v1',
        messages: [
          { role: 'user', content: 'Recommend family SUV options' },
          { role: 'assistant', content: 'You can compare fuel economy and cargo space.' },
        ],
      },
    })
    assert.equal(deniedBid.status, 403)
    assert.equal(deniedBid.payload?.error?.code, 'ACCESS_TOKEN_SCOPE_VIOLATION')

    const denyItems = await querySecurityAudit(baseUrl, {
      action: 'agent_access_deny',
      resourceType: 'agent_access_token',
      resourceId: accessTokenId,
      limit: '20',
    })
    const hasPlacementMismatch = denyItems.some((row) => row?.metadata?.reason === 'placement_mismatch')
    assert.equal(hasPlacementMismatch, true, 'access token placement mismatch should be audited')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[token-security-access] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
