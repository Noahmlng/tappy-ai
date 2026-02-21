import assert from 'node:assert/strict'
import test from 'node:test'

import {
  E_RENDER_GATE_REASON_CODES,
  createRenderGate
} from '../../src/mediation/e/render-gate.js'
import {
  E_CANONICAL_REASON_CODES,
  E_ERROR_DEGRADE_REASON_CODES,
  createErrorDegradeEngine
} from '../../src/mediation/e/error-degrade.js'

function buildTraceKeys() {
  return {
    traceKey: 'trace_e_gate_001',
    requestKey: 'req_e_gate_001',
    attemptKey: 'att_e_gate_001',
    opportunityKey: 'opp_e_gate_001'
  }
}

function buildVersionSnapshot(overrides = {}) {
  return {
    renderPolicyVersion: 'render_policy_v1',
    deviceCapabilityProfileVersion: 'device_profile_v1',
    placementConfigVersion: 'placement_cfg_v1',
    gateRuleVersion: 'e_gate_rule_v1',
    decisionRuleVersion: 'e_error_degrade_rule_v1',
    ...overrides
  }
}

function buildRenderGateInput(overrides = {}) {
  return {
    traceKeys: buildTraceKeys(),
    placementSpecLite: {
      allowedRenderModes: ['mraid_container', 'webview', 'native_card']
    },
    deviceCapabilitiesLite: {
      supportedRenderModes: ['mraid_container', 'webview', 'native_card'],
      webviewSupported: true,
      mraidSupported: true,
      videoVastSupported: false,
      maxRenderSlotCount: 2
    },
    policyConstraintsLite: {
      renderConstraints: {
        disallowRenderModes: []
      },
      personalizationConstraints: {
        nonPersonalizedOnly: false
      },
      categoryConstraints: {
        bcat: [],
        badv: []
      }
    },
    versionSnapshot: buildVersionSnapshot(),
    ...overrides
  }
}

test('e-gate: capability gate selects video first when explicitly allowed and supported', () => {
  const gate = createRenderGate({
    nowFn: () => Date.parse('2026-02-22T07:00:00.000Z')
  })
  const result = gate.evaluate(
    buildRenderGateInput({
      placementSpecLite: {
        allowedRenderModes: ['video_vast_container', 'mraid_container', 'webview', 'native_card']
      },
      deviceCapabilitiesLite: {
        supportedRenderModes: ['video_vast_container', 'mraid_container', 'webview', 'native_card'],
        webviewSupported: true,
        mraidSupported: true,
        videoVastSupported: true,
        maxRenderSlotCount: 2
      }
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, E_RENDER_GATE_REASON_CODES.GATE_READY)
  assert.equal(result.selectedRenderMode, 'video_vast_container')
  assert.equal(result.deliveryHint, 'served')
  assert.deepEqual(result.renderCapabilityGateSnapshotLite.selectionDecision.degradePath, [])
  assert.equal(result.renderCapabilityGateSnapshotLite.selectionDecision.finalGateReasonCode, E_RENDER_GATE_REASON_CODES.MODE_PASS)
})

test('e-gate: policy disallow forces degrade chain mraid -> webview', () => {
  const gate = createRenderGate({
    nowFn: () => Date.parse('2026-02-22T07:01:00.000Z')
  })
  const result = gate.evaluate(
    buildRenderGateInput({
      policyConstraintsLite: {
        renderConstraints: {
          disallowRenderModes: ['mraid_container']
        },
        personalizationConstraints: {
          nonPersonalizedOnly: false
        },
        categoryConstraints: {
          bcat: ['cat_sensitive'],
          badv: []
        }
      }
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.selectedRenderMode, 'webview')
  assert.deepEqual(result.renderCapabilityGateSnapshotLite.selectionDecision.eligibleModes, ['webview', 'native_card'])
  assert.deepEqual(result.renderCapabilityGateSnapshotLite.selectionDecision.degradePath, [
    {
      rejectedMode: 'mraid_container',
      rejectReasonCode: E_RENDER_GATE_REASON_CODES.POLICY_MODE_DISALLOWED
    }
  ])
})

test('e-gate: all modes rejected returns no_fill hint and stable reason', () => {
  const gate = createRenderGate({
    nowFn: () => Date.parse('2026-02-22T07:02:00.000Z')
  })
  const result = gate.evaluate(
    buildRenderGateInput({
      deviceCapabilitiesLite: {
        supportedRenderModes: [],
        webviewSupported: false,
        mraidSupported: false,
        videoVastSupported: false,
        maxRenderSlotCount: 0
      }
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.selectedRenderMode, 'none')
  assert.equal(result.deliveryHint, 'no_fill')
  assert.equal(
    result.renderCapabilityGateSnapshotLite.selectionDecision.finalGateReasonCode,
    E_RENDER_GATE_REASON_CODES.ALL_MODES_REJECTED
  )
})

test('e-gate: invalid version snapshot is rejected', () => {
  const gate = createRenderGate()
  const result = gate.evaluate(
    buildRenderGateInput({
      versionSnapshot: {
        renderPolicyVersion: 'render_policy_v1'
      }
    })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_RENDER_GATE_REASON_CODES.INVALID_VERSION_ANCHOR)
})

test('e-gate: same input yields deterministic gate snapshot', () => {
  const gate = createRenderGate({
    nowFn: () => Date.parse('2026-02-22T07:03:00.000Z')
  })
  const input = buildRenderGateInput()
  const first = gate.evaluate(input)
  const second = gate.evaluate(input)

  assert.deepEqual(second, first)
})

function buildDecisionInput(overrides = {}) {
  return {
    traceKeys: buildTraceKeys(),
    versionSnapshot: buildVersionSnapshot(),
    rawReasonCodes: ['e_gate_all_modes_rejected'],
    modeDegradePath: ['mraid_container', 'webview', 'native_card'],
    ...overrides
  }
}

test('e-gate: error-degrade maps capability rejection to canonical no_fill with fail_open', () => {
  const engine = createErrorDegradeEngine({
    nowFn: () => Date.parse('2026-02-22T07:10:00.000Z')
  })
  const result = engine.decide(buildDecisionInput())

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, E_ERROR_DEGRADE_REASON_CODES.DECISION_READY)
  assert.equal(result.finalDeliveryStatus, 'no_fill')
  assert.equal(result.finalCanonicalReasonCode, E_CANONICAL_REASON_CODES.CAPABILITY_GATE_REJECTED)
  assert.equal(result.failStrategy, 'fail_open')
  assert.equal(result.eErrorDegradeDecisionSnapshotLite.finalDeliveryStatus, 'no_fill')
  assert.equal(
    result.eErrorDegradeDecisionSnapshotLite.finalCanonicalReasonCode,
    E_CANONICAL_REASON_CODES.CAPABILITY_GATE_REJECTED
  )
})

test('e-gate: no_fill vs error uses error-first priority deterministically', () => {
  const engine = createErrorDegradeEngine({
    nowFn: () => Date.parse('2026-02-22T07:11:00.000Z')
  })
  const result = engine.decide(
    buildDecisionInput({
      rawReasonCodes: ['e_no_candidate_input', 'e_compose_invalid_structure']
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.finalDeliveryStatus, 'error')
  assert.equal(result.finalCanonicalReasonCode, E_CANONICAL_REASON_CODES.INVALID_COMPOSE_INPUT)
  assert.equal(result.failStrategy, 'fail_closed')
})

test('e-gate: compose runtime failure maps to mixed strategy error', () => {
  const engine = createErrorDegradeEngine({
    nowFn: () => Date.parse('2026-02-22T07:12:00.000Z')
  })
  const result = engine.decide(
    buildDecisionInput({
      rawReasonCodes: ['e_render_compose_error']
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.finalDeliveryStatus, 'error')
  assert.equal(result.finalCanonicalReasonCode, E_CANONICAL_REASON_CODES.COMPOSE_RUNTIME_FAILURE)
  assert.equal(result.failStrategy, 'mixed')
})

test('e-gate: policy hard block maps to no_fill and fail_closed action family', () => {
  const engine = createErrorDegradeEngine({
    nowFn: () => Date.parse('2026-02-22T07:13:00.000Z')
  })
  const result = engine.decide(
    buildDecisionInput({
      rawReasonCodes: ['e_policy_hard_blocked']
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.finalDeliveryStatus, 'no_fill')
  assert.equal(result.finalCanonicalReasonCode, E_CANONICAL_REASON_CODES.POLICY_BLOCKED)
  assert.equal(result.failStrategy, 'fail_closed')
})

test('e-gate: decision snapshot is deterministic and auditable', () => {
  const engine = createErrorDegradeEngine({
    nowFn: () => Date.parse('2026-02-22T07:14:00.000Z')
  })
  const input = buildDecisionInput({
    actionsTaken: [
      {
        stage: 'capability_gate',
        rawReasonCode: 'e_gate_policy_mode_disallowed'
      },
      {
        stage: 'disclosure_check',
        rawReasonCode: 'e_disclosure_all_rejected'
      }
    ]
  })
  const first = engine.decide(input)
  const second = engine.decide(input)

  assert.equal(first.ok, true)
  assert.deepEqual(second, first)
  assert.equal(Array.isArray(first.eErrorDegradeDecisionSnapshotLite.actionsTaken), true)
  assert.equal(first.eErrorDegradeDecisionSnapshotLite.actionsTaken.length, 2)
})

test('e-gate: missing trace keys fails fast with stable reason code', () => {
  const engine = createErrorDegradeEngine()
  const result = engine.decide(
    buildDecisionInput({
      traceKeys: {
        traceKey: 'trace_missing_only'
      }
    })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_ERROR_DEGRADE_REASON_CODES.INVALID_INPUT)
})
