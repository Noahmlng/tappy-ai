import crypto from 'node:crypto'

export const G_APPEND_ACK_STATUSES = Object.freeze({
  ACCEPTED: 'accepted',
  QUEUED: 'queued',
  REJECTED: 'rejected'
})

export const G_APPEND_REASON_CODES = Object.freeze({
  DUPLICATE_ACCEPTED_NOOP: 'g_append_duplicate_accepted_noop',
  PAYLOAD_CONFLICT: 'g_append_payload_conflict',
  MISSING_REQUIRED: 'g_append_missing_required',
  INVALID_SCHEMA_VERSION: 'g_append_invalid_schema_version',
  PAYLOAD_TOO_LARGE: 'g_append_payload_too_large',
  RATE_LIMITED: 'g_append_rate_limited',
  INTERNAL_UNAVAILABLE: 'g_append_internal_unavailable',
  AUTH_FAILED: 'g_append_auth_failed',
  ASYNC_BUFFERED: 'g_append_async_buffered',
  ASYNC_RETRY_SCHEDULED: 'g_append_async_retry_scheduled',
  ACCEPTED_COMMITTED: 'g_append_accepted_committed'
})

function normalizeText(value) {
  return String(value ?? '').trim()
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString()
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

function stableStringify(value) {
  return JSON.stringify(stableClone(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function buildAppendToken(dedupKey) {
  return `g_app_${sha256(dedupKey).slice(0, 24)}`
}

function byteSizeUtf8(value) {
  return Buffer.byteLength(String(value), 'utf8')
}

function pickAckRetryable(reasonCode) {
  if (
    reasonCode === G_APPEND_REASON_CODES.PAYLOAD_CONFLICT ||
    reasonCode === G_APPEND_REASON_CODES.INVALID_SCHEMA_VERSION ||
    reasonCode === G_APPEND_REASON_CODES.AUTH_FAILED
  ) {
    return false
  }
  if (
    reasonCode === G_APPEND_REASON_CODES.MISSING_REQUIRED ||
    reasonCode === G_APPEND_REASON_CODES.PAYLOAD_TOO_LARGE ||
    reasonCode === G_APPEND_REASON_CODES.RATE_LIMITED ||
    reasonCode === G_APPEND_REASON_CODES.INTERNAL_UNAVAILABLE
  ) {
    return true
  }
  return false
}

function requiredMissing(value, paths = []) {
  const missing = []
  for (const path of paths) {
    const parts = String(path).split('.')
    let cursor = value
    let absent = false
    for (const part of parts) {
      if (!isPlainObject(cursor) || !(part in cursor)) {
        absent = true
        break
      }
      cursor = cursor[part]
    }
    if (absent || cursor === undefined || cursor === null || (typeof cursor === 'string' && normalizeText(cursor) === '')) {
      missing.push(path)
    }
  }
  return missing
}

function normalizeAuditRecordForDigest(auditRecord) {
  const snapshot = stableClone(auditRecord || {})
  delete snapshot.appendAt
  delete snapshot.requestId
  delete snapshot.idempotencyKey
  delete snapshot.extensions
  return snapshot
}

function validateAuditRecordStructure(auditRecord = {}) {
  const missing = requiredMissing(auditRecord, [
    'auditRecordId',
    'opportunityKey',
    'traceKey',
    'requestKey',
    'attemptKey',
    'responseReferenceOrNA',
    'auditAt',
    'opportunityInputSnapshot.requestSchemaVersion',
    'opportunityInputSnapshot.placementKey',
    'opportunityInputSnapshot.placementType',
    'opportunityInputSnapshot.placementSurface',
    'opportunityInputSnapshot.policyContextDigest',
    'opportunityInputSnapshot.userContextDigest',
    'opportunityInputSnapshot.opportunityContextDigest',
    'opportunityInputSnapshot.ingressReceivedAt',
    'adapterParticipation',
    'winnerSnapshot.winnerAdapterIdOrNA',
    'winnerSnapshot.winnerCandidateRefOrNA',
    'winnerSnapshot.winnerBidPriceOrNA',
    'winnerSnapshot.winnerCurrencyOrNA',
    'winnerSnapshot.winnerReasonCode',
    'winnerSnapshot.winnerSelectedAtOrNA',
    'renderResultSnapshot.renderStatus',
    'renderResultSnapshot.renderAttemptIdOrNA',
    'renderResultSnapshot.renderStartAtOrNA',
    'renderResultSnapshot.renderEndAtOrNA',
    'renderResultSnapshot.renderLatencyMsOrNA',
    'renderResultSnapshot.renderReasonCodeOrNA',
    'keyEventSummary.eventWindowStartAt',
    'keyEventSummary.eventWindowEndAt',
    'keyEventSummary.impressionCount',
    'keyEventSummary.clickCount',
    'keyEventSummary.failureCount',
    'keyEventSummary.interactionCount',
    'keyEventSummary.postbackCount',
    'keyEventSummary.terminalEventTypeOrNA',
    'keyEventSummary.terminalEventAtOrNA',
    'auditRecordVersion',
    'auditRuleVersion',
    'auditContractVersion'
  ])
  if (missing.length > 0) {
    return {
      ok: false,
      reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
      missing
    }
  }

  if (!Array.isArray(auditRecord.adapterParticipation) || auditRecord.adapterParticipation.length === 0) {
    return {
      ok: false,
      reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
      missing: ['adapterParticipation[]']
    }
  }

  for (let index = 0; index < auditRecord.adapterParticipation.length; index += 1) {
    const item = auditRecord.adapterParticipation[index] || {}
    const itemMissing = requiredMissing(item, [
      'adapterId',
      'adapterRequestId',
      'requestSentAt',
      'responseReceivedAtOrNA',
      'responseStatus',
      'responseLatencyMsOrNA',
      'timeoutThresholdMs',
      'didTimeout',
      'responseCodeOrNA',
      'candidateReceivedCount',
      'candidateAcceptedCount',
      'filterReasonCodes'
    ])
    if (itemMissing.length > 0) {
      return {
        ok: false,
        reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
        missing: itemMissing.map((field) => `adapterParticipation[${index}].${field}`)
      }
    }

    const responseStatus = normalizeText(item.responseStatus)
    if (responseStatus === 'responded') {
      if (!normalizeText(item.responseReceivedAtOrNA) || item.responseLatencyMsOrNA === 'NA') {
        return {
          ok: false,
          reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
          missing: [`adapterParticipation[${index}].responseReceivedAtOrNA/responseLatencyMsOrNA`]
        }
      }
    }
    if (responseStatus === 'timeout') {
      if (item.didTimeout !== true || Number(item.timeoutThresholdMs) <= 0) {
        return {
          ok: false,
          reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
          missing: [`adapterParticipation[${index}].didTimeout/timeoutThresholdMs`]
        }
      }
    }
  }

  const winnerAdapterId = normalizeText(auditRecord?.winnerSnapshot?.winnerAdapterIdOrNA)
  if (winnerAdapterId && winnerAdapterId !== 'NA') {
    const hit = auditRecord.adapterParticipation.some((item) => normalizeText(item.adapterId) === winnerAdapterId)
    if (!hit) {
      return {
        ok: false,
        reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
        missing: ['winnerSnapshot.winnerAdapterIdOrNA(adapterParticipation mismatch)']
      }
    }
  }

  const renderStatus = normalizeText(auditRecord?.renderResultSnapshot?.renderStatus)
  if ((renderStatus === 'rendered' || renderStatus === 'failed') && !normalizeText(auditRecord?.renderResultSnapshot?.renderAttemptIdOrNA)) {
    return {
      ok: false,
      reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
      missing: ['renderResultSnapshot.renderAttemptIdOrNA']
    }
  }

  const terminalType = normalizeText(auditRecord?.keyEventSummary?.terminalEventTypeOrNA)
  if (terminalType && terminalType !== 'NA' && !normalizeText(auditRecord?.keyEventSummary?.terminalEventAtOrNA)) {
    return {
      ok: false,
      reasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
      missing: ['keyEventSummary.terminalEventAtOrNA']
    }
  }

  return {
    ok: true,
    reasonCode: G_APPEND_REASON_CODES.ACCEPTED_COMMITTED
  }
}

function resolveDedupKey(request, payloadDigest) {
  const idempotencyKey = normalizeText(request.idempotencyKey)
  if (idempotencyKey) {
    return {
      keySource: 'idempotency_key',
      dedupKey: `g_append_v1:idempotency:${idempotencyKey}`
    }
  }

  const auditRecordId = normalizeText(request?.auditRecord?.auditRecordId)
  if (auditRecordId) {
    return {
      keySource: 'audit_record_id',
      dedupKey: `g_append_v1:audit_record_id:${auditRecordId}`
    }
  }

  const opportunityKey = normalizeText(request?.auditRecord?.opportunityKey)
  const traceKey = normalizeText(request?.auditRecord?.traceKey)
  const auditRecordVersion = normalizeText(request?.auditRecord?.auditRecordVersion)
  if (!opportunityKey || !traceKey || !auditRecordId || !auditRecordVersion) {
    return null
  }
  const computed = sha256(`${opportunityKey}|${traceKey}|${auditRecordId}|${auditRecordVersion}|${payloadDigest}`)
  return {
    keySource: 'computed_v2',
    dedupKey: `g_append_v2:computed:${computed}`
  }
}

function createAck({
  requestId,
  ackStatus,
  ackReasonCode,
  retryable,
  appendToken,
  nowMs
}) {
  const ack = {
    requestId,
    ackStatus,
    ackReasonCode,
    retryable: retryable === true,
    ackAt: nowIso(nowMs)
  }
  if (appendToken && (ackStatus === G_APPEND_ACK_STATUSES.ACCEPTED || ackStatus === G_APPEND_ACK_STATUSES.QUEUED)) {
    ack.appendToken = appendToken
  }
  return ack
}

export function createAuditStore(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const appendDedupWindowMs = Number.isFinite(Number(options.appendDedupWindowMs))
    ? Number(options.appendDedupWindowMs)
    : 7 * 24 * 60 * 60 * 1000
  const maxPayloadBytes = Number.isFinite(Number(options.maxPayloadBytes))
    ? Number(options.maxPayloadBytes)
    : 512 * 1024
  const supportedAppendContractVersions = new Set(
    (options.supportedAppendContractVersions || ['g_append_v1'])
      .map((item) => normalizeText(item))
      .filter(Boolean)
  )
  const dedupStore = options.dedupStore instanceof Map ? options.dedupStore : new Map()
  const appendTokenIndex = options.appendTokenIndex instanceof Map ? options.appendTokenIndex : new Map()
  const queueStore = options.queueStore instanceof Map ? options.queueStore : new Map()
  const authChecker = typeof options.authChecker === 'function' ? options.authChecker : null
  const rateLimiter = typeof options.rateLimiter === 'function' ? options.rateLimiter : null
  const unavailableChecker = typeof options.unavailableChecker === 'function' ? options.unavailableChecker : null

  function append(requestInput = {}) {
    const nowMs = nowFn()
    const request = requestInput && typeof requestInput === 'object' ? requestInput : {}
    const requestId = normalizeText(request.requestId) || 'NA'
    const appendAt = normalizeText(request.appendAt)
    const appendContractVersion = normalizeText(request.appendContractVersion)
    const auditRecord = request.auditRecord

    if (!requestId || !appendAt || !appendContractVersion || !isPlainObject(auditRecord)) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
        retryable: pickAckRetryable(G_APPEND_REASON_CODES.MISSING_REQUIRED),
        nowMs
      })
    }

    if (!supportedAppendContractVersions.has(appendContractVersion)) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: G_APPEND_REASON_CODES.INVALID_SCHEMA_VERSION,
        retryable: pickAckRetryable(G_APPEND_REASON_CODES.INVALID_SCHEMA_VERSION),
        nowMs
      })
    }

    if (authChecker && authChecker(request) === false) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: G_APPEND_REASON_CODES.AUTH_FAILED,
        retryable: pickAckRetryable(G_APPEND_REASON_CODES.AUTH_FAILED),
        nowMs
      })
    }

    if (rateLimiter && rateLimiter(request) === false) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: G_APPEND_REASON_CODES.RATE_LIMITED,
        retryable: pickAckRetryable(G_APPEND_REASON_CODES.RATE_LIMITED),
        nowMs
      })
    }

    if (unavailableChecker && unavailableChecker(request) === true) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: G_APPEND_REASON_CODES.INTERNAL_UNAVAILABLE,
        retryable: pickAckRetryable(G_APPEND_REASON_CODES.INTERNAL_UNAVAILABLE),
        nowMs
      })
    }

    const payloadValidation = validateAuditRecordStructure(auditRecord)
    if (!payloadValidation.ok) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: payloadValidation.reasonCode,
        retryable: pickAckRetryable(payloadValidation.reasonCode),
        nowMs
      })
    }

    const normalizedAuditRecord = normalizeAuditRecordForDigest(auditRecord)
    const payloadDigest = sha256(stableStringify(normalizedAuditRecord))
    const payloadBytes = byteSizeUtf8(stableStringify(auditRecord))
    if (payloadBytes > maxPayloadBytes) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: G_APPEND_REASON_CODES.PAYLOAD_TOO_LARGE,
        retryable: pickAckRetryable(G_APPEND_REASON_CODES.PAYLOAD_TOO_LARGE),
        nowMs
      })
    }

    const dedupKeyInfo = resolveDedupKey(request, payloadDigest)
    if (!dedupKeyInfo) {
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
        ackReasonCode: G_APPEND_REASON_CODES.MISSING_REQUIRED,
        retryable: pickAckRetryable(G_APPEND_REASON_CODES.MISSING_REQUIRED),
        nowMs
      })
    }
    const dedupKey = dedupKeyInfo.dedupKey
    const existing = dedupStore.get(dedupKey)

    if (existing && nowMs - existing.firstSeenAtMs <= appendDedupWindowMs) {
      if (existing.payloadDigest !== payloadDigest) {
        return createAck({
          requestId,
          ackStatus: G_APPEND_ACK_STATUSES.REJECTED,
          ackReasonCode: G_APPEND_REASON_CODES.PAYLOAD_CONFLICT,
          retryable: pickAckRetryable(G_APPEND_REASON_CODES.PAYLOAD_CONFLICT),
          nowMs
        })
      }
      return createAck({
        requestId,
        ackStatus: G_APPEND_ACK_STATUSES.ACCEPTED,
        ackReasonCode: G_APPEND_REASON_CODES.DUPLICATE_ACCEPTED_NOOP,
        retryable: false,
        appendToken: existing.appendToken,
        nowMs
      })
    }

    const appendToken = buildAppendToken(`${dedupKey}|${payloadDigest}`)
    const queueReasonCode = Number(request.retrySequence) > 0
      ? G_APPEND_REASON_CODES.ASYNC_RETRY_SCHEDULED
      : G_APPEND_REASON_CODES.ASYNC_BUFFERED
    const preferSync = request.forceSync === true || request.processingMode === 'sync'
    const ackStatus = preferSync ? G_APPEND_ACK_STATUSES.ACCEPTED : G_APPEND_ACK_STATUSES.QUEUED
    const ackReasonCode = preferSync ? G_APPEND_REASON_CODES.ACCEPTED_COMMITTED : queueReasonCode

    dedupStore.set(dedupKey, {
      dedupKey,
      keySource: dedupKeyInfo.keySource,
      payloadDigest,
      appendToken,
      firstSeenAtMs: nowMs,
      appendRequestIds: [requestId],
      auditRecord: stableClone(auditRecord),
      appendContractVersion
    })
    appendTokenIndex.set(appendToken, dedupKey)
    if (!preferSync) {
      queueStore.set(appendToken, {
        appendToken,
        dedupKey,
        payloadDigest,
        enqueuedAtMs: nowMs,
        queueReasonCode
      })
    }

    return createAck({
      requestId,
      ackStatus,
      ackReasonCode,
      retryable: false,
      appendToken,
      nowMs
    })
  }

  function getByAppendToken(appendToken) {
    const dedupKey = appendTokenIndex.get(normalizeText(appendToken))
    if (!dedupKey) return null
    const record = dedupStore.get(dedupKey)
    return record ? stableClone(record) : null
  }

  return {
    append,
    getByAppendToken,
    _debug: {
      dedupStore,
      appendTokenIndex,
      queueStore
    }
  }
}
