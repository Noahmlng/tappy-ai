import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { createCreateOpportunityService } from '../../src/mediation/ingress-opportunity/create-opportunity.js'
import {
  A_OPPORTUNITY_EVENT_REASON_CODES,
  createOpportunityEventEmitterService
} from '../../src/mediation/ingress-opportunity/opportunity-event-emitter.js'

function buildCreateInput(overrides = {}) {
  return {
    requestKey: 'req_evt_001',
    opportunityKey: 'opp_evt_001',
    impSeed: [
      {
        impKey: 'imp_001',
        placementId: 'chat_from_answer_v1',
        placementType: 'inline',
        slotIndex: 0
      }
    ],
    timestamps: {
      requestAt: '2026-02-21T19:00:00.000Z',
      triggerAt: '2026-02-21T19:00:01.000Z',
      opportunityCreatedAt: '2026-02-21T19:00:02.000Z'
    },
    traceInit: {
      traceKey: 'tr_evt_001',
      requestKey: 'req_evt_001',
      attemptKey: 'att_evt_001'
    },
    schemaVersion: 'schema_v1',
    state: 'received',
    createOpportunityContractVersion: 'a_create_opportunity_v1',
    ...overrides
  }
}

function createCreatedOpportunity(overrides = {}) {
  const service = createCreateOpportunityService({
    nowFn: () => Date.parse('2026-02-21T19:00:02.500Z')
  })
  return service.createOpportunity(buildCreateInput(overrides))
}

test('a-opportunity-event: emits opportunity_created with stable idempotency contract', async () => {
  const emitted = []
  const emitter = createOpportunityEventEmitterService({
    nowFn: () => Date.parse('2026-02-21T19:00:03.000Z'),
    eventKeyFactory: () => 'evt_oc_01952a17-82a8-7b54-bfe9-f7b4e4f74ef0',
    ackFn: async (event) => {
      emitted.push(event)
      return {
        ackStatus: 'accepted',
        retryable: false,
        ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.ACCEPTED,
        ackedAt: '2026-02-21T19:00:03.100Z'
      }
    }
  })

  const createResult = createCreatedOpportunity()
  const result = await emitter.emitOpportunityCreated({
    createOpportunityResult: createResult,
    opportunityCreatedAt: '2026-02-21T19:00:02.000Z',
    handoffToBAt: '2026-02-21T19:00:03.500Z',
    opportunityEventContractVersion: 'a_opportunity_event_v1'
  })

  assert.equal(result.emitAccepted, true)
  assert.equal(result.emitAction, 'emitted')
  assert.equal(result.ack.ackStatus, 'accepted')
  assert.equal(result.attemptCount, 1)
  assert.equal(emitted.length, 1)

  const event = emitted[0]
  assert.equal(event.eventType, 'opportunity_created')
  assert.equal(event.eventKey, 'evt_oc_01952a17-82a8-7b54-bfe9-f7b4e4f74ef0')
  assert.equal(event.requestKey, createResult.handoffPacketLiteOrNA.requestKey)
  assert.equal(event.opportunityKey, createResult.opportunityRefOrNA)
  assert.deepEqual(event.impSeedRefs, ['imp_001'])

  const expectedIdempotencyKey = crypto
    .createHash('sha256')
    .update('req_evt_001|opp_evt_001|att_evt_001|opportunity_created|a_opportunity_event_v1')
    .digest('hex')
  assert.equal(event.eventIdempotencyKey, expectedIdempotencyKey)
})

test('a-opportunity-event: duplicate emit does not resend and returns duplicate_noop', async () => {
  const callCount = { ack: 0 }
  const emitter = createOpportunityEventEmitterService({
    nowFn: () => Date.parse('2026-02-21T19:10:03.000Z'),
    eventKeyFactory: () => 'evt_oc_01952a20-8d00-70ee-88a7-6d4f5d4ce777',
    ackFn: async () => {
      callCount.ack += 1
      return { ackStatus: 'accepted', retryable: false }
    }
  })

  const createResult = createCreatedOpportunity({
    requestKey: 'req_evt_dup_001',
    opportunityKey: 'opp_evt_dup_001',
    traceInit: {
      traceKey: 'tr_evt_dup_001',
      requestKey: 'req_evt_dup_001',
      attemptKey: 'att_evt_dup_001'
    }
  })

  const first = await emitter.emitOpportunityCreated({
    createOpportunityResult: createResult,
    eventAt: '2026-02-21T19:10:03.000Z',
    handoffToBAt: '2026-02-21T19:10:04.000Z'
  })
  const second = await emitter.emitOpportunityCreated({
    createOpportunityResult: createResult,
    eventAt: '2026-02-21T19:10:03.000Z',
    handoffToBAt: '2026-02-21T19:10:04.000Z'
  })

  assert.equal(first.emitAction, 'emitted')
  assert.equal(second.emitAction, 'duplicate_noop')
  assert.equal(second.reasonCode, A_OPPORTUNITY_EVENT_REASON_CODES.DUPLICATE_NOOP)
  assert.equal(callCount.ack, 1)
  assert.equal(second.eventRefOrNA, first.eventRefOrNA)
})

test('a-opportunity-event: retries with backoff and keeps eventKey + idempotencyKey stable', async () => {
  const seenEventKeys = []
  const seenIdempotencyKeys = []
  const waitCalls = []
  const clock = { nowMs: Date.parse('2026-02-21T19:20:00.000Z') }

  const emitter = createOpportunityEventEmitterService({
    nowFn: () => clock.nowMs,
    eventKeyFactory: () => 'evt_oc_01952a2a-8f00-77f7-8513-c80f7ec24999',
    waitFn: async (ms) => {
      waitCalls.push(ms)
      clock.nowMs += ms
    },
    ackFn: async (event, ctx) => {
      seenEventKeys.push(event.eventKey)
      seenIdempotencyKeys.push(event.eventIdempotencyKey)
      if (ctx.attemptIndex < 2) {
        return {
          ackStatus: 'rejected',
          retryable: true,
          ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.REJECTED_RETRYABLE
        }
      }
      return {
        ackStatus: 'accepted',
        retryable: false,
        ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.ACCEPTED
      }
    }
  })

  const result = await emitter.emitOpportunityCreated({
    createOpportunityResult: createCreatedOpportunity({
      requestKey: 'req_evt_retry_001',
      opportunityKey: 'opp_evt_retry_001',
      traceInit: {
        traceKey: 'tr_evt_retry_001',
        requestKey: 'req_evt_retry_001',
        attemptKey: 'att_evt_retry_001'
      }
    }),
    eventAt: '2026-02-21T19:20:01.000Z',
    handoffToBAt: '2026-02-21T19:22:00.000Z'
  })

  assert.equal(result.emitAccepted, true)
  assert.equal(result.ack.ackStatus, 'accepted')
  assert.equal(result.attemptCount, 3)
  assert.deepEqual(waitCalls, [1000, 5000])
  assert.equal(new Set(seenEventKeys).size, 1)
  assert.equal(new Set(seenIdempotencyKeys).size, 1)
})

test('a-opportunity-event: payload conflict is rejected without resend', async () => {
  const callCount = { ack: 0 }
  const emitter = createOpportunityEventEmitterService({
    nowFn: () => Date.parse('2026-02-21T19:30:03.000Z'),
    eventKeyFactory: () => 'evt_oc_01952a35-1ef9-7ccc-9a0b-d613dc487bbb',
    ackFn: async () => {
      callCount.ack += 1
      return { ackStatus: 'accepted', retryable: false }
    }
  })

  const baseResult = createCreatedOpportunity({
    requestKey: 'req_evt_conflict_001',
    opportunityKey: 'opp_evt_conflict_001',
    traceInit: {
      traceKey: 'tr_evt_conflict_001',
      requestKey: 'req_evt_conflict_001',
      attemptKey: 'att_evt_conflict_001'
    }
  })

  const first = await emitter.emitOpportunityCreated({
    createOpportunityResult: baseResult,
    eventAt: '2026-02-21T19:30:03.000Z',
    handoffToBAt: '2026-02-21T19:30:04.000Z'
  })
  assert.equal(first.emitAccepted, true)

  const conflictPayload = JSON.parse(JSON.stringify(baseResult))
  conflictPayload.handoffPacketLiteOrNA.impSeed[0].placementId = 'chat_inline_v2'

  const second = await emitter.emitOpportunityCreated({
    createOpportunityResult: conflictPayload,
    eventAt: '2026-02-21T19:30:03.000Z',
    handoffToBAt: '2026-02-21T19:30:04.000Z'
  })

  assert.equal(second.emitAccepted, false)
  assert.equal(second.emitAction, 'rejected')
  assert.equal(second.ack.ackStatus, 'rejected')
  assert.equal(second.reasonCode, A_OPPORTUNITY_EVENT_REASON_CODES.PAYLOAD_CONFLICT)
  assert.equal(callCount.ack, 1)
})

test('a-opportunity-event: retryable rejection exhausts max retry window', async () => {
  const waits = []
  const clock = { nowMs: Date.parse('2026-02-21T19:40:00.000Z') }

  const emitter = createOpportunityEventEmitterService({
    nowFn: () => clock.nowMs,
    eventKeyFactory: () => 'evt_oc_01952a40-cf90-70ef-b516-00a23729bbbb',
    maxRetryWindowMs: 6000,
    waitFn: async (ms) => {
      waits.push(ms)
      clock.nowMs += ms
    },
    ackFn: async () => ({
      ackStatus: 'rejected',
      retryable: true,
      ackReasonCode: A_OPPORTUNITY_EVENT_REASON_CODES.REJECTED_RETRYABLE
    })
  })

  const result = await emitter.emitOpportunityCreated({
    createOpportunityResult: createCreatedOpportunity({
      requestKey: 'req_evt_exhaust_001',
      opportunityKey: 'opp_evt_exhaust_001',
      traceInit: {
        traceKey: 'tr_evt_exhaust_001',
        requestKey: 'req_evt_exhaust_001',
        attemptKey: 'att_evt_exhaust_001'
      }
    }),
    eventAt: '2026-02-21T19:40:01.000Z',
    handoffToBAt: '2026-02-21T19:41:00.000Z'
  })

  assert.equal(result.emitAccepted, false)
  assert.equal(result.emitAction, 'rejected')
  assert.equal(result.ack.ackStatus, 'rejected')
  assert.equal(result.reasonCode, A_OPPORTUNITY_EVENT_REASON_CODES.RETRY_EXHAUSTED)
  assert.deepEqual(waits, [1000, 5000])
})

test('a-opportunity-event: non-created createAction is skipped and never emitted', async () => {
  const service = createCreateOpportunityService({
    nowFn: () => Date.parse('2026-02-21T19:50:00.000Z')
  })

  const first = service.createOpportunity(
    buildCreateInput({
      requestKey: 'req_evt_skip_001',
      opportunityKey: 'opp_evt_skip_001',
      traceInit: {
        traceKey: 'tr_evt_skip_001',
        requestKey: 'req_evt_skip_001',
        attemptKey: 'att_evt_skip_001'
      }
    })
  )
  assert.equal(first.createAction, 'created')

  const duplicate = service.createOpportunity(
    buildCreateInput({
      requestKey: 'req_evt_skip_001',
      opportunityKey: 'opp_evt_skip_001',
      traceInit: {
        traceKey: 'tr_evt_skip_001',
        requestKey: 'req_evt_skip_001',
        attemptKey: 'att_evt_skip_001'
      }
    })
  )
  assert.equal(duplicate.createAction, 'duplicate_noop')

  let called = 0
  const emitter = createOpportunityEventEmitterService({
    ackFn: async () => {
      called += 1
      return { ackStatus: 'accepted', retryable: false }
    }
  })

  const result = await emitter.emitOpportunityCreated({
    createOpportunityResult: duplicate,
    eventAt: '2026-02-21T19:50:01.000Z',
    handoffToBAt: '2026-02-21T19:50:02.000Z'
  })

  assert.equal(result.emitAccepted, true)
  assert.equal(result.emitAction, 'skipped')
  assert.equal(result.ack.ackStatus, 'duplicate')
  assert.equal(called, 0)
})
