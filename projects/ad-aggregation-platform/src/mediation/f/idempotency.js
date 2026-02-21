import crypto from 'node:crypto'

export const F_IDEMPOTENCY_REASON_CODES = Object.freeze({
  ACCEPTED: 'f_event_accepted',
  DEDUP_INFLIGHT_DUPLICATE: 'f_dedup_inflight_duplicate',
  DEDUP_COMMITTED_DUPLICATE: 'f_dedup_committed_duplicate',
  DEDUP_PAYLOAD_CONFLICT: 'f_dedup_payload_conflict',
  EVENT_ID_GLOBAL_UNIQUENESS_UNVERIFIED: 'f_event_id_global_uniqueness_unverified',
  EVENT_ID_INVALID_NO_FALLBACK: 'f_event_id_invalid_no_fallback',
  EVENT_STALE_OUTSIDE_DEDUP_WINDOW: 'f_event_stale_outside_dedup_window'
})

export const F_IDEMPOTENCY_STATES = Object.freeze({
  NEW: 'new',
  INFLIGHT_LOCKED: 'inflight_locked',
  ACCEPTED_COMMITTED: 'accepted_committed',
  DUPLICATE_INFLIGHT: 'duplicate_inflight',
  DUPLICATE_COMMITTED: 'duplicate_committed',
  REJECTED_CONFLICT: 'rejected_conflict',
  EXPIRED: 'expired'
})

const BILLING_EVENT_TYPES = new Set(['impression', 'click', 'postback', 'failure'])
const EVENT_TYPES = new Set([
  'opportunity_created',
  'auction_started',
  'ad_filled',
  'impression',
  'click',
  'interaction',
  'postback',
  'error',
  'failure'
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map((item) => stableClone(item))
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = stableClone(value[key])
        return acc
      }, {})
  }
  return value
}

function stringifyStable(value) {
  return JSON.stringify(stableClone(value))
}

function validEventId(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(normalizeText(value))
}

function validIdempotencyKey(value) {
  return /^[A-Za-z0-9._:-]{8,200}$/.test(normalizeText(value))
}

function semanticPayloadDigest(eventType, event) {
  const type = normalizeText(eventType)
  switch (type) {
    case 'opportunity_created':
      return normalizeText(event.placementKey)
    case 'auction_started':
      return normalizeText(event.auctionChannel)
    case 'ad_filled':
      return normalizeText(event.creativeId)
    case 'impression':
      return `${normalizeText(event.creativeId)}|${normalizeText(event.renderAttemptId)}`
    case 'click':
      return `${normalizeText(event.renderAttemptId)}|${normalizeText(event.clickTarget)}|${normalizeText(event.eventSeq)}`
    case 'interaction':
      return `${normalizeText(event.renderAttemptId)}|${normalizeText(event.interactionType)}|${normalizeText(event.eventSeq)}`
    case 'postback':
      return `${normalizeText(event.postbackType)}|${normalizeText(event.postbackStatus)}|${normalizeText(event.eventSeq)}`
    case 'error':
      return `${normalizeText(event.errorStage)}|${normalizeText(event.errorCode)}`
    case 'failure':
      return `${normalizeText(event.terminalSource || 'real')}|${normalizeText(event.failureReasonCode || event.reasonCode)}`
    default:
      return ''
  }
}

function resolveComputedKey({ appId, eventType, event }) {
  const requestKey = normalizeText(event.requestKey)
  const attemptKey = normalizeText(event.attemptKey)
  const opportunityKey = normalizeText(event.opportunityKey)
  const responseReferenceOrNA = normalizeText(event.responseReference) || 'NA'
  const renderAttemptIdOrNA = normalizeText(event.renderAttemptId) || 'NA'
  const digest = semanticPayloadDigest(eventType, event)
  if (!requestKey || !attemptKey || !opportunityKey || !digest) {
    return {
      ok: false,
      reasonCode: F_IDEMPOTENCY_REASON_CODES.EVENT_ID_INVALID_NO_FALLBACK
    }
  }
  const input = [
    normalizeText(appId),
    eventType,
    requestKey,
    attemptKey,
    opportunityKey,
    responseReferenceOrNA,
    renderAttemptIdOrNA,
    digest
  ].join('|')
  return {
    ok: true,
    keySource: 'computed',
    keyValue: sha256(input)
  }
}

function resolveCanonicalDedupKey({ appId, batchId, event }) {
  const eventType = normalizeText(event.eventType)
  if (!EVENT_TYPES.has(eventType)) {
    return {
      ok: false,
      reasonCode: F_IDEMPOTENCY_REASON_CODES.EVENT_ID_INVALID_NO_FALLBACK
    }
  }

  const idempotencyKey = normalizeText(event.idempotencyKey)
  const eventId = normalizeText(event.eventId)

  if (idempotencyKey && validIdempotencyKey(idempotencyKey)) {
    const keyValue = `${normalizeText(appId)}|${idempotencyKey}`
    return {
      ok: true,
      keySource: 'client_idempotency',
      keyValue,
      canonicalDedupKey: `f_dedup_v1:client_idempotency:${keyValue}`
    }
  }

  if (eventId && validEventId(eventId)) {
    const eventIdScope = normalizeText(event.eventIdScope) || 'batch_scoped'
    if (eventIdScope === 'global_unique') {
      const verified = event.globalUniqueVerified === true || event.eventIdGlobalUniqueVerified === true
      if (!verified) {
        return {
          ok: false,
          reasonCode: F_IDEMPOTENCY_REASON_CODES.EVENT_ID_GLOBAL_UNIQUENESS_UNVERIFIED
        }
      }
      const keyValue = `${normalizeText(appId)}|global|${eventId}`
      return {
        ok: true,
        keySource: 'client_event_id',
        keyValue,
        canonicalDedupKey: `f_dedup_v1:client_event_id:${keyValue}`
      }
    }
    const keyValue = `${normalizeText(appId)}|${normalizeText(batchId)}|${eventId}`
    return {
      ok: true,
      keySource: 'client_event_id',
      keyValue,
      canonicalDedupKey: `f_dedup_v1:client_event_id:${keyValue}`
    }
  }

  const computed = resolveComputedKey({
    appId,
    eventType,
    event
  })
  if (!computed.ok) return computed
  return {
    ok: true,
    keySource: computed.keySource,
    keyValue: computed.keyValue,
    canonicalDedupKey: `f_dedup_v1:computed:${computed.keyValue}`
  }
}

function eventLayer(eventType) {
  return BILLING_EVENT_TYPES.has(normalizeText(eventType)) ? 'billing' : 'diagnostics'
}

function dedupWindowMsByLayer(layer) {
  if (layer === 'billing') return 14 * 24 * 60 * 60 * 1000
  return 3 * 24 * 60 * 60 * 1000
}

export function createIdempotencyEngine(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const inflightLockMs = Number.isFinite(Number(options.inflightLockMs)) ? Number(options.inflightLockMs) : 120_000
  const dedupStore = options.dedupStore instanceof Map ? options.dedupStore : new Map()

  function getRecord(canonicalDedupKey) {
    return dedupStore.get(normalizeText(canonicalDedupKey)) || null
  }

  function beginInFlight(input = {}) {
    const appId = normalizeText(input.appId)
    const batchId = normalizeText(input.batchId)
    const event = input.event || {}
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : nowFn()

    const keyResult = resolveCanonicalDedupKey({ appId, batchId, event })
    if (!keyResult.ok) return { ok: false, reasonCode: keyResult.reasonCode }
    const canonicalDedupKey = keyResult.canonicalDedupKey
    const record = dedupStore.get(canonicalDedupKey)
    const payloadHash = sha256(stringifyStable(event))

    if (record && record.state === F_IDEMPOTENCY_STATES.INFLIGHT_LOCKED && nowMs - record.lockedAtMs < inflightLockMs) {
      return {
        ok: true,
        ackStatus: 'duplicate',
        reasonCode: F_IDEMPOTENCY_REASON_CODES.DEDUP_INFLIGHT_DUPLICATE,
        canonicalDedupKey,
        keySource: keyResult.keySource
      }
    }

    dedupStore.set(canonicalDedupKey, {
      state: F_IDEMPOTENCY_STATES.INFLIGHT_LOCKED,
      keySource: keyResult.keySource,
      payloadHash,
      lockedAtMs: nowMs,
      history: [
        {
          state: F_IDEMPOTENCY_STATES.INFLIGHT_LOCKED,
          at: nowIso(nowMs)
        }
      ]
    })

    return {
      ok: true,
      ackStatus: 'accepted',
      reasonCode: F_IDEMPOTENCY_REASON_CODES.ACCEPTED,
      canonicalDedupKey,
      keySource: keyResult.keySource
    }
  }

  function commit(input = {}) {
    const canonicalDedupKey = normalizeText(input.canonicalDedupKey)
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : nowFn()
    const record = dedupStore.get(canonicalDedupKey)
    if (!record) return { ok: false, reasonCode: F_IDEMPOTENCY_REASON_CODES.EVENT_ID_INVALID_NO_FALLBACK }

    record.state = F_IDEMPOTENCY_STATES.ACCEPTED_COMMITTED
    record.committedAtMs = nowMs
    record.history.push({
      state: F_IDEMPOTENCY_STATES.ACCEPTED_COMMITTED,
      at: nowIso(nowMs)
    })
    dedupStore.set(canonicalDedupKey, record)
    return { ok: true, reasonCode: F_IDEMPOTENCY_REASON_CODES.ACCEPTED }
  }

  function evaluate(input = {}) {
    const appId = normalizeText(input.appId)
    const batchId = normalizeText(input.batchId)
    const event = input.event || {}
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : nowFn()
    const eventType = normalizeText(event.eventType)

    const keyResult = resolveCanonicalDedupKey({ appId, batchId, event })
    if (!keyResult.ok) {
      return {
        ok: false,
        ackStatus: 'rejected',
        reasonCode: keyResult.reasonCode,
        retryable: false
      }
    }

    const layer = eventLayer(eventType)
    const dedupWindowMs = dedupWindowMsByLayer(layer)
    const eventAtMs = Date.parse(normalizeText(event.eventAt))
    if (!Number.isFinite(eventAtMs) || nowMs - eventAtMs > dedupWindowMs) {
      return {
        ok: false,
        ackStatus: 'rejected',
        reasonCode: F_IDEMPOTENCY_REASON_CODES.EVENT_STALE_OUTSIDE_DEDUP_WINDOW,
        retryable: false,
        keySource: keyResult.keySource,
        canonicalDedupKey: keyResult.canonicalDedupKey
      }
    }

    const canonicalDedupKey = keyResult.canonicalDedupKey
    const payloadHash = sha256(stringifyStable(event))
    const existing = dedupStore.get(canonicalDedupKey)

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        existing.state = F_IDEMPOTENCY_STATES.REJECTED_CONFLICT
        existing.history.push({
          state: F_IDEMPOTENCY_STATES.REJECTED_CONFLICT,
          at: nowIso(nowMs)
        })
        dedupStore.set(canonicalDedupKey, existing)
        return {
          ok: false,
          ackStatus: 'rejected',
          reasonCode: F_IDEMPOTENCY_REASON_CODES.DEDUP_PAYLOAD_CONFLICT,
          retryable: false,
          keySource: keyResult.keySource,
          canonicalDedupKey
        }
      }

      if (existing.state === F_IDEMPOTENCY_STATES.INFLIGHT_LOCKED && nowMs - existing.lockedAtMs < inflightLockMs) {
        existing.state = F_IDEMPOTENCY_STATES.DUPLICATE_INFLIGHT
        existing.history.push({
          state: F_IDEMPOTENCY_STATES.DUPLICATE_INFLIGHT,
          at: nowIso(nowMs)
        })
        dedupStore.set(canonicalDedupKey, existing)
        return {
          ok: true,
          ackStatus: 'duplicate',
          reasonCode: F_IDEMPOTENCY_REASON_CODES.DEDUP_INFLIGHT_DUPLICATE,
          retryable: false,
          keySource: keyResult.keySource,
          canonicalDedupKey
        }
      }

      if (existing.state === F_IDEMPOTENCY_STATES.ACCEPTED_COMMITTED) {
        const elapsed = nowMs - existing.committedAtMs
        if (elapsed <= dedupWindowMs) {
          existing.state = F_IDEMPOTENCY_STATES.DUPLICATE_COMMITTED
          existing.history.push({
            state: F_IDEMPOTENCY_STATES.DUPLICATE_COMMITTED,
            at: nowIso(nowMs)
          })
          dedupStore.set(canonicalDedupKey, existing)
          return {
            ok: true,
            ackStatus: 'duplicate',
            reasonCode: F_IDEMPOTENCY_REASON_CODES.DEDUP_COMMITTED_DUPLICATE,
            retryable: false,
            keySource: keyResult.keySource,
            canonicalDedupKey
          }
        }
        existing.state = F_IDEMPOTENCY_STATES.EXPIRED
        existing.history.push({
          state: F_IDEMPOTENCY_STATES.EXPIRED,
          at: nowIso(nowMs)
        })
      }
    }

    const begin = beginInFlight({ appId, batchId, event, nowMs })
    if (!begin.ok) {
      return {
        ok: false,
        ackStatus: 'rejected',
        reasonCode: begin.reasonCode,
        retryable: false
      }
    }
    if (begin.ackStatus === 'duplicate') {
      return {
        ok: true,
        ackStatus: 'duplicate',
        reasonCode: begin.reasonCode,
        retryable: false,
        canonicalDedupKey: begin.canonicalDedupKey,
        keySource: begin.keySource
      }
    }

    const commitResult = commit({
      canonicalDedupKey: begin.canonicalDedupKey,
      nowMs
    })
    if (!commitResult.ok) {
      return {
        ok: false,
        ackStatus: 'rejected',
        reasonCode: commitResult.reasonCode,
        retryable: false
      }
    }

    return {
      ok: true,
      ackStatus: 'accepted',
      reasonCode: F_IDEMPOTENCY_REASON_CODES.ACCEPTED,
      retryable: false,
      canonicalDedupKey: begin.canonicalDedupKey,
      keySource: begin.keySource,
      dedupFingerprintVersion: 'f_dedup_v1'
    }
  }

  function replay(canonicalDedupKey) {
    const record = dedupStore.get(normalizeText(canonicalDedupKey))
    if (!record) return null
    return stableClone(record)
  }

  return {
    evaluate,
    beginInFlight,
    commit,
    replay,
    resolveCanonicalDedupKey,
    _debug: {
      dedupStore
    }
  }
}
