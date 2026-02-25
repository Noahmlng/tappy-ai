import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 12000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeoutSignal(timeoutMs = 5000) {
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

async function waitForGateway(baseUrl, expectedRole) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const health = await requestJson(baseUrl, '/api/health', { timeoutMs: 1200 })
      if (health.ok && health.payload?.ok === true && health.payload?.apiServiceRole === expectedRole) {
        return health.payload
      }
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`gateway health check timeout after ${HEALTH_TIMEOUT_MS}ms`)
}

async function startHandlerServer(port, type) {
  process.env.SUPABASE_DB_URL = process.env.SUPABASE_DB_URL_TEST || process.env.SUPABASE_DB_URL || ''
  process.env.MEDIATION_ALLOWED_ORIGINS = process.env.MEDIATION_ALLOWED_ORIGINS || 'http://127.0.0.1:3000'
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
  process.env.OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'glm-5'
  process.env.CJ_TOKEN = process.env.CJ_TOKEN || 'mock-cj-token'
  process.env.PARTNERSTACK_API_KEY = process.env.PARTNERSTACK_API_KEY || 'mock-partnerstack-key'

  const modulePath = type === 'runtime'
    ? path.join(PROJECT_ROOT, '..', 'apps', 'runtime-api', 'api', 'index.js')
    : path.join(PROJECT_ROOT, '..', 'apps', 'control-plane-api', 'api', 'index.js')
  const moduleUrl = `${pathToFileURL(modulePath).href}?t=${Date.now()}_${Math.random().toString(36).slice(2)}`
  const mod = await import(moduleUrl)
  const handler = mod.default
  if (typeof handler !== 'function') {
    throw new Error(`Invalid handler export for ${type}: default export is not a function`)
  }

  const server = http.createServer((req, res) => {
    void handler(req, res)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, HOST, () => resolve())
  })

  return {
    async close() {
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

test('runtime service role only exposes runtime routes', async () => {
  const port = 4520 + Math.floor(Math.random() * 120)
  const baseUrl = `http://${HOST}:${port}`
  const server = await startHandlerServer(port, 'runtime')

  try {
    const health = await waitForGateway(baseUrl, 'runtime')
    assert.equal(health.apiServiceRole, 'runtime')

    const bid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      body: {
        userId: 'runtime_role_user',
        chatId: 'runtime_role_chat',
        placementId: 'chat_from_answer_v1',
        messages: [
          { role: 'user', content: 'recommend travel backpack' },
          { role: 'assistant', content: 'prefer lightweight and waterproof' },
        ],
      },
      timeoutMs: 12000,
    })
    assert.equal([200, 401].includes(bid.status), true)

    const login = await requestJson(baseUrl, '/api/v1/public/dashboard/login', {
      method: 'POST',
      body: {
        email: 'runtime-role@example.com',
        password: 'not-used',
      },
    })
    assert.equal(login.status, 404)
  } finally {
    await server.close()
  }
})

test('control-plane service role only exposes control-plane routes', async () => {
  const port = 4640 + Math.floor(Math.random() * 120)
  const baseUrl = `http://${HOST}:${port}`
  const server = await startHandlerServer(port, 'control_plane')

  try {
    const health = await waitForGateway(baseUrl, 'control_plane')
    assert.equal(health.apiServiceRole, 'control_plane')

    const audits = await requestJson(baseUrl, '/api/v1/public/audit/logs')
    assert.equal(audits.status, 200)
    assert.equal(Array.isArray(audits.payload?.items), true)

    const bid = await requestJson(baseUrl, '/api/v2/bid', {
      method: 'POST',
      body: {
        userId: 'cp_role_user',
        chatId: 'cp_role_chat',
        placementId: 'chat_from_answer_v1',
        messages: [
          { role: 'user', content: 'recommend running shoes' },
          { role: 'assistant', content: 'focus on stability and grip' },
        ],
      },
      timeoutMs: 12000,
    })
    assert.equal(bid.status, 404)
  } finally {
    await server.close()
  }
})
