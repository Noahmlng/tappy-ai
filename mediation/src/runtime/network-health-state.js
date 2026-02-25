const networkHealthStore = new Map()

const DEFAULT_HEALTH_STATE = {
  network: '',
  status: 'healthy',
  consecutiveFailures: 0,
  lastSuccessAt: '',
  lastFailureAt: '',
  lastErrorCode: '',
  lastErrorMessage: '',
  cooldownUntil: 0,
  lastHealthCheckAt: 0
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function ensureNetworkState(network) {
  const key = String(network || '').trim().toLowerCase()
  if (!key) {
    throw new Error('[runtime-health] network is required')
  }

  if (!networkHealthStore.has(key)) {
    networkHealthStore.set(key, {
      ...DEFAULT_HEALTH_STATE,
      network: key
    })
  }

  return networkHealthStore.get(key)
}

function normalizeHealthPolicy(policy = {}) {
  const failureThreshold =
    Number.isInteger(policy.failureThreshold) && policy.failureThreshold > 0 ? policy.failureThreshold : 2
  const circuitOpenMs =
    Number.isInteger(policy.circuitOpenMs) && policy.circuitOpenMs > 0 ? policy.circuitOpenMs : 30000
  const healthCheckIntervalMs =
    Number.isInteger(policy.healthCheckIntervalMs) && policy.healthCheckIntervalMs > 0
      ? policy.healthCheckIntervalMs
      : 10000

  return {
    failureThreshold,
    circuitOpenMs,
    healthCheckIntervalMs
  }
}

function getNetworkHealth(network) {
  const state = ensureNetworkState(network)
  return clone(state)
}

function getAllNetworkHealth() {
  const output = {}
  for (const [network, state] of networkHealthStore.entries()) {
    output[network] = clone(state)
  }
  return output
}

function shouldSkipNetworkFetch(network, policy = {}) {
  const state = ensureNetworkState(network)
  const now = Date.now()
  if (state.status !== 'open') {
    return { skip: false, reason: null, retryAfterMs: 0, state: clone(state) }
  }

  if (state.cooldownUntil > now) {
    return {
      skip: true,
      reason: 'circuit_open',
      retryAfterMs: state.cooldownUntil - now,
      state: clone(state)
    }
  }

  // Cooldown ended, allow probing/retry.
  return { skip: false, reason: 'cooldown_elapsed', retryAfterMs: 0, state: clone(state) }
}

function shouldRunHealthCheck(network, policy = {}) {
  const state = ensureNetworkState(network)
  const healthPolicy = normalizeHealthPolicy(policy)
  const now = Date.now()

  if (state.status !== 'open') return false
  if (state.cooldownUntil > now) return false
  if (state.lastHealthCheckAt && now - state.lastHealthCheckAt < healthPolicy.healthCheckIntervalMs) {
    return false
  }
  return true
}

function recordNetworkSuccess(network) {
  const state = ensureNetworkState(network)
  const nowIso = new Date().toISOString()

  state.status = 'healthy'
  state.consecutiveFailures = 0
  state.lastSuccessAt = nowIso
  state.lastErrorCode = ''
  state.lastErrorMessage = ''
  state.cooldownUntil = 0
}

function recordNetworkFailure(network, error, policy = {}) {
  const state = ensureNetworkState(network)
  const healthPolicy = normalizeHealthPolicy(policy)
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  state.consecutiveFailures += 1
  state.lastFailureAt = nowIso
  state.lastErrorCode = String(error?.errorCode || 'UNKNOWN')
  state.lastErrorMessage = String(error?.message || 'Unknown error')
  state.lastHealthCheckAt = now

  if (state.consecutiveFailures >= healthPolicy.failureThreshold) {
    state.status = 'open'
    state.cooldownUntil = now + healthPolicy.circuitOpenMs
  } else {
    state.status = 'degraded'
  }
}

function recordHealthCheckResult(network, result, policy = {}) {
  const state = ensureNetworkState(network)
  const now = Date.now()
  state.lastHealthCheckAt = now

  if (result?.ok) {
    recordNetworkSuccess(network)
    return
  }

  recordNetworkFailure(
    network,
    {
      errorCode: result?.errorCode || 'HEALTHCHECK_FAILED',
      message: result?.message || 'Health check failed'
    },
    policy
  )
}

function clearNetworkHealthState() {
  networkHealthStore.clear()
}

export {
  clearNetworkHealthState,
  getAllNetworkHealth,
  getNetworkHealth,
  normalizeHealthPolicy,
  recordHealthCheckResult,
  recordNetworkFailure,
  recordNetworkSuccess,
  shouldRunHealthCheck,
  shouldSkipNetworkFetch
}
