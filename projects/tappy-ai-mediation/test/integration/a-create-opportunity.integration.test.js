import assert from 'node:assert/strict'
import test from 'node:test'

import {
  A_CREATE_OPPORTUNITY_REASON_CODES,
  A_DEDUP_STATES,
  createCreateOpportunityService
} from '../../src/mediation/ingress-opportunity/create-opportunity.js'

function baseInput(overrides = {}) {
  return {
    impSeed: [
      {
        impKey: 'imp_001',
        placementId: 'chat_from_answer_v1',
        placementType: 'inline',
        slotIndex: 0
      }
    ],
    timestamps: {
      requestAt: '2026-02-21T18:10:00.000Z',
      triggerAt: '2026-02-21T18:10:01.000Z',
      opportunityCreatedAt: '2026-02-21T18:10:02.000Z'
    },
    traceContext: {
      appId: 'app_chat_main',
      sessionId: 'sess_001',
      placementId: 'chat_from_answer_v1',
      triggerType: 'answer_end',
      triggerAt: '2026-02-21T18:10:01.000Z'
    },
    schemaVersion: 'schema_v1',
    state: 'received',
    createOpportunityContractVersion: 'a_create_opportunity_v1',
    dedupState: A_DEDUP_STATES.NEW,
    ...overrides
  }
}

test('a-create-opportunity: creates opportunity and outputs A->B minimal handoff contract', () => {
  const service = createCreateOpportunityService({
    nowFn: () => Date.parse('2026-02-21T18:10:03.000Z')
  })

  const result = service.createOpportunity(baseInput())

  assert.equal(result.createAccepted, true)
  assert.equal(result.createAction, 'created')
  assert.equal(result.resultState, 'received')
  assert.equal(result.errorAction, 'allow')
  assert.equal(result.traceInit.traceKey.startsWith('tr_'), true)
  assert.equal(result.traceInit.requestKey.startsWith('req_'), true)
  assert.equal(result.traceInit.attemptKey.startsWith('att_'), true)
  assert.equal(result.opportunityRefOrNA.startsWith('opp_'), true)

  assert.equal(Boolean(result.handoffPacketLiteOrNA), true)
  assert.equal(result.handoffPacketLiteOrNA.requestKey, result.traceInit.requestKey)
  assert.equal(result.handoffPacketLiteOrNA.opportunityKey, result.opportunityRefOrNA)
  assert.deepEqual(result.handoffPacketLiteOrNA.traceInit, result.traceInit)
})

test('a-create-opportunity: trace request mismatch is rejected with stable reason code', () => {
  const service = createCreateOpportunityService({
    nowFn: () => Date.parse('2026-02-21T18:11:03.000Z')
  })

  const result = service.createOpportunity(
    baseInput({
      requestKey: 'req_manual_001',
      traceInit: {
        traceKey: 'tr_manual_001',
        requestKey: 'req_other_001',
        attemptKey: 'att_manual_001'
      }
    })
  )

  assert.equal(result.createAccepted, false)
  assert.equal(result.createAction, 'rejected')
  assert.equal(result.reasonCode, A_CREATE_OPPORTUNITY_REASON_CODES.TRACE_REQUEST_MISMATCH)
})

test('a-create-opportunity: timestamp order invalid is rejected', () => {
  const service = createCreateOpportunityService({
    nowFn: () => Date.parse('2026-02-21T18:12:03.000Z')
  })

  const result = service.createOpportunity(
    baseInput({
      timestamps: {
        requestAt: '2026-02-21T18:10:02.000Z',
        triggerAt: '2026-02-21T18:10:01.000Z',
        opportunityCreatedAt: '2026-02-21T18:10:00.000Z'
      }
    })
  )

  assert.equal(result.createAccepted, false)
  assert.equal(result.reasonCode, A_CREATE_OPPORTUNITY_REASON_CODES.TIMESTAMP_ORDER_INVALID)
})

test('a-create-opportunity: duplicate opportunityKey returns duplicate_noop without new key', () => {
  const service = createCreateOpportunityService({
    nowFn: () => Date.parse('2026-02-21T18:13:03.000Z')
  })

  const first = service.createOpportunity(
    baseInput({
      requestKey: 'req_dup_001',
      opportunityKey: 'opp_dup_001',
      traceInit: {
        traceKey: 'tr_dup_001',
        requestKey: 'req_dup_001',
        attemptKey: 'att_dup_001'
      }
    })
  )

  const second = service.createOpportunity(
    baseInput({
      requestKey: 'req_dup_001',
      opportunityKey: 'opp_dup_001',
      traceInit: {
        traceKey: 'tr_dup_001',
        requestKey: 'req_dup_001',
        attemptKey: 'att_dup_001'
      }
    })
  )

  assert.equal(first.createAction, 'created')
  assert.equal(second.createAction, 'duplicate_noop')
  assert.equal(second.reasonCode, A_CREATE_OPPORTUNITY_REASON_CODES.DUPLICATE_OPPORTUNITY_KEY)
  assert.equal(second.opportunityRefOrNA, 'opp_dup_001')
  assert.deepEqual(second.traceInit, first.traceInit)
})

test('a-create-opportunity: expired_retry generates new request/attempt and reuses traceKey', () => {
  const service = createCreateOpportunityService({
    nowFn: () => Date.parse('2026-02-21T18:14:03.000Z')
  })

  const first = service.createOpportunity(baseInput())

  const expiredRetry = service.createOpportunity(
    baseInput({
      dedupState: A_DEDUP_STATES.EXPIRED_RETRY,
      previousTraceInitOrNA: first.traceInit
    })
  )

  assert.equal(expiredRetry.createAction, 'created')
  assert.equal(expiredRetry.traceInit.traceKey, first.traceInit.traceKey)
  assert.notEqual(expiredRetry.traceInit.requestKey, first.traceInit.requestKey)
  assert.notEqual(expiredRetry.traceInit.attemptKey, first.traceInit.attemptKey)
  assert.equal(expiredRetry.handoffPacketLiteOrNA.traceInit.traceKey, first.traceInit.traceKey)
})
