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
  const raw = Number(process.env.MEDIATION_TEST_HEALTH_TIMEOUT_MS || 45000)
  if (!Number.isFinite(raw) || raw <= 0) return 45000
  return Math.floor(raw)
})()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeoutSignal(timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const timeout = withTimeoutSignal(options.timeoutMs || 10000)
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
      SUPABASE_DB_URL: process.env.SUPABASE_DB_URL_TEST || process.env.SUPABASE_DB_URL || '',
      MEDIATION_ALLOWED_ORIGINS: 'http://127.0.0.1:3000',
      MEDIATION_ENABLE_LOCAL_SERVER: 'true',
      MEDIATION_GATEWAY_HOST: HOST,
      MEDIATION_GATEWAY_PORT: String(port),
      OPENROUTER_API_KEY: '',
      OPENROUTER_MODEL: 'glm-5',
      CJ_TOKEN: 'mock-cj-token',
      PARTNERSTACK_API_KEY: 'mock-partnerstack-key',
      CPC_SEMANTICS: 'on',
      BUDGET_ENFORCEMENT: 'on',
      RISK_ENFORCEMENT: 'on',
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
  const register = await requestJson(baseUrl, '/api/v1/public/dashboard/register', {
    method: 'POST',
    body: {
      email: input.email,
      password: 'pass12345',
      accountId: input.accountId,
      appId: input.appId,
    },
  })
  assert.equal(register.status, 201, JSON.stringify(register.payload))
  return {
    Authorization: `Bearer ${String(register.payload?.session?.accessToken || '')}`,
  }
}

test('dashboard budget+risk APIs: budget upsert/list and risk rule update', async () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const scopedAccountId = `org_budget_${suffix}`
  const scopedAppId = `app_budget_${suffix}`
  const port = 4180 + Math.floor(Math.random() * 120)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const headers = await registerDashboardHeaders(baseUrl, {
      email: `budget_owner_${suffix}@example.com`,
      accountId: scopedAccountId,
      appId: scopedAppId,
    })

    const campaignId = `cmp_test_${suffix}`
    const upsert = await requestJson(baseUrl, '/api/v1/dashboard/campaign-budgets', {
      method: 'POST',
      headers,
      body: {
        campaignId,
        appId: scopedAppId,
        accountId: scopedAccountId,
        dailyBudgetUsd: 35,
        lifetimeBudgetUsd: 300,
      },
    })
    assert.equal(upsert.status, 200, JSON.stringify(upsert.payload))
    assert.equal(String(upsert.payload?.campaignId || ''), campaignId)
    assert.equal(Number(upsert.payload?.dailyBudgetUsd || 0), 35)
    assert.equal(Number(upsert.payload?.lifetimeBudgetUsd || 0), 300)

    const list = await requestJson(baseUrl, `/api/v1/dashboard/campaign-budgets?campaignId=${encodeURIComponent(campaignId)}`, {
      headers,
    })
    assert.equal(list.status, 200, JSON.stringify(list.payload))
    const rows = Array.isArray(list.payload?.items) ? list.payload.items : []
    assert.equal(rows.length >= 1, true)
    assert.equal(String(rows[0]?.campaignId || ''), campaignId)

    const riskConfigBefore = await requestJson(baseUrl, '/api/v1/dashboard/risk/config', { headers })
    assert.equal(riskConfigBefore.status, 200, JSON.stringify(riskConfigBefore.payload))
    assert.equal(typeof riskConfigBefore.payload?.rules?.clickBurstLimit, 'number')

    const riskUpdate = await requestJson(baseUrl, '/api/v1/dashboard/risk/config', {
      method: 'PUT',
      headers,
      body: {
        clickBurstLimit: 9,
        ctrWarnThreshold: 0.22,
      },
    })
    assert.equal(riskUpdate.status, 200, JSON.stringify(riskUpdate.payload))
    assert.equal(Number(riskUpdate.payload?.rules?.clickBurstLimit || 0), 9)
    assert.equal(Number(riskUpdate.payload?.rules?.ctrWarnThreshold || 0), 0.22)
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[budget-risk-control] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
