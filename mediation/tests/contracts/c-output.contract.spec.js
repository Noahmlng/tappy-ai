import assert from 'node:assert/strict'
import test from 'node:test'

import { assertRequiredFields } from '../utils/contract-runner.js'
import {
  C_POLICY_ACTIONS,
  C_POLICY_REASON_CODES,
  createPolicyEngine
} from '../../src/mediation/policy-safety/policy-engine.js'
import {
  C_PRIMARY_POLICY_REASON_CODES,
  C_REASON_CODE_ACTION_MAP,
  createPolicyOutputBuilder
} from '../../src/mediation/policy-safety/output-builder.js'

function buildBaseInput(overrides = {}) {
  return {
    opportunityKey: 'opp_c_out_001',
    schemaVersion: 'schema_v1',
    cInputContractVersion: 'c_input_contract_v1',
    state: 'received',
    RequestMeta: {
      requestKey: 'req_c_out_001',
      requestTimestamp: '2026-02-22T01:00:00.000Z',
      channelType: 'sdk_server',
      frequencyCount: 1
    },
    PlacementMeta: {
      placementKey: 'plc_inline_001',
      placementType: 'chat_inline',
      placementSurface: 'chat_surface'
    },
    UserContext: {
      sessionKey: 'sess_c_out_001',
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
      traceKey: 'trace_c_out_001',
      requestKey: 'req_c_out_001',
      attemptKey: 'att_c_out_001'
    },
    normalizationSummary: {
      mappingProfileVersion: 'b_mapping_profile_v1',
      enumDictVersion: 'b_enum_dict_v1',
      conflictPolicyVersion: 'b_conflict_policy_v1'
    },
    mappingAuditSnapshotLite: { id: 'map_snapshot_1' },
    policySnapshotLite: {
      policySnapshotId: 'ps_out_001',
      policySnapshotVersion: 'ps_v1',
      policyPackVersion: 'pp_v1',
      policyRuleVersion: 'pr_v1',
      snapshotSource: 'resolvedConfigSnapshot',
      resolvedConfigRef: 'resolve_out_001',
      configHash: 'cfg_hash_001',
      effectiveAt: '2026-02-22T00:00:00.000Z',
      expireAtOrNA: '2026-02-22T02:00:00.000Z',
      failureMode: 'fail_closed',
      policyConstraintsLite: {
        complianceGate: { hardBlocked: false, ruleId: 'r_comp_allow' },
        consentAuthGate: {
          blockedConsentScopes: ['consent_denied'],
          degradeOnLimited: true,
          degradeRuleId: 'r_consent_degrade',
          degradeRiskLevel: 'medium'
        },
        frequencyCapGate: {
          hardCap: 10,
          degradeThreshold: 5,
          ruleId: 'r_freq_block',
          degradeRuleId: 'r_freq_degrade',
          degradeRiskLevel: 'medium'
        },
        categoryGate: {
          hardBlockedCategories: ['restricted_hard'],
          degradedCategories: ['restricted_soft'],
          ruleId: 'r_cat_block',
          degradeRuleId: 'r_cat_degrade',
          degradeRiskLevel: 'low'
        },
        constraintsLite: {
          constraintSetVersion: 'c_constraints_v1',
          categoryConstraints: {
            bcat: [],
            badv: []
          },
          personalizationConstraints: {
            nonPersonalizedOnly: false
          },
          renderConstraints: {
            disallowRenderModes: ['webview']
          },
          sourceConstraints: {
            sourceSelectionMode: 'all_except_blocked',
            allowedSourceIds: [],
            blockedSourceIds: []
          },
          constraintReasonCodes: []
        }
      }
    },
    mappingWarnings: [],
    ...overrides
  }
}

test('c-output: allow output contains full C->D consumable contract', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T01:10:00.000Z')
  })
  const builder = createPolicyOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T01:10:01.000Z')
  })
  const cInput = buildBaseInput()
  const evaluationResult = engine.evaluate(cInput)
  const output = builder.buildOutput({
    cInput,
    evaluationResult,
    policyEvaluationStartAt: '2026-02-22T01:10:00.000Z',
    policyEvaluationEndAt: '2026-02-22T01:10:01.000Z'
  })

  assert.equal(output.finalPolicyAction, C_POLICY_ACTIONS.ALLOW)
  assert.equal(output.isRoutable, true)
  assert.equal(output.adDecisionLite.allowAd, true)
  assert.equal(output.adDecisionLite.decisionSemantic, 'serve_ad')
  assert.equal(output.stateUpdate.toState, 'routed')
  assert.equal(output.stateUpdate.stateReasonCode, 'policy_passed')
  assert.equal(Boolean(output.routableOpportunityLite), true)
  assert.equal(output.policyBlockedResultLite, null)

  assertRequiredFields(output, [
    'opportunityKey',
    'traceKey',
    'requestKey',
    'attemptKey',
    'finalPolicyAction',
    'isRoutable',
    'policyDecisionReasonCode',
    'winningGate',
    'winningRuleId',
    'decisionTimestamp',
    'policyPackVersion',
    'policyRuleVersion',
    'policySnapshotId',
    'policySnapshotVersion',
    'constraintsLite.constraintSetVersion',
    'constraintsLite.categoryConstraints.bcat',
    'constraintsLite.categoryConstraints.badv',
    'constraintsLite.personalizationConstraints.nonPersonalizedOnly',
    'constraintsLite.renderConstraints.disallowRenderModes',
    'constraintsLite.sourceConstraints.sourceSelectionMode',
    'constraintsLite.sourceConstraints.allowedSourceIds',
    'constraintsLite.sourceConstraints.blockedSourceIds',
    'constraintsLite.constraintReasonCodes',
    'adDecisionLite.allowAd',
    'adDecisionLite.decisionSemantic',
    'stateUpdate.fromState',
    'stateUpdate.toState',
    'stateUpdate.stateReasonCode',
    'policyAuditSnapshotLite.finalConclusion.finalPolicyAction',
    'policyAuditSnapshotLite.finalConclusion.constraintsLite.constraintSetVersion'
  ])
})

test('c-output: block output contains full C->E no-ad contract', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T01:20:00.000Z')
  })
  const builder = createPolicyOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T01:20:01.000Z')
  })

  const cInput = buildBaseInput({
    PolicyContext: {
      consentScope: 'consent_denied',
      policyGateHint: 'deny',
      restrictedCategoryFlags: [],
      frequencyCount: 1
    }
  })
  const evaluationResult = engine.evaluate(cInput)
  const output = builder.buildOutput({ cInput, evaluationResult })

  assert.equal(output.finalPolicyAction, C_POLICY_ACTIONS.BLOCK)
  assert.equal(output.isRoutable, false)
  assert.equal(output.adDecisionLite.allowAd, false)
  assert.equal(output.adDecisionLite.decisionSemantic, 'no_ad')
  assert.equal(output.adDecisionLite.noAdReasonCode, output.primaryPolicyReasonCode)
  assert.equal(output.stateUpdate.toState, 'error')
  assert.equal(output.stateUpdate.stateReasonCode, 'policy_blocked')
  assert.equal(output.routableOpportunityLite, null)
  assert.equal(Boolean(output.policyBlockedResultLite), true)
})

test('c-output: frequency degrade maps to frequency soft-cap reason code', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T01:30:00.000Z')
  })
  const builder = createPolicyOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T01:30:01.000Z')
  })

  const cInput = buildBaseInput({
    PolicyContext: {
      consentScope: 'consent_granted',
      policyGateHint: 'allow',
      restrictedCategoryFlags: [],
      frequencyCount: 6
    }
  })
  const evaluationResult = engine.evaluate(cInput)
  const output = builder.buildOutput({ cInput, evaluationResult })

  assert.equal(output.finalPolicyAction, C_POLICY_ACTIONS.DEGRADE)
  assert.equal(output.primaryPolicyReasonCode, C_PRIMARY_POLICY_REASON_CODES.FREQUENCY_SOFT_CAP_DEGRADE)
  assert.equal(output.stateUpdate.stateReasonCode, 'policy_degraded_pass')
  assert.equal(output.constraintsLite.constraintReasonCodes.includes(C_PRIMARY_POLICY_REASON_CODES.FREQUENCY_SOFT_CAP_DEGRADE), true)
})

test('c-output: sourceConstraints keeps blocked precedence over allowlist', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T01:40:00.000Z')
  })
  const builder = createPolicyOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T01:40:01.000Z')
  })
  const cInput = buildBaseInput({
    policySnapshotLite: {
      ...buildBaseInput().policySnapshotLite,
      policyConstraintsLite: {
        ...buildBaseInput().policySnapshotLite.policyConstraintsLite,
        constraintsLite: {
          ...buildBaseInput().policySnapshotLite.policyConstraintsLite.constraintsLite,
          sourceConstraints: {
            sourceSelectionMode: 'allowlist_only',
            allowedSourceIds: ['src_a', 'src_b'],
            blockedSourceIds: ['src_b', 'src_c']
          }
        }
      }
    }
  })

  const evaluationResult = engine.evaluate(cInput)
  const output = builder.buildOutput({ cInput, evaluationResult })

  assert.deepEqual(output.constraintsLite.sourceConstraints.allowedSourceIds, ['src_a'])
  assert.deepEqual(output.constraintsLite.sourceConstraints.blockedSourceIds, ['src_b', 'src_c'])
  assert.equal(output.constraintsLite.sourceConstraints.sourceSelectionMode, 'allowlist_only')
})

test('c-output: reason code action map is aligned with policy actions', () => {
  assert.equal(
    C_REASON_CODE_ACTION_MAP[C_PRIMARY_POLICY_REASON_CODES.COMPLIANCE_HARD_BLOCK],
    C_POLICY_ACTIONS.BLOCK
  )
  assert.equal(
    C_REASON_CODE_ACTION_MAP[C_PRIMARY_POLICY_REASON_CODES.FREQUENCY_SOFT_CAP_DEGRADE],
    C_POLICY_ACTIONS.DEGRADE
  )
  assert.equal(
    C_REASON_CODE_ACTION_MAP[C_PRIMARY_POLICY_REASON_CODES.POLICY_PASS],
    C_POLICY_ACTIONS.ALLOW
  )
  assert.equal(
    C_REASON_CODE_ACTION_MAP[C_PRIMARY_POLICY_REASON_CODES.POLICY_SNAPSHOT_INVALID],
    C_POLICY_ACTIONS.REJECT
  )
})

test('c-output: policy audit snapshot is aligned with final output conclusion', () => {
  const engine = createPolicyEngine({
    nowFn: () => Date.parse('2026-02-22T01:50:00.000Z')
  })
  const builder = createPolicyOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T01:50:01.000Z')
  })
  const cInput = buildBaseInput({
    PolicyContext: {
      consentScope: 'consent_limited',
      policyGateHint: 'allow',
      restrictedCategoryFlags: ['restricted_soft'],
      frequencyCount: 1
    }
  })
  const evaluationResult = engine.evaluate(cInput)
  const output = builder.buildOutput({
    cInput,
    evaluationResult,
    policyEvaluationStartAt: '2026-02-22T01:50:00.000Z',
    policyEvaluationEndAt: '2026-02-22T01:50:01.000Z'
  })

  const audit = output.policyAuditSnapshotLite
  assert.equal(audit.traceKey, output.traceKey)
  assert.equal(audit.requestKey, output.requestKey)
  assert.equal(audit.attemptKey, output.attemptKey)
  assert.equal(audit.opportunityKey, output.opportunityKey)
  assert.equal(audit.finalConclusion.finalPolicyAction, output.finalPolicyAction)
  assert.deepEqual(audit.finalConclusion.constraintsLite, output.constraintsLite)
  assert.equal(audit.finalConclusion.primaryPolicyReasonCode, output.primaryPolicyReasonCode)
  assert.equal(audit.versionSnapshot.policySnapshotId, output.policySnapshotId)
  assert.equal(audit.versionSnapshot.policySnapshotVersion, output.policySnapshotVersion)
  assert.equal(audit.stateUpdate.toState, output.stateUpdate.toState)
  assert.equal(Array.isArray(audit.decisionActions), true)
  assert.equal(audit.decisionActions.length > 0, true)
  assert.equal(Array.isArray(audit.hitRules), true)
  assert.equal(audit.hitRules.length > 0, true)
  assert.equal(audit.shortCircuitSnapshot.shortCircuitAction, output.shortCircuitAction)
})

test('c-output: engine reject reason is retained for invalid input state', () => {
  const builder = createPolicyOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T02:00:01.000Z')
  })

  const cInput = buildBaseInput({
    state: 'error'
  })
  const evaluationResult = {
    evaluateAccepted: false,
    finalPolicyAction: C_POLICY_ACTIONS.REJECT,
    reasonCode: C_POLICY_REASON_CODES.INVALID_INPUT_STATE,
    shortCircuitReasonCode: C_POLICY_REASON_CODES.INVALID_INPUT_STATE,
    shortCircuitAction: 'short_circuit_block',
    shortCircuitGate: 'input_guard',
    winningGate: 'input_guard',
    winningRuleId: 'input_guard_rule',
    policyPackVersion: cInput.policySnapshotLite.policyPackVersion,
    policyRuleVersion: cInput.policySnapshotLite.policyRuleVersion,
    policySnapshotId: cInput.policySnapshotLite.policySnapshotId,
    policySnapshotVersion: cInput.policySnapshotLite.policySnapshotVersion,
    traceKey: cInput.TraceContext.traceKey,
    requestKey: cInput.TraceContext.requestKey,
    attemptKey: cInput.TraceContext.attemptKey,
    decisionActions: [],
    decisionTimestamp: '2026-02-22T02:00:01.000Z'
  }
  const output = builder.buildOutput({ cInput, evaluationResult })

  assert.equal(evaluationResult.evaluateAccepted, false)
  assert.equal(output.primaryPolicyReasonCode, C_POLICY_REASON_CODES.INVALID_INPUT_STATE)
  assert.equal(output.finalPolicyAction, C_POLICY_ACTIONS.REJECT)
  assert.equal(output.isRoutable, false)
})
