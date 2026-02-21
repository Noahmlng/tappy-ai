import assert from 'node:assert/strict'
import test from 'node:test'

import {
  E_DELIVERY_OUTPUT_REASON_CODES,
  createDeliveryOutputBuilder
} from '../../src/mediation/delivery-composer/delivery-output.js'
import {
  E_EVENT_OUTPUT_REASON_CODES,
  createEventOutputBuilder
} from '../../src/mediation/delivery-composer/event-output.js'

function buildDToEOutputLite(overrides = {}) {
  return {
    opportunityKey: 'opp_e_out_001',
    traceKey: 'trace_e_out_001',
    requestKey: 'req_e_out_001',
    attemptKey: 'att_e_out_001',
    auctionDecisionLite: {
      winner: {
        sourceId: 'source_primary_a',
        candidateId: 'cand_001'
      }
    },
    routeConclusion: {
      routeOutcome: 'served_candidate',
      finalReasonCode: 'd_route_short_circuit_served'
    },
    versionAnchors: {
      routingPolicyVersion: 'd_routing_policy_v2'
    },
    ...overrides
  }
}

function buildRenderPlanLite(overrides = {}) {
  return {
    opportunityKey: 'opp_e_out_001',
    traceKey: 'trace_e_out_001',
    requestKey: 'req_e_out_001',
    attemptKey: 'att_e_out_001',
    responseReference: 'resp_e_out_001',
    deliveryStatus: 'served',
    candidateConsumptionDecision: {
      selectedCandidateRefs: [
        {
          sourceId: 'source_primary_a',
          candidateId: 'cand_001'
        }
      ]
    },
    versionAnchors: {
      renderPlanContractVersion: 'e_render_plan_contract_v1'
    },
    eErrorDegradeDecisionSnapshotLite: {
      finalCanonicalReasonCode: 'none',
      decisionRuleVersion: 'e_decision_rule_v1'
    },
    ...overrides
  }
}

test('e-output: route served_candidate + render served stays pass_through', () => {
  const deliveryBuilder = createDeliveryOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T08:00:00.000Z')
  })

  const result = deliveryBuilder.buildDeliveryResponse({
    dToEOutputLite: buildDToEOutputLite(),
    renderPlanLite: buildRenderPlanLite()
  })

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, E_DELIVERY_OUTPUT_REASON_CODES.DELIVERY_READY)
  assert.equal(result.eDeliveryResponseLite.deliveryStatus, 'served')
  assert.equal(result.eDeliveryResponseLite.renderPlanLite.deliveryStatus, 'served')
  assert.equal(result.eDeliveryResponseLite.stateTransitionLite.fromState, 'routed')
  assert.equal(result.eDeliveryResponseLite.stateTransitionLite.toState, 'served')
  assert.equal(result.eDeliveryResponseLite.routeDeliveryConsistencyLite.consistencyAction, 'pass_through')
})

test('e-output: served_candidate overridden to no_fill uses override_by_e', () => {
  const deliveryBuilder = createDeliveryOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T08:01:00.000Z')
  })

  const result = deliveryBuilder.buildDeliveryResponse({
    dToEOutputLite: buildDToEOutputLite(),
    renderPlanLite: buildRenderPlanLite({
      deliveryStatus: 'no_fill',
      candidateConsumptionDecision: {
        selectedCandidateRefs: []
      },
      eErrorDegradeDecisionSnapshotLite: {
        finalCanonicalReasonCode: 'e_nf_all_candidate_rejected',
        decisionRuleVersion: 'e_decision_rule_v1'
      }
    })
  })

  assert.equal(result.ok, true)
  assert.equal(result.eDeliveryResponseLite.deliveryStatus, 'no_fill')
  assert.equal(result.eDeliveryResponseLite.finalReasonCode, 'e_nf_all_candidate_rejected')
  assert.equal(result.eDeliveryResponseLite.stateTransitionLite.toState, 'no_fill')
  assert.equal(result.eDeliveryResponseLite.routeDeliveryConsistencyLite.consistencyAction, 'override_by_e')
  assert.equal(result.eDeliveryResponseLite.routeDeliveryConsistencyLite.consistencyReasonCode, 'e_nf_all_candidate_rejected')
})

test('e-output: route no_fill remains pass_through no_fill', () => {
  const deliveryBuilder = createDeliveryOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T08:02:00.000Z')
  })
  const result = deliveryBuilder.buildDeliveryResponse({
    dToEOutputLite: buildDToEOutputLite({
      routeConclusion: {
        routeOutcome: 'no_fill',
        finalReasonCode: 'd_nf_no_fill'
      }
    }),
    renderPlanLite: buildRenderPlanLite({
      deliveryStatus: 'no_fill',
      candidateConsumptionDecision: {
        selectedCandidateRefs: []
      },
      eErrorDegradeDecisionSnapshotLite: {
        finalCanonicalReasonCode: 'e_nf_no_candidate_input',
        decisionRuleVersion: 'e_decision_rule_v1'
      }
    })
  })

  assert.equal(result.ok, true)
  assert.equal(result.eDeliveryResponseLite.deliveryStatus, 'no_fill')
  assert.equal(result.eDeliveryResponseLite.routeDeliveryConsistencyLite.consistencyAction, 'pass_through')
})

test('e-output: no_fill or error cannot be upgraded to served', () => {
  const deliveryBuilder = createDeliveryOutputBuilder()
  const result = deliveryBuilder.buildDeliveryResponse({
    dToEOutputLite: buildDToEOutputLite({
      routeConclusion: {
        routeOutcome: 'error',
        finalReasonCode: 'd_en_unknown'
      }
    }),
    renderPlanLite: buildRenderPlanLite({
      deliveryStatus: 'served'
    })
  })

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_DELIVERY_OUTPUT_REASON_CODES.INVALID_ROUTE_CONSISTENCY)
})

test('e-output: no_fill requires canonical e_nf reason code', () => {
  const deliveryBuilder = createDeliveryOutputBuilder()
  const result = deliveryBuilder.buildDeliveryResponse({
    dToEOutputLite: buildDToEOutputLite({
      routeConclusion: {
        routeOutcome: 'no_fill',
        finalReasonCode: 'd_nf_no_fill'
      }
    }),
    renderPlanLite: buildRenderPlanLite({
      deliveryStatus: 'no_fill',
      eErrorDegradeDecisionSnapshotLite: {
        finalCanonicalReasonCode: 'e_er_unknown',
        decisionRuleVersion: 'e_decision_rule_v1'
      },
      candidateConsumptionDecision: {
        selectedCandidateRefs: []
      }
    })
  })

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_DELIVERY_OUTPUT_REASON_CODES.INVALID_FINAL_REASON_CODE)
})

test('e-output: maps ad_rendered to impression for F event', () => {
  const deliveryBuilder = createDeliveryOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T08:03:00.000Z')
  })
  const eventBuilder = createEventOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T08:03:01.000Z')
  })

  const delivery = deliveryBuilder.buildDeliveryResponse({
    dToEOutputLite: buildDToEOutputLite(),
    renderPlanLite: buildRenderPlanLite()
  })
  assert.equal(delivery.ok, true)

  const eventResult = eventBuilder.buildEvent({
    eDeliveryResponseLite: delivery.eDeliveryResponseLite,
    sourceRenderEventType: 'ad_rendered',
    renderAttemptId: 'render_attempt_001',
    eventReasonCode: 'e_impression_reported'
  })

  assert.equal(eventResult.ok, true)
  assert.equal(eventResult.emitted, true)
  assert.equal(eventResult.reasonCode, E_EVENT_OUTPUT_REASON_CODES.EVENT_READY)
  assert.equal(eventResult.eToFEventLite.eventType, 'impression')
  assert.equal(eventResult.eToFEventLite.sourceRenderEventType, 'ad_rendered')
  assert.equal(eventResult.eToFEventLite.deliveryStatusSnapshot, 'served')
  assert.equal(Boolean(eventResult.eToFEventLite.idempotencyKey), true)
})

test('e-output: ad_render_started is ignored for F billing events', () => {
  const eventBuilder = createEventOutputBuilder()
  const result = eventBuilder.buildEvent({
    eDeliveryResponseLite: {
      responseReference: 'resp_e_out_ignored',
      deliveryStatus: 'served',
      traceKey: 'trace_e_ignored',
      requestKey: 'req_e_ignored',
      attemptKey: 'att_e_ignored',
      opportunityKey: 'opp_e_ignored'
    },
    sourceRenderEventType: 'ad_render_started',
    renderAttemptId: 'render_attempt_ignored'
  })

  assert.equal(result.ok, true)
  assert.equal(result.emitted, false)
  assert.equal(result.reasonCode, E_EVENT_OUTPUT_REASON_CODES.EVENT_IGNORED)
})

test('e-output: no_fill snapshot cannot emit impression', () => {
  const eventBuilder = createEventOutputBuilder()
  const result = eventBuilder.buildEvent({
    eDeliveryResponseLite: {
      responseReference: 'resp_e_out_nofill',
      deliveryStatus: 'no_fill',
      traceKey: 'trace_e_nofill',
      requestKey: 'req_e_nofill',
      attemptKey: 'att_e_nofill',
      opportunityKey: 'opp_e_nofill'
    },
    sourceRenderEventType: 'ad_rendered',
    renderAttemptId: 'render_attempt_nofill'
  })

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_EVENT_OUTPUT_REASON_CODES.IMPRESSION_FORBIDDEN_STATUS)
})

test('e-output: one renderAttempt allows only one terminal event', () => {
  const eventBuilder = createEventOutputBuilder()
  const base = {
    eDeliveryResponseLite: {
      responseReference: 'resp_e_out_term',
      deliveryStatus: 'served',
      traceKey: 'trace_e_term',
      requestKey: 'req_e_term',
      attemptKey: 'att_e_term',
      opportunityKey: 'opp_e_term'
    },
    renderAttemptId: 'render_attempt_term'
  }

  const first = eventBuilder.buildEvent({
    ...base,
    sourceRenderEventType: 'ad_rendered'
  })
  assert.equal(first.ok, true)
  assert.equal(first.eToFEventLite.eventType, 'impression')

  const second = eventBuilder.buildEvent({
    ...base,
    sourceRenderEventType: 'ad_render_failed'
  })
  assert.equal(second.ok, false)
  assert.equal(second.reasonCode, E_EVENT_OUTPUT_REASON_CODES.TERMINAL_EVENT_CONFLICT)
})

test('e-output: missing responseReference goes to quarantine track', () => {
  const eventBuilder = createEventOutputBuilder()
  const result = eventBuilder.buildEvent({
    eDeliveryResponseLite: {
      deliveryStatus: 'error',
      traceKey: 'trace_e_q',
      requestKey: 'req_e_q',
      attemptKey: 'att_e_q',
      opportunityKey: 'opp_e_q'
    },
    sourceRenderEventType: 'ad_render_failed',
    renderAttemptId: 'render_attempt_q'
  })

  assert.equal(result.ok, true)
  assert.equal(result.emitted, false)
  assert.equal(result.quarantined, true)
  assert.equal(result.reasonCode, E_EVENT_OUTPUT_REASON_CODES.MISSING_RESPONSE_REFERENCE)
})
