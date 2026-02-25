const API_PROXY_BASE_URL = '/api'
const API_BASE_URL = String(
  import.meta.env.VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL
  || API_PROXY_BASE_URL,
).trim().replace(/\/$/, '')
let dashboardAccessToken = ''

export function setDashboardAccessToken(token) {
  dashboardAccessToken = String(token || '').trim()
}

export function getDashboardAccessToken() {
  return dashboardAccessToken
}

export class ControlPlaneApiError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ControlPlaneApiError'
    this.status = Number(details.status || 0)
    this.code = String(details.code || '')
    this.details = details.details || null
  }
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function isLikelyNetworkError(error) {
  if (error instanceof TypeError) return true
  const message = String(error instanceof Error ? error.message : error || '').toLowerCase()
  return message.includes('failed to fetch') || message.includes('networkerror')
}

function createNetworkError(error, details = {}) {
  return new ControlPlaneApiError(
    'Failed to reach dashboard API. Check HTTPS/CORS or configure same-origin /api proxy.',
    {
      status: 0,
      code: 'NETWORK_ERROR',
      details: {
        ...details,
        cause: error instanceof Error ? error.message : String(error || ''),
      },
    },
  )
}

function buildUrl(baseUrl, pathname, query) {
  const normalizedBaseUrl = String(baseUrl || API_PROXY_BASE_URL)
  const isAbsoluteBase = isAbsoluteHttpUrl(normalizedBaseUrl)
  const url = isAbsoluteBase
    ? new URL(`${normalizedBaseUrl}${pathname}`)
    : new URL(`${normalizedBaseUrl}${pathname}`, 'http://localhost')

  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      url.searchParams.set(key, String(value))
    })
  }

  return isAbsoluteBase ? url.toString() : `${url.pathname}${url.search}`
}

async function fetchWithProxyFallback(pathname, requestOptions = {}, query) {
  try {
    return await fetch(buildUrl(API_BASE_URL, pathname, query), requestOptions)
  } catch (error) {
    const shouldRetryViaProxy = (
      API_BASE_URL !== API_PROXY_BASE_URL
      && isAbsoluteHttpUrl(API_BASE_URL)
      && isLikelyNetworkError(error)
    )
    if (!shouldRetryViaProxy) {
      throw createNetworkError(error, {
        apiBaseUrl: API_BASE_URL,
        pathname,
      })
    }

    try {
      return await fetch(buildUrl(API_PROXY_BASE_URL, pathname, query), requestOptions)
    } catch (fallbackError) {
      throw createNetworkError(fallbackError, {
        apiBaseUrl: API_BASE_URL,
        fallbackBaseUrl: API_PROXY_BASE_URL,
        pathname,
      })
    }
  }
}

async function request(pathname, options = {}) {
  const headers = {
    ...(options.headers || {}),
  }
  if (!headers.Authorization && dashboardAccessToken) {
    headers.Authorization = `Bearer ${dashboardAccessToken}`
  }

  let body = options.body
  const isJsonBody = body && typeof body === 'object' && !(body instanceof FormData)
  if (isJsonBody) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(body)
  }

  const response = await fetchWithProxyFallback(pathname, {
    method: options.method || 'GET',
    headers,
    body,
    signal: options.signal,
  }, options.query)

  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  const isJson = contentType.includes('application/json')

  let payload = null
  if (response.status !== 204) {
    payload = isJson
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '')
  }

  if (!response.ok) {
    const message = isJson
      ? payload?.error?.message || payload?.message || `Request failed: ${response.status}`
      : `Request failed: ${response.status}`

    throw new ControlPlaneApiError(message, {
      status: response.status,
      code: isJson ? (payload?.error?.code || payload?.code || '') : '',
      details: payload,
    })
  }

  return payload || {}
}

export const controlPlaneClient = {
  health: {
    ping() {
      return request('/health')
    },
  },
  dashboard: {
    getState(query) {
      return request('/v1/dashboard/state', { query: query || {} })
    },
    getUsageRevenue(query) {
      return request('/v1/dashboard/usage-revenue', { query: query || {} })
    },
    updatePlacement(placementId, patch) {
      return request(`/v1/dashboard/placements/${encodeURIComponent(placementId)}`, {
        method: 'PUT',
        body: patch || {},
      })
    },
  },
  credentials: {
    listKeys(query) {
      return request('/v1/public/credentials/keys', {
        query: query || {},
      })
    },
    createKey(payload) {
      return request('/v1/public/credentials/keys', {
        method: 'POST',
        body: payload || {},
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
    verify(payload) {
      return request('/v1/public/quick-start/verify', {
        method: 'POST',
        body: payload || {},
      })
    },
  },
  auth: {
    register(payload) {
      return request('/v1/public/dashboard/register', {
        method: 'POST',
        body: payload || {},
      })
    },
    login(payload) {
      return request('/v1/public/dashboard/login', {
        method: 'POST',
        body: payload || {},
      })
    },
    me(query) {
      return request('/v1/public/dashboard/me', {
        query: query || {},
      })
    },
    logout() {
      return request('/v1/public/dashboard/logout', {
        method: 'POST',
      })
    },
  },
  agent: {
    issueIntegrationToken(payload) {
      return request('/v1/public/agent/integration-token', {
        method: 'POST',
        body: payload || {},
      })
    },
    exchangeIntegrationToken(payload) {
      return request('/v1/public/agent/token-exchange', {
        method: 'POST',
        body: payload || {},
      })
    },
  },
  placements: {
    list(query) {
      return request('/v1/dashboard/placements', {
        query: query || {},
      })
    },
    create(payload) {
      return request('/v1/dashboard/placements', {
        method: 'POST',
        body: payload || {},
      })
    },
    update(placementId, payload) {
      return request(`/v1/dashboard/placements/${encodeURIComponent(placementId)}`, {
        method: 'PUT',
        body: payload || {},
      })
    },
  },
}
