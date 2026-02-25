import crypto from 'node:crypto'

export const A_OPPORTUNITY_EVENT_REASON_CODES = Object.freeze({
  ACCEPTED: 'a_oc_emit_accepted',
  DUPLICATE_NOOP: 'a_oc_emit_duplicate_noop',
  REJECTED_RETRYABLE: 'a_oc_emit_rejected_retryable',
  REJECTED_NON_RETRYABLE: 'a_oc_emit_rejected_non_retryable',
  PAYLOAD_CONFLICT: 'a_oc_emit_payload_conflict',
  RETRY_EXHAUSTED: 'a_oc_emit_retry_exhausted',
  CONTRACT_INVALID: 'a_oc_emit_contract_invalid'
})

const VALID_ACK_STATUSES = new Set(['accepted', 'duplicate', 'rejected'])
const DEFAULT_RETRY_BACKOFF_MS = Object.freeze([1000, 5000, 30000, 120000])
const DEFAULT_MAX_RETRY_WINDOW_MS = 15 * 60 * 1000

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item))
  }

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

function stableStringify(value) {
  return JSON.stringify(stableClone(value))
}

function parseDateMs(input) {
  const ms = Date.parse(String(input || ''))
  return Number.isFinite(ms) ? ms : NaN
}

function formatUuid(bytes) {
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')
}

function generateUuidV7Like(nowMs) {
  const bytes = crypto.randomBytes(16)
  const time = BigInt(nowMs)

  bytes[0] = Number((time >> 40n) & 0xffn)
  bytes[1] = Number((time >> 32n) & 0xffn)
  bytes[2] = Number((time >> 24n) & 0xffn)
  bytes[3] = Number((time >> 16n) & 0xffn)
  bytes[4] = Number((time >> 8n) & 0xffn)
  bytes[5] = Number(time & 0xffn)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  return formatUuid(bytes)
}

function buildContractInvalidAck(eventRefOrNA, eventIdempotencyKey) {
  return {
    eventKey: eventRefOrNA,
    eventIdempotencyKey,
    ackStatus: 'rejected',
    ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.CONTRACT_INVALID,
    retryable: false,
    ackedAt: new Date().toISOString()
  }
}

function normalizeEmitInput(input) {
  if (isPlainObject(input) && isPlainObject(input.createOpportunityResult)) {
    return {
      createOpportunityResult: input.createOpportunityResult,
      opportunityCreatedAt: normalizeText(input.opportunityCreatedAt),
      handoffToBAt: normalizeText(input.handoffToBAt),
      eventAt: normalizeText(input.eventAt),
      opportunityEventContractVersion: normalizeText(input.opportunityEventContractVersion),
      experimentTagsOrNA: Array.isArray(input.experimentTagsOrNA)
        ? input.experimentTagsOrNA.map((item) => normalizeText(item)).filter(Boolean)
        : []
    }
  }

  return {
    createOpportunityResult: isPlainObject(input) ? input : {},
    opportunityCreatedAt: '',
    handoffToBAt: '',
    eventAt: '',
    opportunityEventContractVersion: '',
    experimentTagsOrNA: []
  }
}

function validateCreateResult(result) {
  if (!isPlainObject(result)) return false
  if (normalizeText(result.createAction) !== 'created') return false
  if (!isPlainObject(result.handoffPacketLiteOrNA)) return false

  const handoff = result.handoffPacketLiteOrNA
  if (!normalizeText(handoff.requestKey)) return false
  if (!normalizeText(handoff.opportunityKey || result.opportunityRefOrNA)) return false
  if (!isPlainObject(handoff.traceInit)) return false

  const traceInit = handoff.traceInit
  if (!normalizeText(traceInit.traceKey) || !normalizeText(traceInit.attemptKey)) return false
  if (!Array.isArray(handoff.impSeed) || handoff.impSeed.length === 0) return false

  return true
}

function computeIdempotencyKey(event, opportunityEventContractVersion) {
  const seed = [
    event.requestKey,
    event.opportunityKey,
    event.attemptKey,
    'opportunity_created',
    opportunityEventContractVersion
  ].join('|')
  return sha256(seed)
}

function payloadHash(event) {
  return sha256(stableStringify(event))
}

function normalizeAck(rawAck, event, nowFn) {
  const ack = isPlainObject(rawAck) ? rawAck : {}
  const ackStatus = VALID_ACK_STATUSES.has(ack.ackStatus) ? ack.ackStatus : 'rejected'

  let retryable = ack.retryable === true
  let ackReasonCode = normalizeText(ack.ackReasonCode)

  if (!ackReasonCode) {
    if (ackStatus === 'accepted') {
      ackReasonCode = A_OPPORTUNITY_EVENT_REASON_CODES.ACCEPTED
      retryable = false
    } else if (ackStatus === 'duplicate') {
      ackReasonCode = A_OPPORTUNITY_EVENT_REASON_CODES.DUPLICATE_NOOP
      retryable = false
    } else {
      ackReasonCode = retryable
        ? A_OPPORTUNITY_EVENT_REASON_CODES.REJECTED_RETRYABLE
        : A_OPPORTUNITY_EVENT_REASON_CODES.REJECTED_NON_RETRYABLE
    }
  }

  return {
    eventKey: event.eventKey,
    eventIdempotencyKey: event.eventIdempotencyKey,
    ackStatus,
    ackReasonCode,
    retryable,
    ackedAt: normalizeText(ack.ackedAt) || nowIso(nowFn)
  }
}

function shouldRetry(ack) {
  return ack.ackStatus === 'rejected' && ack.retryable === true
}

export function createOpportunityEventEmitterService(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const ackFn = typeof options.ackFn === 'function'
    ? options.ackFn
    : async () => ({ ackStatus: 'accepted', retryable: false })
  const waitFn = typeof options.waitFn === 'function'
    ? options.waitFn
    : async (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const retryBackoffMs = Array.isArray(options.retryBackoffMs) && options.retryBackoffMs.length > 0
    ? options.retryBackoffMs.map((item) => Math.max(0, Number(item) || 0))
    : [...DEFAULT_RETRY_BACKOFF_MS]
  const maxRetryWindowMs = Number.isFinite(options.maxRetryWindowMs)
    ? Math.max(0, Number(options.maxRetryWindowMs))
    : DEFAULT_MAX_RETRY_WINDOW_MS
  const defaultContractVersion = normalizeText(options.opportunityEventContractVersion) || 'a_opportunity_event_v1'
  const eventKeyFactory = typeof options.eventKeyFactory === 'function'
    ? options.eventKeyFactory
    : () => `evt_oc_${generateUuidV7Like(nowFn())}`

  const eventStore = new Map()

  async function emitOpportunityCreated(input) {
    const normalizedInput = normalizeEmitInput(input)
    const createResult = normalizedInput.createOpportunityResult

    if (normalizeText(createResult.createAction) !== 'created') {
      return {
        emitAccepted: true,
        emitAction: 'skipped',
        reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.DUPLICATE_NOOP,
        eventRefOrNA: 'NA',
        eventOrNA: null,
        ack: {
          eventKey: 'NA',
          eventIdempotencyKey: 'NA',
          ackStatus: 'duplicate',
          ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.DUPLICATE_NOOP,
          retryable: false,
          ackedAt: nowIso(nowFn)
        },
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    if (!validateCreateResult(createResult)) {
      const invalidAck = buildContractInvalidAck('NA', 'NA')
      invalidAck.ackedAt = nowIso(nowFn)
      return {
        emitAccepted: false,
        emitAction: 'rejected',
        reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.CONTRACT_INVALID,
        eventRefOrNA: 'NA',
        eventOrNA: null,
        ack: invalidAck,
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    const handoff = createResult.handoffPacketLiteOrNA
    const traceInit = handoff.traceInit

    const opportunityEventContractVersion = normalizedInput.opportunityEventContractVersion || defaultContractVersion
    const requestKey = normalizeText(handoff.requestKey)
    const opportunityKey = normalizeText(handoff.opportunityKey || createResult.opportunityRefOrNA)
    const traceKey = normalizeText(traceInit.traceKey)
    const attemptKey = normalizeText(traceInit.attemptKey)
    const impSeedRefs = handoff.impSeed
      .map((item) => normalizeText(item?.impKey))
      .filter(Boolean)
    const placementId = normalizeText(handoff.impSeed[0]?.placementId)

    if (!requestKey || !opportunityKey || !traceKey || !attemptKey || !placementId || impSeedRefs.length === 0) {
      const invalidAck = buildContractInvalidAck('NA', 'NA')
      invalidAck.ackedAt = nowIso(nowFn)
      return {
        emitAccepted: false,
        emitAction: 'rejected',
        reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.CONTRACT_INVALID,
        eventRefOrNA: 'NA',
        eventOrNA: null,
        ack: invalidAck,
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    const resolvedEventAt = normalizedInput.eventAt || nowIso(nowFn)
    const eventAtMs = parseDateMs(resolvedEventAt)
    const lowerBoundMs = parseDateMs(
      normalizedInput.opportunityCreatedAt ||
      createResult.opportunityCreatedAt ||
      createResult.returnedAt
    )
    const upperBoundMs = parseDateMs(normalizedInput.handoffToBAt || resolvedEventAt)

    if (!Number.isFinite(eventAtMs) || !Number.isFinite(lowerBoundMs) || !Number.isFinite(upperBoundMs)) {
      const invalidAck = buildContractInvalidAck('NA', 'NA')
      invalidAck.ackedAt = nowIso(nowFn)
      return {
        emitAccepted: false,
        emitAction: 'rejected',
        reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.CONTRACT_INVALID,
        eventRefOrNA: 'NA',
        eventOrNA: null,
        ack: invalidAck,
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    if (!(lowerBoundMs <= eventAtMs && eventAtMs <= upperBoundMs)) {
      const invalidAck = buildContractInvalidAck('NA', 'NA')
      invalidAck.ackedAt = nowIso(nowFn)
      return {
        emitAccepted: false,
        emitAction: 'rejected',
        reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.CONTRACT_INVALID,
        eventRefOrNA: 'NA',
        eventOrNA: null,
        ack: invalidAck,
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    const provisionalEvent = {
      eventKey: '',
      eventIdempotencyKey: '',
      eventType: 'opportunity_created',
      eventAt: new Date(eventAtMs).toISOString(),
      requestKey,
      opportunityKey,
      traceKey,
      attemptKey,
      placementId,
      impSeedRefs,
      createOpportunityContractVersion: normalizeText(createResult.createOpportunityContractVersion),
      opportunityEventContractVersion,
      experimentTagsOrNA: normalizedInput.experimentTagsOrNA
    }

    const eventIdempotencyKey = computeIdempotencyKey(provisionalEvent, opportunityEventContractVersion)
    const existing = eventStore.get(eventIdempotencyKey)

    const eventKey = existing?.event.eventKey || eventKeyFactory()
    const event = {
      ...provisionalEvent,
      eventKey,
      eventIdempotencyKey
    }

    const currentPayloadHash = payloadHash(event)

    if (existing) {
      if (existing.payloadHash !== currentPayloadHash) {
        return {
          emitAccepted: false,
          emitAction: 'rejected',
          reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.PAYLOAD_CONFLICT,
          eventRefOrNA: existing.event.eventKey,
          eventOrNA: existing.event,
          ack: {
            eventKey: existing.event.eventKey,
            eventIdempotencyKey,
            ackStatus: 'rejected',
            ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.PAYLOAD_CONFLICT,
            retryable: false,
            ackedAt: nowIso(nowFn)
          },
          attemptCount: 0,
          retryScheduleAppliedMs: []
        }
      }

      return {
        emitAccepted: true,
        emitAction: 'duplicate_noop',
        reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.DUPLICATE_NOOP,
        eventRefOrNA: existing.event.eventKey,
        eventOrNA: existing.event,
        ack: {
          eventKey: existing.event.eventKey,
          eventIdempotencyKey,
          ackStatus: 'duplicate',
          ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.DUPLICATE_NOOP,
          retryable: false,
          ackedAt: nowIso(nowFn)
        },
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    const createdRecord = {
      event,
      payloadHash: currentPayloadHash
    }
    eventStore.set(eventIdempotencyKey, createdRecord)

    const startedAtMs = nowFn()
    const retryScheduleAppliedMs = []

    let attemptIndex = 0
    while (true) {
      const rawAck = await ackFn(event, {
        attemptIndex,
        retryScheduleMs: retryBackoffMs,
        maxRetryWindowMs
      })
      const ack = normalizeAck(rawAck, event, nowFn)

      if (!shouldRetry(ack)) {
        return {
          emitAccepted: ack.ackStatus === 'accepted' || ack.ackStatus === 'duplicate',
          emitAction: 'emitted',
          reasonCode: ack.ackReasonCode,
          eventRefOrNA: event.eventKey,
          eventOrNA: event,
          ack,
          attemptCount: attemptIndex + 1,
          retryScheduleAppliedMs
        }
      }

      const delayMs = retryBackoffMs[Math.min(attemptIndex, retryBackoffMs.length - 1)]
      const elapsedMs = nowFn() - startedAtMs
      if (elapsedMs + delayMs > maxRetryWindowMs) {
        return {
          emitAccepted: false,
          emitAction: 'rejected',
          reasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.RETRY_EXHAUSTED,
          eventRefOrNA: event.eventKey,
          eventOrNA: event,
          ack: {
            eventKey: event.eventKey,
            eventIdempotencyKey,
            ackStatus: 'rejected',
            ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.RETRY_EXHAUSTED,
            retryable: false,
            ackedAt: nowIso(nowFn)
          },
          attemptCount: attemptIndex + 1,
          retryScheduleAppliedMs
        }
      }

      retryScheduleAppliedMs.push(delayMs)
      await waitFn(delayMs)
      attemptIndex += 1
    }
  }

  return {
    emitOpportunityCreated,
    _debug: {
      eventStore
    }
  }
}
