export const C_POLICY_REASON_CODES = Object.freeze({
  MISSING_REQUIRED_FIELD: 'c_missing_required_field',
  OPTIONAL_MISSING_IGNORED: 'c_optional_missing_ignored',
  INVALID_INPUT_STATE: 'c_invalid_input_state',
  POLICY_SNAPSHOT_MISSING: 'c_policy_snapshot_missing',
  POLICY_SNAPSHOT_EXPIRED: 'c_policy_snapshot_expired',
  POLICY_SNAPSHOT_INVALID: 'c_policy_snapshot_invalid',
  POLICY_ENGINE_ERROR: 'c_policy_engine_error',
  COMPLIANCE_HARD_BLOCK: 'c_compliance_hard_block',
  CONSENT_SCOPE_BLOCKED: 'c_consent_scope_blocked',
  FREQUENCY_HARD_CAP_BLOCK: 'c_frequency_hard_cap_block',
  CATEGORY_RESTRICTED_BLOCK: 'c_category_restricted_block',
  POLICY_PASS: 'c_policy_pass',
  POLICY_DEGRADED_PASS: 'c_policy_degraded_pass',
  POLICY_CONFLICT_RESOLVED: 'c_policy_conflict_resolved'
})

export const C_POLICY_ACTIONS = Object.freeze({
  ALLOW: 'allow',
  DEGRADE: 'degrade',
  BLOCK: 'block',
  REJECT: 'reject'
})

export const C_SHORT_CIRCUIT_ACTIONS = Object.freeze({
  BLOCK: 'short_circuit_block',
  ALLOW: 'short_circuit_allow'
})

export const C_GATE_ORDER = Object.freeze([
  'compliance_gate',
  'consent_auth_gate',
  'frequency_cap_gate',
  'category_gate'
])

const RISK_LEVEL_WEIGHT = Object.freeze({
  high: 3,
  medium: 2,
  low: 1
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

function parseDateMs(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : NaN
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeInput(input) {
  const request = isPlainObject(input) ? input : {}
  return {
    opportunityKey: normalizeText(request.opportunityKey),
    schemaVersion: normalizeText(request.schemaVersion),
    cInputContractVersion: normalizeText(request.cInputContractVersion) || 'c_input_contract_v1',
    state: normalizeText(request.state),
    RequestMeta: isPlainObject(request.RequestMeta) ? request.RequestMeta : null,
    PlacementMeta: isPlainObject(request.PlacementMeta) ? request.PlacementMeta : null,
    UserContext: isPlainObject(request.UserContext) ? request.UserContext : null,
    OpportunityContext: isPlainObject(request.OpportunityContext) ? request.OpportunityContext : null,
    PolicyContext: isPlainObject(request.PolicyContext) ? request.PolicyContext : null,
    TraceContext: isPlainObject(request.TraceContext) ? request.TraceContext : null,
    normalizationSummary: isPlainObject(request.normalizationSummary) ? request.normalizationSummary : null,
    mappingAuditSnapshotLite: request.mappingAuditSnapshotLite,
    policySnapshotLite: isPlainObject(request.policySnapshotLite) ? request.policySnapshotLite : null,
    mappingWarnings: Array.isArray(request.mappingWarnings) ? request.mappingWarnings : []
  }
}

function buildRejectedResult(normalized, reasonCode, nowFn) {
  return {
    evaluateAccepted: false,
    finalPolicyAction: C_POLICY_ACTIONS.REJECT,
    isRoutable: false,
    allowAd: false,
    reasonCode,
    policyDecisionReasonCode: reasonCode,
    shortCircuitAction: C_SHORT_CIRCUIT_ACTIONS.BLOCK,
    shortCircuitGate: 'input_guard',
    shortCircuitReasonCode: reasonCode,
    winningGate: 'input_guard',
    winningRuleId: 'input_guard_rule',
    policyConflictReasonCode: reasonCode,
    decisionTimestamp: nowIso(nowFn),
    traceKey: normalizeText(normalized?.TraceContext?.traceKey) || 'NA',
    requestKey: normalizeText(normalized?.TraceContext?.requestKey) || 'NA',
    attemptKey: normalizeText(normalized?.TraceContext?.attemptKey) || 'NA',
    policyPackVersion: normalizeText(normalized?.policySnapshotLite?.policyPackVersion) || 'NA',
    policyRuleVersion: normalizeText(normalized?.policySnapshotLite?.policyRuleVersion) || 'NA',
    policySnapshotId: normalizeText(normalized?.policySnapshotLite?.policySnapshotId) || 'NA',
    policySnapshotVersion: normalizeText(normalized?.policySnapshotLite?.policySnapshotVersion) || 'NA',
    executedGates: [],
    decisionActions: []
  }
}

function validateInput(normalized, nowFn) {
  const requiredObjects = [
    normalized.RequestMeta,
    normalized.PlacementMeta,
    normalized.UserContext,
    normalized.OpportunityContext,
    normalized.PolicyContext,
    normalized.TraceContext,
    normalized.normalizationSummary
  ]

  if (!normalized.opportunityKey || !normalized.schemaVersion || !normalized.cInputContractVersion) {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.MISSING_REQUIRED_FIELD, nowFn)
  }

  if (requiredObjects.some((value) => !isPlainObject(value))) {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.MISSING_REQUIRED_FIELD, nowFn)
  }

  if (normalized.mappingAuditSnapshotLite === undefined || normalized.mappingAuditSnapshotLite === null) {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.MISSING_REQUIRED_FIELD, nowFn)
  }

  if (normalized.state !== 'received') {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.INVALID_INPUT_STATE, nowFn)
  }

  const summary = normalized.normalizationSummary
  if (
    !normalizeText(summary.mappingProfileVersion) ||
    !normalizeText(summary.enumDictVersion) ||
    !normalizeText(summary.conflictPolicyVersion)
  ) {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.MISSING_REQUIRED_FIELD, nowFn)
  }

  const snapshot = normalized.policySnapshotLite
  if (!snapshot) {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_SNAPSHOT_MISSING, nowFn)
  }

  const requiredSnapshotFields = [
    snapshot.policySnapshotId,
    snapshot.policySnapshotVersion,
    snapshot.policyPackVersion,
    snapshot.policyRuleVersion,
    snapshot.snapshotSource,
    snapshot.resolvedConfigRef,
    snapshot.configHash,
    snapshot.effectiveAt,
    snapshot.failureMode
  ]
  if (requiredSnapshotFields.some((value) => !normalizeText(value))) {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_SNAPSHOT_INVALID, nowFn)
  }

  if (normalizeText(snapshot.snapshotSource) !== 'resolvedConfigSnapshot') {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_SNAPSHOT_INVALID, nowFn)
  }

  if (!isPlainObject(snapshot.policyConstraintsLite)) {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_SNAPSHOT_INVALID, nowFn)
  }

  const failureMode = normalizeText(snapshot.failureMode)
  if (failureMode !== 'fail_open' && failureMode !== 'fail_closed') {
    return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_SNAPSHOT_INVALID, nowFn)
  }

  const expireAt = normalizeText(snapshot.expireAtOrNA)
  if (expireAt && expireAt !== 'NA') {
    const expireMs = parseDateMs(expireAt)
    if (!Number.isFinite(expireMs)) {
      return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_SNAPSHOT_INVALID, nowFn)
    }
    if (nowFn() > expireMs) {
      if (failureMode === 'fail_closed') {
        return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_SNAPSHOT_EXPIRED, nowFn)
      }

      return {
        rejected: null,
        snapshotExpiredWithFailOpen: true
      }
    }
  }

  return {
    rejected: null,
    snapshotExpiredWithFailOpen: false
  }
}

function evaluateComplianceGate(normalized) {
  const policy = normalized.policySnapshotLite.policyConstraintsLite.complianceGate || {}
  const outcome = normalizeText(normalized.OpportunityContext.decisionOutcome)
  const hardBlocked = policy.hardBlocked === true || outcome === 'opportunity_blocked_by_policy'
  if (hardBlocked) {
    return {
      gate: 'compliance_gate',
      gateAction: C_POLICY_ACTIONS.BLOCK,
      reasonCode: C_POLICY_REASON_CODES.COMPLIANCE_HARD_BLOCK,
      ruleId: normalizeText(policy.ruleId) || 'compliance_hard_block_rule',
      riskLevel: 'high'
    }
  }

  if (policy.degrade === true) {
    return {
      gate: 'compliance_gate',
      gateAction: C_POLICY_ACTIONS.DEGRADE,
      reasonCode: C_POLICY_REASON_CODES.POLICY_DEGRADED_PASS,
      ruleId: normalizeText(policy.ruleId) || 'compliance_degrade_rule',
      riskLevel: 'medium'
    }
  }

  return {
    gate: 'compliance_gate',
    gateAction: C_POLICY_ACTIONS.ALLOW,
    reasonCode: C_POLICY_REASON_CODES.POLICY_PASS,
    ruleId: normalizeText(policy.ruleId) || 'compliance_allow_rule',
    riskLevel: 'low'
  }
}

function evaluateConsentAuthGate(normalized) {
  const policy = normalized.policySnapshotLite.policyConstraintsLite.consentAuthGate || {}
  const consentScope = normalizeText(normalized.PolicyContext.consentScope)
  const blockedConsentScopes = Array.isArray(policy.blockedConsentScopes)
    ? policy.blockedConsentScopes.map((item) => normalizeText(item)).filter(Boolean)
    : ['consent_denied']

  if (blockedConsentScopes.includes(consentScope)) {
    return {
      gate: 'consent_auth_gate',
      gateAction: C_POLICY_ACTIONS.BLOCK,
      reasonCode: C_POLICY_REASON_CODES.CONSENT_SCOPE_BLOCKED,
      ruleId: normalizeText(policy.ruleId) || 'consent_scope_block_rule',
      riskLevel: 'high'
    }
  }

  if (consentScope === 'consent_limited' && policy.degradeOnLimited !== false) {
    return {
      gate: 'consent_auth_gate',
      gateAction: C_POLICY_ACTIONS.DEGRADE,
      reasonCode: C_POLICY_REASON_CODES.POLICY_DEGRADED_PASS,
      ruleId: normalizeText(policy.degradeRuleId) || 'consent_scope_degrade_rule',
      riskLevel: normalizeText(policy.degradeRiskLevel) || 'medium'
    }
  }

  return {
    gate: 'consent_auth_gate',
    gateAction: C_POLICY_ACTIONS.ALLOW,
    reasonCode: C_POLICY_REASON_CODES.POLICY_PASS,
    ruleId: normalizeText(policy.allowRuleId) || 'consent_scope_allow_rule',
    riskLevel: 'low'
  }
}

function evaluateFrequencyCapGate(normalized) {
  const policy = normalized.policySnapshotLite.policyConstraintsLite.frequencyCapGate || {}
  const currentCount = toNumber(
    normalized.PolicyContext.frequencyCount ??
      normalized.RequestMeta.frequencyCount ??
      0
  )
  const hardCap = Number.isFinite(policy.hardCap) ? Number(policy.hardCap) : Number.POSITIVE_INFINITY
  const degradeThreshold = Number.isFinite(policy.degradeThreshold)
    ? Number(policy.degradeThreshold)
    : Number.POSITIVE_INFINITY

  if (currentCount > hardCap) {
    return {
      gate: 'frequency_cap_gate',
      gateAction: C_POLICY_ACTIONS.BLOCK,
      reasonCode: C_POLICY_REASON_CODES.FREQUENCY_HARD_CAP_BLOCK,
      ruleId: normalizeText(policy.ruleId) || 'frequency_hard_cap_rule',
      riskLevel: 'high'
    }
  }

  if (currentCount >= degradeThreshold) {
    return {
      gate: 'frequency_cap_gate',
      gateAction: C_POLICY_ACTIONS.DEGRADE,
      reasonCode: C_POLICY_REASON_CODES.POLICY_DEGRADED_PASS,
      ruleId: normalizeText(policy.degradeRuleId) || 'frequency_degrade_rule',
      riskLevel: normalizeText(policy.degradeRiskLevel) || 'medium'
    }
  }

  return {
    gate: 'frequency_cap_gate',
    gateAction: C_POLICY_ACTIONS.ALLOW,
    reasonCode: C_POLICY_REASON_CODES.POLICY_PASS,
    ruleId: normalizeText(policy.allowRuleId) || 'frequency_allow_rule',
    riskLevel: 'low'
  }
}

function evaluateCategoryGate(normalized) {
  const policy = normalized.policySnapshotLite.policyConstraintsLite.categoryGate || {}
  const blockedCategories = Array.isArray(policy.hardBlockedCategories)
    ? policy.hardBlockedCategories.map((item) => normalizeText(item)).filter(Boolean)
    : []
  const degradedCategories = Array.isArray(policy.degradedCategories)
    ? policy.degradedCategories.map((item) => normalizeText(item)).filter(Boolean)
    : []
  const flags = Array.isArray(normalized.PolicyContext.restrictedCategoryFlags)
    ? normalized.PolicyContext.restrictedCategoryFlags.map((item) => normalizeText(item)).filter(Boolean)
    : []

  const hitBlocked = flags.find((flag) => blockedCategories.includes(flag))
  if (hitBlocked) {
    return {
      gate: 'category_gate',
      gateAction: C_POLICY_ACTIONS.BLOCK,
      reasonCode: C_POLICY_REASON_CODES.CATEGORY_RESTRICTED_BLOCK,
      ruleId: normalizeText(policy.ruleId) || `category_block_${hitBlocked}`,
      riskLevel: 'high'
    }
  }

  const hitDegrade = flags.find((flag) => degradedCategories.includes(flag))
  if (hitDegrade) {
    return {
      gate: 'category_gate',
      gateAction: C_POLICY_ACTIONS.DEGRADE,
      reasonCode: C_POLICY_REASON_CODES.POLICY_DEGRADED_PASS,
      ruleId: normalizeText(policy.degradeRuleId) || `category_degrade_${hitDegrade}`,
      riskLevel: normalizeText(policy.degradeRiskLevel) || 'low'
    }
  }

  return {
    gate: 'category_gate',
    gateAction: C_POLICY_ACTIONS.ALLOW,
    reasonCode: C_POLICY_REASON_CODES.POLICY_PASS,
    ruleId: normalizeText(policy.allowRuleId) || 'category_allow_rule',
    riskLevel: 'low'
  }
}

function evaluateGateByName(gateName, normalized) {
  switch (gateName) {
    case 'compliance_gate':
      return evaluateComplianceGate(normalized)
    case 'consent_auth_gate':
      return evaluateConsentAuthGate(normalized)
    case 'frequency_cap_gate':
      return evaluateFrequencyCapGate(normalized)
    case 'category_gate':
      return evaluateCategoryGate(normalized)
    default:
      return {
        gate: gateName,
        gateAction: C_POLICY_ACTIONS.ALLOW,
        reasonCode: C_POLICY_REASON_CODES.POLICY_PASS,
        ruleId: `${gateName}_allow_rule`,
        riskLevel: 'low'
      }
  }
}

function pickWinningDegrade(decisions) {
  const degraded = decisions.filter((item) => item.gateAction === C_POLICY_ACTIONS.DEGRADE)
  if (degraded.length === 0) return null

  const byRisk = [...degraded].sort((a, b) => {
    const weightA = RISK_LEVEL_WEIGHT[normalizeText(a.riskLevel)] || 0
    const weightB = RISK_LEVEL_WEIGHT[normalizeText(b.riskLevel)] || 0
    if (weightB !== weightA) return weightB - weightA
    return normalizeText(a.ruleId).localeCompare(normalizeText(b.ruleId))
  })
  return byRisk[0]
}

export function createPolicyEngine(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()

  function evaluate(input) {
    const normalized = normalizeInput(input)
    const validation = validateInput(normalized, nowFn)
    if (validation?.rejected) {
      return validation.rejected
    }

    try {
      const decisionActions = []
      const executedGates = []
      let shortCircuit = null
      let inheritedDegradeFromSnapshotExpiry = validation.snapshotExpiredWithFailOpen === true

      for (const gateName of C_GATE_ORDER) {
        const decision = evaluateGateByName(gateName, normalized)
        const decisionAction = {
          gate: decision.gate,
          gateAction: decision.gateAction,
          reasonCode: decision.reasonCode,
          ruleId: decision.ruleId,
          riskLevel: decision.riskLevel
        }
        decisionActions.push(decisionAction)
        executedGates.push(gateName)

        if (decision.gateAction === C_POLICY_ACTIONS.BLOCK) {
          shortCircuit = {
            shortCircuitGate: gateName,
            shortCircuitAction: C_SHORT_CIRCUIT_ACTIONS.BLOCK,
            shortCircuitReasonCode: decision.reasonCode
          }
          break
        }
      }

      let finalPolicyAction = C_POLICY_ACTIONS.ALLOW
      let winningDecision = decisionActions[decisionActions.length - 1] || {
        gate: 'category_gate',
        gateAction: C_POLICY_ACTIONS.ALLOW,
        reasonCode: C_POLICY_REASON_CODES.POLICY_PASS,
        ruleId: 'policy_allow_rule',
        riskLevel: 'low'
      }

      if (shortCircuit) {
        finalPolicyAction = C_POLICY_ACTIONS.BLOCK
      } else {
        const winningDegrade = pickWinningDegrade(decisionActions)
        if (winningDegrade || inheritedDegradeFromSnapshotExpiry) {
          finalPolicyAction = C_POLICY_ACTIONS.DEGRADE
          if (winningDegrade) {
            winningDecision = winningDegrade
          } else {
            winningDecision = {
              gate: 'snapshot_guard',
              gateAction: C_POLICY_ACTIONS.DEGRADE,
              reasonCode: C_POLICY_REASON_CODES.POLICY_SNAPSHOT_EXPIRED,
              ruleId: 'snapshot_expired_fail_open_rule',
              riskLevel: 'medium'
            }
          }
        }
      }

      const shortCircuitAction = shortCircuit
        ? shortCircuit.shortCircuitAction
        : C_SHORT_CIRCUIT_ACTIONS.ALLOW
      const shortCircuitGate = shortCircuit
        ? shortCircuit.shortCircuitGate
        : winningDecision.gate
      const shortCircuitReasonCode = shortCircuit
        ? shortCircuit.shortCircuitReasonCode
        : (finalPolicyAction === C_POLICY_ACTIONS.ALLOW
          ? C_POLICY_REASON_CODES.POLICY_PASS
          : C_POLICY_REASON_CODES.POLICY_DEGRADED_PASS)

      const policyConflictReasonCode = decisionActions.length > 1 &&
        new Set(decisionActions.map((item) => item.gateAction)).size > 1
        ? C_POLICY_REASON_CODES.POLICY_CONFLICT_RESOLVED
        : shortCircuitReasonCode

      return {
        evaluateAccepted: true,
        finalPolicyAction,
        isRoutable: finalPolicyAction !== C_POLICY_ACTIONS.BLOCK,
        allowAd: finalPolicyAction !== C_POLICY_ACTIONS.BLOCK,
        reasonCode: shortCircuitReasonCode,
        policyDecisionReasonCode: shortCircuitReasonCode,
        shortCircuitAction,
        shortCircuitGate,
        shortCircuitReasonCode,
        winningGate: winningDecision.gate,
        winningRuleId: winningDecision.ruleId,
        policyConflictReasonCode,
        decisionTimestamp: nowIso(nowFn),
        traceKey: normalizeText(normalized.TraceContext.traceKey),
        requestKey: normalizeText(normalized.TraceContext.requestKey),
        attemptKey: normalizeText(normalized.TraceContext.attemptKey),
        policyPackVersion: normalizeText(normalized.policySnapshotLite.policyPackVersion),
        policyRuleVersion: normalizeText(normalized.policySnapshotLite.policyRuleVersion),
        policySnapshotId: normalizeText(normalized.policySnapshotLite.policySnapshotId),
        policySnapshotVersion: normalizeText(normalized.policySnapshotLite.policySnapshotVersion),
        executedGates,
        decisionActions
      }
    } catch {
      return buildRejectedResult(normalized, C_POLICY_REASON_CODES.POLICY_ENGINE_ERROR, nowFn)
    }
  }

  return {
    evaluate
  }
}
