function normalizeBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/$/, '')
  if (!normalized) {
    throw new Error('[contracts] baseUrl is required')
  }
  return normalized
}

async function requestJson(baseUrl, path, options = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`
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
  const baseUrl = normalizeBaseUrl(config?.baseUrl)
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
  const baseUrl = normalizeBaseUrl(config?.baseUrl)
  const dashboardToken = String(config?.dashboardToken || '').trim()

  function authHeaders(extra = {}) {
    return dashboardToken
      ? { ...extra, Authorization: `Bearer ${dashboardToken}` }
      : extra
  }

  return {
    getDashboardState(query = {}) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue
        params.set(key, String(value))
      }
      const suffix = params.toString() ? `?${params.toString()}` : ''
      return requestJson(baseUrl, `/api/v1/dashboard/state${suffix}`, {
        headers: authHeaders(),
      })
    },
    login(payload) {
      return requestJson(baseUrl, '/api/v1/public/dashboard/login', {
        method: 'POST',
        headers: authHeaders(),
        body: payload,
      })
    },
    createKey(payload) {
      return requestJson(baseUrl, '/api/v1/public/credentials/keys', {
        method: 'POST',
        headers: authHeaders(),
        body: payload,
      })
    },
  }
}
