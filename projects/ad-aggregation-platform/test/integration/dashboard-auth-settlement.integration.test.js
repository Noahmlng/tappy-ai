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

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(Number(value || 0) * factor) / factor
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

async function seedScopedRevenue(baseUrl, input) {
  const evaluate = await requestJson(baseUrl, '/api/v1/sdk/evaluate', {
    method: 'POST',
    body: {
      appId: input.appId,
      accountId: input.accountId,
      sessionId: `sess_${input.appId}_${Date.now()}`,
      turnId: `turn_${input.appId}_${Date.now()}`,
      query: `find product for ${input.accountId}`,
      answerText: 'seed account-scoped revenue',
      intentScore: 0.84,
      locale: 'en-US',
      placementId: 'chat_inline_v1',
    },
  })
  assert.equal(evaluate.ok, true, `evaluate failed: ${JSON.stringify(evaluate.payload)}`)
  const requestId = String(evaluate.payload?.requestId || '').trim()
  assert.equal(Boolean(requestId), true)

  const postback = await requestJson(baseUrl, '/api/v1/sdk/events', {
    method: 'POST',
    body: {
      eventType: 'postback',
      appId: input.appId,
      accountId: input.accountId,
      requestId,
      placementId: 'chat_inline_v1',
      adId: `offer_${input.accountId}`,
      postbackType: 'conversion',
      postbackStatus: 'success',
      conversionId: `conv_${input.accountId}_${Date.now()}`,
      cpaUsd: input.cpaUsd,
      currency: 'USD',
    },
  })
  assert.equal(postback.ok, true, `postback failed: ${JSON.stringify(postback.payload)}`)
}

test('dashboard auth: login session enforces account scope for settlement aggregates', async () => {
  const port = 3980 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const registerOrg = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'owner-org@example.com',
        password: 'pass12345',
        accountId: 'org_simulator',
        appId: 'simulator-chatbot',
      },
    })
    assert.equal(registerOrg.status, 201, `register org failed: ${JSON.stringify(registerOrg.payload)}`)

    const registerOther = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'owner-other@example.com',
        password: 'pass12345',
        accountId: 'acct_other',
        appId: 'simulator-chatbot-other',
      },
    })
    assert.equal(registerOther.status, 201, `register other failed: ${JSON.stringify(registerOther.payload)}`)

    await seedScopedRevenue(baseUrl, { accountId: 'org_simulator', appId: 'simulator-chatbot', cpaUsd: 3.2 })
    await seedScopedRevenue(baseUrl, { accountId: 'acct_other', appId: 'simulator-chatbot-other', cpaUsd: 9.5 })

    const openUsage = await requestJson(baseUrl, '/api/v1/dashboard/usage-revenue')
    assert.equal(openUsage.ok, true)
    assert.equal(round(openUsage.payload?.totals?.settledRevenueUsd), 12.7)

    const loginOrg = await requestJson(baseUrl, '/api/v1/public/dashboard/login', {
      method: 'POST',
      body: {
        email: 'owner-org@example.com',
        password: 'pass12345',
      },
    })
    assert.equal(loginOrg.ok, true, `login failed: ${JSON.stringify(loginOrg.payload)}`)
    const token = String(loginOrg.payload?.session?.accessToken || '').trim()
    assert.equal(Boolean(token), true, 'login should return dashboard access token')
    const authHeaders = { Authorization: `Bearer ${token}` }

    const me = await requestJson(baseUrl, '/api/v1/public/dashboard/me', {
      headers: authHeaders,
    })
    assert.equal(me.ok, true)
    assert.equal(String(me.payload?.user?.accountId || ''), 'org_simulator')

    const scopedUsage = await requestJson(baseUrl, '/api/v1/dashboard/usage-revenue', {
      headers: authHeaders,
    })
    assert.equal(scopedUsage.ok, true)
    assert.equal(round(scopedUsage.payload?.totals?.settledRevenueUsd), 3.2)
    const accountRows = Array.isArray(scopedUsage.payload?.byAccount) ? scopedUsage.payload.byAccount : []
    assert.equal(accountRows.length > 0, true)
    assert.equal(accountRows.every((row) => String(row?.accountId || '') === 'org_simulator'), true)

    const tamperedScope = await requestJson(
      baseUrl,
      '/api/v1/dashboard/usage-revenue?accountId=acct_other&appId=simulator-chatbot-other',
      { headers: authHeaders },
    )
    assert.equal(tamperedScope.status, 403)
    assert.equal(tamperedScope.payload?.error?.code, 'DASHBOARD_SCOPE_VIOLATION')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[dashboard-auth-settlement] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
