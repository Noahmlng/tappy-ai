import {
  D_ROUTE_AUDIT_REASON_CODES,
  createRouteAuditBuilder
} from './route-audit.js'

const ROUTE_OUTCOMES = new Set(['served_candidate', 'no_fill', 'error'])
const FINAL_ROUTE_TIERS = new Set(['primary', 'secondary', 'fallback', 'none'])
const HIT_ROUTE_TIERS = new Set(['primary', 'secondary', 'fallback'])
const SOURCE_SELECTION_MODES = new Set(['all_except_blocked', 'allowlist_only'])

export const D_OUTPUT_REASON_CODES = Object.freeze({
  OUTPUT_READY: 'd_output_ready',
  MISSING_REQUIRED_FIELD: 'd_output_missing_required_field',
  INVALID_CANDIDATE_PRESENCE: 'd_output_invalid_candidate_presence',
  INVALID_ROUTE_CONCLUSION: 'd_output_invalid_route_conclusion',
  INVALID_AUCTION_DECISION: 'd_output_invalid_auction_decision',
  INVALID_STATE_UPDATE: 'd_output_invalid_state_update',
  INVALID_VERSION_ANCHOR: 'd_output_invalid_version_anchor',
  ROUTE_AUDIT_FAILED: 'd_output_route_audit_failed',
  WINNING_CANDIDATE_REF_MISMATCH: 'd_output_winning_candidate_ref_mismatch'
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  return fallback
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item)).filter(Boolean)
}

function uniquePreserveOrder(values = []) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const normalized = normalizeText(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function normalizeCandidate(rawCandidate = {}) {
  const source = isPlainObject(rawCandidate) ? rawCandidate : {}
  const sourceId = normalizeText(source.sourceId)
  const candidateId = normalizeText(source.candidateId || source.sourceCandidateId)
  const routeTierRaw = normalizeText(source.routeTier)
  const routeTier = FINAL_ROUTE_TIERS.has(routeTierRaw) && routeTierRaw !== 'none'
    ? routeTierRaw
    : 'primary'

  const pricingSource = isPlainObject(source.pricing) ? source.pricing : {}
  const bidValue = toFiniteNumber(
    pricingSource.value ?? pricingSource.bidValue ?? source.bidValue,
    0
  )
  const currency = normalizeText(pricingSource.currency || source.currency) || 'NA'
  const creativeSource = isPlainObject(source.creativeRef) ? source.creativeRef : {}

  return {
    sourceId,
    candidateId,
    sourceCandidateId: candidateId || 'none',
    routeTier,
    candidateStatus: normalizeText(source.candidateStatus) || 'eligible',
    pricing: {
      value: bidValue,
      bidValue,
      currency
    },
    creativeRef: {
      creativeId: normalizeText(creativeSource.creativeId || source.creativeId) || 'none',
      landingType: normalizeText(creativeSource.landingType || source.landingType) || 'none'
    }
  }
}

function normalizePolicyConstraints(source = {}) {
  const constraints = isPlainObject(source) ? source : {}
  const category = isPlainObject(constraints.categoryConstraints) ? constraints.categoryConstraints : {}
  const personalization = isPlainObject(constraints.personalizationConstraints)
    ? constraints.personalizationConstraints
    : {}
  const render = isPlainObject(constraints.renderConstraints) ? constraints.renderConstraints : {}
  const sourceConstraints = isPlainObject(constraints.sourceConstraints) ? constraints.sourceConstraints : {}

  let sourceSelectionMode = normalizeText(sourceConstraints.sourceSelectionMode) || 'all_except_blocked'
  if (!SOURCE_SELECTION_MODES.has(sourceSelectionMode)) sourceSelectionMode = 'all_except_blocked'

  const blockedSourceIds = uniquePreserveOrder(sourceConstraints.blockedSourceIds)
  const allowedSourceIds = uniquePreserveOrder(sourceConstraints.allowedSourceIds)
    .filter((item) => !blockedSourceIds.includes(item))

  return {
    constraintSetVersion: normalizeText(constraints.constraintSetVersion) || 'c_constraints_v1',
    categoryConstraints: {
      bcat: uniquePreserveOrder(category.bcat),
      badv: uniquePreserveOrder(category.badv)
    },
    personalizationConstraints: {
      nonPersonalizedOnly: personalization.nonPersonalizedOnly === true
    },
    renderConstraints: {
      disallowRenderModes: uniquePreserveOrder(render.disallowRenderModes)
    },
    sourceConstraints: {
      sourceSelectionMode,
      allowedSourceIds,
      blockedSourceIds
    }
  }
}

function routeOutcomeToAction(routeOutcome) {
  if (routeOutcome === 'served_candidate') return 'deliver'
  if (routeOutcome === 'error') return 'terminal_error'
  return 'no_fill'
}

function routeOutcomeToState(routeOutcome) {
  if (routeOutcome === 'served_candidate') return 'served'
  if (routeOutcome === 'error') return 'error'
  return 'no_fill'
}

function routeOutcomeDefaultReasonCode(routeOutcome) {
  if (routeOutcome === 'served_candidate') return 'd_route_short_circuit_served'
  if (routeOutcome === 'error') return 'd_en_unknown'
  return 'd_nf_no_fill'
}

function buildFailure(reasonCode, details) {
  return {
    ok: false,
    reasonCode,
    dToEOutputLite: null,
    details: details || null
  }
}

function findWinnerCandidate(candidates = [], winnerRef = {}) {
  const sourceId = normalizeText(winnerRef.sourceId)
  const candidateId = normalizeText(winnerRef.candidateId || winnerRef.sourceCandidateId)
  if (!sourceId || !candidateId) return null

  return candidates.find((item) => (
    normalizeText(item.sourceId) === sourceId &&
    normalizeText(item.candidateId || item.sourceCandidateId) === candidateId
  )) || null
}

function resolveRouteOutcome(request = {}, hasCandidate = false) {
  const explicit = normalizeText(
    request?.routeConclusion?.routeOutcome ||
    request.routeOutcome
  )
  if (explicit) return explicit
  return hasCandidate ? 'served_candidate' : 'no_fill'
}

function resolveFinalRouteTier(request = {}, winnerCandidate = null, routeOutcome = 'no_fill') {
  const explicit = normalizeText(
    request?.routeConclusion?.finalRouteTier ||
    request.finalRouteTier
  )
  if (explicit) return explicit
  if (routeOutcome === 'served_candidate') {
    return normalizeText(winnerCandidate?.routeTier) || 'primary'
  }
  return 'none'
}

function resolveFinalReasonCode(request = {}, routeOutcome = 'no_fill') {
  const explicit = normalizeText(
    request?.routeConclusion?.finalReasonCode ||
    request.finalReasonCode
  )
  if (explicit) return explicit
  return routeOutcomeDefaultReasonCode(routeOutcome)
}

function normalizeProvidedWinnerRef(request = {}) {
  const winnerRef = isPlainObject(request.winningCandidateRef) ? request.winningCandidateRef : {}
  return {
    sourceId: normalizeText(winnerRef.sourceId),
    candidateId: normalizeText(winnerRef.candidateId || winnerRef.sourceCandidateId)
  }
}

function validateRouteConclusionAgainstPlan(routeConclusion = {}, routePlanLite = {}) {
  const routePlanStrategyType = normalizeText(routePlanLite?.executionStrategyLite?.strategyType)
  const routePlanConfigSnapshotId = normalizeText(routePlanLite?.configSnapshotLite?.configSnapshotId)
  const strategyType = normalizeText(routeConclusion.strategyType)
  const configSnapshotId = normalizeText(routeConclusion.configSnapshotId)

  if (strategyType && routePlanStrategyType && strategyType !== routePlanStrategyType) {
    return {
      ok: false,
      reasonCode: D_OUTPUT_REASON_CODES.INVALID_ROUTE_CONCLUSION
    }
  }
  if (configSnapshotId && routePlanConfigSnapshotId && configSnapshotId !== routePlanConfigSnapshotId) {
    return {
      ok: false,
      reasonCode: D_OUTPUT_REASON_CODES.INVALID_ROUTE_CONCLUSION
    }
  }

  return { ok: true, reasonCode: D_OUTPUT_REASON_CODES.OUTPUT_READY }
}

function buildDecisionVersionRefs(routePlanLite = {}) {
  return {
    routingPolicyVersion: normalizeText(routePlanLite.routingPolicyVersion) || 'd_routing_policy_v1',
    executionStrategyVersion: normalizeText(routePlanLite?.executionStrategyLite?.executionStrategyVersion) || 'd_execution_strategy_v1',
    configSnapshotId: normalizeText(routePlanLite?.configSnapshotLite?.configSnapshotId) || 'NA'
  }
}

function validateVersionAnchors(anchors = {}) {
  const required = [
    'dOutputContractVersion',
    'routingPolicyVersion',
    'fallbackProfileVersion',
    'candidateNormalizeVersion',
    'errorNormalizeVersion',
    'constraintSetVersion',
    'executionStrategyVersion',
    'configSnapshotId'
  ]
  const missing = required.filter((field) => !normalizeText(anchors[field]))
  return {
    ok: missing.length === 0,
    missing
  }
}

function validateStateUpdate(routeOutcome, stateUpdate, finalReasonCode) {
  const expectedToState = routeOutcomeToState(routeOutcome)
  if (normalizeText(stateUpdate.fromState) !== 'routed') {
    return false
  }
  if (normalizeText(stateUpdate.toState) !== expectedToState) {
    return false
  }
  if (normalizeText(stateUpdate.statusReasonCode) !== normalizeText(finalReasonCode)) {
    return false
  }
  return true
}

export function createDOutputBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const dOutputContractVersion = normalizeText(options.dOutputContractVersion) || 'd_output_contract_v1'
  const routeAuditBuilder = options.routeAuditBuilder || createRouteAuditBuilder({
    nowFn,
    routeAuditSchemaVersion: normalizeText(options.routeAuditSchemaVersion) || 'd_route_audit_schema_v1',
    adapterRegistryVersion: normalizeText(options.adapterRegistryVersion) || 'd_adapter_registry_v1',
    routePlanRuleVersion: normalizeText(options.routePlanRuleVersion) || 'd_route_plan_rule_v1'
  })

  function buildOutput(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const routePlanLite = isPlainObject(request.routePlanLite) ? request.routePlanLite : {}
    const routeConclusionInput = isPlainObject(request.routeConclusion) ? request.routeConclusion : {}
    const routePlanId = normalizeText(routePlanLite.routePlanId)
    const traceKey = normalizeText(request.traceKey || routePlanLite.traceKey)
    const requestKey = normalizeText(request.requestKey || routePlanLite.requestKey)
    const attemptKey = normalizeText(request.attemptKey || routePlanLite.attemptKey)
    const opportunityKey = normalizeText(request.opportunityKey || routePlanLite.opportunityKey)

    if (!routePlanId || !traceKey || !requestKey || !attemptKey || !opportunityKey) {
      return buildFailure(D_OUTPUT_REASON_CODES.MISSING_REQUIRED_FIELD)
    }

    const routeConclusionPlanCheck = validateRouteConclusionAgainstPlan(routeConclusionInput, routePlanLite)
    if (!routeConclusionPlanCheck.ok) {
      return buildFailure(routeConclusionPlanCheck.reasonCode)
    }

    const normalizedCandidates = Array.isArray(request.normalizedCandidates)
      ? request.normalizedCandidates.map((item) => normalizeCandidate(item))
      : []
    const hasCandidate = normalizedCandidates.length > 0
    const candidateCount = normalizedCandidates.length
    const providedHasCandidate = request.hasCandidate
    const providedCandidateCount = request.candidateCount

    if (typeof providedHasCandidate === 'boolean' && providedHasCandidate !== hasCandidate) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_CANDIDATE_PRESENCE)
    }
    if (providedCandidateCount !== undefined && Number(providedCandidateCount) !== candidateCount) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_CANDIDATE_PRESENCE)
    }

    const routeOutcome = resolveRouteOutcome(request, hasCandidate)
    if (!ROUTE_OUTCOMES.has(routeOutcome)) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_ROUTE_CONCLUSION)
    }

    let winnerCandidate = null
    if (routeOutcome === 'served_candidate') {
      const auctionInput = isPlainObject(request.auctionDecisionLite) ? request.auctionDecisionLite : {}
      const auctionWinner = isPlainObject(auctionInput.winner) ? auctionInput.winner : {}
      const providedWinner = {
        sourceId: normalizeText(
          auctionWinner.sourceId ||
          request?.winningCandidateRef?.sourceId
        ),
        candidateId: normalizeText(
          auctionWinner.candidateId ||
          auctionWinner.sourceCandidateId ||
          request?.winningCandidateRef?.candidateId ||
          request?.winningCandidateRef?.sourceCandidateId
        )
      }
      winnerCandidate = findWinnerCandidate(normalizedCandidates, providedWinner) || normalizedCandidates[0] || null
      if (!winnerCandidate) {
        return buildFailure(D_OUTPUT_REASON_CODES.INVALID_AUCTION_DECISION)
      }
    }

    const finalRouteTier = resolveFinalRouteTier(request, winnerCandidate, routeOutcome)
    if (!FINAL_ROUTE_TIERS.has(finalRouteTier)) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_ROUTE_CONCLUSION)
    }
    if (routeOutcome === 'served_candidate' && finalRouteTier === 'none') {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_ROUTE_CONCLUSION)
    }

    const finalAction = routeOutcomeToAction(routeOutcome)
    const finalReasonCode = resolveFinalReasonCode(request, routeOutcome)
    if (!finalReasonCode) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_ROUTE_CONCLUSION)
    }

    const strategyType = normalizeText(
      routeConclusionInput.strategyType ||
      routePlanLite?.executionStrategyLite?.strategyType
    )
    const configSnapshotId = normalizeText(
      routeConclusionInput.configSnapshotId ||
      routePlanLite?.configSnapshotLite?.configSnapshotId
    )
    if (!strategyType || !configSnapshotId) {
      return buildFailure(D_OUTPUT_REASON_CODES.MISSING_REQUIRED_FIELD)
    }

    const routeConclusion = {
      routePlanId,
      configSnapshotId,
      strategyType,
      routeOutcome,
      finalRouteTier,
      finalAction,
      finalReasonCode,
      fallbackUsed: routeConclusionInput.fallbackUsed === true || request.fallbackUsed === true || finalRouteTier === 'fallback'
    }

    const decisionVersionRefs = buildDecisionVersionRefs(routePlanLite)
    const routeAuditSnapshotRef = `${traceKey}:${attemptKey}`
    let auctionDecisionLite

    if (routeOutcome === 'served_candidate') {
      const priceValue = toFiniteNumber(winnerCandidate.pricing?.value ?? winnerCandidate.pricing?.bidValue, 0)
      const priceCurrency = normalizeText(winnerCandidate.pricing?.currency) || 'NA'
      const creativeId = normalizeText(winnerCandidate.creativeRef?.creativeId) || 'none'
      const landingType = normalizeText(winnerCandidate.creativeRef?.landingType) || 'none'

      const auctionInput = isPlainObject(request.auctionDecisionLite) ? request.auctionDecisionLite : {}
      if (auctionInput.served === false) {
        return buildFailure(D_OUTPUT_REASON_CODES.INVALID_AUCTION_DECISION)
      }

      const expectedWinnerRef = {
        sourceId: normalizeText(winnerCandidate.sourceId) || 'none',
        candidateId: normalizeText(winnerCandidate.candidateId || winnerCandidate.sourceCandidateId) || 'none'
      }

      const providedWinnerRef = normalizeProvidedWinnerRef(request)
      if ((providedWinnerRef.sourceId || providedWinnerRef.candidateId) &&
        (providedWinnerRef.sourceId !== expectedWinnerRef.sourceId ||
          providedWinnerRef.candidateId !== expectedWinnerRef.candidateId)) {
        return buildFailure(D_OUTPUT_REASON_CODES.WINNING_CANDIDATE_REF_MISMATCH)
      }

      auctionDecisionLite = {
        served: true,
        winner: expectedWinnerRef,
        price: {
          value: priceValue,
          currency: priceCurrency
        },
        creativeHandle: {
          creativeId,
          landingType
        },
        debugRef: {
          routePlanId,
          routeAuditSnapshotRef,
          decisionVersionRefs
        }
      }
    } else {
      const auctionInput = isPlainObject(request.auctionDecisionLite) ? request.auctionDecisionLite : {}
      if (auctionInput.served === true) {
        return buildFailure(D_OUTPUT_REASON_CODES.INVALID_AUCTION_DECISION)
      }
      auctionDecisionLite = {
        served: false,
        winner: {
          sourceId: 'none',
          candidateId: 'none'
        },
        price: {
          value: 0,
          currency: 'NA'
        },
        creativeHandle: {
          creativeId: 'none',
          landingType: 'none'
        },
        debugRef: {
          routePlanId,
          routeAuditSnapshotRef,
          decisionVersionRefs
        }
      }
    }

    if (auctionDecisionLite.debugRef.routePlanId !== routeConclusion.routePlanId) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_AUCTION_DECISION)
    }

    const policyConstraintsLite = normalizePolicyConstraints(
      request.policyConstraintsLite ||
      request.constraintsLite
    )
    const stateUpdate = {
      fromState: 'routed',
      toState: routeOutcomeToState(routeOutcome),
      statusReasonCode: finalReasonCode,
      updatedAt: nowIso(nowFn)
    }
    if (!validateStateUpdate(routeOutcome, stateUpdate, finalReasonCode)) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_STATE_UPDATE)
    }

    const versionAnchors = {
      dOutputContractVersion,
      routingPolicyVersion: decisionVersionRefs.routingPolicyVersion,
      fallbackProfileVersion: normalizeText(routePlanLite.fallbackProfileVersion) || 'd_fallback_profile_v1',
      candidateNormalizeVersion: normalizeText(request.candidateNormalizeVersion) || 'd_candidate_normalize_v1',
      errorNormalizeVersion: normalizeText(request.errorNormalizeVersion) || 'd_error_normalize_v1',
      constraintSetVersion: normalizeText(policyConstraintsLite.constraintSetVersion) || 'c_constraints_v1',
      executionStrategyVersion: decisionVersionRefs.executionStrategyVersion,
      configSnapshotId: decisionVersionRefs.configSnapshotId
    }
    const versionAnchorsValidation = validateVersionAnchors(versionAnchors)
    if (!versionAnchorsValidation.ok) {
      return buildFailure(D_OUTPUT_REASON_CODES.INVALID_VERSION_ANCHOR, {
        missing: versionAnchorsValidation.missing
      })
    }

    const routeAuditResult = routeAuditBuilder.buildRouteAuditSnapshot({
      routePlanLite,
      traceKey,
      requestKey,
      attemptKey,
      opportunityKey,
      routeConclusion: {
        ...routeConclusion,
        finalSourceId: auctionDecisionLite.winner.sourceId
      },
      routeSwitchEvents: Array.isArray(request.routeSwitchEvents) ? request.routeSwitchEvents : [],
      routeSwitches: request.routeSwitches,
      sourceFilterSnapshot: request?.routeAuditHints?.sourceFilterSnapshot || request.sourceFilterSnapshot,
      routingHitSnapshot: {
        strategyType: routeConclusion.strategyType,
        hitRouteTier: HIT_ROUTE_TIERS.has(finalRouteTier) ? finalRouteTier : 'primary',
        hitSourceId: auctionDecisionLite.winner.sourceId,
        hitStepIndex: Number(request.hitStepIndex) > 0 ? Number(request.hitStepIndex) : 0
      },
      versionSnapshot: {
        routingPolicyVersion: versionAnchors.routingPolicyVersion,
        fallbackProfileVersion: versionAnchors.fallbackProfileVersion,
        adapterRegistryVersion: normalizeText(request.adapterRegistryVersion) || 'd_adapter_registry_v1',
        routePlanRuleVersion: normalizeText(request.routePlanRuleVersion) || 'd_route_plan_rule_v1',
        executionStrategyVersion: versionAnchors.executionStrategyVersion,
        configSnapshotId: versionAnchors.configSnapshotId,
        resolvedConfigRef: normalizeText(routePlanLite?.configSnapshotLite?.resolvedConfigRef) || 'NA',
        configHash: normalizeText(routePlanLite?.configSnapshotLite?.configHash) || 'NA',
        effectiveAt: normalizeText(routePlanLite?.configSnapshotLite?.effectiveAt) || 'NA'
      }
    })

    if (!routeAuditResult.ok || !routeAuditResult.routeAuditSnapshotLite) {
      return buildFailure(D_OUTPUT_REASON_CODES.ROUTE_AUDIT_FAILED, {
        routeAuditReasonCode: routeAuditResult.reasonCode || D_ROUTE_AUDIT_REASON_CODES.MISSING_REQUIRED_FIELD
      })
    }

    const routeAuditSnapshotLite = routeAuditResult.routeAuditSnapshotLite
    if (normalizeText(routeAuditSnapshotLite.finalRouteDecision.finalReasonCode) !== finalReasonCode) {
      return buildFailure(D_OUTPUT_REASON_CODES.ROUTE_AUDIT_FAILED)
    }

    const output = {
      opportunityKey,
      traceKey,
      requestKey,
      attemptKey,
      hasCandidate,
      candidateCount,
      normalizedCandidates,
      auctionDecisionLite,
      policyConstraintsLite,
      routeConclusion,
      routeAuditSnapshotLite,
      stateUpdate,
      versionAnchors
    }

    if (routeOutcome === 'served_candidate') {
      output.winningCandidateRef = {
        sourceId: auctionDecisionLite.winner.sourceId,
        candidateId: auctionDecisionLite.winner.candidateId
      }
    }

    if (Array.isArray(request.warnings) && request.warnings.length > 0) {
      output.warnings = request.warnings
    }
    if (isPlainObject(request.extensions) && Object.keys(request.extensions).length > 0) {
      output.extensions = request.extensions
    }

    return {
      ok: true,
      reasonCode: D_OUTPUT_REASON_CODES.OUTPUT_READY,
      dToEOutputLite: output
    }
  }

  return {
    buildOutput
  }
}
