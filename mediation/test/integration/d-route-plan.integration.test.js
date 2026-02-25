import assert from 'node:assert/strict'
import test from 'node:test'

import {
  D_ROUTE_PLAN_REASON_CODES,
  D_SHORT_CIRCUIT_ACTIONS,
  createRoutePlanner
} from '../../src/mediation/supply-routing/route-planner.js'

function buildSource(overrides = {}) {
  return {
    sourceId: 'source_default',
    status: 'active',
    supportedPlacementTypes: ['chat_inline'],
    timeoutPolicyMs: 1200,
    sourcePriorityScore: 10,
    historicalSuccessRate: 0.5,
    p95LatencyMs: 200,
    costWeight: 5,
    routeTier: 'primary',
    ...overrides
  }
}

function buildRouteInput(overrides = {}) {
  return {
    opportunityKey: 'opp_d_route_001',
    traceKey: 'trace_d_route_001',
    requestKey: 'req_d_route_001',
    attemptKey: 'att_d_route_001',
    placementType: 'chat_inline',
    routeBudgetMs: 4500,
    isRoutable: true,
    routingPolicyVersion: 'd_routing_policy_v2',
    fallbackProfileVersion: 'd_fallback_profile_v2',
    configSnapshotLite: {
      configSnapshotId: 'cfg_snap_d_002',
      resolvedConfigRef: 'resolve_d_002',
      configHash: 'hash_d_002',
      effectiveAt: '2026-02-22T03:00:00.000Z'
    },
    executionStrategyLite: {
      strategyType: 'waterfall',
      parallelFanout: 3,
      strategyTimeoutMs: 1300,
      fallbackPolicy: 'on_no_fill_or_error',
      executionStrategyVersion: 'd_execution_strategy_v2'
    },
    constraintsLite: {
      sourceConstraints: {
        sourceSelectionMode: 'all_except_blocked',
        allowedSourceIds: [],
        blockedSourceIds: []
      }
    },
    sources: [
      buildSource({
        sourceId: 'source_primary_2',
        sourcePriorityScore: 80,
        historicalSuccessRate: 0.92,
        p95LatencyMs: 90,
        costWeight: 3,
        routeTier: 'primary'
      }),
      buildSource({
        sourceId: 'source_primary_1',
        sourcePriorityScore: 80,
        historicalSuccessRate: 0.92,
        p95LatencyMs: 90,
        costWeight: 2,
        routeTier: 'primary'
      }),
      buildSource({
        sourceId: 'source_secondary_1',
        sourcePriorityScore: 60,
        routeTier: 'secondary'
      }),
      buildSource({
        sourceId: 'source_fallback_1',
        sourcePriorityScore: 40,
        routeTier: 'fallback'
      }),
      buildSource({
        sourceId: 'source_blocked',
        sourcePriorityScore: 100,
        routeTier: 'primary'
      })
    ],
    ...overrides
  }
}

test('d-route-plan: waterfall route plan is deterministic and follows tier order', () => {
  const planner = createRoutePlanner({
    nowFn: () => Date.parse('2026-02-22T03:10:00.000Z')
  })
  const input = buildRouteInput({
    constraintsLite: {
      sourceConstraints: {
        sourceSelectionMode: 'all_except_blocked',
        allowedSourceIds: [],
        blockedSourceIds: ['source_blocked']
      }
    }
  })

  const first = planner.buildRoutePlan(input)
  const second = planner.buildRoutePlan(input)

  assert.deepEqual(second, first)
  assert.equal(first.ok, true)
  assert.equal(first.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_PLAN_READY)
  assert.equal(first.routePlanLite.routePlanStatus, 'planned')
  assert.deepEqual(
    first.routePlanLite.routeSteps.map((item) => item.sourceId),
    ['source_primary_1', 'source_primary_2', 'source_secondary_1', 'source_fallback_1']
  )
  assert.deepEqual(
    first.routePlanLite.routeSteps.map((item) => item.routeTier),
    ['primary', 'primary', 'secondary', 'fallback']
  )
  assert.equal(first.routePlanLite.executionStrategyLite.strategyType, 'waterfall')
  assert.equal(first.routePlanLite.executionStrategyLite.parallelFanout, 1)
  assert.equal(first.routePlanLite.routeSteps.every((item) => item.dispatchMode === 'sequential'), true)
  assert.deepEqual(first.routeAuditHints.sourceFilterSnapshot.filteredOutSourceIds, ['source_blocked'])
})

test('d-route-plan: allowlist plus blocked precedence produces terminal no-available-source', () => {
  const planner = createRoutePlanner({
    nowFn: () => Date.parse('2026-02-22T03:11:00.000Z')
  })

  const result = planner.buildRoutePlan(
    buildRouteInput({
      constraintsLite: {
        sourceConstraints: {
          sourceSelectionMode: 'allowlist_only',
          allowedSourceIds: ['source_primary_1', 'source_primary_2'],
          blockedSourceIds: ['source_primary_1', 'source_primary_2']
        }
      }
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_NO_AVAILABLE_SOURCE)
  assert.equal(result.routePlanLite.routePlanStatus, 'terminated')
  assert.deepEqual(result.routePlanLite.routeSteps, [])
  assert.deepEqual(result.routeAuditHints.sourceFilterSnapshot.effectiveSourcePoolIds, [])
  assert.deepEqual(
    result.routeAuditHints.sourceFilterSnapshot.filteredOutSourceIds,
    ['source_primary_1', 'source_primary_2']
  )
})

test('d-route-plan: bidding uses parallel fanout and disabled fallback stops extra tiers', () => {
  const planner = createRoutePlanner({
    nowFn: () => Date.parse('2026-02-22T03:12:00.000Z')
  })

  const result = planner.buildRoutePlan(
    buildRouteInput({
      executionStrategyLite: {
        strategyType: 'bidding',
        parallelFanout: 2,
        strategyTimeoutMs: 1500,
        fallbackPolicy: 'disabled',
        executionStrategyVersion: 'd_execution_strategy_v2'
      }
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_PLAN_READY)
  assert.equal(result.routePlanLite.executionStrategyLite.strategyType, 'bidding')
  assert.equal(result.routePlanLite.routeSteps.length, 2)
  assert.equal(result.routePlanLite.routeSteps.every((item) => item.routeTier === 'primary'), true)
  assert.equal(result.routePlanLite.routeSteps.every((item) => item.dispatchMode === 'parallel_batch'), true)
})

test('d-route-plan: hybrid emits primary parallel then sequential secondary and fallback', () => {
  const planner = createRoutePlanner({
    nowFn: () => Date.parse('2026-02-22T03:13:00.000Z')
  })
  const result = planner.buildRoutePlan(
    buildRouteInput({
      executionStrategyLite: {
        strategyType: 'hybrid',
        parallelFanout: 2,
        strategyTimeoutMs: 1500,
        fallbackPolicy: 'on_no_fill_or_error',
        executionStrategyVersion: 'd_execution_strategy_v2'
      }
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.routePlanLite.executionStrategyLite.strategyType, 'hybrid')
  assert.deepEqual(
    result.routePlanLite.routeSteps.map((item) => `${item.routeTier}:${item.dispatchMode}`),
    [
      'primary:parallel_batch',
      'primary:parallel_batch',
      'secondary:sequential',
      'fallback:sequential'
    ]
  )
})

test('d-route-plan: invalid input and invalid strategy are rejected deterministically', () => {
  const planner = createRoutePlanner()

  const policyBlocked = planner.buildRoutePlan(
    buildRouteInput({
      isRoutable: false
    })
  )
  assert.equal(policyBlocked.ok, false)
  assert.equal(policyBlocked.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_POLICY_BLOCK)

  const missingKeys = planner.buildRoutePlan(
    buildRouteInput({
      requestKey: '',
      attemptKey: ''
    })
  )
  assert.equal(missingKeys.ok, false)
  assert.equal(missingKeys.reasonCode, D_ROUTE_PLAN_REASON_CODES.INVALID_ROUTE_INPUT_STATE)

  const invalidStrategy = planner.buildRoutePlan(
    buildRouteInput({
      executionStrategyLite: {
        strategyType: 'weighted_random',
        parallelFanout: 2,
        strategyTimeoutMs: 1500,
        fallbackPolicy: 'on_no_fill_or_error',
        executionStrategyVersion: 'd_execution_strategy_v2'
      }
    })
  )
  assert.equal(invalidStrategy.ok, false)
  assert.equal(invalidStrategy.reasonCode, D_ROUTE_PLAN_REASON_CODES.INVALID_EXECUTION_STRATEGY_CONTRACT)
})

test('d-route-plan: route transition handles continue, switch, and short-circuit priorities', () => {
  const planner = createRoutePlanner()

  const continueSameTier = planner.resolveRouteTransition({
    strategyType: 'waterfall',
    currentTier: 'primary',
    outcome: 'no_fill',
    hasRemainingInCurrentTier: true
  })
  assert.equal(continueSameTier.routeAction, 'continue_same_tier')
  assert.equal(continueSameTier.nextTier, 'primary')

  const waterfallToSecondary = planner.resolveRouteTransition({
    strategyType: 'waterfall',
    fallbackPolicy: 'on_no_fill_only',
    currentTier: 'primary',
    outcome: 'no_fill',
    retryClass: 'non_retryable',
    hasRemainingInCurrentTier: false,
    hasSecondaryPool: true,
    hasFallbackPool: true
  })
  assert.equal(waterfallToSecondary.routeAction, 'switch_tier')
  assert.equal(waterfallToSecondary.nextTier, 'secondary')

  const biddingToFallback = planner.resolveRouteTransition({
    strategyType: 'bidding',
    fallbackPolicy: 'on_no_fill_or_error',
    currentTier: 'primary',
    outcome: 'timeout',
    hasRemainingInCurrentTier: false,
    hasSecondaryPool: false,
    hasFallbackPool: true,
    enableSecondaryBidding: false
  })
  assert.equal(biddingToFallback.routeAction, 'switch_tier')
  assert.equal(biddingToFallback.nextTier, 'fallback')
  assert.equal(biddingToFallback.switchReasonCode, 'strategy_fallback')

  const served = planner.resolveRouteTransition({
    strategyType: 'hybrid',
    currentTier: 'primary',
    outcome: 'served'
  })
  assert.equal(served.routeAction, D_SHORT_CIRCUIT_ACTIONS.SERVED)
  assert.equal(served.shortCircuitReasonCode, D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_SERVED)

  const terminal = planner.resolveRouteTransition({
    strategyType: 'hybrid',
    currentTier: 'secondary',
    outcome: 'policy_block'
  })
  assert.equal(terminal.routeAction, D_SHORT_CIRCUIT_ACTIONS.TERMINAL)
  assert.equal(terminal.shortCircuitReasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_POLICY_BLOCK)

  const exhausted = planner.resolveRouteTransition({
    strategyType: 'waterfall',
    fallbackPolicy: 'disabled',
    currentTier: 'fallback',
    outcome: 'no_fill',
    hasRemainingInCurrentTier: false,
    hasSecondaryPool: false,
    hasFallbackPool: false
  })
  assert.equal(exhausted.routeAction, D_SHORT_CIRCUIT_ACTIONS.EXHAUSTED)
  assert.equal(exhausted.shortCircuitReasonCode, D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_EXHAUSTED)
})

test('d-route-plan: short-circuit snapshot includes action, reason and version', () => {
  const planner = createRoutePlanner({
    routePlanRuleVersion: 'd_route_plan_rule_v2'
  })

  const served = planner.resolveShortCircuit({
    routePlanId: 'rp_d_001',
    triggerStepIndex: 2,
    beforeBudgetMs: 3000,
    afterBudgetMs: 1800,
    served: true
  })
  assert.equal(served.shortCircuitAction, D_SHORT_CIRCUIT_ACTIONS.SERVED)
  assert.equal(served.shortCircuitReasonCode, D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_SERVED)
  assert.equal(served.ruleVersion, 'd_route_plan_rule_v2')

  const terminal = planner.resolveShortCircuit({
    routePlanId: 'rp_d_001',
    triggerStepIndex: 3,
    beforeBudgetMs: 1800,
    afterBudgetMs: 0,
    terminal: true,
    terminalReasonCode: D_ROUTE_PLAN_REASON_CODES.ROUTE_BUDGET_EXHAUSTED
  })
  assert.equal(terminal.shortCircuitAction, D_SHORT_CIRCUIT_ACTIONS.TERMINAL)
  assert.equal(terminal.shortCircuitReasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_BUDGET_EXHAUSTED)
})
