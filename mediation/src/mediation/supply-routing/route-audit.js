const HIT_ROUTE_TIERS = new Set(['primary', 'secondary', 'fallback'])
const FINAL_ROUTE_TIERS = new Set(['primary', 'secondary', 'fallback', 'none'])
const ROUTE_OUTCOMES = new Set(['served_candidate', 'no_fill', 'error'])
const SOURCE_SELECTION_MODES = new Set(['all_except_blocked', 'allowlist_only'])
const SWITCH_REASON_CODES = new Set(['no_fill', 'timeout', 'error', 'policy_block', 'strategy_fallback'])

export const D_ROUTE_AUDIT_REASON_CODES = Object.freeze({
  SNAPSHOT_READY: 'd_route_audit_snapshot_ready',
  MISSING_REQUIRED_FIELD: 'd_route_audit_missing_required_field',
  INVALID_ROUTE_OUTCOME: 'd_route_audit_invalid_route_outcome',
  INVALID_ROUTE_TIER: 'd_route_audit_invalid_route_tier',
  INVALID_SWITCH_REASON_CODE: 'd_route_audit_invalid_switch_reason_code',
  INCONSISTENT_CONCLUSION: 'd_route_audit_inconsistent_conclusion'
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

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric)
  }
  return fallback
}

function collectRoutePlanSourceIds(routePlanLite = {}) {
  const routeSteps = Array.isArray(routePlanLite.routeSteps) ? routePlanLite.routeSteps : []
  return uniquePreserveOrder(routeSteps.map((item) => item?.sourceId))
}

function buildTraceKeys(input = {}) {
  const traceKeys = isPlainObject(input.traceKeys) ? input.traceKeys : {}
  const routePlanLite = isPlainObject(input.routePlanLite) ? input.routePlanLite : {}

  return {
    traceKey: normalizeText(traceKeys.traceKey || input.traceKey || routePlanLite.traceKey),
    requestKey: normalizeText(traceKeys.requestKey || input.requestKey || routePlanLite.requestKey),
    attemptKey: normalizeText(traceKeys.attemptKey || input.attemptKey || routePlanLite.attemptKey),
    opportunityKey: normalizeText(traceKeys.opportunityKey || input.opportunityKey || routePlanLite.opportunityKey)
  }
}

function buildSourceFilterSnapshot(input = {}, routePlanLite = {}) {
  const sourceFilterInput = isPlainObject(input.sourceFilterSnapshot) ? input.sourceFilterSnapshot : {}
  const routePlanSourceIds = collectRoutePlanSourceIds(routePlanLite)
  let sourceSelectionMode = normalizeText(sourceFilterInput.sourceSelectionMode) || 'all_except_blocked'
  if (!SOURCE_SELECTION_MODES.has(sourceSelectionMode)) sourceSelectionMode = 'all_except_blocked'

  const providedEffective = uniquePreserveOrder(sourceFilterInput.effectiveSourcePoolIds)
  const effectiveSourcePoolIds = routePlanSourceIds.length > 0 ? routePlanSourceIds : providedEffective

  return {
    sourceSelectionMode,
    inputAllowedSourceIds: uniquePreserveOrder(sourceFilterInput.inputAllowedSourceIds),
    inputBlockedSourceIds: uniquePreserveOrder(sourceFilterInput.inputBlockedSourceIds),
    filteredOutSourceIds: uniquePreserveOrder(sourceFilterInput.filteredOutSourceIds),
    effectiveSourcePoolIds
  }
}

function normalizeSwitchEvents(input = {}, nowFn) {
  const fromSwitchesObject = isPlainObject(input.routeSwitches) ? input.routeSwitches : {}
  const sourceEvents = Array.isArray(fromSwitchesObject.switchEvents)
    ? fromSwitchesObject.switchEvents
    : (Array.isArray(input.routeSwitchEvents) ? input.routeSwitchEvents : [])

  const normalized = []
  for (const raw of sourceEvents) {
    const event = isPlainObject(raw) ? raw : {}
    const switchReasonCode = normalizeText(event.switchReasonCode)
    if (!SWITCH_REASON_CODES.has(switchReasonCode)) {
      return {
        ok: false,
        reasonCode: D_ROUTE_AUDIT_REASON_CODES.INVALID_SWITCH_REASON_CODE,
        switchEvents: []
      }
    }
    normalized.push({
      fromSourceId: normalizeText(event.fromSourceId || 'none'),
      toSourceId: normalizeText(event.toSourceId || 'none'),
      switchReasonCode,
      switchAt: normalizeText(event.switchAt) || nowIso(nowFn)
    })
  }

  return {
    ok: true,
    reasonCode: D_ROUTE_AUDIT_REASON_CODES.SNAPSHOT_READY,
    switchEvents: normalized
  }
}

function normalizeRoutingHitSnapshot(input = {}, routePlanLite = {}, routeConclusion = {}) {
  const hitSnapshotInput = isPlainObject(input.routingHitSnapshot) ? input.routingHitSnapshot : {}
  const routeSteps = Array.isArray(routePlanLite.routeSteps) ? routePlanLite.routeSteps : []
  const strategyType = normalizeText(
    hitSnapshotInput.strategyType ||
    routeConclusion.strategyType ||
    routePlanLite?.executionStrategyLite?.strategyType
  )
  let hitRouteTier = normalizeText(
    hitSnapshotInput.hitRouteTier ||
    routeConclusion.finalRouteTier
  )
  if (!HIT_ROUTE_TIERS.has(hitRouteTier)) {
    const firstTier = normalizeText(routeSteps[0]?.routeTier)
    hitRouteTier = HIT_ROUTE_TIERS.has(firstTier) ? firstTier : 'primary'
  }

  let hitSourceId = normalizeText(hitSnapshotInput.hitSourceId)
  if (!hitSourceId) {
    if (normalizeText(routeConclusion.finalRouteTier) === hitRouteTier) {
      hitSourceId = normalizeText(routeConclusion.finalSourceId)
    }
    if (!hitSourceId) {
      const hitStep = routeSteps.find((item) => normalizeText(item.routeTier) === hitRouteTier)
      hitSourceId = normalizeText(hitStep?.sourceId || 'none')
    }
  }

  let hitStepIndex = toPositiveInt(hitSnapshotInput.hitStepIndex, 0)
  if (hitStepIndex === 0) {
    const hitStep = routeSteps.find((item) => normalizeText(item.sourceId) === hitSourceId)
    hitStepIndex = toPositiveInt(hitStep?.stepIndex, 0)
  }

  return {
    routePlanId: normalizeText(routePlanLite.routePlanId),
    strategyType,
    hitRouteTier,
    hitSourceId: hitSourceId || 'none',
    hitStepIndex
  }
}

function normalizeVersionSnapshot(input = {}, routePlanLite = {}, options = {}) {
  const versionInput = isPlainObject(input.versionSnapshot) ? input.versionSnapshot : {}
  const routePlanConfig = isPlainObject(routePlanLite.configSnapshotLite) ? routePlanLite.configSnapshotLite : {}
  const routePlanStrategy = isPlainObject(routePlanLite.executionStrategyLite) ? routePlanLite.executionStrategyLite : {}

  return {
    routingPolicyVersion: normalizeText(
      versionInput.routingPolicyVersion ||
      routePlanLite.routingPolicyVersion ||
      input.routingPolicyVersion
    ) || 'd_routing_policy_v1',
    fallbackProfileVersion: normalizeText(
      versionInput.fallbackProfileVersion ||
      routePlanLite.fallbackProfileVersion ||
      input.fallbackProfileVersion
    ) || 'd_fallback_profile_v1',
    adapterRegistryVersion: normalizeText(
      versionInput.adapterRegistryVersion ||
      input.adapterRegistryVersion ||
      options.adapterRegistryVersion
    ) || 'd_adapter_registry_v1',
    routePlanRuleVersion: normalizeText(
      versionInput.routePlanRuleVersion ||
      input.routePlanRuleVersion ||
      options.routePlanRuleVersion
    ) || 'd_route_plan_rule_v1',
    executionStrategyVersion: normalizeText(
      versionInput.executionStrategyVersion ||
      routePlanStrategy.executionStrategyVersion ||
      input.executionStrategyVersion
    ) || 'd_execution_strategy_v1',
    configSnapshotId: normalizeText(
      versionInput.configSnapshotId ||
      routePlanConfig.configSnapshotId ||
      input.configSnapshotId
    ) || 'NA',
    resolvedConfigRef: normalizeText(
      versionInput.resolvedConfigRef ||
      routePlanConfig.resolvedConfigRef ||
      input.resolvedConfigRef
    ) || 'NA',
    configHash: normalizeText(
      versionInput.configHash ||
      routePlanConfig.configHash ||
      input.configHash
    ) || 'NA',
    effectiveAt: normalizeText(
      versionInput.effectiveAt ||
      routePlanConfig.effectiveAt ||
      input.effectiveAt
    ) || 'NA'
  }
}

function normalizeFinalRouteDecision(input = {}, routeConclusion = {}, nowFn) {
  const finalDecisionInput = isPlainObject(input.finalRouteDecision) ? input.finalRouteDecision : {}
  const finalOutcome = normalizeText(
    finalDecisionInput.finalOutcome ||
    routeConclusion.routeOutcome
  )
  if (!ROUTE_OUTCOMES.has(finalOutcome)) {
    return {
      ok: false,
      reasonCode: D_ROUTE_AUDIT_REASON_CODES.INVALID_ROUTE_OUTCOME,
      finalRouteDecision: null
    }
  }

  let finalRouteTier = normalizeText(
    finalDecisionInput.finalRouteTier ||
    routeConclusion.finalRouteTier
  )
  if (!FINAL_ROUTE_TIERS.has(finalRouteTier)) {
    return {
      ok: false,
      reasonCode: D_ROUTE_AUDIT_REASON_CODES.INVALID_ROUTE_TIER,
      finalRouteDecision: null
    }
  }

  const finalSourceId = normalizeText(
    finalDecisionInput.finalSourceId ||
    routeConclusion.finalSourceId
  ) || 'none'
  const finalReasonCode = normalizeText(
    finalDecisionInput.finalReasonCode ||
    routeConclusion.finalReasonCode
  )
  if (!finalReasonCode) {
    return {
      ok: false,
      reasonCode: D_ROUTE_AUDIT_REASON_CODES.MISSING_REQUIRED_FIELD,
      finalRouteDecision: null
    }
  }

  return {
    ok: true,
    reasonCode: D_ROUTE_AUDIT_REASON_CODES.SNAPSHOT_READY,
    finalRouteDecision: {
      finalSourceId,
      finalRouteTier,
      finalOutcome,
      finalReasonCode,
      selectedAt: normalizeText(finalDecisionInput.selectedAt || routeConclusion.selectedAt) || nowIso(nowFn)
    }
  }
}

function validateRequired(snapshot = {}) {
  const missing = []
  if (!normalizeText(snapshot?.traceKeys?.traceKey)) missing.push('traceKeys.traceKey')
  if (!normalizeText(snapshot?.traceKeys?.requestKey)) missing.push('traceKeys.requestKey')
  if (!normalizeText(snapshot?.traceKeys?.attemptKey)) missing.push('traceKeys.attemptKey')
  if (!normalizeText(snapshot?.traceKeys?.opportunityKey)) missing.push('traceKeys.opportunityKey')
  if (!normalizeText(snapshot?.routingHitSnapshot?.routePlanId)) missing.push('routingHitSnapshot.routePlanId')
  if (!normalizeText(snapshot?.routingHitSnapshot?.strategyType)) missing.push('routingHitSnapshot.strategyType')
  if (!normalizeText(snapshot?.finalRouteDecision?.finalReasonCode)) missing.push('finalRouteDecision.finalReasonCode')
  if (!normalizeText(snapshot?.versionSnapshot?.configSnapshotId)) missing.push('versionSnapshot.configSnapshotId')
  if (!normalizeText(snapshot?.snapshotMeta?.routeAuditSchemaVersion)) missing.push('snapshotMeta.routeAuditSchemaVersion')

  return {
    ok: missing.length === 0,
    missing
  }
}

export function createRouteAuditBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const routeAuditSchemaVersion = normalizeText(options.routeAuditSchemaVersion) || 'd_route_audit_schema_v1'

  function buildRouteAuditSnapshot(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const routePlanLite = isPlainObject(request.routePlanLite) ? request.routePlanLite : {}
    const routeConclusion = isPlainObject(request.routeConclusion) ? request.routeConclusion : {}

    const traceKeys = buildTraceKeys(request)
    const sourceFilterSnapshot = buildSourceFilterSnapshot(request, routePlanLite)
    const routeSwitchesResult = normalizeSwitchEvents(request, nowFn)
    if (!routeSwitchesResult.ok) {
      return {
        ok: false,
        reasonCode: routeSwitchesResult.reasonCode,
        routeAuditSnapshotLite: null
      }
    }

    const finalRouteDecisionResult = normalizeFinalRouteDecision(request, routeConclusion, nowFn)
    if (!finalRouteDecisionResult.ok) {
      return {
        ok: false,
        reasonCode: finalRouteDecisionResult.reasonCode,
        routeAuditSnapshotLite: null
      }
    }

    const routeSwitches = {
      switchCount: routeSwitchesResult.switchEvents.length,
      switchEvents: routeSwitchesResult.switchEvents
    }
    const routingHitSnapshot = normalizeRoutingHitSnapshot(request, routePlanLite, {
      ...routeConclusion,
      finalSourceId: finalRouteDecisionResult.finalRouteDecision.finalSourceId,
      finalRouteTier: finalRouteDecisionResult.finalRouteDecision.finalRouteTier
    })
    const versionSnapshot = normalizeVersionSnapshot(request, routePlanLite, options)

    const snapshot = {
      traceKeys,
      routingHitSnapshot,
      sourceFilterSnapshot,
      routeSwitches,
      finalRouteDecision: finalRouteDecisionResult.finalRouteDecision,
      versionSnapshot,
      snapshotMeta: {
        routeAuditSchemaVersion,
        generatedAt: nowIso(nowFn)
      }
    }

    const required = validateRequired(snapshot)
    if (!required.ok) {
      return {
        ok: false,
        reasonCode: D_ROUTE_AUDIT_REASON_CODES.MISSING_REQUIRED_FIELD,
        routeAuditSnapshotLite: null,
        missing: required.missing
      }
    }

    const routeConclusionReason = normalizeText(routeConclusion.finalReasonCode)
    if (routeConclusionReason && routeConclusionReason !== snapshot.finalRouteDecision.finalReasonCode) {
      return {
        ok: false,
        reasonCode: D_ROUTE_AUDIT_REASON_CODES.INCONSISTENT_CONCLUSION,
        routeAuditSnapshotLite: null
      }
    }

    const routeConclusionStrategy = normalizeText(routeConclusion.strategyType)
    if (routeConclusionStrategy && routeConclusionStrategy !== snapshot.routingHitSnapshot.strategyType) {
      return {
        ok: false,
        reasonCode: D_ROUTE_AUDIT_REASON_CODES.INCONSISTENT_CONCLUSION,
        routeAuditSnapshotLite: null
      }
    }

    const routeConclusionConfigSnapshotId = normalizeText(routeConclusion.configSnapshotId)
    if (routeConclusionConfigSnapshotId && routeConclusionConfigSnapshotId !== snapshot.versionSnapshot.configSnapshotId) {
      return {
        ok: false,
        reasonCode: D_ROUTE_AUDIT_REASON_CODES.INCONSISTENT_CONCLUSION,
        routeAuditSnapshotLite: null
      }
    }

    return {
      ok: true,
      reasonCode: D_ROUTE_AUDIT_REASON_CODES.SNAPSHOT_READY,
      routeAuditSnapshotLite: snapshot
    }
  }

  return {
    buildRouteAuditSnapshot
  }
}
