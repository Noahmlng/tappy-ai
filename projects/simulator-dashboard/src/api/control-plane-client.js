const API_BASE_URL = (import.meta.env.VITE_SIMULATOR_API_BASE_URL || '/api').replace(/\/$/, '')

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
    getState() {
      return request('/v1/dashboard/state')
    },
    updatePlacement(placementId, patch) {
      return request(`/v1/dashboard/placements/${encodeURIComponent(placementId)}`, {
        method: 'PUT',
        body: patch || {},
      })
    },
  },
  credentials: {
    listKeys() {
      return request('/v1/public/credentials/keys')
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
  placements: {
    list() {
      return request('/v1/public/placements')
    },
    create(payload) {
      return request('/v1/public/placements', {
        method: 'POST',
        body: payload || {},
      })
    },
    update(placementId, payload) {
      return request(`/v1/public/placements/${encodeURIComponent(placementId)}`, {
        method: 'PUT',
        body: payload || {},
      })
    },
  },
}
