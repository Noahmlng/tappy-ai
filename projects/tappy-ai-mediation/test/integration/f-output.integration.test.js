import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'

import {
  F_FACTS_REASON_CODES,
  createFactsMapper
} from '../../src/mediation/event-attribution/facts-mapper.js'
import {
  F_ARCHIVE_RECORD_REASON_CODES,
  createArchiveRecordBuilder
} from '../../src/mediation/event-attribution/archive-record-builder.js'

function buildBaseEvent(overrides = {}) {
  return {
    eventId: 'evt_f_output_001',
    eventType: 'impression',
    eventAt: '2026-02-22T12:00:00.000Z',
    traceKey: 'trace_f_output_001',
    requestKey: 'req_f_output_001',
    attemptKey: 'att_f_output_001',
    opportunityKey: 'opp_f_output_001',
    responseReference: 'resp_f_output_001',
    renderAttemptId: 'render_attempt_001',
    creativeId: 'creative_001',
    eventVersion: 'f_evt_v1',
    ...overrides
  }
}

function buildVersionAnchors(overrides = {}) {
  return {
    eventContractVersion: 'f_evt_v1',
    mappingRuleVersion: 'f_mapping_rule_v1',
    dedupFingerprintVersion: 'f_dedup_v1',
    closureRuleVersion: 'f_closure_rule_v1',
    billingRuleVersion: 'f_billing_rule_v1',
    archiveContractVersion: 'f_archive_contract_v1',
    ...overrides
  }
}

function expectedRecordKey(recordType, payloadKey, canonicalDedupKey, archiveContractVersion) {
  return crypto
    .createHash('sha256')
    .update(`${recordType}|${payloadKey}|${canonicalDedupKey}|${archiveContractVersion}`)
    .digest('hex')
}

test('f-output: impression with closed_success emits both billable and attribution facts', () => {
  const mapper = createFactsMapper({
    nowFn: () => Date.parse('2026-02-22T12:01:00.000Z')
  })

  const result = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_imp_001',
      eventType: 'impression'
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot: {
      closureKey: 'resp_f_output_001|render_attempt_001',
      state: 'closed_success'
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, F_FACTS_REASON_CODES.FACTS_MAPPED)
  assert.equal(result.billableFacts.length, 1)
  assert.equal(result.billableFacts[0].billableType, 'billable_impression')
  assert.equal(result.billableFacts[0].billingKey, 'resp_f_output_001|render_attempt_001|billable_impression')
  assert.equal(result.attributionFacts.length, 1)
  assert.equal(result.attributionFacts[0].attributionType, 'attr_impression')
  assert.equal(result.factDecisionAuditLite.decisionAction, 'both_emit')
})

test('f-output: single-attempt unique billing keeps second impression non-billable', () => {
  const mapper = createFactsMapper({
    nowFn: () => Date.parse('2026-02-22T12:02:00.000Z')
  })
  const closureSnapshot = {
    closureKey: 'resp_f_output_001|render_attempt_001',
    state: 'closed_success'
  }

  const first = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_imp_dup_1',
      eventType: 'impression'
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot
  })
  assert.equal(first.billableFacts.length, 1)

  const second = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_imp_dup_2',
      eventType: 'impression',
      eventAt: '2026-02-22T12:02:01.000Z'
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot
  })
  assert.equal(second.ok, true)
  assert.equal(second.billableFacts.length, 0)
  assert.equal(second.attributionFacts[0].attributionType, 'attr_impression_duplicate')
  assert.equal(
    second.factDecisionAuditLite.decisionReasonCode,
    F_FACTS_REASON_CODES.BILLING_CONFLICT_DUPLICATE_IMPRESSION
  )
})

test('f-output: click before impression is attribution pending without billable click', () => {
  const mapper = createFactsMapper({
    nowFn: () => Date.parse('2026-02-22T12:03:00.000Z')
  })
  const result = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_click_pending_1',
      eventType: 'click',
      clickTarget: 'cta_primary',
      eventSeq: 1
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot: {
      closureKey: 'resp_f_output_001|render_attempt_001',
      state: 'open'
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.billableFacts.length, 0)
  assert.equal(result.attributionFacts[0].attributionType, 'attr_click_pending')
  assert.equal(
    result.factDecisionAuditLite.decisionReasonCode,
    F_FACTS_REASON_CODES.BILLING_CLICK_WITHOUT_IMPRESSION
  )
})

test('f-output: click after billable impression emits billable_click once', () => {
  const mapper = createFactsMapper({
    nowFn: () => Date.parse('2026-02-22T12:04:00.000Z')
  })
  const closureSnapshot = {
    closureKey: 'resp_f_output_001|render_attempt_001',
    state: 'closed_success'
  }

  const impression = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_for_click_1',
      eventType: 'impression'
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot
  })
  assert.equal(impression.billableFacts.length, 1)

  const click = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_click_billable_1',
      eventType: 'click',
      clickTarget: 'cta_primary',
      eventSeq: 1
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot
  })
  assert.equal(click.billableFacts.length, 1)
  assert.equal(click.billableFacts[0].billableType, 'billable_click')
  assert.equal(click.billableFacts[0].billingKey, 'resp_f_output_001|render_attempt_001|billable_click')
})

test('f-output: click on closed_failure remains non-billable attribution', () => {
  const mapper = createFactsMapper({
    nowFn: () => Date.parse('2026-02-22T12:05:00.000Z')
  })
  const result = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_click_closed_failure_1',
      eventType: 'click',
      clickTarget: 'cta_primary',
      eventSeq: 1
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot: {
      closureKey: 'resp_f_output_001|render_attempt_001',
      state: 'closed_failure'
    }
  })

  assert.equal(result.billableFacts.length, 0)
  assert.equal(result.attributionFacts[0].attributionType, 'attr_click_non_billable')
  assert.equal(
    result.factDecisionAuditLite.decisionReasonCode,
    F_FACTS_REASON_CODES.BILLING_INELIGIBLE_TERMINAL_FAILURE
  )
})

test('f-output: archive record builder emits ordered decision -> billable -> attribution records', () => {
  const mapper = createFactsMapper({
    nowFn: () => Date.parse('2026-02-22T12:06:00.000Z')
  })
  const builder = createArchiveRecordBuilder({
    nowFn: () => Date.parse('2026-02-22T12:06:01.000Z')
  })

  const mapping = mapper.mapFacts({
    event: buildBaseEvent({
      eventId: 'evt_archive_order_1',
      eventType: 'impression'
    }),
    dedupAckStatus: 'accepted',
    closureSnapshot: {
      closureKey: 'resp_f_output_001|render_attempt_001',
      state: 'closed_success'
    }
  })

  const canonicalDedupKey = 'f_dedup_v1:client_event_id:app_main|batch_1|evt_archive_order_1'
  const records = builder.buildArchiveRecords({
    sourceEvent: buildBaseEvent({
      eventId: 'evt_archive_order_1',
      eventType: 'impression'
    }),
    sourceEventId: 'evt_archive_order_1',
    canonicalDedupKey,
    mappingResult: mapping,
    versionAnchors: buildVersionAnchors()
  })

  assert.equal(records.ok, true)
  assert.equal(records.fToGArchiveRecordsLite.length, 3)
  assert.deepEqual(
    records.fToGArchiveRecordsLite.map((item) => item.recordType),
    ['decision_audit', 'billable_fact', 'attribution_fact']
  )
  const billable = records.fToGArchiveRecordsLite.find((item) => item.recordType === 'billable_fact')
  const expected = expectedRecordKey(
    'billable_fact',
    mapping.billableFacts[0].billingKey,
    canonicalDedupKey,
    'f_archive_contract_v1'
  )
  assert.equal(billable.recordKey, expected)
})

test('f-output: same recordKey with same payload is idempotent no-op (duplicate)', () => {
  const mapper = createFactsMapper({
    nowFn: () => Date.parse('2026-02-22T12:07:00.000Z')
  })
  const builder = createArchiveRecordBuilder({
    nowFn: () => Date.parse('2026-02-22T12:07:01.000Z')
  })
  const sourceEvent = buildBaseEvent({
    eventId: 'evt_archive_idem_1',
    eventType: 'error',
    errorStage: 'render',
    errorCode: 'timeout'
  })
  const mapping = mapper.mapFacts({
    event: sourceEvent,
    dedupAckStatus: 'accepted',
    closureSnapshot: {
      closureKey: 'resp_f_output_001|render_attempt_001',
      state: 'open'
    }
  })
  const input = {
    sourceEvent,
    sourceEventId: sourceEvent.eventId,
    canonicalDedupKey: 'f_dedup_v1:computed:idem',
    mappingResult: mapping,
    versionAnchors: buildVersionAnchors()
  }

  const first = builder.buildArchiveRecords(input)
  assert.equal(first.ok, true)

  const second = builder.buildArchiveRecords(input)
  assert.equal(second.ok, true)
  assert.equal(
    second.fToGArchiveRecordsLite.every((item) => (
      item.recordStatus === 'duplicate' || item.recordStatus === 'new'
    )),
    true
  )
  assert.equal(
    second.fToGArchiveRecordsLite.some((item) => item.decisionReasonCode === F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_RECORDKEY_IDEMPOTENT_NOOP),
    true
  )
})

test('f-output: same recordKey with different payload becomes conflicted', () => {
  const builder = createArchiveRecordBuilder({
    nowFn: () => Date.parse('2026-02-22T12:08:00.000Z')
  })

  const sourceEvent = buildBaseEvent({
    eventId: 'evt_archive_conflict_1',
    eventType: 'error',
    errorStage: 'render',
    errorCode: 'timeout'
  })

  const firstPayload = {
    sourceEventId: 'evt_archive_conflict_1',
    mappingRuleVersion: 'f_mapping_rule_v1',
    decisionAction: 'attribution_emit',
    decisionReasonCode: 'f_first',
    conflictDecision: 'none',
    decidedAt: '2026-02-22T12:08:00.000Z'
  }
  const secondPayload = {
    ...firstPayload,
    decisionReasonCode: 'f_second'
  }

  const baseInput = {
    sourceEvent,
    sourceEventId: sourceEvent.eventId,
    canonicalDedupKey: 'f_dedup_v1:computed:conflict',
    versionAnchors: buildVersionAnchors()
  }

  const first = builder.buildArchiveRecords({
    ...baseInput,
    mappingResult: {
      billableFacts: [],
      attributionFacts: [],
      factDecisionAuditLite: firstPayload
    }
  })
  assert.equal(first.ok, true)

  const second = builder.buildArchiveRecords({
    ...baseInput,
    mappingResult: {
      billableFacts: [],
      attributionFacts: [],
      factDecisionAuditLite: secondPayload
    }
  })
  assert.equal(second.ok, false)
  assert.equal(second.reasonCode, F_ARCHIVE_RECORD_REASON_CODES.OUTPUT_RECORDKEY_PAYLOAD_MISMATCH)
  assert.equal(second.fToGArchiveRecordsLite[0].recordStatus, 'conflicted')
})
