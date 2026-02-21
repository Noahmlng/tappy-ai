import crypto from 'node:crypto'

export const B_SIGNAL_EVENT_REASON_CODES = Object.freeze({
  SAMPLED_IN_EMIT: 'b_sig_evt_sampled_in_emit',
  SAMPLED_OUT_NO_EMIT: 'b_sig_evt_sampled_out_no_emit',
  ACK_ACCEPTED: 'b_sig_evt_ack_accepted',
  ACK_DUPLICATE: 'b_sig_evt_ack_duplicate',
  ACK_REJECTED_RETRYABLE: 'b_sig_evt_ack_rejected_retryable',
  ACK_REJECTED_NON_RETRYABLE: 'b_sig_evt_ack_rejected_non_retryable',
  PAYLOAD_CONFLICT: 'b_sig_evt_payload_conflict',
  RETRY_EXHAUSTED: 'b_sig_evt_retry_exhausted',
  SAMPLING_RULE_INVALID: 'b_sig_evt_sampling_rule_invalid'
})

const VALID_ACK_STATUSES = new Set(['accepted', 'duplicate', 'rejected'])
const DEFAULT_RETRY_BACKOFF_MS = Object.freeze([1000, 5000, 30000, 120000])
const DEFAULT_MAX_RETRY_WINDOW_MS = 10 * 60 * 1000

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

function payloadHash(value) {
  return sha256(stableStringify(value))
}

function parseSampleRateBps(rawValue) {
  if (typeof rawValue === 'number' && Number.isInteger(rawValue)) {
    return rawValue
  }
  if (typeof rawValue === 'string' && rawValue.trim() !== '') {
    const parsed = Number(rawValue)
    if (Number.isInteger(parsed)) return parsed
  }
  return NaN
}

function normalizeEmitInput(input) {
  const request = isPlainObject(input) ? input : {}
  const trace = isPlainObject(request.traceInitLite) ? request.traceInitLite : {}
  return {
    traceInitLite: {
      traceKey: normalizeText(trace.traceKey),
      requestKey: normalizeText(trace.requestKey),
      attemptKey: normalizeText(trace.attemptKey)
    },
    opportunityKey: normalizeText(request.opportunityKey),
    sampleRateBps: parseSampleRateBps(request.sampleRateBps),
    samplingRuleVersion: normalizeText(request.samplingRuleVersion),
    signalNormalizedEventContractVersion: normalizeText(request.signalNormalizedEventContractVersion),
    mappingProfileVersion: normalizeText(request.mappingProfileVersion),
    enumDictVersion: normalizeText(request.enumDictVersion),
    bucketDictVersion: normalizeText(request.bucketDictVersion),
    sampledSemanticSlots: Array.isArray(request.sampledSemanticSlots)
      ? request.sampledSemanticSlots.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    mappingAuditSnapshotRefOrNA: normalizeText(request.mappingAuditSnapshotRefOrNA),
    bucketAuditSnapshotRefOrNA: normalizeText(request.bucketAuditSnapshotRefOrNA),
    debugForceSample: request.debugForceSample === true,
    eventAt: normalizeText(request.eventAt)
  }
}

function isSamplingConfigValid(input) {
  if (!input.traceInitLite.traceKey || !input.traceInitLite.requestKey || !input.traceInitLite.attemptKey) {
    return false
  }
  if (!input.opportunityKey) return false
  if (!input.samplingRuleVersion) return false
  if (!input.signalNormalizedEventContractVersion) return false
  if (!input.mappingProfileVersion || !input.enumDictVersion || !input.bucketDictVersion) return false
  if (!Number.isInteger(input.sampleRateBps)) return false
  if (input.sampleRateBps < 0 || input.sampleRateBps > 10000) return false
  return true
}

export function computeSignalSamplingDecision(input) {
  const normalized = normalizeEmitInput(input)
  if (!isSamplingConfigValid(normalized)) {
    return {
      ok: false,
      reasonCode: B_SIGNAL_EVENT_REASON_CODES.SAMPLING_RULE_INVALID,
      samplingHash: NaN,
      samplingDecision: 'sampled_out'
    }
  }

  if (normalized.debugForceSample) {
    return {
      ok: true,
      reasonCode: B_SIGNAL_EVENT_REASON_CODES.SAMPLED_IN_EMIT,
      samplingHash: -1,
      samplingDecision: 'sampled_in'
    }
  }

  const rawHash = sha256(`${normalized.traceInitLite.traceKey}|${normalized.samplingRuleVersion}`).slice(0, 8)
  const samplingHash = parseInt(rawHash, 16) % 10000
  const samplingDecision = samplingHash < normalized.sampleRateBps ? 'sampled_in' : 'sampled_out'
  return {
    ok: true,
    reasonCode: samplingDecision === 'sampled_in'
      ? B_SIGNAL_EVENT_REASON_CODES.SAMPLED_IN_EMIT
      : B_SIGNAL_EVENT_REASON_CODES.SAMPLED_OUT_NO_EMIT,
    samplingHash,
    samplingDecision
  }
}

function computeIdempotencyKey(event) {
  const seed = [
    event.traceKey,
    event.requestKey,
    event.attemptKey,
    event.opportunityKey,
    'signal_normalized',
    event.samplingRuleVersion,
    event.signalNormalizedEventContractVersion
  ].join('|')
  return sha256(seed)
}

function normalizeAck(rawAck, event, nowFn) {
  const ack = isPlainObject(rawAck) ? rawAck : {}
  const ackStatus = VALID_ACK_STATUSES.has(ack.ackStatus) ? ack.ackStatus : 'rejected'

  let retryable = ack.retryable === true
  let ackReasonCode = normalizeText(ack.ackReasonCode)
  if (!ackReasonCode) {
    if (ackStatus === 'accepted') {
      ackReasonCode = B_SIGNAL_EVENT_REASON_CODES.ACK_ACCEPTED
      retryable = false
    } else if (ackStatus === 'duplicate') {
      ackReasonCode = B_SIGNAL_EVENT_REASON_CODES.ACK_DUPLICATE
      retryable = false
    } else {
      ackReasonCode = retryable
        ? B_SIGNAL_EVENT_REASON_CODES.ACK_REJECTED_RETRYABLE
        : B_SIGNAL_EVENT_REASON_CODES.ACK_REJECTED_NON_RETRYABLE
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

export function createSignalEventEmitterService(options = {}) {
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
  const eventKeyFactory = typeof options.eventKeyFactory === 'function'
    ? options.eventKeyFactory
    : () => `evt_b_sig_${generateUuidV7Like(nowFn())}`

  const eventStore = new Map()

  async function emitSignalNormalized(input = {}) {
    const normalized = normalizeEmitInput(input)
    const samplingResult = computeSignalSamplingDecision(normalized)

    if (!samplingResult.ok) {
      return {
        emitAccepted: false,
        emitAction: 'reject',
        reasonCode: B_SIGNAL_EVENT_REASON_CODES.SAMPLING_RULE_INVALID,
        samplingDecision: 'sampled_out',
        samplingHash: NaN,
        eventRefOrNA: 'NA',
        eventOrNA: null,
        ack: null,
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    if (samplingResult.samplingDecision === 'sampled_out') {
      return {
        emitAccepted: true,
        emitAction: 'skipped',
        reasonCode: B_SIGNAL_EVENT_REASON_CODES.SAMPLED_OUT_NO_EMIT,
        samplingDecision: 'sampled_out',
        samplingHash: samplingResult.samplingHash,
        eventRefOrNA: 'NA',
        eventOrNA: null,
        ack: null,
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    const eventAt = normalized.eventAt || nowIso(nowFn)
    const provisionalEvent = {
      eventKey: '',
      eventIdempotencyKey: '',
      eventType: 'signal_normalized',
      traceKey: normalized.traceInitLite.traceKey,
      requestKey: normalized.traceInitLite.requestKey,
      attemptKey: normalized.traceInitLite.attemptKey,
      opportunityKey: normalized.opportunityKey,
      samplingDecision: 'sampled_in',
      samplingRuleVersion: normalized.samplingRuleVersion,
      eventAt,
      mappingProfileVersion: normalized.mappingProfileVersion,
      enumDictVersion: normalized.enumDictVersion,
      bucketDictVersion: normalized.bucketDictVersion,
      signalNormalizedEventContractVersion: normalized.signalNormalizedEventContractVersion,
      sampledSemanticSlots: normalized.sampledSemanticSlots,
      mappingAuditSnapshotRefOrNA: normalized.mappingAuditSnapshotRefOrNA || 'NA',
      bucketAuditSnapshotRefOrNA: normalized.bucketAuditSnapshotRefOrNA || 'NA'
    }

    const eventIdempotencyKey = computeIdempotencyKey(provisionalEvent)
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
          reasonCode: B_SIGNAL_EVENT_REASON_CODES.PAYLOAD_CONFLICT,
          samplingDecision: 'sampled_in',
          samplingHash: samplingResult.samplingHash,
          eventRefOrNA: existing.event.eventKey,
          eventOrNA: existing.event,
          ack: {
            eventKey: existing.event.eventKey,
            eventIdempotencyKey,
            ackStatus: 'rejected',
            ackReasonCode: B_SIGNAL_EVENT_REASON_CODES.PAYLOAD_CONFLICT,
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
        reasonCode: B_SIGNAL_EVENT_REASON_CODES.ACK_DUPLICATE,
        samplingDecision: 'sampled_in',
        samplingHash: samplingResult.samplingHash,
        eventRefOrNA: existing.event.eventKey,
        eventOrNA: existing.event,
        ack: {
          eventKey: existing.event.eventKey,
          eventIdempotencyKey,
          ackStatus: 'duplicate',
          ackReasonCode: B_SIGNAL_EVENT_REASON_CODES.ACK_DUPLICATE,
          retryable: false,
          ackedAt: nowIso(nowFn)
        },
        attemptCount: 0,
        retryScheduleAppliedMs: []
      }
    }

    eventStore.set(eventIdempotencyKey, {
      event,
      payloadHash: currentPayloadHash
    })

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
          samplingDecision: 'sampled_in',
          samplingHash: samplingResult.samplingHash,
          emitReasonCode: B_SIGNAL_EVENT_REASON_CODES.SAMPLED_IN_EMIT,
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
          reasonCode: B_SIGNAL_EVENT_REASON_CODES.RETRY_EXHAUSTED,
          samplingDecision: 'sampled_in',
          samplingHash: samplingResult.samplingHash,
          emitReasonCode: B_SIGNAL_EVENT_REASON_CODES.SAMPLED_IN_EMIT,
          eventRefOrNA: event.eventKey,
          eventOrNA: event,
          ack: {
            eventKey: event.eventKey,
            eventIdempotencyKey,
            ackStatus: 'rejected',
            ackReasonCode: B_SIGNAL_EVENT_REASON_CODES.RETRY_EXHAUSTED,
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
    emitSignalNormalized,
    _debug: {
      eventStore
    }
  }
}
