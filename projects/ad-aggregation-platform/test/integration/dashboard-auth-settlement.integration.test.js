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

async function issueRuntimeApiKey(baseUrl, input = {}, headers = {}) {
  const accountId = String(input.accountId || 'org_simulator')
  const appId = String(input.appId || 'simulator-chatbot')
  const environment = String(input.environment || 'staging')
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

async function seedScopedRevenue(baseUrl, input, headers = {}) {
  const evaluate = await requestJson(baseUrl, '/api/v1/sdk/evaluate', {
    method: 'POST',
    headers,
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
    headers,
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

    const runtimeOrgHeaders = await issueRuntimeApiKey(baseUrl, {
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    }, registerOrg.payload?.session?.accessToken
      ? { Authorization: `Bearer ${String(registerOrg.payload.session.accessToken)}` }
      : {})
    const runtimeOtherHeaders = await issueRuntimeApiKey(baseUrl, {
      accountId: 'acct_other',
      appId: 'simulator-chatbot-other',
    }, registerOther.payload?.session?.accessToken
      ? { Authorization: `Bearer ${String(registerOther.payload.session.accessToken)}` }
      : {})

    await seedScopedRevenue(baseUrl, { accountId: 'org_simulator', appId: 'simulator-chatbot', cpaUsd: 3.2 }, runtimeOrgHeaders)
    await seedScopedRevenue(baseUrl, { accountId: 'acct_other', appId: 'simulator-chatbot-other', cpaUsd: 9.5 }, runtimeOtherHeaders)

    const openUsage = await requestJson(baseUrl, '/api/v1/dashboard/usage-revenue')
    assert.equal(openUsage.status, 401)
    assert.equal(openUsage.payload?.error?.code, 'DASHBOARD_AUTH_REQUIRED')
    const openPlacementAudits = await requestJson(baseUrl, '/api/v1/dashboard/placement-audits')
    assert.equal(openPlacementAudits.status, 401)
    assert.equal(openPlacementAudits.payload?.error?.code, 'DASHBOARD_AUTH_REQUIRED')

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

test('dashboard placement config is isolated per account app', async () => {
  const port = 4180 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const registerAccountA = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'placement-account-a@example.com',
        password: 'pass12345',
        accountId: 'acct_a',
        appId: 'simulator-chatbot-a',
      },
    })
    assert.equal(registerAccountA.status, 201, `register account A failed: ${JSON.stringify(registerAccountA.payload)}`)
    const dashboardAHeaders = registerAccountA.payload?.session?.accessToken
      ? { Authorization: `Bearer ${String(registerAccountA.payload.session.accessToken)}` }
      : {}

    const registerAccountB = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'placement-account-b@example.com',
        password: 'pass12345',
        accountId: 'acct_b',
        appId: 'simulator-chatbot-b',
      },
    })
    assert.equal(registerAccountB.status, 201, `register account B failed: ${JSON.stringify(registerAccountB.payload)}`)
    const dashboardBHeaders = registerAccountB.payload?.session?.accessToken
      ? { Authorization: `Bearer ${String(registerAccountB.payload.session.accessToken)}` }
      : {}

    const runtimeAHeaders = await issueRuntimeApiKey(baseUrl, {
      accountId: 'acct_a',
      appId: 'simulator-chatbot-a',
    }, dashboardAHeaders)
    const runtimeBHeaders = await issueRuntimeApiKey(baseUrl, {
      accountId: 'acct_b',
      appId: 'simulator-chatbot-b',
    }, dashboardBHeaders)

    const placementsA = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardAHeaders,
    })
    assert.equal(placementsA.ok, true, `placements A failed: ${JSON.stringify(placementsA.payload)}`)
    const placementAInlineBefore = Array.isArray(placementsA.payload?.placements)
      ? placementsA.payload.placements.find((row) => String(row?.placementId || '') === 'chat_inline_v1')
      : null
    assert.equal(Boolean(placementAInlineBefore), true, 'account A should have chat_inline_v1')
    assert.equal(Boolean(placementAInlineBefore?.enabled), true, 'account A chat_inline_v1 should start enabled')

    const placementsB = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardBHeaders,
    })
    assert.equal(placementsB.ok, true, `placements B failed: ${JSON.stringify(placementsB.payload)}`)
    const placementBInlineBefore = Array.isArray(placementsB.payload?.placements)
      ? placementsB.payload.placements.find((row) => String(row?.placementId || '') === 'chat_inline_v1')
      : null
    assert.equal(Boolean(placementBInlineBefore), true, 'account B should have chat_inline_v1')
    assert.equal(Boolean(placementBInlineBefore?.enabled), true, 'account B chat_inline_v1 should start enabled')

    const patchA = await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_inline_v1', {
      method: 'PUT',
      headers: dashboardAHeaders,
      body: {
        enabled: false,
      },
    })
    assert.equal(patchA.ok, true, `patch A failed: ${JSON.stringify(patchA.payload)}`)
    assert.equal(Boolean(patchA.payload?.changed), true, 'account A patch should change placement config')
    assert.equal(Boolean(patchA.payload?.placement?.enabled), false, 'account A placement should be disabled after patch')

    const placementsAAfterPatch = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardAHeaders,
    })
    assert.equal(placementsAAfterPatch.ok, true)
    const placementAInlineAfter = Array.isArray(placementsAAfterPatch.payload?.placements)
      ? placementsAAfterPatch.payload.placements.find((row) => String(row?.placementId || '') === 'chat_inline_v1')
      : null
    assert.equal(Boolean(placementAInlineAfter), true)
    assert.equal(Boolean(placementAInlineAfter?.enabled), false, 'account A placement should remain disabled')

    const placementsBAfterPatch = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardBHeaders,
    })
    assert.equal(placementsBAfterPatch.ok, true)
    const placementBInlineAfter = Array.isArray(placementsBAfterPatch.payload?.placements)
      ? placementsBAfterPatch.payload.placements.find((row) => String(row?.placementId || '') === 'chat_inline_v1')
      : null
    assert.equal(Boolean(placementBInlineAfter), true)
    assert.equal(Boolean(placementBInlineAfter?.enabled), true, 'account B placement should remain enabled')

    const sdkConfigA = await requestJson(baseUrl, '/api/v1/sdk/config?appId=simulator-chatbot-a')
    assert.equal(sdkConfigA.ok, true, `sdk config A failed: ${JSON.stringify(sdkConfigA.payload)}`)
    const sdkAInline = Array.isArray(sdkConfigA.payload?.placements)
      ? sdkConfigA.payload.placements.find((row) => String(row?.placementId || '') === 'chat_inline_v1')
      : null
    assert.equal(Boolean(sdkAInline), true)
    assert.equal(Boolean(sdkAInline?.enabled), false, 'sdk config for account A app should be disabled')

    const sdkConfigB = await requestJson(baseUrl, '/api/v1/sdk/config?appId=simulator-chatbot-b')
    assert.equal(sdkConfigB.ok, true, `sdk config B failed: ${JSON.stringify(sdkConfigB.payload)}`)
    const sdkBInline = Array.isArray(sdkConfigB.payload?.placements)
      ? sdkConfigB.payload.placements.find((row) => String(row?.placementId || '') === 'chat_inline_v1')
      : null
    assert.equal(Boolean(sdkBInline), true)
    assert.equal(Boolean(sdkBInline?.enabled), true, 'sdk config for account B app should stay enabled')

    const evaluateA = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeAHeaders,
      body: {
        userId: 'tenant_a_user',
        chatId: `sess_a_${Date.now()}`,
        placementId: 'chat_inline_v1',
        messages: [
          { role: 'user', content: 'find product for tenant A' },
          { role: 'assistant', content: 'seed decision' },
        ],
      },
    })
    assert.equal(evaluateA.ok, true, `bid A failed: ${JSON.stringify(evaluateA.payload)}`)
    assert.equal(evaluateA.payload?.status, 'success')
    assert.equal(evaluateA.payload?.message, 'No bid')
    assert.equal(evaluateA.payload?.data?.bid, null)

    const evaluateB = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeBHeaders,
      body: {
        userId: 'tenant_b_user',
        chatId: `sess_b_${Date.now()}`,
        placementId: 'chat_inline_v1',
        messages: [
          { role: 'user', content: 'find product for tenant B' },
          { role: 'assistant', content: 'seed decision' },
        ],
      },
    })
    assert.equal(evaluateB.ok, true, `bid B failed: ${JSON.stringify(evaluateB.payload)}`)
    assert.equal(evaluateB.payload?.status, 'success')

    const dashboardStateA = await requestJson(baseUrl, '/api/v1/dashboard/state', {
      headers: dashboardAHeaders,
    })
    assert.equal(dashboardStateA.ok, true, `dashboard state A failed: ${JSON.stringify(dashboardStateA.payload)}`)
    const reasonDetailA = String(dashboardStateA.payload?.decisionLogs?.[0]?.reasonDetail || '')
    assert.equal(reasonDetailA, 'placement_unavailable')

    const dashboardStateB = await requestJson(baseUrl, '/api/v1/dashboard/state', {
      headers: dashboardBHeaders,
    })
    assert.equal(dashboardStateB.ok, true, `dashboard state B failed: ${JSON.stringify(dashboardStateB.payload)}`)
    const reasonDetailB = String(dashboardStateB.payload?.decisionLogs?.[0]?.reasonDetail || '')
    assert.notEqual(reasonDetailB, 'placement_unavailable', 'account B should not inherit account A placement disable')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[dashboard-placement-isolation] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('dashboard placements create route is available and scoped by account app', async () => {
  const port = 4580 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const registerAccountA = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'placement-create-account-a@example.com',
        password: 'pass12345',
        accountId: 'acct_create_a',
        appId: 'simulator-chatbot-create-a',
      },
    })
    assert.equal(registerAccountA.status, 201, `register account A failed: ${JSON.stringify(registerAccountA.payload)}`)
    const dashboardAHeaders = registerAccountA.payload?.session?.accessToken
      ? { Authorization: `Bearer ${String(registerAccountA.payload.session.accessToken)}` }
      : {}

    const registerAccountB = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'placement-create-account-b@example.com',
        password: 'pass12345',
        accountId: 'acct_create_b',
        appId: 'simulator-chatbot-create-b',
      },
    })
    assert.equal(registerAccountB.status, 201, `register account B failed: ${JSON.stringify(registerAccountB.payload)}`)
    const dashboardBHeaders = registerAccountB.payload?.session?.accessToken
      ? { Authorization: `Bearer ${String(registerAccountB.payload.session.accessToken)}` }
      : {}

    const placementId = `follow_up_custom_${Date.now()}`
    const createPlacement = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      method: 'POST',
      headers: dashboardAHeaders,
      body: {
        placementId,
        surface: 'FOLLOW_UP',
        enabled: false,
      },
    })
    assert.equal(createPlacement.status, 201, `create placement failed: ${JSON.stringify(createPlacement.payload)}`)
    assert.equal(String(createPlacement.payload?.appId || ''), 'simulator-chatbot-create-a')
    assert.equal(String(createPlacement.payload?.placement?.placementId || ''), placementId)
    assert.equal(Boolean(createPlacement.payload?.placement?.enabled), false)

    const duplicateCreate = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      method: 'POST',
      headers: dashboardAHeaders,
      body: {
        placementId,
      },
    })
    assert.equal(duplicateCreate.status, 409)
    assert.equal(duplicateCreate.payload?.error?.code, 'PLACEMENT_EXISTS')

    const placementsA = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardAHeaders,
    })
    assert.equal(placementsA.ok, true, `placements A failed: ${JSON.stringify(placementsA.payload)}`)
    const foundA = Array.isArray(placementsA.payload?.placements)
      ? placementsA.payload.placements.find((row) => String(row?.placementId || '') === placementId)
      : null
    assert.equal(Boolean(foundA), true, 'account A should include created placement')

    const placementsB = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardBHeaders,
    })
    assert.equal(placementsB.ok, true, `placements B failed: ${JSON.stringify(placementsB.payload)}`)
    const foundB = Array.isArray(placementsB.payload?.placements)
      ? placementsB.payload.placements.find((row) => String(row?.placementId || '') === placementId)
      : null
    assert.equal(Boolean(foundB), false, 'account B should not see account A placement')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[dashboard-placements-create] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('dashboard register enforces account ownership proof for claimed accounts', async () => {
  const port = 4380 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const registerOwner = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'owner-claimed@example.com',
        password: 'pass12345',
        accountId: 'acct_claimed',
        appId: 'simulator-chatbot-claimed',
      },
    })
    assert.equal(registerOwner.status, 201, `register owner failed: ${JSON.stringify(registerOwner.payload)}`)
    const ownerToken = String(registerOwner.payload?.session?.accessToken || '').trim()
    assert.equal(Boolean(ownerToken), true, 'owner register should return dashboard session token')

    const registerNoProof = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      body: {
        email: 'intruder-claimed@example.com',
        password: 'pass12345',
        accountId: 'acct_claimed',
        appId: 'simulator-chatbot-claimed',
      },
    })
    assert.equal(registerNoProof.status, 403)
    assert.equal(registerNoProof.payload?.error?.code, 'DASHBOARD_ACCOUNT_OWNERSHIP_REQUIRED')

    const registerWithProof = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
      },
      body: {
        email: 'member-claimed@example.com',
        password: 'pass12345',
        accountId: 'acct_claimed',
        appId: 'simulator-chatbot-claimed',
      },
    })
    assert.equal(registerWithProof.status, 201, `register with proof failed: ${JSON.stringify(registerWithProof.payload)}`)
    assert.equal(String(registerWithProof.payload?.user?.accountId || ''), 'acct_claimed')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[dashboard-register-ownership] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
