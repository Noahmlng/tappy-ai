import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  B_SIGNAL_EVENT_REASON_CODES,
  computeSignalSamplingDecision,
  createSignalEventEmitterService
} from '../../src/mediation/schema-normalization/signal-event-emitter.js'

function buildEventInput(overrides = {}) {
  return {
    traceInitLite: {
      traceKey: 'trace_b_sig_001',
      requestKey: 'req_b_sig_001',
      attemptKey: 'att_b_sig_001'
    },
    opportunityKey: 'opp_b_sig_001',
    sampleRateBps: 10000,
    samplingRuleVersion: 'b_sampling_rule_v1',
    signalNormalizedEventContractVersion: 'b_signal_event_v1',
    mappingProfileVersion: 'b_mapping_profile_v1',
    enumDictVersion: 'b_enum_dict_v1',
    bucketDictVersion: 'b_bucket_dict_v1',
    sampledSemanticSlots: ['triggerDecision', 'hitType'],
    mappingAuditSnapshotRefOrNA: 'map_audit_ref_001',
    bucketAuditSnapshotRefOrNA: 'bucket_audit_ref_001',
    eventAt: '2026-02-21T23:40:01.000Z',
    ...overrides
  }
}

test('b-signal-event: sampled_out does not emit and does not call ack', async () => {
  let ackCalled = 0
  const emitter = createSignalEventEmitterService({
    ackFn: async () => {
      ackCalled += 1
      return { ackStatus: 'accepted', retryable: false }
    }
  })

  const result = await emitter.emitSignalNormalized(
    buildEventInput({
      sampleRateBps: 0
    })
  )

  assert.equal(result.emitAccepted, true)
  assert.equal(result.emitAction, 'skipped')
  assert.equal(result.reasonCode, B_SIGNAL_EVENT_REASON_CODES.SAMPLED_OUT_NO_EMIT)
  assert.equal(result.samplingDecision, 'sampled_out')
  assert.equal(ackCalled, 0)
  assert.equal(result.eventRefOrNA, 'NA')
})

test('b-signal-event: sampled_in sends event and tracks ACK', async () => {
  const emitted = []
  const emitter = createSignalEventEmitterService({
    nowFn: () => Date.parse('2026-02-21T23:40:00.000Z'),
    eventKeyFactory: () => 'evt_b_sig_01952c03-bb3f-7298-8fa8-0f95a1bb1111',
    ackFn: async (event) => {
      emitted.push(event)
      return {
        ackStatus: 'accepted',
        retryable: false,
        ackReasonCode: B_SIGNAL_EVENT_REASON_CODES.ACK_ACCEPTED,
        ackedAt: '2026-02-21T23:40:01.100Z'
      }
    }
  })

  const input = buildEventInput()
  const result = await emitter.emitSignalNormalized(input)
  assert.equal(result.emitAccepted, true)
  assert.equal(result.emitAction, 'emitted')
  assert.equal(result.emitReasonCode, B_SIGNAL_EVENT_REASON_CODES.SAMPLED_IN_EMIT)
  assert.equal(result.reasonCode, B_SIGNAL_EVENT_REASON_CODES.ACK_ACCEPTED)
  assert.equal(result.ack.ackStatus, 'accepted')
  assert.equal(result.attemptCount, 1)
  assert.equal(emitted.length, 1)

  const event = emitted[0]
  assert.equal(event.eventType, 'signal_normalized')
  assert.equal(event.eventKey, 'evt_b_sig_01952c03-bb3f-7298-8fa8-0f95a1bb1111')
  const expectedIdempotency = crypto
    .createHash('sha256')
    .update('trace_b_sig_001|req_b_sig_001|att_b_sig_001|opp_b_sig_001|signal_normalized|b_sampling_rule_v1|b_signal_event_v1')
    .digest('hex')
  assert.equal(event.eventIdempotencyKey, expectedIdempotency)
})

test('b-signal-event: same request has stable sampling decision', () => {
  const input = buildEventInput({
    sampleRateBps: 3555,
    traceInitLite: {
      traceKey: 'trace_b_sig_det_001',
      requestKey: 'req_b_sig_det_001',
      attemptKey: 'att_b_sig_det_001'
    }
  })

  const first = computeSignalSamplingDecision(input)
  const second = computeSignalSamplingDecision(input)
  assert.equal(first.ok, true)
  assert.deepEqual(second, first)
})

test('b-signal-event: duplicate payload does not resend', async () => {
  const counter = { ack: 0 }
  const emitter = createSignalEventEmitterService({
    eventKeyFactory: () => 'evt_b_sig_01952c11-0a76-7014-80d7-e2f655552222',
    ackFn: async () => {
      counter.ack += 1
      return { ackStatus: 'accepted', retryable: false }
    }
  })

  const input = buildEventInput()
  const first = await emitter.emitSignalNormalized(input)
  const second = await emitter.emitSignalNormalized(input)

  assert.equal(first.emitAction, 'emitted')
  assert.equal(second.emitAction, 'duplicate_noop')
  assert.equal(second.reasonCode, B_SIGNAL_EVENT_REASON_CODES.ACK_DUPLICATE)
  assert.equal(counter.ack, 1)
  assert.equal(second.eventRefOrNA, first.eventRefOrNA)
})

test('b-signal-event: payload conflict is rejected', async () => {
  let ackCalls = 0
  const emitter = createSignalEventEmitterService({
    eventKeyFactory: () => 'evt_b_sig_01952c17-b0ed-7f95-a5e4-8eaa33333333',
    ackFn: async () => {
      ackCalls += 1
      return { ackStatus: 'accepted', retryable: false }
    }
  })

  const first = await emitter.emitSignalNormalized(buildEventInput())
  assert.equal(first.emitAccepted, true)

  const second = await emitter.emitSignalNormalized(
    buildEventInput({
      sampledSemanticSlots: ['triggerDecision', 'decisionOutcome', 'hitType']
    })
  )
  assert.equal(second.emitAccepted, false)
  assert.equal(second.emitAction, 'rejected')
  assert.equal(second.reasonCode, B_SIGNAL_EVENT_REASON_CODES.PAYLOAD_CONFLICT)
  assert.equal(ackCalls, 1)
})

test('b-signal-event: retryable rejection retries and keeps keys stable', async () => {
  const seenKeys = []
  const waits = []
  const clock = { nowMs: Date.parse('2026-02-21T23:50:00.000Z') }
  const emitter = createSignalEventEmitterService({
    nowFn: () => clock.nowMs,
    eventKeyFactory: () => 'evt_b_sig_01952c28-cd34-73c2-86dd-999944444444',
    waitFn: async (ms) => {
      waits.push(ms)
      clock.nowMs += ms
    },
    ackFn: async (event, ctx) => {
      seenKeys.push(`${event.eventKey}|${event.eventIdempotencyKey}`)
      if (ctx.attemptIndex < 2) {
        return {
          ackStatus: 'rejected',
          retryable: true,
          ackReasonCode: B_SIGNAL_EVENT_REASON_CODES.ACK_REJECTED_RETRYABLE
        }
      }
      return {
        ackStatus: 'accepted',
        retryable: false,
        ackReasonCode: B_SIGNAL_EVENT_REASON_CODES.ACK_ACCEPTED
      }
    }
  })

  const result = await emitter.emitSignalNormalized(buildEventInput())
  assert.equal(result.emitAccepted, true)
  assert.equal(result.ack.ackStatus, 'accepted')
  assert.equal(result.attemptCount, 3)
  assert.deepEqual(waits, [1000, 5000])
  assert.equal(new Set(seenKeys).size, 1)
})

test('b-signal-event: retry exhaustion returns retry_exhausted reason', async () => {
  const waits = []
  const clock = { nowMs: Date.parse('2026-02-22T00:00:00.000Z') }
  const emitter = createSignalEventEmitterService({
    nowFn: () => clock.nowMs,
    maxRetryWindowMs: 6000,
    eventKeyFactory: () => 'evt_b_sig_01952c31-f6f9-7ae3-ae7e-0d3b55555555',
    waitFn: async (ms) => {
      waits.push(ms)
      clock.nowMs += ms
    },
    ackFn: async () => ({
      ackStatus: 'rejected',
      retryable: true,
      ackReasonCode: B_SIGNAL_EVENT_REASON_CODES.ACK_REJECTED_RETRYABLE
    })
  })

  const result = await emitter.emitSignalNormalized(buildEventInput())
  assert.equal(result.emitAccepted, false)
  assert.equal(result.emitAction, 'rejected')
  assert.equal(result.reasonCode, B_SIGNAL_EVENT_REASON_CODES.RETRY_EXHAUSTED)
  assert.deepEqual(waits, [1000, 5000])
})

test('b-signal-event: invalid sampling config is rejected', async () => {
  const emitter = createSignalEventEmitterService()
  const result = await emitter.emitSignalNormalized(
    buildEventInput({
      sampleRateBps: 12000
    })
  )
  assert.equal(result.emitAccepted, false)
  assert.equal(result.emitAction, 'reject')
  assert.equal(result.reasonCode, B_SIGNAL_EVENT_REASON_CODES.SAMPLING_RULE_INVALID)
})
