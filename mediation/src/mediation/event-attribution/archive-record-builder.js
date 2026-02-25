import crypto from 'node:crypto'

export const F_ARCHIVE_RECORD_REASON_CODES = Object.freeze({
  RECORDS_READY: 'f_archive_records_ready',
  OUTPUT_MISSING_VERSION_ANCHOR: 'f_output_missing_version_anchor',
  OUTPUT_RECORDKEY_PAYLOAD_MISMATCH: 'f_output_recordkey_payload_mismatch',
  OUTPUT_RECORDKEY_IDEMPOTENT_NOOP: 'f_output_recordkey_idempotent_noop',
  OUTPUT_ARCHIVE_COMPENSATION_EXHAUSTED: 'f_output_archive_compensation_exhausted'
})

const RECORD_TYPE_ORDER = Object.freeze({
  decision_audit: 1,
  billable_fact: 2,
  attribution_fact: 3
})

const RETRYABLE_G_CODES = new Set([
  'g_archive_write_timeout',
  'g_archive_temporarily_unavailable',
  'g_archive_rate_limited'
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString()
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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function stringifyStable(value) {
  return JSON.stringify(stableClone(value))
}

function makeRecordKey(recordType, payloadKey, canonicalDedupKey, archiveContractVersion) {
  return sha256(`${recordType}|${payloadKey}|${canonicalDedupKey}|${archiveContractVersion}`)
}

function mustHaveVersionAnchors(versionAnchors) {
  const required = [
    'eventContractVersion',
    'mappingRuleVersion',
    'dedupFingerprintVersion',
    'closureRuleVersion',
    'billingRuleVersion',
    'archiveContractVersion'
  ]
  return required.filter((field) => !normalizeText(versionAnchors[field]))
}

function relationKeysFor({ sourceEvent, canonicalDedupKey, fact }) {
  const responseReference = normalizeText(sourceEvent.responseReference) || 'NA'
  const renderAttemptId = normalizeText(sourceEvent.renderAttemptId) || 'NA'
  const closureKey = responseReference !== 'NA' && renderAttemptId !== 'NA'
    ? `${responseReference}|${renderAttemptId}`
    : 'NA'
  const billingKey = normalizeText(fact.billingKey) || 'NA'
  const attributionKey = normalizeText(fact.attributionKey) || 'NA'
  return {
    closureKeyOrNA: closureKey,
    billingKeyOrNA: billingKey,
    attributionKeyOrNA: attributionKey,
    canonicalDedupKey: normalizeText(canonicalDedupKey)
  }
}

function sourceKeysFor(sourceEvent, sourceEventId) {
  return {
    eventId: normalizeText(sourceEvent.eventId) || normalizeText(sourceEventId),
    sourceEventId: normalizeText(sourceEventId) || normalizeText(sourceEvent.eventId),
    traceKey: normalizeText(sourceEvent.traceKey),
    requestKey: normalizeText(sourceEvent.requestKey),
    attemptKey: normalizeText(sourceEvent.attemptKey),
    opportunityKey: normalizeText(sourceEvent.opportunityKey),
    responseReferenceOrNA: normalizeText(sourceEvent.responseReference) || 'NA',
    renderAttemptIdOrNA: normalizeText(sourceEvent.renderAttemptId) || 'NA'
  }
}

function recordTypeFromPayloadType(payloadType) {
  if (payloadType === 'factDecisionAuditLite') return 'decision_audit'
  if (payloadType === 'billableFactLite') return 'billable_fact'
  return 'attribution_fact'
}

function payloadKeyFor(payloadType, payload) {
  if (payloadType === 'factDecisionAuditLite') return normalizeText(payload.sourceEventId)
  if (payloadType === 'billableFactLite') return normalizeText(payload.billingKey)
  return normalizeText(payload.attributionKey)
}

function compareRecordOrder(a, b) {
  const typeDiff = (RECORD_TYPE_ORDER[a.recordType] || 99) - (RECORD_TYPE_ORDER[b.recordType] || 99)
  if (typeDiff !== 0) return typeDiff
  const timeDiff = normalizeText(a.outputAt).localeCompare(normalizeText(b.outputAt))
  if (timeDiff !== 0) return timeDiff
  return normalizeText(a.recordKey).localeCompare(normalizeText(b.recordKey))
}

export function createArchiveRecordBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const archiveContractVersion = normalizeText(options.archiveContractVersion) || 'f_archive_contract_v1'
  const compensationWindowMs = Number.isFinite(Number(options.compensationWindowMs))
    ? Number(options.compensationWindowMs)
    : 15 * 60 * 1000
  const recordStore = options.recordStore instanceof Map ? options.recordStore : new Map()

  function upsertRecord(input = {}) {
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : nowFn()
    const payload = input.payload || {}
    const payloadType = normalizeText(input.payloadType)
    const sourceEvent = input.sourceEvent || {}
    const sourceEventId = normalizeText(input.sourceEventId || payload.sourceEventId || sourceEvent.eventId)
    const canonicalDedupKey = normalizeText(input.canonicalDedupKey)

    const versionAnchors = {
      eventContractVersion: normalizeText(input.versionAnchors?.eventContractVersion),
      mappingRuleVersion: normalizeText(input.versionAnchors?.mappingRuleVersion),
      dedupFingerprintVersion: normalizeText(input.versionAnchors?.dedupFingerprintVersion),
      closureRuleVersion: normalizeText(input.versionAnchors?.closureRuleVersion),
      billingRuleVersion: normalizeText(input.versionAnchors?.billingRuleVersion),
      archiveContractVersion: normalizeText(input.versionAnchors?.archiveContractVersion) || archiveContractVersion
    }
    const missingVersion = mustHaveVersionAnchors(versionAnchors)
    const payloadKey = payloadKeyFor(payloadType, payload)
    const recordType = recordTypeFromPayloadType(payloadType)
    const relationKeys = relationKeysFor({ sourceEvent, canonicalDedupKey, fact: payload })
    const sourceKeys = sourceKeysFor(sourceEvent, sourceEventId)
    const recordKey = makeRecordKey(
      recordType,
      payloadKey,
      canonicalDedupKey,
      versionAnchors.archiveContractVersion
    )
    const payloadDigest = sha256(stringifyStable(payload))

    const baseRecord = {
      recordKey,
      recordType,
      recordStatus: 'new',
      payloadRef: {
        payloadType,
        payloadKey
      },
      sourceKeys,
      relationKeys,
      versionAnchors,
      decisionReasonCode: normalizeText(input.decisionReasonCode) || F_ARCHIVE_RECORD_REASON_CODES.RECORDS_READY,
      outputAt: nowIso(nowMs)
    }

    if (missingVersion.length > 0) {
      return {
        ok: false,
        reasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_MISSING_VERSION_ANCHOR,
        record: {
          ...baseRecord,
          recordStatus: 'rejected',
          decisionReasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_MISSING_VERSION_ANCHOR
        },
        missingVersion
      }
    }

    if (recordType === 'billable_fact' && relationKeys.billingKeyOrNA === 'NA') {
      return {
        ok: false,
        reasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_MISSING_VERSION_ANCHOR,
        record: {
          ...baseRecord,
          recordStatus: 'rejected',
          decisionReasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_MISSING_VERSION_ANCHOR
        }
      }
    }
    if (recordType === 'attribution_fact' && relationKeys.attributionKeyOrNA === 'NA') {
      return {
        ok: false,
        reasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_MISSING_VERSION_ANCHOR,
        record: {
          ...baseRecord,
          recordStatus: 'rejected',
          decisionReasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_MISSING_VERSION_ANCHOR
        }
      }
    }

    const existing = recordStore.get(recordKey)
    if (existing) {
      if (existing.payloadDigest === payloadDigest) {
        return {
          ok: true,
          reasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_RECORDKEY_IDEMPOTENT_NOOP,
          record: {
            ...stableClone(existing.record),
            recordStatus: 'duplicate',
            decisionReasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_RECORDKEY_IDEMPOTENT_NOOP
          }
        }
      }

      return {
        ok: false,
        reasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_RECORDKEY_PAYLOAD_MISMATCH,
        record: {
          ...baseRecord,
          recordStatus: 'conflicted',
          decisionReasonCode: F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_RECORDKEY_PAYLOAD_MISMATCH,
          conflictWithRecordKey: recordKey
        }
      }
    }

    const record = stableClone(baseRecord)
    recordStore.set(recordKey, {
      payloadDigest,
      firstSeenAtMs: nowMs,
      retryState: {
        nextBackoffSec: 1,
        firstFailureAtMs: null,
        lastFailureCode: ''
      },
      record
    })
    return {
      ok: true,
      reasonCode: F_ARCHIVE_RECORD_REASON_CODES.RECORDS_READY,
      record
    }
  }

  function applyArchiveWriteOutcome(input = {}) {
    const recordKey = normalizeText(input.recordKey)
    const gReasonCode = normalizeText(input.gReasonCode)
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : nowFn()
    const existing = recordStore.get(recordKey)
    if (!existing) return null

    if (!gReasonCode) {
      existing.record.recordStatus = 'committed'
      existing.record.decisionReasonCode = F_ARCHIVE_RECORD_REASON_CODES.RECORDS_READY
      recordStore.set(recordKey, existing)
      return stableClone(existing.record)
    }

    if (RETRYABLE_G_CODES.has(gReasonCode)) {
      if (!existing.retryState.firstFailureAtMs) {
        existing.retryState.firstFailureAtMs = nowMs
      }
      const elapsed = nowMs - existing.retryState.firstFailureAtMs
      if (elapsed > compensationWindowMs) {
        existing.record.recordStatus = 'conflicted'
        existing.record.decisionReasonCode = F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_ARCHIVE_COMPENSATION_EXHAUSTED
      } else {
        existing.record.recordStatus = 'new'
        existing.record.decisionReasonCode = gReasonCode
        const next = existing.retryState.nextBackoffSec
        existing.retryState.nextBackoffSec = next === 1 ? 5 : (next === 5 ? 30 : (next === 30 ? 120 : 120))
      }
      existing.retryState.lastFailureCode = gReasonCode
      recordStore.set(recordKey, existing)
      return stableClone(existing.record)
    }

    existing.record.recordStatus = 'conflicted'
    existing.record.decisionReasonCode = gReasonCode
    recordStore.set(recordKey, existing)
    return stableClone(existing.record)
  }

  function buildArchiveRecords(input = {}) {
    const request = input || {}
    const nowMs = Number.isFinite(Number(request.nowMs)) ? Number(request.nowMs) : nowFn()
    const mappingResult = request.mappingResult || {}
    const sourceEvent = request.sourceEvent || {}
    const sourceEventId = normalizeText(request.sourceEventId || sourceEvent.eventId)
    const canonicalDedupKey = normalizeText(request.canonicalDedupKey)

    const versionAnchors = {
      eventContractVersion: normalizeText(request.versionAnchors?.eventContractVersion) || normalizeText(sourceEvent.eventVersion),
      mappingRuleVersion: normalizeText(request.versionAnchors?.mappingRuleVersion),
      dedupFingerprintVersion: normalizeText(request.versionAnchors?.dedupFingerprintVersion) || 'f_dedup_v1',
      closureRuleVersion: normalizeText(request.versionAnchors?.closureRuleVersion) || 'f_closure_rule_v1',
      billingRuleVersion: normalizeText(request.versionAnchors?.billingRuleVersion) || 'f_billing_rule_v1',
      archiveContractVersion: normalizeText(request.versionAnchors?.archiveContractVersion) || archiveContractVersion
    }

    const records = []
    const errors = []

    const decisionRecord = upsertRecord({
      payloadType: 'factDecisionAuditLite',
      payload: mappingResult.factDecisionAuditLite || {},
      sourceEvent,
      sourceEventId,
      canonicalDedupKey,
      decisionReasonCode: normalizeText(mappingResult?.factDecisionAuditLite?.decisionReasonCode),
      versionAnchors,
      nowMs
    })
    records.push(decisionRecord.record)
    if (!decisionRecord.ok) errors.push(decisionRecord.reasonCode)

    const billableFacts = Array.isArray(mappingResult.billableFacts) ? mappingResult.billableFacts : []
    for (const billableFact of billableFacts) {
      const result = upsertRecord({
        payloadType: 'billableFactLite',
        payload: billableFact,
        sourceEvent,
        sourceEventId,
        canonicalDedupKey,
        decisionReasonCode: normalizeText(mappingResult?.factDecisionAuditLite?.decisionReasonCode),
        versionAnchors,
        nowMs
      })
      records.push(result.record)
      if (!result.ok) errors.push(result.reasonCode)
    }

    const attributionFacts = Array.isArray(mappingResult.attributionFacts) ? mappingResult.attributionFacts : []
    for (const attributionFact of attributionFacts) {
      const result = upsertRecord({
        payloadType: 'attributionFactLite',
        payload: attributionFact,
        sourceEvent,
        sourceEventId,
        canonicalDedupKey,
        decisionReasonCode: normalizeText(mappingResult?.factDecisionAuditLite?.decisionReasonCode),
        versionAnchors,
        nowMs
      })
      records.push(result.record)
      if (!result.ok) errors.push(result.reasonCode)
    }

    const orderedRecords = [...records].sort(compareRecordOrder)
    const hasPending = orderedRecords.some((item) => item.recordStatus === 'new')
    const hasConflicted = orderedRecords.some((item) => item.recordStatus === 'conflicted')
    const hasBillableCommitted = orderedRecords.some(
      (item) => item.recordType === 'billable_fact' && item.recordStatus === 'committed'
    )
    const closureAggregateStatus = hasPending
      ? 'partial_pending'
      : (hasConflicted
        ? 'partial_timeout'
        : (hasBillableCommitted ? 'consistent_committed' : 'consistent_non_billable'))

    return {
      ok: errors.length === 0,
      reasonCode: errors.length === 0
        ? F_ARCHIVE_RECORD_REASON_CODES.RECORDS_READY
        : errors[0],
      fToGArchiveRecordsLite: orderedRecords,
      closureAggregateStatus
    }
  }

  function replayRecord(recordKey) {
    const existing = recordStore.get(normalizeText(recordKey))
    if (!existing) return null
    return stableClone(existing.record)
  }

  return {
    buildArchiveRecords,
    applyArchiveWriteOutcome,
    replayRecord,
    makeRecordKey,
    _debug: {
      recordStore
    }
  }
}
