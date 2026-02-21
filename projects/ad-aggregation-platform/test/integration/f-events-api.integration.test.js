import assert from 'node:assert/strict'
import test from 'node:test'

import {
  F_EVENTS_ACK_STATUSES,
  F_EVENTS_OVERALL_STATUSES,
  F_EVENTS_REASON_CODES,
  createEventsController
} from '../../src/mediation/event-attribution/events-controller.js'

function buildEnvelope(overrides = {}) {
  return {
    batchId: 'batch_f_001',
    appId: 'app_chat_main',
    sdkVersion: '1.2.0',
    sentAt: '2026-02-22T09:00:00.000Z',
    schemaVersion: 'schema_v1',
    events: [],
    ...overrides
  }
}

function buildBaseEvent(overrides = {}) {
  return {
    eventId: 'evt_client_001',
    eventType: 'impression',
    eventAt: '2026-02-22T09:00:01.000Z',
    traceKey: 'trace_f_001',
    requestKey: 'req_f_001',
    attemptKey: 'att_f_001',
    opportunityKey: 'opp_f_001',
    responseReference: 'resp_f_001',
    eventVersion: 'f_evt_v1',
    renderAttemptId: 'render_attempt_001',
    creativeId: 'creative_001',
    ...overrides
  }
}

test('f-events-api: valid batch returns accepted_all with per-item ACK', async () => {
  const controller = createEventsController({
    nowFn: () => Date.parse('2026-02-22T09:01:00.000Z')
  })

  const request = buildEnvelope({
    batchId: 'batch_f_all_ok',
    events: [
      buildBaseEvent({
        eventId: 'evt_impression_001',
        eventType: 'impression'
      }),
      buildBaseEvent({
        eventId: 'evt_click_001',
        eventType: 'click',
        eventSeq: 1,
        clickTarget: 'cta_primary'
      }),
      buildBaseEvent({
        eventId: 'evt_postback_001',
        eventType: 'postback',
        eventSeq: 1,
        postbackType: 'conversion',
        postbackStatus: 'success'
      })
    ]
  })

  const response = await controller.handlePostEvents(request)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.overallStatus, F_EVENTS_OVERALL_STATUSES.ACCEPTED_ALL)
  assert.equal(response.body.ackItems.length, 3)
  assert.equal(response.body.ackItems.every((item) => item.ackStatus === F_EVENTS_ACK_STATUSES.ACCEPTED), true)
  assert.deepEqual(
    response.body.ackItems.map((item) => item.eventIndex),
    [0, 1, 2]
  )
})

test('f-events-api: partial_success keeps valid events accepted while invalid one rejected', async () => {
  const controller = createEventsController({
    nowFn: () => Date.parse('2026-02-22T09:02:00.000Z')
  })

  const response = await controller.handlePostEvents(
    buildEnvelope({
      batchId: 'batch_f_partial',
      events: [
        buildBaseEvent({
          eventId: 'evt_valid_001',
          eventType: 'impression'
        }),
        buildBaseEvent({
          eventId: 'evt_invalid_type_001',
          eventType: 'viewability_ping'
        }),
        buildBaseEvent({
          eventId: 'evt_valid_002',
          eventType: 'error',
          responseReference: 'resp_f_err_001',
          errorStage: 'render',
          errorCode: 'timeout'
        })
      ]
    })
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.overallStatus, F_EVENTS_OVERALL_STATUSES.PARTIAL_SUCCESS)
  assert.equal(response.body.ackItems.length, 3)
  assert.equal(response.body.ackItems[0].ackStatus, F_EVENTS_ACK_STATUSES.ACCEPTED)
  assert.equal(response.body.ackItems[1].ackStatus, F_EVENTS_ACK_STATUSES.REJECTED)
  assert.equal(response.body.ackItems[1].ackReasonCode, F_EVENTS_REASON_CODES.EVENT_TYPE_UNSUPPORTED)
  assert.equal(response.body.ackItems[2].ackStatus, F_EVENTS_ACK_STATUSES.ACCEPTED)
})

test('f-events-api: envelope validation failure rejects whole batch without per-item processing', async () => {
  const controller = createEventsController()
  const response = await controller.handlePostEvents(
    buildEnvelope({
      batchId: '',
      events: []
    })
  )

  assert.equal(response.statusCode, 400)
  assert.equal(response.body.overallStatus, F_EVENTS_OVERALL_STATUSES.REJECTED_ALL)
  assert.deepEqual(response.body.ackItems, [])
  assert.equal(response.body.reasonCode, F_EVENTS_REASON_CODES.ENVELOPE_EVENTS_INVALID)
})

test('f-events-api: repeated event requires monotonic eventSeq in same scope', async () => {
  const controller = createEventsController({
    nowFn: () => Date.parse('2026-02-22T09:03:00.000Z')
  })
  const response = await controller.handlePostEvents(
    buildEnvelope({
      batchId: 'batch_f_seq',
      events: [
        buildBaseEvent({
          eventId: 'evt_click_seq_001',
          eventType: 'click',
          clickTarget: 'cta_primary',
          eventSeq: 1
        }),
        buildBaseEvent({
          eventId: 'evt_click_seq_002',
          eventType: 'click',
          clickTarget: 'cta_secondary',
          eventSeq: 1
        })
      ]
    })
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.overallStatus, F_EVENTS_OVERALL_STATUSES.PARTIAL_SUCCESS)
  assert.equal(response.body.ackItems[0].ackStatus, F_EVENTS_ACK_STATUSES.ACCEPTED)
  assert.equal(response.body.ackItems[1].ackStatus, F_EVENTS_ACK_STATUSES.REJECTED)
  assert.equal(response.body.ackItems[1].ackReasonCode, F_EVENTS_REASON_CODES.EVENT_SEQ_INVALID)
})

test('f-events-api: invalid idempotencyKey falls back and event remains accepted', async () => {
  const controller = createEventsController({
    nowFn: () => Date.parse('2026-02-22T09:04:00.000Z')
  })
  const response = await controller.handlePostEvents(
    buildEnvelope({
      batchId: 'batch_f_idem_fallback',
      events: [
        buildBaseEvent({
          eventId: 'evt_idem_bad_001',
          eventType: 'impression',
          idempotencyKey: '*invalid*'
        })
      ]
    })
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.overallStatus, F_EVENTS_OVERALL_STATUSES.ACCEPTED_ALL)
  assert.equal(response.body.ackItems[0].ackStatus, F_EVENTS_ACK_STATUSES.ACCEPTED)
  assert.equal(
    response.body.ackItems[0].ackReasonCode,
    F_EVENTS_REASON_CODES.IDEMPOTENCY_KEY_INVALID_FALLBACK
  )
})

test('f-events-api: duplicate event returns duplicate ACK and does not re-enter accepted flow', async () => {
  const controller = createEventsController({
    nowFn: () => Date.parse('2026-02-22T09:05:00.000Z')
  })
  const first = await controller.handlePostEvents(
    buildEnvelope({
      batchId: 'batch_f_dup_1',
      events: [
        buildBaseEvent({
          eventId: 'evt_dup_001',
          eventType: 'impression',
          idempotencyKey: 'idem_dup_key_001'
        })
      ]
    })
  )
  assert.equal(first.body.ackItems[0].ackStatus, F_EVENTS_ACK_STATUSES.ACCEPTED)

  const second = await controller.handlePostEvents(
    buildEnvelope({
      batchId: 'batch_f_dup_2',
      events: [
        buildBaseEvent({
          eventId: 'evt_dup_001',
          eventType: 'impression',
          idempotencyKey: 'idem_dup_key_001'
        })
      ]
    })
  )
  assert.equal(second.statusCode, 200)
  assert.equal(second.body.overallStatus, F_EVENTS_OVERALL_STATUSES.PARTIAL_SUCCESS)
  assert.equal(second.body.ackItems[0].ackStatus, F_EVENTS_ACK_STATUSES.DUPLICATE)
  assert.equal(second.body.ackItems[0].ackReasonCode, F_EVENTS_REASON_CODES.DEDUP_COMMITTED_DUPLICATE)
})

test('f-events-api: global_unique eventId without verification is rejected', async () => {
  const controller = createEventsController()
  const response = await controller.handlePostEvents(
    buildEnvelope({
      batchId: 'batch_f_global_scope',
      events: [
        buildBaseEvent({
          eventId: 'evt_global_001',
          eventType: 'impression',
          eventIdScope: 'global_unique'
        })
      ]
    })
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.ackItems[0].ackStatus, F_EVENTS_ACK_STATUSES.REJECTED)
  assert.equal(
    response.body.ackItems[0].ackReasonCode,
    F_EVENTS_REASON_CODES.EVENT_ID_GLOBAL_UNIQUENESS_UNVERIFIED
  )
})

test('f-events-api: unknown sub-enum is normalized and accepted', async () => {
  const controller = createEventsController()
  const response = await controller.handlePostEvents(
    buildEnvelope({
      batchId: 'batch_f_unknown_subenum',
      events: [
        buildBaseEvent({
          eventId: 'evt_interaction_unknown_enum_001',
          eventType: 'interaction',
          renderAttemptId: 'render_attempt_002',
          interactionType: 'super_like',
          eventSeq: 1
        })
      ]
    })
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.overallStatus, F_EVENTS_OVERALL_STATUSES.ACCEPTED_ALL)
  assert.equal(response.body.ackItems[0].ackStatus, F_EVENTS_ACK_STATUSES.ACCEPTED)
  assert.equal(
    response.body.ackItems[0].ackReasonCode,
    F_EVENTS_REASON_CODES.EVENT_SUBENUM_UNKNOWN_NORMALIZED
  )
})
