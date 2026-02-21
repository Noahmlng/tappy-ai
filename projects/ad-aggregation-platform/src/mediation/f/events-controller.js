import crypto from 'node:crypto'

export const F_EVENTS_ACK_STATUSES = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  DUPLICATE: 'duplicate'
})

export const F_EVENTS_OVERALL_STATUSES = Object.freeze({
  ACCEPTED_ALL: 'accepted_all',
  PARTIAL_SUCCESS: 'partial_success',
  REJECTED_ALL: 'rejected_all'
})

export const F_EVENTS_REASON_CODES = Object.freeze({
  EVENT_ACCEPTED: 'f_event_accepted',
  EVENT_TYPE_UNSUPPORTED: 'f_event_type_unsupported',
  EVENT_MISSING_REQUIRED: 'f_event_missing_required',
  EVENT_TIME_INVALID: 'f_event_time_invalid',
  IDEMPOTENCY_KEY_INVALID_FALLBACK: 'f_idempotency_key_invalid_fallback',
  EVENT_ID_INVALID_NO_FALLBACK: 'f_event_id_invalid_no_fallback',
  EVENT_ID_GLOBAL_UNIQUENESS_UNVERIFIED: 'f_event_id_global_uniqueness_unverified',
  EVENT_SEQ_MISSING_REQUIRED: 'f_event_seq_missing_required',
  EVENT_SEQ_INVALID: 'f_event_seq_invalid',
  DEDUP_INFLIGHT_DUPLICATE: 'f_dedup_inflight_duplicate',
  DEDUP_COMMITTED_DUPLICATE: 'f_dedup_committed_duplicate',
  DEDUP_PAYLOAD_CONFLICT: 'f_dedup_payload_conflict',
  ENVELOPE_EVENTS_INVALID: 'f_envelope_events_invalid',
  ENVELOPE_BATCH_ID_INVALID: 'f_envelope_batch_id_invalid',
  ENVELOPE_SCHEMA_UNSUPPORTED: 'f_envelope_schema_unsupported',
  EVENT_SUBENUM_UNKNOWN_NORMALIZED: 'f_event_subenum_unknown_normalized'
})

const EVENT_TYPES = Object.freeze([
  'opportunity_created',
  'auction_started',
  'ad_filled',
  'impression',
  'click',
  'interaction',
  'postback',
  'error'
])

const EVENT_TYPE_SET = new Set(EVENT_TYPES)
const REPEATED_EVENT_TYPES = new Set(['click', 'interaction', 'postback'])
const RESPONSE_REF_OPTIONAL_TYPES = new Set(['opportunity_created', 'auction_started'])
const KNOWN_SCHEMA_VERSIONS = new Set(['schema_v1'])

const TYPE_REQUIRED_FIELDS = Object.freeze({
  opportunity_created: ['placementKey'],
  auction_started: ['auctionChannel'],
  ad_filled: ['responseReference', 'creativeId'],
  impression: ['responseReference', 'renderAttemptId', 'creativeId'],
  click: ['responseReference', 'renderAttemptId', 'clickTarget', 'eventSeq'],
  interaction: ['responseReference', 'renderAttemptId', 'interactionType', 'eventSeq'],
  postback: ['responseReference', 'postbackType', 'postbackStatus', 'eventSeq'],
  error: ['errorStage', 'errorCode']
})

const SUBENUM_FIELDS = Object.freeze({
  auction_started: ['auctionChannel'],
  interaction: ['interactionType'],
  postback: ['postbackType', 'postbackStatus'],
  error: ['errorStage']
})

const KNOWN_SUBENUM_VALUES = Object.freeze({
  auctionChannel: new Set(['waterfall', 'bidding', 'hybrid']),
  interactionType: new Set(['expand', 'collapse', 'dismiss', 'close', 'engage']),
  postbackType: new Set(['conversion', 'install', 'purchase', 'signup']),
  postbackStatus: new Set(['pending', 'success', 'failed']),
  errorStage: new Set(['compose', 'render', 'event_pipeline', 'network'])
})

const COMMON_REQUIRED_FIELDS = Object.freeze([
  'eventId',
  'eventType',
  'eventAt',
  'traceKey',
  'requestKey',
  'attemptKey',
  'opportunityKey',
  'eventVersion'
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map((item) => stableClone(item))
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = stableClone(value[key])
        return acc
      }, {})
  }
  return value
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function stringifyStable(value) {
  return JSON.stringify(stableClone(value))
}

function validIsoTime(value) {
  const normalized = normalizeText(value)
  if (!normalized) return false
  const ms = Date.parse(normalized)
  if (!Number.isFinite(ms)) return false
  return new Date(ms).toISOString() === normalized || Number.isFinite(ms)
}

function isPositiveInt(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1
}

function validEventId(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(normalizeText(value))
}

function validIdempotencyKey(value) {
  return /^[A-Za-z0-9._:-]{8,200}$/.test(normalizeText(value))
}

function requiredMissingFields(event, requiredFields) {
  return requiredFields.filter((field) => {
    const val = event[field]
    return val === undefined || val === null || normalizeText(val) === ''
  })
}

function eventSeqScope(appId, event) {
  const responseReference = normalizeText(event.responseReference) || 'NA'
  const renderAttemptId = normalizeText(event.renderAttemptId) || 'NA'
  return `${normalizeText(appId)}|${responseReference}|${renderAttemptId}|${normalizeText(event.eventType)}`
}

function semanticDigestForEvent(eventType, event) {
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
    default:
      return ''
  }
}

function normalizeEventUnknownSubEnums(rawEvent) {
  const event = { ...rawEvent }
  const eventType = normalizeText(event.eventType)
  const fields = SUBENUM_FIELDS[eventType] || []
  const normalizedUnknowns = []

  for (const field of fields) {
    const raw = normalizeText(event[field])
    if (!raw) continue
    const knownSet = KNOWN_SUBENUM_VALUES[field]
    if (!knownSet || knownSet.has(raw)) continue
    event[field] = 'unknown'
    normalizedUnknowns.push({
      fieldPath: field,
      rawValue: raw,
      canonicalValue: 'unknown'
    })
  }

  return {
    event,
    normalizedUnknowns
  }
}

function canonicalDedupKey({
  appId,
  batchId,
  event,
  idempotencyKeyValid,
  eventIdValid
}) {
  const eventType = normalizeText(event.eventType)
  const requestKey = normalizeText(event.requestKey)
  const attemptKey = normalizeText(event.attemptKey)
  const opportunityKey = normalizeText(event.opportunityKey)
  const responseReferenceOrNA = normalizeText(event.responseReference) || 'NA'
  const renderAttemptIdOrNA = normalizeText(event.renderAttemptId) || 'NA'
  const semanticDigest = semanticDigestForEvent(eventType, event)

  if (idempotencyKeyValid) {
    return {
      ok: true,
      keySource: 'client_idempotency',
      keyValue: `${normalizeText(appId)}|${normalizeText(event.idempotencyKey)}`
    }
  }

  if (eventIdValid) {
    const scope = normalizeText(event.eventIdScope) || 'batch_scoped'
    if (scope === 'global_unique') {
      const globalVerified = event.globalUniqueVerified === true || event.eventIdGlobalUniqueVerified === true
      if (!globalVerified) {
        return {
          ok: false,
          reasonCode: F_EVENTS_REASON_CODES.EVENT_ID_GLOBAL_UNIQUENESS_UNVERIFIED
        }
      }
      return {
        ok: true,
        keySource: 'client_event_id',
        keyValue: `${normalizeText(appId)}|global|${normalizeText(event.eventId)}`
      }
    }
    return {
      ok: true,
      keySource: 'client_event_id',
      keyValue: `${normalizeText(appId)}|${normalizeText(batchId)}|${normalizeText(event.eventId)}`
    }
  }

  const computedInput = [
    normalizeText(appId),
    eventType,
    requestKey,
    attemptKey,
    opportunityKey,
    responseReferenceOrNA,
    renderAttemptIdOrNA,
    semanticDigest
  ].join('|')

  if (!eventType || !requestKey || !attemptKey || !opportunityKey || !semanticDigest) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.EVENT_ID_INVALID_NO_FALLBACK
    }
  }

  return {
    ok: true,
    keySource: 'computed',
    keyValue: sha256Hex(computedInput)
  }
}

function buildServerEventKey(key) {
  return `f_dedup_v1:${key.keySource}:${key.keyValue}`
}

function buildAckItem(event, index, ackStatus, ackReasonCode, retryable, serverEventKey) {
  return {
    eventId: normalizeText(event.eventId) || `NA_${index}`,
    eventIndex: index,
    ackStatus,
    ackReasonCode,
    retryable: retryable === true,
    serverEventKey
  }
}

function envelopeValidation(request, maxBatchSize, schemaVersions) {
  const events = request.events
  if (!Array.isArray(events) || events.length < 1 || events.length > maxBatchSize) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.ENVELOPE_EVENTS_INVALID
    }
  }
  if (!normalizeText(request.batchId)) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.ENVELOPE_BATCH_ID_INVALID
    }
  }
  if (!schemaVersions.has(normalizeText(request.schemaVersion))) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.ENVELOPE_SCHEMA_UNSUPPORTED
    }
  }
  return { ok: true }
}

function validateSingleEvent({
  event,
  appId,
  eventSeqState
}) {
  if (!isPlainObject(event) || Object.keys(event).length === 0) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.EVENT_MISSING_REQUIRED
    }
  }

  const normalizedType = normalizeText(event.eventType)
  if (!EVENT_TYPE_SET.has(normalizedType)) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.EVENT_TYPE_UNSUPPORTED
    }
  }

  const commonMissing = requiredMissingFields(event, COMMON_REQUIRED_FIELDS)
  if (commonMissing.length > 0) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.EVENT_MISSING_REQUIRED
    }
  }
  if (!RESPONSE_REF_OPTIONAL_TYPES.has(normalizedType) && !normalizeText(event.responseReference)) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.EVENT_MISSING_REQUIRED
    }
  }
  if (!validIsoTime(event.eventAt)) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.EVENT_TIME_INVALID
    }
  }

  const typeRequired = TYPE_REQUIRED_FIELDS[normalizedType] || []
  const typeMissing = requiredMissingFields(event, typeRequired)
  if (typeMissing.length > 0) {
    return {
      ok: false,
      reasonCode: F_EVENTS_REASON_CODES.EVENT_MISSING_REQUIRED
    }
  }

  if (REPEATED_EVENT_TYPES.has(normalizedType)) {
    if (event.eventSeq === undefined || event.eventSeq === null || normalizeText(event.eventSeq) === '') {
      return {
        ok: false,
        reasonCode: F_EVENTS_REASON_CODES.EVENT_SEQ_MISSING_REQUIRED
      }
    }
    if (!isPositiveInt(event.eventSeq)) {
      return {
        ok: false,
        reasonCode: F_EVENTS_REASON_CODES.EVENT_SEQ_INVALID
      }
    }

    const seqScope = eventSeqScope(appId, event)
    const nextSeq = Number(event.eventSeq)
    const previous = eventSeqState.get(seqScope)
    if (previous !== undefined && nextSeq <= previous) {
      return {
        ok: false,
        reasonCode: F_EVENTS_REASON_CODES.EVENT_SEQ_INVALID
      }
    }
    eventSeqState.set(seqScope, nextSeq)
  }

  return {
    ok: true,
    reasonCode: F_EVENTS_REASON_CODES.EVENT_ACCEPTED
  }
}

function computeOverallStatus(ackItems) {
  if (ackItems.length === 0) return F_EVENTS_OVERALL_STATUSES.REJECTED_ALL
  const statuses = ackItems.map((item) => item.ackStatus)
  if (statuses.every((status) => status === F_EVENTS_ACK_STATUSES.ACCEPTED)) {
    return F_EVENTS_OVERALL_STATUSES.ACCEPTED_ALL
  }
  if (statuses.every((status) => status === F_EVENTS_ACK_STATUSES.REJECTED)) {
    return F_EVENTS_OVERALL_STATUSES.REJECTED_ALL
  }
  return F_EVENTS_OVERALL_STATUSES.PARTIAL_SUCCESS
}

export function createEventsController(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const maxBatchSize = Number.isInteger(options.maxBatchSize) ? options.maxBatchSize : 100
  const supportedSchemaVersions = Array.isArray(options.supportedSchemaVersions)
    ? new Set(options.supportedSchemaVersions.map((item) => normalizeText(item)).filter(Boolean))
    : KNOWN_SCHEMA_VERSIONS
  const dedupStore = options.dedupStore instanceof Map ? options.dedupStore : new Map()
  const globalEventSeqState = options.eventSeqState instanceof Map ? options.eventSeqState : new Map()

  async function handlePostEvents(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const receivedAt = nowIso(nowFn)
    const envelopeResult = envelopeValidation(request, maxBatchSize, supportedSchemaVersions)
    if (!envelopeResult.ok) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: {
          batchId: normalizeText(request.batchId) || 'NA',
          receivedAt,
          overallStatus: F_EVENTS_OVERALL_STATUSES.REJECTED_ALL,
          ackItems: [],
          reasonCode: envelopeResult.reasonCode
        }
      }
    }

    const batchId = normalizeText(request.batchId)
    const appId = normalizeText(request.appId)
    const batchEvents = request.events
    const ackItems = []

    for (let index = 0; index < batchEvents.length; index += 1) {
      const rawEvent = isPlainObject(batchEvents[index]) ? stableClone(batchEvents[index]) : {}
      const baseEventId = normalizeText(rawEvent.eventId) || `NA_${index}`

      const eventSeqState = new Map(globalEventSeqState)
      const validationResult = validateSingleEvent({
        event: rawEvent,
        appId,
        eventSeqState
      })
      if (!validationResult.ok) {
        ackItems.push(
          buildAckItem(
            { eventId: baseEventId },
            index,
            F_EVENTS_ACK_STATUSES.REJECTED,
            validationResult.reasonCode,
            false,
            `f_evt_rejected_${index}`
          )
        )
        continue
      }

      globalEventSeqState.clear()
      for (const [key, value] of eventSeqState.entries()) {
        globalEventSeqState.set(key, value)
      }

      const { event, normalizedUnknowns } = normalizeEventUnknownSubEnums(rawEvent)

      const idemKeyValid = validIdempotencyKey(event.idempotencyKey)
      const eventIdValid = validEventId(event.eventId)
      const fallbackReason = Boolean(normalizeText(event.idempotencyKey)) && !idemKeyValid
        ? F_EVENTS_REASON_CODES.IDEMPOTENCY_KEY_INVALID_FALLBACK
        : ''

      const dedupKeyCandidate = canonicalDedupKey({
        appId,
        batchId,
        event,
        idempotencyKeyValid: idemKeyValid,
        eventIdValid
      })
      if (!dedupKeyCandidate.ok) {
        ackItems.push(
          buildAckItem(
            event,
            index,
            F_EVENTS_ACK_STATUSES.REJECTED,
            dedupKeyCandidate.reasonCode,
            false,
            `f_evt_rejected_${index}`
          )
        )
        continue
      }

      const serverEventKey = buildServerEventKey(dedupKeyCandidate)
      const canonicalPayloadHash = sha256Hex(stringifyStable(event))
      const existing = dedupStore.get(serverEventKey)
      if (existing) {
        if (existing.payloadHash !== canonicalPayloadHash) {
          ackItems.push(
            buildAckItem(
              event,
              index,
              F_EVENTS_ACK_STATUSES.REJECTED,
              F_EVENTS_REASON_CODES.DEDUP_PAYLOAD_CONFLICT,
              false,
              serverEventKey
            )
          )
          continue
        }

        ackItems.push(
          buildAckItem(
            event,
            index,
            F_EVENTS_ACK_STATUSES.DUPLICATE,
            F_EVENTS_REASON_CODES.DEDUP_COMMITTED_DUPLICATE,
            false,
            serverEventKey
          )
        )
        continue
      }

      dedupStore.set(serverEventKey, {
        payloadHash: canonicalPayloadHash,
        createdAt: receivedAt
      })

      let ackReasonCode = F_EVENTS_REASON_CODES.EVENT_ACCEPTED
      if (fallbackReason) {
        ackReasonCode = fallbackReason
      } else if (normalizedUnknowns.length > 0) {
        ackReasonCode = F_EVENTS_REASON_CODES.EVENT_SUBENUM_UNKNOWN_NORMALIZED
      }

      ackItems.push(
        buildAckItem(
          event,
          index,
          F_EVENTS_ACK_STATUSES.ACCEPTED,
          ackReasonCode,
          false,
          serverEventKey
        )
      )
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        batchId,
        receivedAt,
        overallStatus: computeOverallStatus(ackItems),
        ackItems
      }
    }
  }

  return {
    handlePostEvents,
    _debug: {
      dedupStore,
      eventSeqState: globalEventSeqState
    }
  }
}
