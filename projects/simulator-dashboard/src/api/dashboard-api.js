const API_BASE_URL = (import.meta.env.VITE_SIMULATOR_API_BASE_URL || '/api').replace(/\/$/, '')

async function request(pathname, options = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = data?.error?.message || `Request failed: ${response.status}`
    throw new Error(message)
  }

  return data
}

export async function fetchDashboardState() {
  return request('/v1/dashboard/state')
}

export async function updateDashboardPlacement(placementId, patch) {
  return request(`/v1/dashboard/placements/${encodeURIComponent(placementId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch || {}),
  })
}

export async function pingGatewayHealth() {
  return request('/health')
}
