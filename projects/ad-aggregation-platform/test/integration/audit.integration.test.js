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
  const accountId = String(input.accountId || 'org_simulator')
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

test('control-plane audit records key lifecycle and config publish operations', async () => {
  const port = 4250 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'audit-owner@example.com',
      accountId: 'org_simulator',
      appId: 'sample-client-app',
    })

    const create = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
      method: 'POST',
      headers: {
        ...dashboardHeaders,
        'x-dashboard-actor': 'alice',
      },
      body: {
        appId: 'sample-client-app',
        environment: 'prod',
        name: 'ops-prod',
      },
    })
    assert.equal(create.status, 201, `create failed: ${JSON.stringify(create.payload)}`)
    const keyId = String(create.payload?.key?.keyId || '')
    assert.equal(Boolean(keyId), true, 'create should return keyId')

    const rotate = await requestJson(
      baseUrl,
      `/api/v1/public/credentials/keys/${encodeURIComponent(keyId)}/rotate`,
      {
        method: 'POST',
        headers: {
          ...dashboardHeaders,
          'x-dashboard-actor': 'bob',
        },
      },
    )
    assert.equal(rotate.ok, true, `rotate failed: ${JSON.stringify(rotate.payload)}`)

    const revoke = await requestJson(
      baseUrl,
      `/api/v1/public/credentials/keys/${encodeURIComponent(keyId)}/revoke`,
      {
        method: 'POST',
        headers: {
          ...dashboardHeaders,
          'x-dashboard-actor': 'bob',
        },
      },
    )
    assert.equal(revoke.ok, true, `revoke failed: ${JSON.stringify(revoke.payload)}`)

    const patch = await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_from_answer_v1', {
      method: 'PUT',
      headers: {
        ...dashboardHeaders,
        'x-dashboard-actor': 'publisher',
      },
      body: {
        enabled: false,
      },
    })
    assert.equal(patch.ok, true, `placement patch failed: ${JSON.stringify(patch.payload)}`)

    const list = await requestJson(baseUrl, '/api/v1/public/audit/logs?limit=20')
    assert.equal(list.ok, true, `audit list failed: ${JSON.stringify(list.payload)}`)
    const items = Array.isArray(list.payload?.items) ? list.payload.items : []
    assert.equal(items.length >= 4, true, 'audit logs should include key + config actions')

    const actions = new Set(items.map((row) => String(row?.action || '')))
    assert.equal(actions.has('key_create'), true)
    assert.equal(actions.has('key_rotate'), true)
    assert.equal(actions.has('key_revoke'), true)
    assert.equal(actions.has('config_publish'), true)

    const configRows = await requestJson(
      baseUrl,
      '/api/v1/public/audit/logs?action=config_publish&resourceType=placement&resourceId=chat_from_answer_v1',
    )
    assert.equal(configRows.ok, true, `config filter failed: ${JSON.stringify(configRows.payload)}`)
    const configItems = Array.isArray(configRows.payload?.items) ? configRows.payload.items : []
    assert.equal(configItems.length > 0, true, 'config publish audit should be queryable')
    assert.equal(configItems[0]?.actor, 'publisher')

    const actorRows = await requestJson(
      baseUrl,
      '/api/v1/dashboard/audit/logs?actor=bob&resourceType=api_key',
      { headers: dashboardHeaders },
    )
    assert.equal(actorRows.ok, true, `actor filter failed: ${JSON.stringify(actorRows.payload)}`)
    const actorItems = Array.isArray(actorRows.payload?.items) ? actorRows.payload.items : []
    assert.equal(actorItems.length > 0, true, 'actor filter should return rotate/revoke logs')
    assert.equal(
      actorItems.every((row) => String(row?.actor || '').toLowerCase() === 'bob'),
      true,
      'filtered rows must match actor=bob',
    )
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[control-plane-audit] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})

test('config publish audit is only written when placement config changed', async () => {
  const port = 4450 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)
    const dashboardHeaders = await registerDashboardHeaders(baseUrl, {
      email: 'audit-no-change@example.com',
      accountId: 'org_simulator',
      appId: 'sample-client-app',
    })

    const listPlacements = await requestJson(baseUrl, '/api/v1/dashboard/placements', {
      headers: dashboardHeaders,
    })
    assert.equal(listPlacements.ok, true, `placements list failed: ${JSON.stringify(listPlacements.payload)}`)
    const placements = Array.isArray(listPlacements.payload?.placements) ? listPlacements.payload.placements : []
    const target = placements.find((row) => row.placementId === 'chat_from_answer_v1')
    assert.equal(Boolean(target), true, 'chat_from_answer_v1 should exist')

    const noChangePatch = await requestJson(baseUrl, '/api/v1/dashboard/placements/chat_from_answer_v1', {
      method: 'PUT',
      headers: dashboardHeaders,
      body: {
        enabled: Boolean(target.enabled),
      },
    })
    assert.equal(noChangePatch.ok, true, `no-change patch failed: ${JSON.stringify(noChangePatch.payload)}`)
    assert.equal(noChangePatch.payload?.changed, false, 'no-change patch should not publish config')

    const configRows = await requestJson(
      baseUrl,
      '/api/v1/public/audit/logs?action=config_publish&resourceType=placement&resourceId=chat_from_answer_v1',
    )
    assert.equal(configRows.ok, true, `config filter failed: ${JSON.stringify(configRows.payload)}`)
    const configItems = Array.isArray(configRows.payload?.items) ? configRows.payload.items : []
    assert.equal(configItems.length, 0, 'no config publish audit should be written for unchanged patch')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[control-plane-audit-no-change] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
