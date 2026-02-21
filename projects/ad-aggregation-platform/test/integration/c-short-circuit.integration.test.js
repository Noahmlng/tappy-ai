import assert from 'node:assert/strict'
import test from 'node:test'

import {
  C_POLICY_ACTIONS,
  C_POLICY_REASON_CODES,
  C_SHORT_CIRCUIT_ACTIONS,
  createPolicyEngine
} from '../../src/mediation/c/policy-engine.js'

function buildBaseInput(overrides = {}) {
  return {
    opportunityKey: 'opp_c_001',
    schemaVersion: 'schema_v1',
    cInputContractVersion: 'c_input_contract_v1',
    state: 'received',
    RequestMeta: {
      requestKey: 'req_c_001',
      requestTimestamp: '2026-02-22T00:10:00.000Z',
      channelType: 'sdk_server',
      frequencyCount: 1
    },
    PlacementMeta: {
      placementKey: 'plc_inline_001',
      placementType: 'chat_inline',
      placementSurface: 'chat_surface'
    },
    UserContext: {
      sessionKey: 'sess_c_001',
      actorType: 'human'
    },
    OpportunityContext: {
      triggerDecision: 'opportunity_eligible',
      decisionOutcome: 'opportunity_eligible',
      hitType: 'explicit_hit'
    },
    PolicyContext: {
      consentScope: 'consent_granted',
      policyGateHint: 'allow',
      restrictedCategoryFlags: [],
      frequencyCount: 1
    },
    TraceContext: {
      traceKey: 'trace_c_001',
      requestKey: 'req_c_001',
      attemptKey: 'att_c_001'
    },
    normalizationSummary: {
      mappingProfileVersion: 'b_mapping_profile_v1',
      enumDictVersion: 'b_enum_dict_v1',
      conflictPolicyVersion: 'b_conflict_policy_v1'
    },
    mappingAuditSnapshotLite: {},
    policySnapshotLite: {
      policySnapshotId: 'ps_001',
      policySnapshotVersion: 'ps_v1',
      policyPackVersion: 'pp_v1',
      policyRuleVersion: 'pr_v1',
      snapshotSource: 'resolvedConfigSnapshot',
      resolvedConfigRef: 'resolve_001',
      configHash: 'hash_001',
      effectiveAt: '2026-02-22T00:00:00.000Z',
      expireAtOrNA: '2026-02-22T01:00:00.000Z',
      failureMode: 'fail_closed',
      policyConstraintsLite: {
        complianceGate: {
          hardBlocked: false,
          ruleId: 'r_compliance_allow'
        },
        consentAuthGate: {
          blockedConsentScopes: ['consent_denied'],
          degradeOnLimited: true,
          degradeRuleId: 'r_consent_degrade_z',
          degradeRiskLevel: 'medium'
        },
        frequencyCapGate: {
          hardCap: 10,
          degradeThreshold: 5,
          ruleId: 'r_frequency_block',
          degradeRuleId: 'r_frequency_degrade_a',
          degradeRiskLevel: 'medium'
        },
        categoryGate: {
          hardBlockedCategories: ['restricted_hard'],
          degradedCategories: ['restricted_soft'],
          ruleId: 'r_category_block',
          degradeRuleId: 'r_category_degrade_c',
          degradeRiskLevel: 'low'
        }
      }
    },
    ...overrides
  }
}

test('c-short-circuit: compliance hard block stops evaluation immediately', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T00:20:00.000Z')
  })

  const result = engine.evaluate(
    buildBaseInput({
      policySnapshotLite: {
        ...buildBaseInput().policySnapshotLite,
        policyConstraintsLite: {
          ...buildBaseInput().policySnapshotLite.policyConstraintsLite,
          complianceGate: {
            hardBlocked: true,
            ruleId: 'r_compliance_hard_block'
          }
        }
      }
    })
  )

  assert.equal(result.evaluateAccepted, true)
  assert.equal(result.finalPolicyAction, C_POLICY_ACTIONS.BLOCK)
  assert.equal(result.shortCircuitAction, C_SHORT_CIRCUIT_ACTIONS.BLOCK)
  assert.equal(result.shortCircuitGate, 'compliance_gate')
  assert.equal(result.shortCircuitReasonCode, C_POLICY_REASON_CODES.COMPLIANCE_HARD_BLOCK)
  assert.deepEqual(result.executedGates, ['compliance_gate'])
  assert.equal(result.isRoutable, false)
  assert.equal(result.allowAd, false)
})

test('c-short-circuit: consent hard block executes first two gates then stops', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T00:21:00.000Z')
  })

  const result = engine.evaluate(
    buildBaseInput({
      PolicyContext: {
        consentScope: 'consent_denied',
        policyGateHint: 'deny',
        restrictedCategoryFlags: [],
        frequencyCount: 1
      }
    })
  )

  assert.equal(result.finalPolicyAction, C_POLICY_ACTIONS.BLOCK)
  assert.equal(result.shortCircuitAction, C_SHORT_CIRCUIT_ACTIONS.BLOCK)
  assert.equal(result.shortCircuitGate, 'consent_auth_gate')
  assert.equal(result.shortCircuitReasonCode, C_POLICY_REASON_CODES.CONSENT_SCOPE_BLOCKED)
  assert.deepEqual(result.executedGates, ['compliance_gate', 'consent_auth_gate'])
})

test('c-short-circuit: all gates allow results in short_circuit_allow', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T00:22:00.000Z')
  })

  const result = engine.evaluate(buildBaseInput())
  assert.equal(result.finalPolicyAction, C_POLICY_ACTIONS.ALLOW)
  assert.equal(result.shortCircuitAction, C_SHORT_CIRCUIT_ACTIONS.ALLOW)
  assert.equal(result.shortCircuitReasonCode, C_POLICY_REASON_CODES.POLICY_PASS)
  assert.deepEqual(result.executedGates, [
    'compliance_gate',
    'consent_auth_gate',
    'frequency_cap_gate',
    'category_gate'
  ])
  assert.equal(result.isRoutable, true)
  assert.equal(result.allowAd, true)
})

test('c-short-circuit: degrade conflict uses risk then ruleId tie-break', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T00:23:00.000Z')
  })

  const result = engine.evaluate(
    buildBaseInput({
      PolicyContext: {
        consentScope: 'consent_limited',
        policyGateHint: 'allow',
        restrictedCategoryFlags: [],
        frequencyCount: 5
      },
      policySnapshotLite: {
        ...buildBaseInput().policySnapshotLite,
        policyConstraintsLite: {
          ...buildBaseInput().policySnapshotLite.policyConstraintsLite,
          consentAuthGate: {
            ...buildBaseInput().policySnapshotLite.policyConstraintsLite.consentAuthGate,
            degradeRuleId: 'z_rule_consent'
          },
          frequencyCapGate: {
            ...buildBaseInput().policySnapshotLite.policyConstraintsLite.frequencyCapGate,
            degradeRuleId: 'a_rule_frequency'
          }
        }
      }
    })
  )

  assert.equal(result.finalPolicyAction, C_POLICY_ACTIONS.DEGRADE)
  assert.equal(result.shortCircuitAction, C_SHORT_CIRCUIT_ACTIONS.ALLOW)
  assert.equal(result.winningGate, 'frequency_cap_gate')
  assert.equal(result.winningRuleId, 'a_rule_frequency')
  assert.equal(result.policyConflictReasonCode, C_POLICY_REASON_CODES.POLICY_CONFLICT_RESOLVED)
  assert.equal(result.isRoutable, true)
})

test('c-short-circuit: expired snapshot with fail_open degrades deterministically', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T00:24:00.000Z')
  })

  const result = engine.evaluate(
    buildBaseInput({
      policySnapshotLite: {
        ...buildBaseInput().policySnapshotLite,
        failureMode: 'fail_open',
        expireAtOrNA: '2026-02-22T00:00:00.000Z'
      }
    })
  )

  assert.equal(result.finalPolicyAction, C_POLICY_ACTIONS.DEGRADE)
  assert.equal(result.shortCircuitAction, C_SHORT_CIRCUIT_ACTIONS.ALLOW)
  assert.equal(result.reasonCode, C_POLICY_REASON_CODES.POLICY_DEGRADED_PASS)
  assert.equal(result.winningGate, 'snapshot_guard')
  assert.equal(result.winningRuleId, 'snapshot_expired_fail_open_rule')
})

test('c-short-circuit: same input returns stable decision for repeated runs', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T00:25:00.000Z')
  })
  const input = buildBaseInput({
    PolicyContext: {
      consentScope: 'consent_limited',
      policyGateHint: 'allow',
      restrictedCategoryFlags: ['restricted_soft'],
      frequencyCount: 5
    }
  })

  const first = engine.evaluate(input)
  for (let i = 0; i < 8; i += 1) {
    const next = engine.evaluate(input)
    assert.deepEqual(next, first)
  }
})
