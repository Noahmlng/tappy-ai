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

test('public key api supports create/list/rotate/revoke lifecycle', async () => {
  const port = 3650 + Math.floor(Math.random() * 200)
  const baseUrl = `http://${HOST}:${port}`
  const gateway = startGateway(port)

  try {
    await waitForGateway(baseUrl)

    const reset = await requestJson(baseUrl, '/api/v1/dev/reset', { method: 'POST' })
    assert.equal(reset.ok, true, `reset failed: ${JSON.stringify(reset.payload)}`)

    const listBefore = await requestJson(baseUrl, '/api/v1/public/credentials/keys')
    assert.equal(listBefore.ok, true, `list before create failed: ${JSON.stringify(listBefore.payload)}`)
    assert.equal(Array.isArray(listBefore.payload?.keys), true)

    const create = await requestJson(baseUrl, '/api/v1/public/credentials/keys', {
      method: 'POST',
      body: {
        appId: 'simulator-chatbot',
        name: 'primary-prod',
        environment: 'prod',
      },
    })
    assert.equal(create.status, 201, `create failed: ${JSON.stringify(create.payload)}`)
    assert.equal(typeof create.payload?.secret, 'string')
    assert.match(create.payload.secret, /^sk_prod_[a-z0-9]+$/)

    const createdKey = create.payload?.key || {}
    const keyId = String(createdKey.keyId || '')
    assert.equal(Boolean(keyId), true, 'create should return keyId')
    assert.equal(createdKey.name, 'primary-prod')
    assert.equal(createdKey.environment, 'prod')
    assert.equal(createdKey.status, 'active')
    assert.equal(typeof createdKey.maskedKey, 'string')
    const createdMaskedKey = createdKey.maskedKey

    const listAfterCreate = await requestJson(baseUrl, '/api/v1/public/credentials/keys?environment=prod')
    assert.equal(listAfterCreate.ok, true, `list after create failed: ${JSON.stringify(listAfterCreate.payload)}`)
    const createdListRow = (listAfterCreate.payload?.keys || []).find((row) => row.keyId === keyId)
    assert.equal(Boolean(createdListRow), true, 'created key should appear in list')

    const rotate = await requestJson(
      baseUrl,
      `/api/v1/public/credentials/keys/${encodeURIComponent(keyId)}/rotate`,
      { method: 'POST' },
    )
    assert.equal(rotate.ok, true, `rotate failed: ${JSON.stringify(rotate.payload)}`)
    assert.equal(rotate.payload?.key?.keyId, keyId)
    assert.equal(rotate.payload?.key?.status, 'active')
    assert.equal(typeof rotate.payload?.secret, 'string')
    assert.match(rotate.payload.secret, /^sk_prod_[a-z0-9]+$/)
    assert.notEqual(rotate.payload?.key?.maskedKey, createdMaskedKey)

    const revoke = await requestJson(
      baseUrl,
      `/api/v1/public/credentials/keys/${encodeURIComponent(keyId)}/revoke`,
      { method: 'POST' },
    )
    assert.equal(revoke.ok, true, `revoke failed: ${JSON.stringify(revoke.payload)}`)
    assert.equal(revoke.payload?.key?.keyId, keyId)
    assert.equal(revoke.payload?.key?.status, 'revoked')

    const listRevoked = await requestJson(baseUrl, '/api/v1/public/credentials/keys?status=revoked')
    assert.equal(listRevoked.ok, true, `list revoked failed: ${JSON.stringify(listRevoked.payload)}`)
    const revokedRow = (listRevoked.payload?.keys || []).find((row) => row.keyId === keyId)
    assert.equal(Boolean(revokedRow), true, 'revoked key should appear in revoked list')
    assert.equal(revokedRow.status, 'revoked')

    const rotateMissing = await requestJson(
      baseUrl,
      '/api/v1/public/credentials/keys/key_not_found/rotate',
      { method: 'POST' },
    )
    assert.equal(rotateMissing.status, 404)
    assert.equal(rotateMissing.payload?.error?.code, 'KEY_NOT_FOUND')
  } catch (error) {
    const logs = gateway.getLogs()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[public-key-api] ${message}\n[gateway stdout]\n${logs.stdout}\n[gateway stderr]\n${logs.stderr}`,
    )
  } finally {
    await stopGateway(gateway)
  }
})
