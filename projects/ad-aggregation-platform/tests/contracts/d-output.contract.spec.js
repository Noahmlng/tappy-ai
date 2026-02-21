import assert from 'node:assert/strict'
import test from 'node:test'

import { assertRequiredFields } from '../utils/contract-runner.js'
import {
  D_OUTPUT_REASON_CODES,
  createDOutputBuilder
} from '../../src/mediation/d/output-builder.js'
import { D_ROUTE_AUDIT_REASON_CODES } from '../../src/mediation/d/route-audit.js'

function buildRoutePlanLite(overrides = {}) {
  return {
    routePlanId: 'rp_d_out_001',
    opportunityKey: 'opp_d_out_001',
    traceKey: 'trace_d_out_001',
    requestKey: 'req_d_out_001',
    attemptKey: 'att_d_out_001',
    routingPolicyVersion: 'd_routing_policy_v2',
    fallbackProfileVersion: 'd_fallback_profile_v2',
    configSnapshotLite: {
      configSnapshotId: 'cfg_snap_d_out_001',
      resolvedConfigRef: 'cfg_resolve_d_out_001',
      configHash: 'cfg_hash_d_out_001',
      effectiveAt: '2026-02-22T04:00:00.000Z'
    },
    executionStrategyLite: {
      strategyType: 'waterfall',
      parallelFanout: 1,
      strategyTimeoutMs: 1500,
      fallbackPolicy: 'on_no_fill_or_error',
      executionStrategyVersion: 'd_execution_strategy_v2'
    },
    routeSteps: [
      {
        stepIndex: 1,
        routeTier: 'primary',
        sourceId: 'source_primary_a',
        entryCondition: 'on_plan_start_1',
        timeoutBudgetMs: 1200,
        maxRetryCount: 1,
        dispatchMode: 'sequential',
        stepStatus: 'pending'
      },
      {
        stepIndex: 2,
        routeTier: 'secondary',
        sourceId: 'source_secondary_a',
        entryCondition: 'on_primary_no_fill_or_non_retryable_error_2',
        timeoutBudgetMs: 900,
        maxRetryCount: 1,
        dispatchMode: 'sequential',
        stepStatus: 'pending'
      },
      {
        stepIndex: 3,
        routeTier: 'fallback',
        sourceId: 'source_fallback_a',
        entryCondition: 'on_primary_secondary_exhausted_3',
        timeoutBudgetMs: 700,
        maxRetryCount: 1,
        dispatchMode: 'sequential',
        stepStatus: 'pending'
      }
    ],
    routePlanStatus: 'planned',
    plannedAt: '2026-02-22T04:10:00.000Z',
    ...overrides
  }
}

function buildPolicyConstraintsLite(overrides = {}) {
  return {
    constraintSetVersion: 'c_constraints_v1',
    categoryConstraints: {
      bcat: ['cat_blocked_a'],
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
      allowedSourceIds: ['source_primary_a', 'source_secondary_a'],
      blockedSourceIds: ['source_blocked_a']
    },
    ...overrides
  }
}

function buildCandidate(overrides = {}) {
  return {
    sourceId: 'source_primary_a',
    candidateId: 'cand_001',
    routeTier: 'primary',
    candidateStatus: 'eligible',
    pricing: {
      bidValue: 2.4,
      currency: 'USD'
    },
    creativeRef: {
      creativeId: 'creative_001',
      landingType: 'external'
    },
    ...overrides
  }
}

test('d-output: served path provides complete D->E contract without hidden context', () => {
  const builder = createDOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T04:20:00.000Z')
  })
  const result = builder.buildOutput({
    routePlanLite: buildRoutePlanLite(),
    policyConstraintsLite: buildPolicyConstraintsLite(),
    normalizedCandidates: [
      buildCandidate(),
      buildCandidate({
        sourceId: 'source_secondary_a',
        candidateId: 'cand_002',
        routeTier: 'secondary',
        pricing: {
          bidValue: 2.1,
          currency: 'USD'
        },
        creativeRef: {
          creativeId: 'creative_002',
          landingType: 'external'
        }
      })
    ],
    routeOutcome: 'served_candidate',
    finalReasonCode: 'd_route_short_circuit_served',
    routeSwitches: {
      switchEvents: [
        {
          fromSourceId: 'source_primary_a',
          toSourceId: 'source_secondary_a',
          switchReasonCode: 'no_fill',
          switchAt: '2026-02-22T04:19:59.000Z'
        }
      ]
    },
    routeAuditHints: {
      sourceFilterSnapshot: {
        sourceSelectionMode: 'all_except_blocked',
        inputAllowedSourceIds: ['source_primary_a', 'source_secondary_a'],
        inputBlockedSourceIds: ['source_blocked_a'],
        filteredOutSourceIds: ['source_blocked_a'],
        effectiveSourcePoolIds: ['source_primary_a', 'source_secondary_a', 'source_fallback_a']
      }
    },
    candidateNormalizeVersion: 'd_candidate_normalize_v2',
    errorNormalizeVersion: 'd_error_normalize_v2',
    adapterRegistryVersion: 'd_adapter_registry_v2',
    routePlanRuleVersion: 'd_route_plan_rule_v2'
  })

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, D_OUTPUT_REASON_CODES.OUTPUT_READY)

  const output = result.dToEOutputLite
  assertRequiredFields(output, [
    'opportunityKey',
    'traceKey',
    'requestKey',
    'attemptKey',
    'hasCandidate',
    'candidateCount',
    'normalizedCandidates',
    'auctionDecisionLite.served',
    'auctionDecisionLite.winner.sourceId',
    'auctionDecisionLite.winner.candidateId',
    'auctionDecisionLite.price.value',
    'auctionDecisionLite.price.currency',
    'auctionDecisionLite.creativeHandle.creativeId',
    'auctionDecisionLite.creativeHandle.landingType',
    'auctionDecisionLite.debugRef.routePlanId',
    'auctionDecisionLite.debugRef.routeAuditSnapshotRef',
    'auctionDecisionLite.debugRef.decisionVersionRefs.routingPolicyVersion',
    'auctionDecisionLite.debugRef.decisionVersionRefs.executionStrategyVersion',
    'auctionDecisionLite.debugRef.decisionVersionRefs.configSnapshotId',
    'policyConstraintsLite.constraintSetVersion',
    'policyConstraintsLite.categoryConstraints.bcat',
    'policyConstraintsLite.categoryConstraints.badv',
    'policyConstraintsLite.personalizationConstraints.nonPersonalizedOnly',
    'policyConstraintsLite.renderConstraints.disallowRenderModes',
    'policyConstraintsLite.sourceConstraints.sourceSelectionMode',
    'policyConstraintsLite.sourceConstraints.allowedSourceIds',
    'policyConstraintsLite.sourceConstraints.blockedSourceIds',
    'routeConclusion.routePlanId',
    'routeConclusion.configSnapshotId',
    'routeConclusion.strategyType',
    'routeConclusion.routeOutcome',
    'routeConclusion.finalRouteTier',
    'routeConclusion.finalAction',
    'routeConclusion.finalReasonCode',
    'routeConclusion.fallbackUsed',
    'routeAuditSnapshotLite.traceKeys.traceKey',
    'routeAuditSnapshotLite.traceKeys.requestKey',
    'routeAuditSnapshotLite.traceKeys.attemptKey',
    'routeAuditSnapshotLite.traceKeys.opportunityKey',
    'routeAuditSnapshotLite.routingHitSnapshot.routePlanId',
    'routeAuditSnapshotLite.routingHitSnapshot.strategyType',
    'routeAuditSnapshotLite.routingHitSnapshot.hitRouteTier',
    'routeAuditSnapshotLite.routingHitSnapshot.hitSourceId',
    'routeAuditSnapshotLite.sourceFilterSnapshot.sourceSelectionMode',
    'routeAuditSnapshotLite.sourceFilterSnapshot.effectiveSourcePoolIds',
    'routeAuditSnapshotLite.routeSwitches.switchCount',
    'routeAuditSnapshotLite.finalRouteDecision.finalRouteTier',
    'routeAuditSnapshotLite.finalRouteDecision.finalOutcome',
    'routeAuditSnapshotLite.finalRouteDecision.finalReasonCode',
    'routeAuditSnapshotLite.versionSnapshot.routingPolicyVersion',
    'routeAuditSnapshotLite.versionSnapshot.fallbackProfileVersion',
    'routeAuditSnapshotLite.versionSnapshot.executionStrategyVersion',
    'routeAuditSnapshotLite.versionSnapshot.configSnapshotId',
    'routeAuditSnapshotLite.snapshotMeta.routeAuditSchemaVersion',
    'stateUpdate.fromState',
    'stateUpdate.toState',
    'stateUpdate.statusReasonCode',
    'stateUpdate.updatedAt',
    'versionAnchors.dOutputContractVersion',
    'versionAnchors.routingPolicyVersion',
    'versionAnchors.fallbackProfileVersion',
    'versionAnchors.candidateNormalizeVersion',
    'versionAnchors.errorNormalizeVersion',
    'versionAnchors.constraintSetVersion',
    'versionAnchors.executionStrategyVersion',
    'versionAnchors.configSnapshotId'
  ])

  assert.equal(output.hasCandidate, true)
  assert.equal(output.candidateCount, 2)
  assert.equal(output.auctionDecisionLite.served, true)
  assert.equal(output.auctionDecisionLite.winner.sourceId, 'source_primary_a')
  assert.equal(output.auctionDecisionLite.winner.candidateId, 'cand_001')
  assert.equal(output.auctionDecisionLite.price.value, 2.4)
  assert.equal(output.auctionDecisionLite.price.currency, 'USD')
  assert.equal(output.auctionDecisionLite.creativeHandle.creativeId, 'creative_001')
  assert.equal(output.routeConclusion.routeOutcome, 'served_candidate')
  assert.equal(output.routeConclusion.finalAction, 'deliver')
  assert.equal(output.routeConclusion.finalRouteTier, 'primary')
  assert.equal(output.stateUpdate.toState, 'served')
  assert.equal(output.stateUpdate.statusReasonCode, output.routeConclusion.finalReasonCode)
  assert.equal(output.routeAuditSnapshotLite.finalRouteDecision.finalReasonCode, output.routeConclusion.finalReasonCode)
  assert.equal(output.routeAuditSnapshotLite.routeSwitches.switchCount, 1)
})

test('d-output: no_fill path uses fixed non-served auction decision contract', () => {
  const builder = createDOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T04:30:00.000Z')
  })
  const result = builder.buildOutput({
    routePlanLite: buildRoutePlanLite(),
    policyConstraintsLite: buildPolicyConstraintsLite(),
    normalizedCandidates: [],
    routeOutcome: 'no_fill',
    finalRouteTier: 'none',
    finalReasonCode: 'd_nf_no_fill'
  })

  assert.equal(result.ok, true)
  const output = result.dToEOutputLite
  assert.equal(output.hasCandidate, false)
  assert.equal(output.candidateCount, 0)
  assert.deepEqual(output.normalizedCandidates, [])
  assert.equal(output.auctionDecisionLite.served, false)
  assert.equal(output.auctionDecisionLite.winner.sourceId, 'none')
  assert.equal(output.auctionDecisionLite.winner.candidateId, 'none')
  assert.equal(output.auctionDecisionLite.price.value, 0)
  assert.equal(output.auctionDecisionLite.price.currency, 'NA')
  assert.equal(output.routeConclusion.routeOutcome, 'no_fill')
  assert.equal(output.routeConclusion.finalAction, 'no_fill')
  assert.equal(output.routeConclusion.finalRouteTier, 'none')
  assert.equal(output.stateUpdate.toState, 'no_fill')
})

test('d-output: error path maps to terminal_error and state error', () => {
  const builder = createDOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T04:40:00.000Z')
  })
  const result = builder.buildOutput({
    routePlanLite: buildRoutePlanLite(),
    policyConstraintsLite: buildPolicyConstraintsLite(),
    normalizedCandidates: [],
    routeOutcome: 'error',
    finalRouteTier: 'secondary',
    finalReasonCode: 'd_en_contract_invalid'
  })

  assert.equal(result.ok, true)
  const output = result.dToEOutputLite
  assert.equal(output.auctionDecisionLite.served, false)
  assert.equal(output.routeConclusion.routeOutcome, 'error')
  assert.equal(output.routeConclusion.finalAction, 'terminal_error')
  assert.equal(output.stateUpdate.toState, 'error')
  assert.equal(output.stateUpdate.statusReasonCode, 'd_en_contract_invalid')
})

test('d-output: route conclusion strategy mismatch is rejected', () => {
  const builder = createDOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T04:50:00.000Z')
  })
  const result = builder.buildOutput({
    routePlanLite: buildRoutePlanLite({
      executionStrategyLite: {
        strategyType: 'waterfall',
        parallelFanout: 1,
        strategyTimeoutMs: 1500,
        fallbackPolicy: 'on_no_fill_or_error',
        executionStrategyVersion: 'd_execution_strategy_v2'
      }
    }),
    policyConstraintsLite: buildPolicyConstraintsLite(),
    normalizedCandidates: [buildCandidate()],
    routeConclusion: {
      strategyType: 'hybrid'
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, D_OUTPUT_REASON_CODES.INVALID_ROUTE_CONCLUSION)
  assert.equal(result.dToEOutputLite, null)
})

test('d-output: invalid route switch reason code fails route audit build', () => {
  const builder = createDOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T05:00:00.000Z')
  })
  const result = builder.buildOutput({
    routePlanLite: buildRoutePlanLite(),
    policyConstraintsLite: buildPolicyConstraintsLite(),
    normalizedCandidates: [buildCandidate()],
    routeOutcome: 'served_candidate',
    finalReasonCode: 'd_route_short_circuit_served',
    routeSwitches: {
      switchEvents: [
        {
          fromSourceId: 'source_primary_a',
          toSourceId: 'source_secondary_a',
          switchReasonCode: 'manual_override',
          switchAt: '2026-02-22T04:59:59.000Z'
        }
      ]
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, D_OUTPUT_REASON_CODES.ROUTE_AUDIT_FAILED)
  assert.equal(result.details.routeAuditReasonCode, D_ROUTE_AUDIT_REASON_CODES.INVALID_SWITCH_REASON_CODE)
})

test('d-output: repeated build with same input is deterministic', () => {
  const builder = createDOutputBuilder({
    nowFn: () => Date.parse('2026-02-22T05:10:00.000Z')
  })
  const input = {
    routePlanLite: buildRoutePlanLite(),
    policyConstraintsLite: buildPolicyConstraintsLite(),
    normalizedCandidates: [buildCandidate()],
    routeOutcome: 'served_candidate',
    finalReasonCode: 'd_route_short_circuit_served'
  }

  const first = builder.buildOutput(input)
  const second = builder.buildOutput(input)

  assert.equal(first.ok, true)
  assert.deepEqual(second, first)
})
