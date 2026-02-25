const API_BASE_URL = (
  import.meta.env.VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL
  || import.meta.env.VITE_SIMULATOR_API_BASE_URL
  || '/api'
).replace(/\/$/, '')
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

function buildUrl(pathname, query) {
  const isAbsoluteBase = /^https?:\/\//i.test(API_BASE_URL)
  const url = isAbsoluteBase
    ? new URL(`${API_BASE_URL}${pathname}`)
    : new URL(`${API_BASE_URL}${pathname}`, 'http://localhost')

  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      url.searchParams.set(key, String(value))
    })
  }

  return isAbsoluteBase ? url.toString() : `${url.pathname}${url.search}`
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

  const response = await fetch(buildUrl(pathname, options.query), {
    method: options.method || 'GET',
    headers,
    body,
    signal: options.signal,
  })

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
