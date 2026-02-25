import { H_CONFIG_RESOLUTION_REASON_CODES } from '../config-governance/config-resolution.js'
import {
  H_CONFIG_CACHE_DECISIONS,
  H_CONFIG_CACHE_REASON_CODES,
  buildConfigKey,
  createConfigCache,
  parseIfNoneMatch,
  toStrongEtag
} from '../config-governance/config-cache.js'

const GET_CONFIG_REQUIRED_FIELDS = Object.freeze([
  'appId',
  'placementId',
  'environment',
  'schemaVersion',
  'sdkVersion',
  'requestAt'
])

const ALLOWED_ENVIRONMENTS = new Set(['prod'])

function nowIso(nowMs) {
  return new Date(nowMs).toISOString()
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeRequest(input = {}) {
  const request = isPlainObject(input) ? input : {}
  return {
    appId: String(request.appId || '').trim(),
    placementId: String(request.placementId || '').trim(),
    environment: String(request.environment || '').trim().toLowerCase(),
    schemaVersion: String(request.schemaVersion || '').trim(),
    sdkVersion: String(request.sdkVersion || '').trim(),
    requestAt: String(request.requestAt || '').trim(),
    ifNoneMatch: String(request.ifNoneMatch || request.headers?.ifNoneMatch || request.headers?.['if-none-match'] || '').trim(),
    adapterVersionMapOrNA: isPlainObject(request.adapterVersionMapOrNA) ? clone(request.adapterVersionMapOrNA) : undefined,
    expectedConfigVersionOrNA: String(request.expectedConfigVersionOrNA || '').trim(),
    traceKeyOrNA: String(request.traceKeyOrNA || '').trim(),
    extensions: isPlainObject(request.extensions) ? clone(request.extensions) : undefined
  }
}

function validateRequest(request) {
  const missing = GET_CONFIG_REQUIRED_FIELDS.filter((field) => !request[field])
  if (missing.length > 0) {
    return {
      ok: false,
      reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.MISSING_REQUIRED_AFTER_MERGE,
      message: `missing required fields: ${missing.join(', ')}`
    }
  }

  if (!ALLOWED_ENVIRONMENTS.has(request.environment)) {
    return {
      ok: false,
      reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_RANGE,
      message: 'environment must be prod'
    }
  }

  return { ok: true }
}

function makeHeaders(entry) {
  return {
    ETag: toStrongEtag(entry.etag),
    'Cache-Control': `max-age=${entry.ttlSec}`
  }
}

function buildOkBody({ entry, cacheDecision, reasonCodes, responseAt, contractVersion }) {
  return {
    status: 'ok',
    configKey: entry.configKey,
    etag: entry.etag,
    ttlSec: entry.ttlSec,
    expireAt: nowIso(entry.expireAtMs),
    resolvedConfigSnapshot: clone(entry.resolvedConfigSnapshot),
    configVersionSnapshot: clone(entry.configVersionSnapshot),
    cacheDecision,
    reasonCodes: [...reasonCodes],
    responseAt,
    getConfigContractVersion: contractVersion
  }
}

function buildErrorResponse({ statusCode, reasonCode, message, responseAt, contractVersion }) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      status: 'error',
      reasonCode,
      message,
      responseAt,
      getConfigContractVersion: contractVersion
    }
  }
}

export function createConfigController(options = {}) {
  const cache = options.cache || createConfigCache({
    staleGraceWindowSec: options.staleGraceWindowSec,
    defaultTtlSec: options.defaultTtlSec
  })
  const resolveLatestConfigSnapshot = options.resolveLatestConfigSnapshot
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const getConfigContractVersion = String(options.getConfigContractVersion || 'h_get_config_v1')

  if (typeof resolveLatestConfigSnapshot !== 'function') {
    throw new Error('resolveLatestConfigSnapshot function is required')
  }

  async function refreshEntry(configKey, request, nowMs) {
    const resolvedConfigSnapshot = await resolveLatestConfigSnapshot({
      appId: request.appId,
      placementId: request.placementId,
      environment: request.environment,
      schemaVersion: request.schemaVersion,
      sdkVersion: request.sdkVersion,
      requestAt: request.requestAt,
      adapterVersionMapOrNA: request.adapterVersionMapOrNA,
      expectedConfigVersionOrNA: request.expectedConfigVersionOrNA,
      traceKeyOrNA: request.traceKeyOrNA,
      extensions: request.extensions
    })

    return cache.setFromSnapshot(configKey, resolvedConfigSnapshot, nowMs)
  }

  async function handleGetConfig(input) {
    const request = normalizeRequest(input)
    const requestValidation = validateRequest(request)
    const nowMs = nowFn()
    const responseAt = nowIso(nowMs)

    if (!requestValidation.ok) {
      return buildErrorResponse({
        statusCode: 400,
        reasonCode: requestValidation.reasonCode,
        message: requestValidation.message,
        responseAt,
        contractVersion: getConfigContractVersion
      })
    }

    const configKey = buildConfigKey(request)
    const etagCheck = parseIfNoneMatch(request.ifNoneMatch)
    const baseReasonCodes = []
    if (etagCheck.present && !etagCheck.valid) {
      baseReasonCodes.push(H_CONFIG_CACHE_REASON_CODES.INVALID_ETAG_FORMAT)
    }

    const cacheState = cache.readState(configKey, nowMs)
    const cachedEntry = cacheState.entry

    if (cacheState.state === 'fresh') {
      if (etagCheck.valid && etagCheck.present && etagCheck.etag === cachedEntry.etag) {
        return {
          statusCode: 304,
          headers: makeHeaders(cachedEntry),
          body: null
        }
      }

      return {
        statusCode: 200,
        headers: {
          ...makeHeaders(cachedEntry),
          'Content-Type': 'application/json'
        },
        body: buildOkBody({
          entry: cachedEntry,
          cacheDecision: H_CONFIG_CACHE_DECISIONS.REVALIDATED_NOT_MODIFIED,
          reasonCodes: [...baseReasonCodes, H_CONFIG_CACHE_REASON_CODES.HIT_FRESH],
          responseAt,
          contractVersion: getConfigContractVersion
        })
      }
    }

    try {
      const previousEtag = cachedEntry?.etag || ''
      const refreshedEntry = await refreshEntry(configKey, request, nowMs)
      const changed = previousEtag !== refreshedEntry.etag
      const revalidateReason = changed
        ? H_CONFIG_CACHE_REASON_CODES.REVALIDATED_CHANGED
        : H_CONFIG_CACHE_REASON_CODES.REVALIDATED_NOT_MODIFIED
      const cacheDecision = !cachedEntry
        ? H_CONFIG_CACHE_DECISIONS.MISS
        : changed
          ? H_CONFIG_CACHE_DECISIONS.REVALIDATED_CHANGED
          : H_CONFIG_CACHE_DECISIONS.REVALIDATED_NOT_MODIFIED

      if (
        etagCheck.valid &&
        etagCheck.present &&
        etagCheck.etag === refreshedEntry.etag
      ) {
        return {
          statusCode: 304,
          headers: makeHeaders(refreshedEntry),
          body: null
        }
      }

      return {
        statusCode: 200,
        headers: {
          ...makeHeaders(refreshedEntry),
          'Content-Type': 'application/json'
        },
        body: buildOkBody({
          entry: refreshedEntry,
          cacheDecision,
          reasonCodes: !cachedEntry
            ? [...baseReasonCodes, H_CONFIG_CACHE_REASON_CODES.MISS]
            : [...baseReasonCodes, revalidateReason],
          responseAt,
          contractVersion: getConfigContractVersion
        })
      }
    } catch (error) {
      if (cacheState.state === 'stale_grace' && cachedEntry) {
        return {
          statusCode: 200,
          headers: {
            ...makeHeaders(cachedEntry),
            'Content-Type': 'application/json'
          },
          body: buildOkBody({
            entry: cachedEntry,
            cacheDecision: H_CONFIG_CACHE_DECISIONS.STALE_SERVED,
            reasonCodes: [...baseReasonCodes, H_CONFIG_CACHE_REASON_CODES.STALE_GRACE_SERVED],
            responseAt,
            contractVersion: getConfigContractVersion
          })
        }
      }

      return buildErrorResponse({
        statusCode: 503,
        reasonCode: H_CONFIG_CACHE_REASON_CODES.EXPIRED_REVALIDATE_FAILED,
        message: error instanceof Error ? error.message : 'revalidate failed',
        responseAt,
        contractVersion: getConfigContractVersion
      })
    }
  }

  return {
    handleGetConfig
  }
}
