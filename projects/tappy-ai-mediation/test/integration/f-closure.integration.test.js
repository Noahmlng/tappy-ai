import assert from 'node:assert/strict'
import test from 'node:test'

import {
  F_IDEMPOTENCY_REASON_CODES,
  F_IDEMPOTENCY_STATES,
  createIdempotencyEngine
} from '../../src/mediation/event-attribution/idempotency.js'
import {
  F_TERMINAL_CLOSURE_REASON_CODES,
  createTerminalClosureEngine
} from '../../src/mediation/event-attribution/terminal-closure.js'

function buildBaseEvent(overrides = {}) {
  return {
    eventId: 'evt_base_001',
    eventType: 'impression',
    eventAt: '2026-02-22T10:00:00.000Z',
    requestKey: 'req_f_closure_001',
    attemptKey: 'att_f_closure_001',
    opportunityKey: 'opp_f_closure_001',
    responseReference: 'resp_f_closure_001',
    renderAttemptId: 'render_attempt_001',
    creativeId: 'creative_001',
    ...overrides
  }
}

test('f-closure: idempotency key source priority is deterministic', () => {
  const engine = createIdempotencyEngine()

  const withIdem = engine.resolveCanonicalDedupKey({
    appId: 'app_main',
    batchId: 'batch_1',
    event: buildBaseEvent({
      idempotencyKey: 'idem_key_12345678',
      eventId: 'evt_1'
    })
  })
  assert.equal(withIdem.ok, true)
  assert.equal(withIdem.keySource, 'client_idempotency')

  const withEventId = engine.resolveCanonicalDedupKey({
    appId: 'app_main',
    batchId: 'batch_2',
    event: buildBaseEvent({
      idempotencyKey: '',
      eventId: 'evt_2'
    })
  })
  assert.equal(withEventId.ok, true)
  assert.equal(withEventId.keySource, 'client_event_id')
  assert.equal(withEventId.canonicalDedupKey.includes('app_main|batch_2|evt_2'), true)

  const withComputed = engine.resolveCanonicalDedupKey({
    appId: 'app_main',
    batchId: 'batch_3',
    event: buildBaseEvent({
      idempotencyKey: '',
      eventId: '',
      creativeId: 'creative_abc'
    })
  })
  assert.equal(withComputed.ok, true)
  assert.equal(withComputed.keySource, 'computed')
})

test('f-closure: global_unique scope without verification is rejected', () => {
  const engine = createIdempotencyEngine()
  const result = engine.evaluate({
    appId: 'app_main',
    batchId: 'batch_4',
    event: buildBaseEvent({
      eventId: 'evt_global_1',
      eventIdScope: 'global_unique'
    }),
    nowMs: Date.parse('2026-02-22T10:00:01.000Z')
  })

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, F_IDEMPOTENCY_REASON_CODES.EVENT_ID_GLOBAL_UNIQUENESS_UNVERIFIED)
})

test('f-closure: inflight duplicate and committed duplicate are distinguishable', () => {
  const clockMs = Date.parse('2026-02-22T10:10:00.000Z')
  const engine = createIdempotencyEngine()
  const event = buildBaseEvent({
    eventId: 'evt_dup_state_001',
    idempotencyKey: 'idem_dup_state_12345'
  })

  const inflight = engine.beginInFlight({
    appId: 'app_main',
    batchId: 'batch_state_1',
    event,
    nowMs: clockMs
  })
  assert.equal(inflight.ok, true)
  assert.equal(inflight.ackStatus, 'accepted')

  const duplicateInflight = engine.evaluate({
    appId: 'app_main',
    batchId: 'batch_state_1',
    event,
    nowMs: clockMs + 1000
  })
  assert.equal(duplicateInflight.ok, true)
  assert.equal(duplicateInflight.ackStatus, 'duplicate')
  assert.equal(duplicateInflight.reasonCode, F_IDEMPOTENCY_REASON_CODES.DEDUP_INFLIGHT_DUPLICATE)

  const committed = engine.commit({
    canonicalDedupKey: inflight.canonicalDedupKey,
    nowMs: clockMs + 2000
  })
  assert.equal(committed.ok, true)

  const duplicateCommitted = engine.evaluate({
    appId: 'app_main',
    batchId: 'batch_state_2',
    event,
    nowMs: clockMs + 3000
  })
  assert.equal(duplicateCommitted.ok, true)
  assert.equal(duplicateCommitted.ackStatus, 'duplicate')
  assert.equal(duplicateCommitted.reasonCode, F_IDEMPOTENCY_REASON_CODES.DEDUP_COMMITTED_DUPLICATE)

  const replay = engine.replay(inflight.canonicalDedupKey)
  assert.equal(Array.isArray(replay.history), true)
  assert.equal(replay.state, F_IDEMPOTENCY_STATES.DUPLICATE_COMMITTED)
})

test('f-closure: payload conflict rejects with non-retryable reason', () => {
  const nowMs = Date.parse('2026-02-22T10:20:00.000Z')
  const engine = createIdempotencyEngine()
  const baseEvent = buildBaseEvent({
    eventId: 'evt_conflict_001',
    idempotencyKey: 'idem_conflict_123456'
  })

  const first = engine.evaluate({
    appId: 'app_main',
    batchId: 'batch_conflict_1',
    event: baseEvent,
    nowMs
  })
  assert.equal(first.ok, true)
  assert.equal(first.ackStatus, 'accepted')

  const conflict = engine.evaluate({
    appId: 'app_main',
    batchId: 'batch_conflict_2',
    event: {
      ...baseEvent,
      creativeId: 'creative_changed'
    },
    nowMs: nowMs + 1000
  })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.ackStatus, 'rejected')
  assert.equal(conflict.reasonCode, F_IDEMPOTENCY_REASON_CODES.DEDUP_PAYLOAD_CONFLICT)
})

test('f-closure: stale event outside dedup window is rejected', () => {
  const nowMs = Date.parse('2026-02-22T10:30:00.000Z')
  const engine = createIdempotencyEngine()
  const oldEvent = buildBaseEvent({
    eventAt: '2025-12-01T00:00:00.000Z',
    eventType: 'impression'
  })
  const result = engine.evaluate({
    appId: 'app_main',
    batchId: 'batch_stale',
    event: oldEvent,
    nowMs
  })
  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, F_IDEMPOTENCY_REASON_CODES.EVENT_STALE_OUTSIDE_DEDUP_WINDOW)
})

test('f-closure: timeout auto-fill emits synthesized failure once per closureKey', () => {
  const baseNow = Date.parse('2026-02-22T10:40:00.000Z')
  const closure = createTerminalClosureEngine({
    nowFn: () => baseNow
  })

  const openResult = closure.processEvent({
    event: {
      eventId: 'evt_open_001',
      eventType: 'ad_filled',
      responseReference: 'resp_timeout_001',
      renderAttemptId: 'render_attempt_timeout_001'
    },
    nowMs: baseNow
  })
  assert.equal(openResult.ok, true)
  assert.equal(openResult.closureState, 'open')

  const synthesized = closure.scanTimeouts(baseNow + 121_000)
  assert.equal(synthesized.length, 1)
  assert.equal(synthesized[0].reasonCode, F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_TIMEOUT_AUTOFILL)

  const secondScan = closure.scanTimeouts(baseNow + 180_000)
  assert.equal(secondScan.length, 0)

  const snapshot = closure.replay('resp_timeout_001|render_attempt_timeout_001')
  assert.equal(snapshot.state, 'closed_failure')
  assert.equal(snapshot.terminalSource, 'system_timeout_synthesized')
})

test('f-closure: impression overrides synthesized timeout failure to closed_success', () => {
  const nowMs = Date.parse('2026-02-22T10:50:00.000Z')
  const closure = createTerminalClosureEngine()
  const closureKey = 'resp_override_001|render_attempt_override_001'

  closure.processEvent({
    event: {
      eventId: 'evt_open_override',
      eventType: 'ad_filled',
      responseReference: 'resp_override_001',
      renderAttemptId: 'render_attempt_override_001'
    },
    nowMs
  })
  closure.scanTimeouts(nowMs + 121_000)

  const impression = closure.processEvent({
    event: {
      eventId: 'evt_impression_override',
      eventType: 'impression',
      responseReference: 'resp_override_001',
      renderAttemptId: 'render_attempt_override_001'
    },
    nowMs: nowMs + 122_000
  })
  assert.equal(impression.ok, true)
  assert.equal(impression.ackStatus, 'accepted')

  const snapshot = closure.replay(closureKey)
  assert.equal(snapshot.state, 'closed_success')
  assert.equal(snapshot.supersededTerminalEventId.length > 0, true)
})

test('f-closure: failure after impression is duplicate conflict', () => {
  const nowMs = Date.parse('2026-02-22T11:00:00.000Z')
  const closure = createTerminalClosureEngine()

  const first = closure.processEvent({
    event: {
      eventId: 'evt_impression_first',
      eventType: 'impression',
      responseReference: 'resp_conflict_001',
      renderAttemptId: 'render_attempt_conflict_001'
    },
    nowMs
  })
  assert.equal(first.ackStatus, 'accepted')

  const second = closure.processEvent({
    event: {
      eventId: 'evt_failure_after',
      eventType: 'failure',
      responseReference: 'resp_conflict_001',
      renderAttemptId: 'render_attempt_conflict_001',
      terminalSource: 'real_failure'
    },
    nowMs: nowMs + 500
  })
  assert.equal(second.ackStatus, 'duplicate')
  assert.equal(second.reasonCode, F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_FAILURE_AFTER_IMPRESSION)
})

test('f-closure: same-batch impression and failure uses impression-first priority', () => {
  const nowMs = Date.parse('2026-02-22T11:10:00.000Z')
  const closure = createTerminalClosureEngine()
  const batchResults = closure.processBatch([
    {
      eventId: 'evt_batch_failure',
      eventType: 'failure',
      responseReference: 'resp_batch_001',
      renderAttemptId: 'render_attempt_batch_001',
      terminalSource: 'real_failure'
    },
    {
      eventId: 'evt_batch_impression',
      eventType: 'impression',
      responseReference: 'resp_batch_001',
      renderAttemptId: 'render_attempt_batch_001'
    }
  ], nowMs)

  assert.equal(batchResults.length, 2)
  assert.equal(batchResults[0].ackStatus, 'accepted')
  assert.equal(batchResults[1].ackStatus, 'duplicate')
  assert.equal(batchResults[1].reasonCode, F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_FAILURE_AFTER_IMPRESSION)

  const snapshot = closure.replay('resp_batch_001|render_attempt_batch_001')
  assert.equal(snapshot.state, 'closed_success')
})
