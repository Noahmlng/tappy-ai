function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/$/, '')
}

const REQUEST_TIMEOUT_MS_DEFAULT = 8_000
const REQUEST_TIMEOUT_MS_MIN = 100
const REQUEST_TIMEOUT_MS_MAX = 60_000
const REQUEST_MAX_RETRIES_DEFAULT = 2
const REQUEST_MAX_RETRIES_MIN = 0
const REQUEST_MAX_RETRIES_MAX = 5
const REQUEST_RETRY_BASE_DELAY_MS_DEFAULT = 250
const REQUEST_RETRY_BASE_DELAY_MS_MIN = 50
const REQUEST_RETRY_BASE_DELAY_MS_MAX = 5_000
const REQUEST_RETRY_MAX_DELAY_MS = 10_000

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

function toBoundedInteger(value, fallback, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  const rounded = Math.round(numeric)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

function normalizeRequestPolicy(input = {}) {
  const source = input && typeof input === 'object' ? input : {}
  return Object.freeze({
    timeoutMs: toBoundedInteger(
      source.timeoutMs,
      REQUEST_TIMEOUT_MS_DEFAULT,
      REQUEST_TIMEOUT_MS_MIN,
      REQUEST_TIMEOUT_MS_MAX,
    ),
    maxRetries: toBoundedInteger(
      source.maxRetries,
      REQUEST_MAX_RETRIES_DEFAULT,
      REQUEST_MAX_RETRIES_MIN,
      REQUEST_MAX_RETRIES_MAX,
    ),
    retryBaseDelayMs: toBoundedInteger(
      source.retryBaseDelayMs,
      REQUEST_RETRY_BASE_DELAY_MS_DEFAULT,
      REQUEST_RETRY_BASE_DELAY_MS_MIN,
      REQUEST_RETRY_BASE_DELAY_MS_MAX,
    ),
  })
}

function isAbortError(error) {
  return String(error?.name || '').trim() === 'AbortError'
}

function extractErrorCode(error) {
  const queue = [error]
  const seen = new Set()
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)
    const code = String(current.code || '').trim().toUpperCase()
    if (code) return code
    if (current.cause && typeof current.cause === 'object') {
      queue.push(current.cause)
    }
  }
  return ''
}

function isRetryableNetworkError(error) {
  if (isAbortError(error)) return true
  const code = extractErrorCode(error)
  if (code && RETRYABLE_NETWORK_ERROR_CODES.has(code)) return true
  const message = String(error?.message || '').toLowerCase()
  return message.includes('fetch failed') || message.includes('socket')
}

function computeRetryDelayMs(attempt, policy) {
  const exponent = Math.max(0, Number(attempt || 1) - 1)
  const backoff = policy.retryBaseDelayMs * (2 ** exponent)
  return Math.min(REQUEST_RETRY_MAX_DELAY_MS, backoff)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    throw new Error('[contracts] baseUrl is required')
  }
  return normalized
}

function appendQuery(path, query) {
  const entries = Object.entries(query || {}).filter(([, value]) => (
    value !== undefined && value !== null && value !== ''
  ))
  if (entries.length === 0) return path
  const params = new URLSearchParams()
  for (const [key, value] of entries) {
    params.set(key, String(value))
  }
  const suffix = params.toString()
  return suffix ? `${path}?${suffix}` : path
}

async function requestJson(baseUrl, path, options = {}) {
  const url = `${ensureBaseUrl(baseUrl)}${appendQuery(path, options.query)}`
  const headers = {
    ...(options.headers || {}),
  }

  let body = options.body
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(body)
  }

  const policy = normalizeRequestPolicy(options.requestPolicy)
  const totalAttempts = policy.maxRetries + 1
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs)

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (attempt < totalAttempts && RETRYABLE_HTTP_STATUS.has(response.status)) {
          await sleep(computeRetryDelayMs(attempt, policy))
          continue
        }

        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`
        const error = new Error(message)
        error.status = response.status
        error.payload = payload
        throw error
      }

      return payload
    } catch (error) {
      clearTimeout(timeout)
      if (attempt < totalAttempts && isRetryableNetworkError(error)) {
        await sleep(computeRetryDelayMs(attempt, policy))
        continue
      }
      throw error
    }
  }

  throw new Error('request failed')
}

export function createRuntimeClient(config) {
  const baseUrl = ensureBaseUrl(config?.baseUrl)
  const runtimeKey = String(config?.runtimeKey || '').trim()
  const requestPolicy = normalizeRequestPolicy(config?.requestPolicy)

  function authHeaders(extra = {}) {
    return runtimeKey
      ? { ...extra, Authorization: `Bearer ${runtimeKey}` }
      : extra
  }

  return {
    getMediationConfig(query = {}) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue
        params.set(key, String(value))
      }
      const suffix = params.toString() ? `?${params.toString()}` : ''
      return requestJson(baseUrl, `/api/v1/mediation/config${suffix}`, {
        headers: authHeaders(),
        requestPolicy,
      })
    },
    evaluateBid(payload) {
      return requestJson(baseUrl, '/api/v2/bid', {
        method: 'POST',
        headers: authHeaders(),
        body: payload,
        requestPolicy,
      })
    },
    sendEvents(payload) {
      return requestJson(baseUrl, '/api/v1/sdk/events', {
        method: 'POST',
        headers: authHeaders(),
        body: payload,
        requestPolicy,
      })
    },
  }
}

export function createControlPlaneClient(config) {
  const baseUrl = ensureBaseUrl(config?.baseUrl)
  let dashboardToken = String(config?.dashboardToken || '').trim()
  const requestPolicy = normalizeRequestPolicy(config?.requestPolicy)

  function authHeaders(extra = {}) {
    return dashboardToken
      ? { ...extra, Authorization: `Bearer ${dashboardToken}` }
      : extra
  }

  function setAccessToken(token) {
    dashboardToken = String(token || '').trim()
  }

  function request(path, options = {}) {
    return requestJson(baseUrl, `/api${path}`, {
      ...options,
      headers: authHeaders(options.headers || {}),
      requestPolicy: options.requestPolicy || requestPolicy,
    })
  }

  return {
    setAccessToken,
    health: {
      ping() {
        return request('/health')
      },
    },
    dashboard: {
      getState(query = {}) {
        return request('/v1/dashboard/state', { query })
      },
      getUsageRevenue(query = {}) {
        return request('/v1/dashboard/usage-revenue', { query })
      },
      updatePlacement(placementId, patch) {
        return request(`/v1/dashboard/placements/${encodeURIComponent(placementId)}`, {
          method: 'PUT',
          body: patch || {},
        })
      },
    },
    credentials: {
      listKeys(query = {}) {
        return request('/v1/public/credentials/keys', { query })
      },
      createKey(payload = {}) {
        return request('/v1/public/credentials/keys', {
          method: 'POST',
          body: payload,
        })
      },
      rotateKey(keyId) {
        return request(`/v1/public/credentials/keys/${encodeURIComponent(keyId)}/rotate`, {
          method: 'POST',
        })
      },
      revokeKey(keyId) {
        return request(`/v1/public/credentials/keys/${encodeURIComponent(keyId)}/revoke`, {
          method: 'POST',
        })
      },
    },
    quickStart: {
      verify(payload = {}) {
        return request('/v1/public/quick-start/verify', {
          method: 'POST',
          body: payload,
        })
      },
    },
    auth: {
      register(payload = {}) {
        return request('/v1/public/dashboard/register', {
          method: 'POST',
          body: payload,
        })
      },
      login(payload = {}) {
        return request('/v1/public/dashboard/login', {
          method: 'POST',
          body: payload,
        })
      },
      me(query = {}) {
        return request('/v1/public/dashboard/me', { query })
      },
      logout() {
        return request('/v1/public/dashboard/logout', {
          method: 'POST',
        })
      },
    },
    agent: {
      issueIntegrationToken(payload = {}) {
        return request('/v1/public/agent/integration-token', {
          method: 'POST',
          body: payload,
        })
      },
      exchangeIntegrationToken(payload = {}) {
        return request('/v1/public/agent/token-exchange', {
          method: 'POST',
          body: payload,
        })
      },
    },
    placements: {
      list(query = {}) {
        return request('/v1/dashboard/placements', { query })
      },
      create(payload = {}) {
        return request('/v1/dashboard/placements', {
          method: 'POST',
          body: payload,
        })
      },
      update(placementId, payload = {}) {
        return request(`/v1/dashboard/placements/${encodeURIComponent(placementId)}`, {
          method: 'PUT',
          body: payload,
        })
      },
    },
  }
}
