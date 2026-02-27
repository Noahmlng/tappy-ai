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
  const accountId = String(input.accountId || 'org_mediation').trim()
  const appId = String(input.appId || 'sample-client-app').trim()
  const register = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
    method: 'POST',
    body: {
      email: String(input.email || `v2_bid_${now}@example.com`).trim(),
      password: 'pass12345',
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

async function issueRuntimeApiKeyHeaders(baseUrl, dashboardHeaders, input = {}) {
  const accountId = String(input.accountId || 'org_mediation').trim()
  const appId = String(input.appId || 'sample-client-app').trim()
  const created = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
    method: 'POST',
    headers: dashboardHeaders,
    body: {
      accountId,
      appId,
      environment: 'prod',
      name: `runtime-${Date.now()}`,
    },
  })
  assert.equal(created.status, 201, `issue runtime key failed: ${JSON.stringify(created.payload)}`)
  const secret = String(created.payload?.secret || '').trim()
  assert.equal(Boolean(secret), true, 'runtime key create should return secret')
  return { secret }
}

test('v2 bid API returns unified response and legacy evaluate endpoint is removed', async () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const scopedAccountId = `org_mediation_${suffix}`
  const scopedAppId = `sample-client-app-${suffix}`
  const port = 3950 + Math.floor(Math.random() * 120)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.status, 404)

    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: `v2_bid_${suffix}@example.com`,
      accountId: scopedAccountId,
      appId: scopedAppId,
    })
    const runtimeCredential = await issueRuntimeApiKeyHeaders(baseUrl, dashboardHeaders, {
      accountId: scopedAccountId,
      appId: scopedAppId,
    })
    const runtimeHeaders = {
      Authorization: `Bearer ${runtimeCredential.secret}`,
    }

    const configWithoutPlacement = await requestJson(
      baseUrl,
      `/api/v1/mediation/config?appId=${encodeURIComponent(scopedAppId)}&environment=prod&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-27T00%3A00%3A00.000Z`,
      {
      method: 'GET',
      headers: runtimeHeaders,
      timeoutMs: 12000,
      },
    )
    assert.equal(configWithoutPlacement.status, 200, JSON.stringify(configWithoutPlacement.payload))
    assert.equal(typeof configWithoutPlacement.payload?.placementId, 'string')
    assert.equal(configWithoutPlacement.payload?.placementId.length > 0, true)

    const bid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        userId: 'user_v2_001',
        chatId: 'chat_v2_001',
        placementId: 'chat_from_answer_v1',
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
    assert.equal(typeof bid.payload?.opportunityId, 'string')
    assert.equal(typeof bid.payload?.filled, 'boolean')
    assert.equal(Object.prototype.hasOwnProperty.call(bid.payload || {}, 'landingUrl'), true)
    assert.equal(typeof bid.payload?.intent?.score, 'number')
    assert.equal(typeof bid.payload?.intent?.class, 'string')
    assert.equal(typeof bid.payload?.intent?.source, 'string')
    assert.equal(typeof bid.payload?.decisionTrace?.reasonCode, 'string')
    assert.equal(Boolean(bid.payload?.decisionTrace?.stageStatus), true)
    assert.equal(typeof bid.payload?.diagnostics?.triggerType, 'string')
    assert.equal(bid.payload?.diagnostics?.pricingVersion, 'cpa_mock_v2')
    assert.equal(typeof bid.payload?.diagnostics?.timingsMs?.total, 'number')
    assert.equal(typeof bid.payload?.diagnostics?.budgetMs?.total, 'number')
    assert.equal(typeof bid.payload?.diagnostics?.budgetExceeded?.total, 'boolean')
    assert.equal(typeof bid.payload?.diagnostics?.timeoutSignal?.occurred, 'boolean')
    assert.equal(typeof bid.payload?.diagnostics?.precheck?.placement?.exists, 'boolean')
    assert.equal(
      bid.payload?.diagnostics?.precheck?.inventory?.ready === null
      || typeof bid.payload?.diagnostics?.precheck?.inventory?.ready === 'boolean',
      true,
    )
    assert.equal(Boolean(bid.payload?.data), true)

    const winner = bid.payload?.data?.bid
    if (winner) {
      assert.equal(typeof winner.price, 'number')
      assert.equal(typeof winner.headline, 'string')
      assert.equal(typeof winner.url, 'string')
      assert.equal(typeof winner.bidId, 'string')
      assert.equal(typeof winner.pricing, 'object')
      assert.equal(typeof winner.pricing.modelVersion, 'string')
      assert.equal(typeof winner.pricing.targetRpmUsd, 'number')
      assert.equal(typeof winner.pricing.ecpmUsd, 'number')
      assert.equal(typeof winner.pricing.cpaUsd, 'number')
      assert.equal(typeof winner.pricing.pClick, 'number')
      assert.equal(typeof winner.pricing.pConv, 'number')
      assert.equal(typeof winner.pricing.network, 'string')
      assert.equal(typeof winner.pricing.rawSignal, 'object')
      assert.equal(typeof winner.pricing.rawSignal.rawBidValue, 'number')
      assert.equal(typeof winner.pricing.rawSignal.rawUnit, 'string')
      assert.equal(typeof winner.pricing.rawSignal.normalizedFactor, 'number')
      assert.equal(typeof bid.payload?.landingUrl, 'string')
      assert.equal(bid.payload?.landingUrl.length > 0, true)
    } else {
      assert.equal(bid.payload?.message, 'No bid')
      assert.equal(bid.payload?.filled, false)
      assert.equal(bid.payload?.landingUrl, null)
    }

    const tolerantMissingChat = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        userId: 'user_missing_chat',
        placementId: 'chat_from_answer_v1',
        messages: [{ role: 'USER_INPUT', content: 'find me a running shoe deal' }],
        extraField: 'ignored',
      },
      timeoutMs: 12000,
    })
    assert.equal(tolerantMissingChat.status, 200, JSON.stringify(tolerantMissingChat.payload))
    assert.equal(tolerantMissingChat.payload?.diagnostics?.inputNormalization?.defaultsApplied?.chatIdDefaultedToUserId, true)
    assert.equal(tolerantMissingChat.payload?.diagnostics?.inputNormalization?.roleCoercions?.[0]?.to, 'user')

    const tolerantMissingUser = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        chatId: 'chat_missing_user',
        placementId: 'chat_from_answer_v1',
        query: 'suggest a vlogging camera',
      },
      timeoutMs: 12000,
    })
    assert.equal(tolerantMissingUser.status, 200, JSON.stringify(tolerantMissingUser.payload))
    assert.equal(tolerantMissingUser.payload?.diagnostics?.inputNormalization?.defaultsApplied?.userIdGenerated, true)
    assert.equal(tolerantMissingUser.payload?.diagnostics?.inputNormalization?.messagesSynthesized, true)

    const tolerantMissingPlacement = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        chatId: 'chat_missing_placement',
        messages: [{ role: 'assistant-bot', content: 'placeholder answer' }],
        prompt: 'show me a gift recommendation',
      },
      timeoutMs: 12000,
    })
    assert.equal(tolerantMissingPlacement.status, 200, JSON.stringify(tolerantMissingPlacement.payload))
    assert.equal(tolerantMissingPlacement.payload?.diagnostics?.inputNormalization?.defaultsApplied?.placementIdDefaulted, true)
    assert.equal(
      tolerantMissingPlacement.payload?.diagnostics?.inputNormalization?.defaultsApplied?.placementIdResolvedFromDashboardDefault,
      true,
    )
    assert.equal(
      tolerantMissingPlacement.payload?.diagnostics?.inputNormalization?.placementResolution?.source,
      'dashboard_default',
    )
    assert.equal(tolerantMissingPlacement.payload?.diagnostics?.inputNormalization?.roleCoercions?.[0]?.to, 'assistant')

    const legacyPlacementMapped = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: runtimeHeaders,
      body: {
        userId: 'user_legacy_placement',
        messages: [{ role: 'user', content: 'legacy placement request' }],
        placementId: 'chat_inline_v1',
      },
      timeoutMs: 12000,
    })
    assert.equal(legacyPlacementMapped.status, 200, JSON.stringify(legacyPlacementMapped.payload))
    assert.equal(legacyPlacementMapped.payload?.diagnostics?.inputNormalization?.placementMigration?.from, 'chat_inline_v1')
    assert.equal(legacyPlacementMapped.payload?.diagnostics?.inputNormalization?.placementMigration?.to, 'chat_from_answer_v1')

    const rawAuthBid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      headers: { Authorization: runtimeCredential.secret },
      body: {
        userId: 'user_raw_auth',
        chatId: 'chat_raw_auth',
        placementId: 'chat_from_answer_v1',
        messages: [{ role: 'user', content: 'raw auth header should pass' }],
      },
      timeoutMs: 12000,
    })
    assert.equal(rawAuthBid.status, 200, JSON.stringify(rawAuthBid.payload))

    const legacyEvaluate = await requestJson(baseUrl, '/api/v1/sdk/evaluate', {
      method: 'POST',
      body: {
        sessionId: 'legacy_sess_001',
        turnId: 'legacy_turn_001',
        query: 'legacy evaluate request',
        answerText: 'legacy answer',
        intentScore: 0.8,
        locale: 'en-US',
        placementId: 'chat_from_answer_v1',
      },
    })

    assert.equal(legacyEvaluate.status, 404)
    assert.equal(legacyEvaluate.payload?.error?.code, 'NOT_FOUND')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[v2-bid-api] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`)
  } finally {
    await stopGateway(gateway)
  }
})
