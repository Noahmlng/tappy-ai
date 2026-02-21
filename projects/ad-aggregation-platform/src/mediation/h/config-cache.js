export const H_CONFIG_CACHE_REASON_CODES = Object.freeze({
  HIT_FRESH: 'h_cfg_cache_hit_fresh',
  MISS: 'h_cfg_cache_miss',
  REVALIDATED_NOT_MODIFIED: 'h_cfg_cache_revalidated_not_modified',
  REVALIDATED_CHANGED: 'h_cfg_cache_revalidated_changed',
  STALE_GRACE_SERVED: 'h_cfg_cache_stale_grace_served',
  EXPIRED_REVALIDATE_FAILED: 'h_cfg_cache_expired_revalidate_failed',
  INVALID_ETAG_FORMAT: 'h_cfg_cache_invalid_etag_format'
})

export const H_CONFIG_CACHE_DECISIONS = Object.freeze({
  MISS: 'miss',
  REVALIDATED_NOT_MODIFIED: 'revalidated_not_modified',
  REVALIDATED_CHANGED: 'revalidated_changed',
  STALE_SERVED: 'stale_served'
})

const STRONG_ETAG_REGEX = /^"([^"]+)"$/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback
  }
  return numeric
}

function deriveVersionSnapshot(snapshot = {}) {
  const versions = isPlainObject(snapshot.appliedVersions) ? snapshot.appliedVersions : {}
  return {
    globalConfigVersion: String(versions.globalConfigVersion || 'global_cfg_na'),
    appConfigVersionOrNA: String(versions.appConfigVersionOrNA || 'NA'),
    placementSourceVersionOrNA: String(versions.placementSourceVersionOrNA || 'NA'),
    routingStrategyVersion: String(versions.routingStrategyVersion || 'routing_v_na'),
    placementConfigVersion: String(versions.placementConfigVersion || 'placement_cfg_na')
  }
}

function deriveTtlSec(snapshot = {}, defaultTtlSec = 120) {
  const ttl = snapshot?.effectiveConfig?.ttlSec
  return normalizePositiveInteger(ttl, defaultTtlSec)
}

function normalizeSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) {
    throw new Error('resolvedConfigSnapshot must be an object')
  }

  if (!String(snapshot.etag || '').trim()) {
    throw new Error('resolvedConfigSnapshot.etag is required')
  }

  if (!String(snapshot.configHash || '').trim()) {
    throw new Error('resolvedConfigSnapshot.configHash is required')
  }

  return snapshot
}

export function toStrongEtag(etag) {
  const normalized = String(etag || '').trim()
  return `"${normalized}"`
}

export function parseIfNoneMatch(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return { present: false, valid: true, etag: '' }
  }

  const match = raw.match(STRONG_ETAG_REGEX)
  if (!match) {
    return { present: true, valid: false, etag: '' }
  }

  const etag = String(match[1] || '').trim()
  if (!etag) {
    return { present: true, valid: false, etag: '' }
  }

  return { present: true, valid: true, etag }
}

export function buildConfigKey(request = {}) {
  const appId = String(request.appId || '').trim()
  const placementId = String(request.placementId || '').trim()
  const environment = String(request.environment || '').trim()
  const schemaVersion = String(request.schemaVersion || '').trim()
  return `${appId}|${placementId}|${environment}|${schemaVersion}`
}

export function createConfigCache(options = {}) {
  const defaultTtlSec = normalizePositiveInteger(options.defaultTtlSec, 120)
  const staleGraceWindowSec = normalizePositiveInteger(options.staleGraceWindowSec, 60)
  const store = new Map()

  function get(configKey) {
    return store.get(String(configKey))
  }

  function setFromSnapshot(configKey, snapshot, nowMs) {
    const normalizedKey = String(configKey)
    const safeSnapshot = normalizeSnapshot(snapshot)
    const ttlSec = deriveTtlSec(safeSnapshot, defaultTtlSec)
    const cachedAtMs = Number.isFinite(nowMs) ? nowMs : Date.now()
    const expireAtMs = cachedAtMs + ttlSec * 1000

    const entry = {
      configKey: normalizedKey,
      resolvedConfigSnapshot: safeSnapshot,
      etag: String(safeSnapshot.etag),
      ttlSec,
      cachedAtMs,
      expireAtMs,
      staleUntilMs: expireAtMs + staleGraceWindowSec * 1000,
      configVersionSnapshot: deriveVersionSnapshot(safeSnapshot)
    }

    store.set(normalizedKey, entry)
    return entry
  }

  function readState(configKey, nowMs) {
    const entry = get(configKey)
    if (!entry) {
      return {
        state: 'miss',
        entry: null
      }
    }

    if (nowMs < entry.expireAtMs) {
      return {
        state: 'fresh',
        entry
      }
    }

    if (nowMs <= entry.staleUntilMs) {
      return {
        state: 'stale_grace',
        entry
      }
    }

    return {
      state: 'expired_hard',
      entry
    }
  }

  return {
    defaultTtlSec,
    staleGraceWindowSec,
    get,
    setFromSnapshot,
    readState
  }
}
