import assert from 'node:assert/strict'
import test from 'node:test'

import {
  G_APPEND_ACK_STATUSES,
  G_APPEND_REASON_CODES,
  createAuditStore
} from '../../src/mediation/audit-replay/audit-store.js'
import { createAppendController } from '../../src/mediation/audit-replay/append-controller.js'

function buildAdapterParticipation(overrides = {}) {
  return {
    adapterId: 'cj',
    adapterRequestId: 'adapter_req_001',
    requestSentAt: '2026-02-22T10:00:00.000Z',
    responseReceivedAtOrNA: '2026-02-22T10:00:00.120Z',
    responseStatus: 'responded',
    responseLatencyMsOrNA: 120,
    timeoutThresholdMs: 1000,
    didTimeout: false,
    responseCodeOrNA: '200',
    candidateReceivedCount: 2,
    candidateAcceptedCount: 1,
    filterReasonCodes: [],
    ...overrides
  }
}

function buildAuditRecord(overrides = {}) {
  const adapterParticipation = overrides.adapterParticipation || [buildAdapterParticipation()]
  return {
    auditRecordId: 'audit_001',
    opportunityKey: 'opp_001',
    traceKey: 'trace_001',
    requestKey: 'req_001',
    attemptKey: 'att_001',
    responseReferenceOrNA: 'resp_001',
    auditAt: '2026-02-22T10:00:00.900Z',
    opportunityInputSnapshot: {
      requestSchemaVersion: 'a_trigger_contract_v1',
      placementKey: 'chat_inline',
      placementType: 'native',
      placementSurface: 'chat',
      policyContextDigest: 'p_ctx',
      userContextDigest: 'u_ctx',
      opportunityContextDigest: 'o_ctx',
      ingressReceivedAt: '2026-02-22T10:00:00.000Z'
    },
    adapterParticipation,
    winnerSnapshot: {
      winnerAdapterIdOrNA: 'cj',
      winnerCandidateRefOrNA: 'cand_001',
      winnerBidPriceOrNA: 1.2,
      winnerCurrencyOrNA: 'USD',
      winnerReasonCode: 'd_route_winner_selected',
      winnerSelectedAtOrNA: '2026-02-22T10:00:00.200Z'
    },
    renderResultSnapshot: {
      renderStatus: 'rendered',
      renderAttemptIdOrNA: 'render_001',
      renderStartAtOrNA: '2026-02-22T10:00:00.220Z',
      renderEndAtOrNA: '2026-02-22T10:00:00.260Z',
      renderLatencyMsOrNA: 40,
      renderReasonCodeOrNA: 'e_render_success'
    },
    keyEventSummary: {
      eventWindowStartAt: '2026-02-22T10:00:00.220Z',
      eventWindowEndAt: '2026-02-22T10:02:00.000Z',
      impressionCount: 1,
      clickCount: 0,
      failureCount: 0,
      interactionCount: 0,
      postbackCount: 0,
      terminalEventTypeOrNA: 'impression',
      terminalEventAtOrNA: '2026-02-22T10:00:00.300Z'
    },
    auditRecordVersion: 'g_audit_record_v1',
    auditRuleVersion: 'g_audit_rule_v1',
    auditContractVersion: 'g_audit_contract_v1',
    ...overrides
  }
}

function buildAppendRequest(overrides = {}) {
  return {
    requestId: 'req_append_001',
    appendAt: '2026-02-22T10:00:01.000Z',
    appendContractVersion: 'g_append_v1',
    auditRecord: buildAuditRecord(),
    ...overrides
  }
}

test('g-append: valid request returns queued + appendToken and can be fetched from store', async () => {
  const store = createAuditStore({
    nowFn: () => Date.parse('2026-02-22T10:00:02.000Z')
  })
  const controller = createAppendController({
    auditStore: store
  })

  const response = await controller.handleAppend(buildAppendRequest())

  assert.equal(response.statusCode, 202)
  assert.equal(response.body.ackStatus, G_APPEND_ACK_STATUSES.QUEUED)
  assert.equal(response.body.ackReasonCode, G_APPEND_REASON_CODES.ASYNC_BUFFERED)
  assert.equal(response.body.retryable, false)
  assert.equal(typeof response.body.appendToken, 'string')
  assert.equal(response.body.appendToken.startsWith('g_app_'), true)

  const stored = store.getByAppendToken(response.body.appendToken)
  assert.equal(Boolean(stored), true)
  assert.equal(stored.auditRecord.auditRecordId, 'audit_001')
})

test('g-append: sync mode returns accepted and includes appendToken', async () => {
  const controller = createAppendController({
    auditStore: createAuditStore({
      nowFn: () => Date.parse('2026-02-22T10:10:02.000Z')
    })
  })

  const response = await controller.handleAppend(
    buildAppendRequest({
      requestId: 'req_append_sync_001',
      processingMode: 'sync'
    })
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.ackStatus, G_APPEND_ACK_STATUSES.ACCEPTED)
  assert.equal(response.body.ackReasonCode, G_APPEND_REASON_CODES.ACCEPTED_COMMITTED)
  assert.equal(typeof response.body.appendToken, 'string')
})

test('g-append: duplicate no-op and payload conflict are distinguishable', async () => {
  const controller = createAppendController({
    auditStore: createAuditStore({
      nowFn: () => Date.parse('2026-02-22T11:00:00.000Z')
    })
  })

  const first = await controller.handleAppend(
    buildAppendRequest({
      requestId: 'req_append_dupe_1',
      idempotencyKey: 'append-fixed-key-001'
    })
  )
  assert.equal(first.statusCode, 202)
  assert.equal(first.body.ackStatus, G_APPEND_ACK_STATUSES.QUEUED)

  const duplicate = await controller.handleAppend(
    buildAppendRequest({
      requestId: 'req_append_dupe_2',
      idempotencyKey: 'append-fixed-key-001'
    })
  )
  assert.equal(duplicate.statusCode, 200)
  assert.equal(duplicate.body.ackStatus, G_APPEND_ACK_STATUSES.ACCEPTED)
  assert.equal(duplicate.body.ackReasonCode, G_APPEND_REASON_CODES.DUPLICATE_ACCEPTED_NOOP)
  assert.equal(duplicate.body.appendToken, first.body.appendToken)

  const conflicted = await controller.handleAppend(
    buildAppendRequest({
      requestId: 'req_append_dupe_3',
      idempotencyKey: 'append-fixed-key-001',
      auditRecord: buildAuditRecord({
        winnerSnapshot: {
          winnerAdapterIdOrNA: 'cj',
          winnerCandidateRefOrNA: 'cand_001',
          winnerBidPriceOrNA: 1.9,
          winnerCurrencyOrNA: 'USD',
          winnerReasonCode: 'd_route_winner_selected_changed',
          winnerSelectedAtOrNA: '2026-02-22T10:00:00.200Z'
        }
      })
    })
  )

  assert.equal(conflicted.statusCode, 409)
  assert.equal(conflicted.body.ackStatus, G_APPEND_ACK_STATUSES.REJECTED)
  assert.equal(conflicted.body.ackReasonCode, G_APPEND_REASON_CODES.PAYLOAD_CONFLICT)
  assert.equal(conflicted.body.retryable, false)
  assert.equal('appendToken' in conflicted.body, false)
})

test('g-append: rejected reason code maps include retryability contract', async () => {
  const baseNow = Date.parse('2026-02-22T12:00:00.000Z')

  const missingRequiredController = createAppendController({
    auditStore: createAuditStore({ nowFn: () => baseNow })
  })
  const missingRequired = await missingRequiredController.handleAppend({ requestId: 'missing_only' })
  assert.equal(missingRequired.statusCode, 400)
  assert.equal(missingRequired.body.ackStatus, G_APPEND_ACK_STATUSES.REJECTED)
  assert.equal(missingRequired.body.ackReasonCode, G_APPEND_REASON_CODES.MISSING_REQUIRED)
  assert.equal(missingRequired.body.retryable, true)

  const invalidSchemaController = createAppendController({
    auditStore: createAuditStore({ nowFn: () => baseNow })
  })
  const invalidSchema = await invalidSchemaController.handleAppend(
    buildAppendRequest({ appendContractVersion: 'g_append_v_unknown' })
  )
  assert.equal(invalidSchema.statusCode, 400)
  assert.equal(invalidSchema.body.ackReasonCode, G_APPEND_REASON_CODES.INVALID_SCHEMA_VERSION)
  assert.equal(invalidSchema.body.retryable, false)

  const payloadTooLargeController = createAppendController({
    auditStore: createAuditStore({
      nowFn: () => baseNow,
      maxPayloadBytes: 64
    })
  })
  const payloadTooLarge = await payloadTooLargeController.handleAppend(buildAppendRequest())
  assert.equal(payloadTooLarge.statusCode, 413)
  assert.equal(payloadTooLarge.body.ackReasonCode, G_APPEND_REASON_CODES.PAYLOAD_TOO_LARGE)
  assert.equal(payloadTooLarge.body.retryable, true)

  const authFailedController = createAppendController({
    auditStore: createAuditStore({
      nowFn: () => baseNow,
      authChecker: () => false
    })
  })
  const authFailed = await authFailedController.handleAppend(buildAppendRequest())
  assert.equal(authFailed.statusCode, 401)
  assert.equal(authFailed.body.ackReasonCode, G_APPEND_REASON_CODES.AUTH_FAILED)
  assert.equal(authFailed.body.retryable, false)

  const rateLimitedController = createAppendController({
    auditStore: createAuditStore({
      nowFn: () => baseNow,
      rateLimiter: () => false
    })
  })
  const rateLimited = await rateLimitedController.handleAppend(buildAppendRequest())
  assert.equal(rateLimited.statusCode, 429)
  assert.equal(rateLimited.body.ackReasonCode, G_APPEND_REASON_CODES.RATE_LIMITED)
  assert.equal(rateLimited.body.retryable, true)

  const unavailableController = createAppendController({
    auditStore: createAuditStore({
      nowFn: () => baseNow,
      unavailableChecker: () => true
    })
  })
  const unavailable = await unavailableController.handleAppend(buildAppendRequest())
  assert.equal(unavailable.statusCode, 503)
  assert.equal(unavailable.body.ackReasonCode, G_APPEND_REASON_CODES.INTERNAL_UNAVAILABLE)
  assert.equal(unavailable.body.retryable, true)
})

test('g-append: winner adapter mismatch is rejected as missing required consistency', async () => {
  const controller = createAppendController({
    auditStore: createAuditStore({
      nowFn: () => Date.parse('2026-02-22T13:00:00.000Z')
    })
  })

  const response = await controller.handleAppend(
    buildAppendRequest({
      requestId: 'req_append_bad_winner_1',
      auditRecord: buildAuditRecord({
        winnerSnapshot: {
          winnerAdapterIdOrNA: 'partnerstack',
          winnerCandidateRefOrNA: 'cand_001',
          winnerBidPriceOrNA: 1.2,
          winnerCurrencyOrNA: 'USD',
          winnerReasonCode: 'd_route_winner_selected',
          winnerSelectedAtOrNA: '2026-02-22T10:00:00.200Z'
        }
      })
    })
  )

  assert.equal(response.statusCode, 400)
  assert.equal(response.body.ackStatus, G_APPEND_ACK_STATUSES.REJECTED)
  assert.equal(response.body.ackReasonCode, G_APPEND_REASON_CODES.MISSING_REQUIRED)
  assert.equal(response.body.retryable, true)
})
