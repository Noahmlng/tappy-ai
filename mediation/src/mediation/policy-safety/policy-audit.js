function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item))
  }

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

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function normalizeDecisionAction(record, index) {
  const item = isPlainObject(record) ? record : {}
  return {
    step: index + 1,
    action: normalizeText(item.gateAction || item.action || 'allow'),
    sourceGate: normalizeText(item.gate || item.sourceGate || `gate_${index + 1}`),
    reasonCode: normalizeText(item.reasonCode || 'c_policy_pass')
  }
}

function normalizeHitRule(record) {
  const item = isPlainObject(record) ? record : {}
  return {
    gate: normalizeText(item.gate || item.sourceGate || 'unknown_gate'),
    ruleId: normalizeText(item.ruleId || 'unknown_rule'),
    ruleAction: normalizeText(item.gateAction || item.ruleAction || 'allow'),
    reasonCode: normalizeText(item.reasonCode || 'c_policy_pass')
  }
}

export function createPolicyAuditBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()

  function buildPolicyAuditSnapshot(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const cInput = isPlainObject(request.cInput) ? request.cInput : {}
    const evaluationResult = isPlainObject(request.evaluationResult) ? request.evaluationResult : {}
    const cPolicyDecisionLite = isPlainObject(request.cPolicyDecisionLite) ? request.cPolicyDecisionLite : {}
    const policySnapshot = isPlainObject(cInput.policySnapshotLite) ? cInput.policySnapshotLite : {}
    const summary = isPlainObject(cInput.normalizationSummary) ? cInput.normalizationSummary : {}

    const startedAt = normalizeText(request.policyEvaluationStartAt) || nowIso(nowFn)
    const endedAt = normalizeText(request.policyEvaluationEndAt) || startedAt

    const decisionActionsSource = Array.isArray(evaluationResult.decisionActions)
      ? evaluationResult.decisionActions
      : []
    const decisionActions = decisionActionsSource.map((item, index) => normalizeDecisionAction(item, index))

    const hitRules = decisionActions
      .filter((item) => item.action === 'block' || item.action === 'degrade')
      .map((item) => normalizeHitRule(item))
    if (hitRules.length === 0 && decisionActions.length > 0) {
      hitRules.push(normalizeHitRule(decisionActions[decisionActions.length - 1]))
    }

    const snapshot = {
      traceKey: normalizeText(cPolicyDecisionLite.traceKey || cInput?.TraceContext?.traceKey || 'NA'),
      requestKey: normalizeText(cPolicyDecisionLite.requestKey || cInput?.TraceContext?.requestKey || 'NA'),
      attemptKey: normalizeText(cPolicyDecisionLite.attemptKey || cInput?.TraceContext?.attemptKey || 'NA'),
      opportunityKey: normalizeText(cPolicyDecisionLite.opportunityKey || cInput.opportunityKey || 'NA'),
      policyEvaluationStartAt: startedAt,
      policyEvaluationEndAt: endedAt,
      hitRules,
      decisionActions,
      finalConclusion: {
        finalPolicyAction: normalizeText(cPolicyDecisionLite.finalPolicyAction),
        isRoutable: cPolicyDecisionLite.isRoutable === true,
        adDecisionLite: stableClone(cPolicyDecisionLite.adDecisionLite || {}),
        primaryPolicyReasonCode: normalizeText(cPolicyDecisionLite.primaryPolicyReasonCode),
        winningGate: normalizeText(cPolicyDecisionLite.winningGate),
        winningRuleId: normalizeText(cPolicyDecisionLite.winningRuleId),
        constraintsLite: stableClone(cPolicyDecisionLite.constraintsLite || {})
      },
      versionSnapshot: {
        policyPackVersion: normalizeText(cPolicyDecisionLite.policyPackVersion || policySnapshot.policyPackVersion),
        policyRuleVersion: normalizeText(cPolicyDecisionLite.policyRuleVersion || policySnapshot.policyRuleVersion),
        policySnapshotId: normalizeText(cPolicyDecisionLite.policySnapshotId || policySnapshot.policySnapshotId),
        policySnapshotVersion: normalizeText(cPolicyDecisionLite.policySnapshotVersion || policySnapshot.policySnapshotVersion),
        resolvedConfigRef: normalizeText(policySnapshot.resolvedConfigRef),
        configHash: normalizeText(policySnapshot.configHash),
        cInputContractVersion: normalizeText(cInput.cInputContractVersion),
        schemaVersion: normalizeText(cInput.schemaVersion),
        enumDictVersion: normalizeText(summary.enumDictVersion)
      },
      stateUpdate: stableClone(cPolicyDecisionLite.stateUpdate || {})
    }

    const secondary = Array.isArray(cPolicyDecisionLite.secondaryPolicyReasonCodes)
      ? cPolicyDecisionLite.secondaryPolicyReasonCodes
      : []
    if (secondary.length > 0) {
      snapshot.secondaryPolicyReasonCodes = secondary.map((item) => normalizeText(item)).filter(Boolean)
    }

    if (normalizeText(cPolicyDecisionLite.shortCircuitAction)) {
      snapshot.shortCircuitSnapshot = {
        shortCircuitGate: normalizeText(cPolicyDecisionLite.shortCircuitGate),
        shortCircuitAction: normalizeText(cPolicyDecisionLite.shortCircuitAction),
        shortCircuitReasonCode: normalizeText(cPolicyDecisionLite.shortCircuitReasonCode)
      }
    }

    const policyWarnings = Array.isArray(cPolicyDecisionLite.policyWarnings)
      ? cPolicyDecisionLite.policyWarnings
      : []
    if (policyWarnings.length > 0) {
      snapshot.policyWarnings = stableClone(policyWarnings)
    }

    return snapshot
  }

  return {
    buildPolicyAuditSnapshot
  }
}
