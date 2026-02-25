import crypto from 'node:crypto'

const VALID_STRATEGY_TYPES = new Set(['waterfall', 'bidding', 'hybrid'])
const VALID_FALLBACK_POLICIES = new Set(['on_no_fill_only', 'on_no_fill_or_error', 'disabled'])
const VALID_ROUTE_TIERS = new Set(['primary', 'secondary', 'fallback'])
const VALID_SOURCE_SELECTION_MODES = new Set(['all_except_blocked', 'allowlist_only'])

export const D_ROUTE_PLAN_REASON_CODES = Object.freeze({
  ROUTE_PLAN_READY: 'd_route_plan_ready',
  INVALID_ROUTE_INPUT_STATE: 'd_invalid_route_input_state',
  INVALID_EXECUTION_STRATEGY_CONTRACT: 'd_invalid_execution_strategy_contract',
  ROUTE_NO_AVAILABLE_SOURCE: 'd_route_no_available_source',
  ROUTE_POLICY_BLOCK: 'd_route_policy_block',
  ROUTE_BUDGET_EXHAUSTED: 'd_route_budget_exhausted',
  SHORT_CIRCUIT_SERVED: 'd_route_short_circuit_served',
  SHORT_CIRCUIT_TERMINAL: 'd_route_short_circuit_terminal',
  SHORT_CIRCUIT_EXHAUSTED: 'd_route_short_circuit_exhausted'
})

export const D_SHORT_CIRCUIT_ACTIONS = Object.freeze({
  SERVED: 'short_circuit_served',
  TERMINAL: 'short_circuit_terminal',
  EXHAUSTED: 'short_circuit_exhausted'
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item)).filter(Boolean)
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  return fallback
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map((item) => stableClone(item))
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = stableClone(value[key])
        return acc
      }, {})
  }
  return value
}

function stableRoutePlanId(seedObject) {
  return `rp_${sha256(JSON.stringify(stableClone(seedObject))).slice(0, 20)}`
}

function normalizeExecutionStrategy(input = {}) {
  const strategyType = normalizeText(input.strategyType) || 'waterfall'
  const fallbackPolicy = normalizeText(input.fallbackPolicy) || 'on_no_fill_or_error'
  const parallelFanoutRaw = toFiniteNumber(input.parallelFanout, 1)
  const strategyTimeoutMs = Math.max(1, Math.floor(toFiniteNumber(input.strategyTimeoutMs, 3000)))
  const executionStrategyVersion = normalizeText(input.executionStrategyVersion) || 'd_execution_strategy_v1'
  return {
    strategyType,
    parallelFanout: strategyType === 'waterfall' ? 1 : Math.max(1, Math.floor(parallelFanoutRaw)),
    strategyTimeoutMs,
    fallbackPolicy,
    executionStrategyVersion,
    enableSecondaryBidding: input.enableSecondaryBidding === true
  }
}

function normalizeConstraints(constraints = {}) {
  const sourceConstraints = isPlainObject(constraints.sourceConstraints) ? constraints.sourceConstraints : {}
  const sourceSelectionMode = normalizeText(sourceConstraints.sourceSelectionMode) || 'all_except_blocked'
  return {
    sourceSelectionMode: VALID_SOURCE_SELECTION_MODES.has(sourceSelectionMode)
      ? sourceSelectionMode
      : 'all_except_blocked',
    allowedSourceIds: normalizeStringArray(sourceConstraints.allowedSourceIds),
    blockedSourceIds: normalizeStringArray(sourceConstraints.blockedSourceIds)
  }
}

function normalizeSource(source = {}) {
  const sourceId = normalizeText(source.sourceId)
  const status = normalizeText(source.status || 'active')
  const supportedPlacementTypes = normalizeStringArray(source.supportedPlacementTypes)
  const timeoutPolicyMs = Math.max(1, Math.floor(toFiniteNumber(source.timeoutPolicyMs, 3000)))
  const sourcePriorityScore = toFiniteNumber(source.sourcePriorityScore, 0)
  const historicalSuccessRate = toFiniteNumber(source.historicalSuccessRate, 0)
  const p95LatencyMs = toFiniteNumber(source.p95LatencyMs, Number.POSITIVE_INFINITY)
  const costWeight = toFiniteNumber(source.costWeight, Number.POSITIVE_INFINITY)
  const declaredTier = normalizeText(source.routeTier)
  let routeTier = VALID_ROUTE_TIERS.has(declaredTier) ? declaredTier : 'primary'
  const tags = normalizeStringArray(source.tags)
  if (!VALID_ROUTE_TIERS.has(declaredTier)) {
    if (tags.includes('tier_fallback')) routeTier = 'fallback'
    else if (tags.includes('tier_secondary')) routeTier = 'secondary'
  }

  return {
    sourceId,
    status,
    supportedPlacementTypes,
    timeoutPolicyMs,
    sourcePriorityScore,
    historicalSuccessRate,
    p95LatencyMs,
    costWeight,
    routeTier
  }
}

function sortTierWithTieBreak(sources = []) {
  return [...sources].sort((a, b) => {
    if (b.sourcePriorityScore !== a.sourcePriorityScore) return b.sourcePriorityScore - a.sourcePriorityScore
    if (b.historicalSuccessRate !== a.historicalSuccessRate) return b.historicalSuccessRate - a.historicalSuccessRate
    if (a.p95LatencyMs !== b.p95LatencyMs) return a.p95LatencyMs - b.p95LatencyMs
    if (a.costWeight !== b.costWeight) return a.costWeight - b.costWeight
    return a.sourceId.localeCompare(b.sourceId)
  })
}

function filterSourcesByConstraints(input = {}) {
  const placementType = normalizeText(input.placementType)
  const constraints = normalizeConstraints(input.constraintsLite)
  const normalizedSources = (Array.isArray(input.sources) ? input.sources : [])
    .map((item) => normalizeSource(item))
    .filter((item) => item.sourceId)

  const activeSources = normalizedSources.filter((item) => item.status === 'active')
  const placementCompatible = activeSources.filter((item) => {
    if (!placementType) return true
    return item.supportedPlacementTypes.includes(placementType)
  })

  const basePool = constraints.sourceSelectionMode === 'allowlist_only'
    ? placementCompatible.filter((item) => constraints.allowedSourceIds.includes(item.sourceId))
    : placementCompatible

  const filteredOutSourceIds = []
  for (const source of basePool) {
    if (constraints.blockedSourceIds.includes(source.sourceId)) {
      filteredOutSourceIds.push(source.sourceId)
    }
  }

  const effectivePool = basePool.filter((item) => !constraints.blockedSourceIds.includes(item.sourceId))
  return {
    sourceFilterSnapshot: {
      sourceSelectionMode: constraints.sourceSelectionMode,
      inputAllowedSourceIds: constraints.allowedSourceIds,
      inputBlockedSourceIds: constraints.blockedSourceIds,
      filteredOutSourceIds: [...new Set(filteredOutSourceIds)].sort((a, b) => a.localeCompare(b)),
      effectiveSourcePoolIds: effectivePool.map((item) => item.sourceId).sort((a, b) => a.localeCompare(b))
    },
    effectivePool
  }
}

function validateStrategy(strategy) {
  if (!VALID_STRATEGY_TYPES.has(strategy.strategyType)) return false
  if (!VALID_FALLBACK_POLICIES.has(strategy.fallbackPolicy)) return false
  if (strategy.strategyTimeoutMs <= 0) return false
  if ((strategy.strategyType === 'bidding' || strategy.strategyType === 'hybrid') && strategy.parallelFanout <= 0) {
    return false
  }
  return true
}

function shouldFallbackForOutcome(outcome, fallbackPolicy) {
  const normalizedOutcome = normalizeText(outcome)
  if (fallbackPolicy === 'disabled') return false
  if (fallbackPolicy === 'on_no_fill_only') {
    return normalizedOutcome === 'no_fill'
  }
  return normalizedOutcome === 'no_fill' || normalizedOutcome === 'error' || normalizedOutcome === 'timeout'
}

function allocateStepBudget(remainingBudgetMs, sourceTimeoutMs, strategyTimeoutMs) {
  if (remainingBudgetMs <= 0) return 0
  return Math.max(0, Math.min(remainingBudgetMs, sourceTimeoutMs, strategyTimeoutMs))
}

function makeStep(stepIndex, routeTier, source, entryCondition, timeoutBudgetMs, dispatchMode, maxRetryCount = 1) {
  return {
    stepIndex,
    routeTier,
    sourceId: source.sourceId,
    entryCondition,
    timeoutBudgetMs,
    maxRetryCount,
    dispatchMode,
    stepStatus: timeoutBudgetMs > 0 ? 'pending' : 'skipped'
  }
}

function partitionByTier(sources = []) {
  const primary = []
  const secondary = []
  const fallback = []

  for (const source of sources) {
    if (source.routeTier === 'secondary') secondary.push(source)
    else if (source.routeTier === 'fallback') fallback.push(source)
    else primary.push(source)
  }

  return {
    primary: sortTierWithTieBreak(primary),
    secondary: sortTierWithTieBreak(secondary),
    fallback: sortTierWithTieBreak(fallback)
  }
}

function shouldCreateFallbackSteps(strategyType, fallbackPolicy, fallbackPoolLength) {
  if (fallbackPoolLength <= 0) return false
  if (fallbackPolicy === 'disabled') return false
  if (strategyType === 'waterfall') return true
  if (strategyType === 'bidding') return true
  if (strategyType === 'hybrid') return true
  return false
}

export function createRoutePlanner(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const routePlanRuleVersion = normalizeText(options.routePlanRuleVersion) || 'd_route_plan_rule_v1'

  function buildRoutePlan(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const traceKey = normalizeText(request.traceKey)
    const requestKey = normalizeText(request.requestKey)
    const attemptKey = normalizeText(request.attemptKey)
    const opportunityKey = normalizeText(request.opportunityKey)
    const routingPolicyVersion = normalizeText(request.routingPolicyVersion) || 'd_routing_policy_v1'
    const fallbackProfileVersion = normalizeText(request.fallbackProfileVersion) || 'd_fallback_profile_v1'
    const placementType = normalizeText(request.placementType)
    const routeBudgetMs = Math.max(0, Math.floor(toFiniteNumber(request.routeBudgetMs, 5000)))
    const isRoutable = request.isRoutable === true
    const strategy = normalizeExecutionStrategy(request.executionStrategyLite)

    if (!isRoutable) {
      return {
        ok: false,
        reasonCode: D_ROUTE_PLAN_REASON_CODES.ROUTE_POLICY_BLOCK,
        routePlanLite: null
      }
    }
    if (!opportunityKey || !traceKey || !requestKey || !attemptKey) {
      return {
        ok: false,
        reasonCode: D_ROUTE_PLAN_REASON_CODES.INVALID_ROUTE_INPUT_STATE,
        routePlanLite: null
      }
    }
    if (!validateStrategy(strategy)) {
      return {
        ok: false,
        reasonCode: D_ROUTE_PLAN_REASON_CODES.INVALID_EXECUTION_STRATEGY_CONTRACT,
        routePlanLite: null
      }
    }

    const { sourceFilterSnapshot, effectivePool } = filterSourcesByConstraints({
      sources: request.sources,
      placementType,
      constraintsLite: request.constraintsLite
    })
    const tierPools = partitionByTier(effectivePool)

    const planSeed = {
      opportunityKey,
      traceKey,
      requestKey,
      attemptKey,
      routingPolicyVersion,
      fallbackProfileVersion,
      strategy,
      placementType,
      sourceIdsByTier: {
        primary: tierPools.primary.map((item) => item.sourceId),
        secondary: tierPools.secondary.map((item) => item.sourceId),
        fallback: tierPools.fallback.map((item) => item.sourceId)
      },
      constraints: sourceFilterSnapshot
    }
    const routePlanId = stableRoutePlanId(planSeed)
    const plannedAt = nowIso(nowFn)
    const configSnapshotLite = isPlainObject(request.configSnapshotLite)
      ? {
          configSnapshotId: normalizeText(request.configSnapshotLite.configSnapshotId) || 'NA',
          resolvedConfigRef: normalizeText(request.configSnapshotLite.resolvedConfigRef) || 'NA',
          configHash: normalizeText(request.configSnapshotLite.configHash) || 'NA',
          effectiveAt: normalizeText(request.configSnapshotLite.effectiveAt) || 'NA'
        }
      : {
          configSnapshotId: 'NA',
          resolvedConfigRef: 'NA',
          configHash: 'NA',
          effectiveAt: 'NA'
        }

    if (effectivePool.length === 0) {
      return {
        ok: true,
        reasonCode: D_ROUTE_PLAN_REASON_CODES.ROUTE_NO_AVAILABLE_SOURCE,
        routePlanLite: {
          routePlanId,
          opportunityKey,
          traceKey,
          requestKey,
          attemptKey,
          routingPolicyVersion,
          fallbackProfileVersion,
          configSnapshotLite,
          executionStrategyLite: {
            strategyType: strategy.strategyType,
            parallelFanout: strategy.parallelFanout,
            strategyTimeoutMs: strategy.strategyTimeoutMs,
            fallbackPolicy: strategy.fallbackPolicy,
            executionStrategyVersion: strategy.executionStrategyVersion
          },
          routeSteps: [],
          routePlanStatus: 'terminated',
          plannedAt
        },
        routeAuditHints: {
          sourceFilterSnapshot,
          tieBreakSnapshots: {
            primary: tierPools.primary,
            secondary: tierPools.secondary,
            fallback: tierPools.fallback
          },
          shortCircuitSnapshot: {
            routePlanId,
            triggerStepIndex: 0,
            shortCircuitAction: D_SHORT_CIRCUIT_ACTIONS.TERMINAL,
            shortCircuitReasonCode: D_ROUTE_PLAN_REASON_CODES.ROUTE_NO_AVAILABLE_SOURCE,
            budgetSnapshotBeforeAfter: {
              beforeBudgetMs: routeBudgetMs,
              afterBudgetMs: routeBudgetMs
            },
            ruleVersion: routePlanRuleVersion
          }
        }
      }
    }

    const routeSteps = []
    let stepIndex = 1
    let remainingBudgetMs = routeBudgetMs
    const addSequentialTier = (tierSources, routeTier, entryConditionBase) => {
      for (const source of tierSources) {
        const timeoutBudgetMs = allocateStepBudget(remainingBudgetMs, source.timeoutPolicyMs, strategy.strategyTimeoutMs)
        routeSteps.push(
          makeStep(
            stepIndex,
            routeTier,
            source,
            `${entryConditionBase}_${stepIndex}`,
            timeoutBudgetMs,
            'sequential',
            1
          )
        )
        stepIndex += 1
        remainingBudgetMs = Math.max(0, remainingBudgetMs - timeoutBudgetMs)
      }
    }

    const addParallelTier = (tierSources, routeTier, entryConditionBase, fanout) => {
      const batch = tierSources.slice(0, fanout)
      for (const source of batch) {
        const timeoutBudgetMs = allocateStepBudget(remainingBudgetMs, source.timeoutPolicyMs, strategy.strategyTimeoutMs)
        routeSteps.push(
          makeStep(
            stepIndex,
            routeTier,
            source,
            `${entryConditionBase}_${stepIndex}`,
            timeoutBudgetMs,
            'parallel_batch',
            1
          )
        )
        stepIndex += 1
        remainingBudgetMs = Math.max(0, remainingBudgetMs - timeoutBudgetMs)
      }
    }

    if (strategy.strategyType === 'waterfall') {
      addSequentialTier(tierPools.primary, 'primary', 'on_plan_start')
      addSequentialTier(tierPools.secondary, 'secondary', 'on_primary_no_fill_or_non_retryable_error')
      if (shouldCreateFallbackSteps(strategy.strategyType, strategy.fallbackPolicy, tierPools.fallback.length)) {
        addSequentialTier(tierPools.fallback, 'fallback', 'on_primary_secondary_exhausted')
      }
    } else if (strategy.strategyType === 'bidding') {
      addParallelTier(tierPools.primary, 'primary', 'on_plan_start_parallel_batch', strategy.parallelFanout)
      if (strategy.enableSecondaryBidding) {
        addParallelTier(tierPools.secondary, 'secondary', 'on_primary_batch_no_candidate', strategy.parallelFanout)
      }
      if (shouldCreateFallbackSteps(strategy.strategyType, strategy.fallbackPolicy, tierPools.fallback.length)) {
        addSequentialTier(tierPools.fallback, 'fallback', 'on_bidding_batch_no_candidate')
      }
    } else {
      addParallelTier(tierPools.primary, 'primary', 'on_plan_start_primary_bidding', strategy.parallelFanout)
      addSequentialTier(tierPools.secondary, 'secondary', 'on_primary_bidding_no_candidate')
      if (shouldCreateFallbackSteps(strategy.strategyType, strategy.fallbackPolicy, tierPools.fallback.length)) {
        addSequentialTier(tierPools.fallback, 'fallback', 'on_secondary_exhausted_or_strategy_fallback')
      }
    }

    const routePlanStatus = routeSteps.length === 0
      ? 'terminated'
      : (routeSteps.every((item) => item.stepStatus === 'skipped') ? 'terminated' : 'planned')
    const reasonCode = routeSteps.length === 0
      ? D_ROUTE_PLAN_REASON_CODES.ROUTE_NO_AVAILABLE_SOURCE
      : (routePlanStatus === 'terminated'
        ? D_ROUTE_PLAN_REASON_CODES.ROUTE_BUDGET_EXHAUSTED
        : D_ROUTE_PLAN_REASON_CODES.ROUTE_PLAN_READY)

    const routePlanLite = {
      routePlanId,
      opportunityKey,
      traceKey,
      requestKey,
      attemptKey,
      routingPolicyVersion,
      fallbackProfileVersion,
      configSnapshotLite,
      executionStrategyLite: {
        strategyType: strategy.strategyType,
        parallelFanout: strategy.parallelFanout,
        strategyTimeoutMs: strategy.strategyTimeoutMs,
        fallbackPolicy: strategy.fallbackPolicy,
        executionStrategyVersion: strategy.executionStrategyVersion
      },
      routeSteps,
      routePlanStatus,
      plannedAt
    }

    return {
      ok: true,
      reasonCode,
      routePlanLite,
      routeAuditHints: {
        sourceFilterSnapshot,
        tieBreakSnapshots: {
          primary: tierPools.primary.map((item) => ({
            sourceId: item.sourceId,
            sourcePriorityScore: item.sourcePriorityScore,
            historicalSuccessRate: item.historicalSuccessRate,
            p95LatencyMs: item.p95LatencyMs,
            costWeight: item.costWeight
          })),
          secondary: tierPools.secondary.map((item) => ({
            sourceId: item.sourceId,
            sourcePriorityScore: item.sourcePriorityScore,
            historicalSuccessRate: item.historicalSuccessRate,
            p95LatencyMs: item.p95LatencyMs,
            costWeight: item.costWeight
          })),
          fallback: tierPools.fallback.map((item) => ({
            sourceId: item.sourceId,
            sourcePriorityScore: item.sourcePriorityScore,
            historicalSuccessRate: item.historicalSuccessRate,
            p95LatencyMs: item.p95LatencyMs,
            costWeight: item.costWeight
          }))
        }
      }
    }
  }

  function resolveRouteTransition(input = {}) {
    const strategyType = normalizeText(input.strategyType)
    const fallbackPolicy = normalizeText(input.fallbackPolicy || 'on_no_fill_or_error')
    const currentTier = normalizeText(input.currentTier)
    const outcome = normalizeText(input.outcome)
    const retryClass = normalizeText(input.retryClass || 'non_retryable')
    const hasRemainingInCurrentTier = input.hasRemainingInCurrentTier === true
    const hasSecondaryPool = input.hasSecondaryPool === true
    const hasFallbackPool = input.hasFallbackPool === true
    const enableSecondaryBidding = input.enableSecondaryBidding === true

    if (outcome === 'served') {
      return {
        routeAction: D_SHORT_CIRCUIT_ACTIONS.SERVED,
        shortCircuitAction: D_SHORT_CIRCUIT_ACTIONS.SERVED,
        shortCircuitReasonCode: D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_SERVED,
        nextTier: 'none',
        switchReasonCode: 'served'
      }
    }

    if (outcome === 'policy_block' || outcome === 'budget_exhausted') {
      return {
        routeAction: D_SHORT_CIRCUIT_ACTIONS.TERMINAL,
        shortCircuitAction: D_SHORT_CIRCUIT_ACTIONS.TERMINAL,
        shortCircuitReasonCode: outcome === 'policy_block'
          ? D_ROUTE_PLAN_REASON_CODES.ROUTE_POLICY_BLOCK
          : D_ROUTE_PLAN_REASON_CODES.ROUTE_BUDGET_EXHAUSTED,
        nextTier: 'none',
        switchReasonCode: outcome
      }
    }

    if (hasRemainingInCurrentTier) {
      return {
        routeAction: 'continue_same_tier',
        shortCircuitAction: '',
        shortCircuitReasonCode: '',
        nextTier: currentTier,
        switchReasonCode: outcome || 'no_fill'
      }
    }

    const canFallback = shouldFallbackForOutcome(outcome, fallbackPolicy) && hasFallbackPool
    const canSecondaryAfterNoFillOrError = outcome === 'no_fill' ||
      outcome === 'timeout' ||
      (outcome === 'error' && retryClass === 'non_retryable')

    if (strategyType === 'waterfall') {
      if (currentTier === 'primary' && hasSecondaryPool && canSecondaryAfterNoFillOrError) {
        return {
          routeAction: 'switch_tier',
          shortCircuitAction: '',
          shortCircuitReasonCode: '',
          nextTier: 'secondary',
          switchReasonCode: outcome || 'no_fill'
        }
      }
      if ((currentTier === 'primary' || currentTier === 'secondary') && canFallback) {
        return {
          routeAction: 'switch_tier',
          shortCircuitAction: '',
          shortCircuitReasonCode: '',
          nextTier: 'fallback',
          switchReasonCode: 'strategy_fallback'
        }
      }
    } else if (strategyType === 'bidding') {
      if (currentTier === 'primary' && enableSecondaryBidding && hasSecondaryPool) {
        return {
          routeAction: 'switch_tier',
          shortCircuitAction: '',
          shortCircuitReasonCode: '',
          nextTier: 'secondary',
          switchReasonCode: 'strategy_fallback'
        }
      }
      if ((currentTier === 'primary' || currentTier === 'secondary') && canFallback) {
        return {
          routeAction: 'switch_tier',
          shortCircuitAction: '',
          shortCircuitReasonCode: '',
          nextTier: 'fallback',
          switchReasonCode: 'strategy_fallback'
        }
      }
    } else if (strategyType === 'hybrid') {
      if (currentTier === 'primary' && hasSecondaryPool) {
        return {
          routeAction: 'switch_tier',
          shortCircuitAction: '',
          shortCircuitReasonCode: '',
          nextTier: 'secondary',
          switchReasonCode: 'strategy_fallback'
        }
      }
      if ((currentTier === 'primary' || currentTier === 'secondary') && canFallback) {
        return {
          routeAction: 'switch_tier',
          shortCircuitAction: '',
          shortCircuitReasonCode: '',
          nextTier: 'fallback',
          switchReasonCode: 'strategy_fallback'
        }
      }
    }

    return {
      routeAction: D_SHORT_CIRCUIT_ACTIONS.EXHAUSTED,
      shortCircuitAction: D_SHORT_CIRCUIT_ACTIONS.EXHAUSTED,
      shortCircuitReasonCode: D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_EXHAUSTED,
      nextTier: 'none',
      switchReasonCode: outcome || 'no_fill'
    }
  }

  function resolveShortCircuit(input = {}) {
    const routePlanId = normalizeText(input.routePlanId) || 'NA'
    const triggerStepIndex = Math.max(0, Math.floor(toFiniteNumber(input.triggerStepIndex, 0)))
    const beforeBudgetMs = Math.max(0, Math.floor(toFiniteNumber(input.beforeBudgetMs, 0)))
    const afterBudgetMs = Math.max(0, Math.floor(toFiniteNumber(input.afterBudgetMs, 0)))
    const served = input.served === true
    const terminal = input.terminal === true
    const exhausted = input.exhausted === true
    const terminalReasonCode = normalizeText(input.terminalReasonCode) || D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_TERMINAL

    if (served) {
      return {
        routePlanId,
        triggerStepIndex,
        shortCircuitAction: D_SHORT_CIRCUIT_ACTIONS.SERVED,
        shortCircuitReasonCode: D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_SERVED,
        budgetSnapshotBeforeAfter: {
          beforeBudgetMs,
          afterBudgetMs
        },
        ruleVersion: routePlanRuleVersion
      }
    }

    if (terminal) {
      return {
        routePlanId,
        triggerStepIndex,
        shortCircuitAction: D_SHORT_CIRCUIT_ACTIONS.TERMINAL,
        shortCircuitReasonCode: terminalReasonCode,
        budgetSnapshotBeforeAfter: {
          beforeBudgetMs,
          afterBudgetMs
        },
        ruleVersion: routePlanRuleVersion
      }
    }

    if (exhausted) {
      return {
        routePlanId,
        triggerStepIndex,
        shortCircuitAction: D_SHORT_CIRCUIT_ACTIONS.EXHAUSTED,
        shortCircuitReasonCode: D_ROUTE_PLAN_REASON_CODES.SHORT_CIRCUIT_EXHAUSTED,
        budgetSnapshotBeforeAfter: {
          beforeBudgetMs,
          afterBudgetMs
        },
        ruleVersion: routePlanRuleVersion
      }
    }

    return {
      routePlanId,
      triggerStepIndex,
      shortCircuitAction: '',
      shortCircuitReasonCode: '',
      budgetSnapshotBeforeAfter: {
        beforeBudgetMs,
        afterBudgetMs
      },
      ruleVersion: routePlanRuleVersion
    }
  }

  return {
    buildRoutePlan,
    resolveRouteTransition,
    resolveShortCircuit
  }
}
