import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
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

async function readGatewayState(baseUrl) {
  const health = await requestJson(baseUrl, '/api/health')
  assert.equal(health.ok, true, `health failed: ${JSON.stringify(health.payload)}`)
  const stateFile = String(health.payload?.stateFile || '').trim()
  assert.equal(Boolean(stateFile), true, 'health response should include stateFile')
  const raw = await fs.readFile(stateFile, 'utf-8')
  return JSON.parse(raw)
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

test('managed default: placement routing mode is fixed to managed_mediation', async () => {
  const port = 6250 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'managed-default-placement@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })

    const placements = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardHeaders,
    })
    assert.equal(placements.ok, true, `placements failed: ${JSON.stringify(placements.payload)}`)
    const items = Array.isArray(placements.payload?.placements) ? placements.payload.placements : []
    assert.equal(items.length > 0, true, 'default placements should exist')
    assert.equal(
      items.every((item) => String(item?.routingMode || '') === 'managed_mediation'),
      true,
      'all placements should default to managed_mediation',
    )

    const patch = await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_inline_v1', {
      method: 'PUT',
      headers: dashboardHeaders,
      body: {
        routingMode: 'provider_direct',
      },
    })
    assert.equal(patch.ok, true, `patch failed: ${JSON.stringify(patch.payload)}`)
    assert.equal(patch.payload?.changed, false, 'routing mode override should be ignored')
    assert.equal(String(patch.payload?.placement?.routingMode || ''), 'managed_mediation')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[managed-default-placement] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('managed default: new app environment is initialized with managed_mediation', async () => {
  const port = 6450 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)
    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'managed-default-env@example.com',
      accountId: 'org_simulator',
      appId: 'simulator-chatbot',
    })

    const createKey = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
      method: 'POST',
      headers: {
        ...dashboardHeaders,
        'x-dashboard-actor': 'routing-admin',
      },
      body: {
        appId: 'new_mvp_app',
        environment: 'prod',
        keyName: 'primary-prod',
      },
    })
    assert.equal(createKey.status, 201, `create key failed: ${JSON.stringify(createKey.payload)}`)

    const state = await readGatewayState(baseUrl)
    const envRows = Array.isArray(state?.controlPlane?.appEnvironments) ? state.controlPlane.appEnvironments : []
    const target = envRows.find((item) => (
      String(item?.appId || '') === 'new_mvp_app'
      && String(item?.environment || '') === 'prod'
    ))
    assert.equal(Boolean(target), true, 'new app prod environment should be created')
    assert.equal(String(target?.routingMode || ''), 'managed_mediation')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[managed-default-environment] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
