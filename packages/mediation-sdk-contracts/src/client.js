function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/$/, '')
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

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`
    const error = new Error(message)
    error.status = response.status
    error.payload = payload
    throw error
  }

  return payload
}

export function createRuntimeClient(config) {
  const baseUrl = ensureBaseUrl(config?.baseUrl)
  const runtimeKey = String(config?.runtimeKey || '').trim()

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
      })
    },
    evaluateBid(payload) {
      return requestJson(baseUrl, '/api/v2/bid', {
        method: 'POST',
        headers: authHeaders(),
        body: payload,
      })
    },
    sendEvents(payload) {
      return requestJson(baseUrl, '/api/v1/sdk/events', {
        method: 'POST',
        headers: authHeaders(),
        body: payload,
      })
    },
  }
}

export function createControlPlaneClient(config) {
  const baseUrl = ensureBaseUrl(config?.baseUrl)
  let dashboardToken = String(config?.dashboardToken || '').trim()

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
