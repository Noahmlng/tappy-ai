import { createPolicyAuditBuilder } from './policy-audit.js'
import {
  C_POLICY_ACTIONS,
  C_POLICY_REASON_CODES,
  C_SHORT_CIRCUIT_ACTIONS
} from './policy-engine.js'

export const C_PRIMARY_POLICY_REASON_CODES = Object.freeze({
  COMPLIANCE_HARD_BLOCK: 'c_compliance_hard_block',
  CONSENT_SCOPE_BLOCKED: 'c_consent_scope_blocked',
  FREQUENCY_HARD_CAP_BLOCK: 'c_frequency_hard_cap_block',
  CATEGORY_RESTRICTED_BLOCK: 'c_category_restricted_block',
  FREQUENCY_SOFT_CAP_DEGRADE: 'c_frequency_soft_cap_degrade',
  CATEGORY_SOFT_RISK_DEGRADE: 'c_category_soft_risk_degrade',
  POLICY_PASS: 'c_policy_pass',
  POLICY_DEGRADED_PASS: 'c_policy_degraded_pass',
  INVALID_INPUT_STATE: 'c_invalid_input_state',
  MISSING_REQUIRED_FIELD: 'c_missing_required_field',
  INVALID_REQUIRED_ENUM: 'c_invalid_required_enum',
  INVALID_VERSION_ANCHOR: 'c_invalid_version_anchor',
  POLICY_SNAPSHOT_MISSING: 'c_policy_snapshot_missing',
  POLICY_SNAPSHOT_EXPIRED: 'c_policy_snapshot_expired',
  POLICY_SNAPSHOT_INVALID: 'c_policy_snapshot_invalid',
  POLICY_CONFLICT_RESOLVED: 'c_policy_conflict_resolved',
  POLICY_ENGINE_ERROR: 'c_policy_engine_error'
})

export const C_REASON_CODE_ACTION_MAP = Object.freeze({
  [C_PRIMARY_POLICY_REASON_CODES.COMPLIANCE_HARD_BLOCK]: C_POLICY_ACTIONS.BLOCK,
  [C_PRIMARY_POLICY_REASON_CODES.CONSENT_SCOPE_BLOCKED]: C_POLICY_ACTIONS.BLOCK,
  [C_PRIMARY_POLICY_REASON_CODES.FREQUENCY_HARD_CAP_BLOCK]: C_POLICY_ACTIONS.BLOCK,
  [C_PRIMARY_POLICY_REASON_CODES.CATEGORY_RESTRICTED_BLOCK]: C_POLICY_ACTIONS.BLOCK,
  [C_PRIMARY_POLICY_REASON_CODES.FREQUENCY_SOFT_CAP_DEGRADE]: C_POLICY_ACTIONS.DEGRADE,
  [C_PRIMARY_POLICY_REASON_CODES.CATEGORY_SOFT_RISK_DEGRADE]: C_POLICY_ACTIONS.DEGRADE,
  [C_PRIMARY_POLICY_REASON_CODES.POLICY_PASS]: C_POLICY_ACTIONS.ALLOW,
  [C_PRIMARY_POLICY_REASON_CODES.POLICY_DEGRADED_PASS]: C_POLICY_ACTIONS.DEGRADE,
  [C_PRIMARY_POLICY_REASON_CODES.INVALID_INPUT_STATE]: C_POLICY_ACTIONS.REJECT,
  [C_PRIMARY_POLICY_REASON_CODES.MISSING_REQUIRED_FIELD]: C_POLICY_ACTIONS.REJECT,
  [C_PRIMARY_POLICY_REASON_CODES.INVALID_REQUIRED_ENUM]: C_POLICY_ACTIONS.REJECT,
  [C_PRIMARY_POLICY_REASON_CODES.INVALID_VERSION_ANCHOR]: C_POLICY_ACTIONS.REJECT,
  [C_PRIMARY_POLICY_REASON_CODES.POLICY_SNAPSHOT_MISSING]: C_POLICY_ACTIONS.REJECT,
  [C_PRIMARY_POLICY_REASON_CODES.POLICY_SNAPSHOT_EXPIRED]: C_POLICY_ACTIONS.REJECT,
  [C_PRIMARY_POLICY_REASON_CODES.POLICY_SNAPSHOT_INVALID]: C_POLICY_ACTIONS.REJECT,
  [C_PRIMARY_POLICY_REASON_CODES.POLICY_CONFLICT_RESOLVED]: 'inherit_final_action',
  [C_PRIMARY_POLICY_REASON_CODES.POLICY_ENGINE_ERROR]: C_POLICY_ACTIONS.REJECT
})

const ALLOWED_RENDER_MODES = new Set(['webview', 'video_vast_container'])
const ALLOWED_SOURCE_SELECTION_MODES = new Set(['all_except_blocked', 'allowlist_only'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
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

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item)).filter(Boolean)
}

function resolvePrimaryReasonCode(evaluationResult) {
  const finalAction = normalizeText(evaluationResult.finalPolicyAction)
  const winningGate = normalizeText(evaluationResult.winningGate)
  const shortCircuitReason = normalizeText(evaluationResult.shortCircuitReasonCode || evaluationResult.reasonCode)

  if (shortCircuitReason && shortCircuitReason !== C_POLICY_REASON_CODES.POLICY_DEGRADED_PASS) {
    return shortCircuitReason
  }

  if (finalAction === C_POLICY_ACTIONS.DEGRADE) {
    if (winningGate === 'frequency_cap_gate') return C_PRIMARY_POLICY_REASON_CODES.FREQUENCY_SOFT_CAP_DEGRADE
    if (winningGate === 'category_gate') return C_PRIMARY_POLICY_REASON_CODES.CATEGORY_SOFT_RISK_DEGRADE
    return C_PRIMARY_POLICY_REASON_CODES.POLICY_DEGRADED_PASS
  }

  if (finalAction === C_POLICY_ACTIONS.ALLOW) return C_PRIMARY_POLICY_REASON_CODES.POLICY_PASS
  if (finalAction === C_POLICY_ACTIONS.BLOCK) return C_PRIMARY_POLICY_REASON_CODES.CATEGORY_RESTRICTED_BLOCK
  return C_PRIMARY_POLICY_REASON_CODES.POLICY_ENGINE_ERROR
}

function normalizeConstraintsLite(cInput, finalAction, primaryReasonCode) {
  const policySnapshot = isPlainObject(cInput.policySnapshotLite) ? cInput.policySnapshotLite : {}
  const policyConstraintsLite = isPlainObject(policySnapshot.policyConstraintsLite)
    ? policySnapshot.policyConstraintsLite
    : {}
  const source = isPlainObject(policyConstraintsLite.constraintsLite)
    ? policyConstraintsLite.constraintsLite
    : policyConstraintsLite

  const categoryConstraints = isPlainObject(source.categoryConstraints) ? source.categoryConstraints : {}
  const personalizationConstraints = isPlainObject(source.personalizationConstraints) ? source.personalizationConstraints : {}
  const renderConstraints = isPlainObject(source.renderConstraints) ? source.renderConstraints : {}
  const sourceConstraints = isPlainObject(source.sourceConstraints) ? source.sourceConstraints : {}

  const blockedSourceIds = normalizeStringArray(sourceConstraints.blockedSourceIds)
  const allowedSourceIdsRaw = normalizeStringArray(sourceConstraints.allowedSourceIds)
  const allowedSourceIds = allowedSourceIdsRaw.filter((sourceId) => !blockedSourceIds.includes(sourceId))

  let sourceSelectionMode = normalizeText(sourceConstraints.sourceSelectionMode)
  if (!ALLOWED_SOURCE_SELECTION_MODES.has(sourceSelectionMode)) {
    sourceSelectionMode = 'all_except_blocked'
  }
  if (sourceSelectionMode === 'allowlist_only' && allowedSourceIds.length === 0) {
    sourceSelectionMode = 'all_except_blocked'
  }

  const disallowRenderModes = normalizeStringArray(renderConstraints.disallowRenderModes)
    .filter((mode) => ALLOWED_RENDER_MODES.has(mode))

  const constraintReasonCodes = normalizeStringArray(source.constraintReasonCodes)
  if (finalAction === C_POLICY_ACTIONS.DEGRADE || finalAction === C_POLICY_ACTIONS.BLOCK) {
    if (!constraintReasonCodes.includes(primaryReasonCode)) {
      constraintReasonCodes.push(primaryReasonCode)
    }
  }

  return {
    constraintSetVersion: normalizeText(source.constraintSetVersion) || 'c_constraints_v1',
    categoryConstraints: {
      bcat: normalizeStringArray(categoryConstraints.bcat),
      badv: normalizeStringArray(categoryConstraints.badv)
    },
    personalizationConstraints: {
      nonPersonalizedOnly: personalizationConstraints.nonPersonalizedOnly === true
    },
    renderConstraints: {
      disallowRenderModes
    },
    sourceConstraints: {
      sourceSelectionMode,
      allowedSourceIds,
      blockedSourceIds
    },
    constraintReasonCodes
  }
}

function buildStateUpdate(finalPolicyAction) {
  if (finalPolicyAction === C_POLICY_ACTIONS.ALLOW) {
    return {
      fromState: 'received',
      toState: 'routed',
      stateReasonCode: 'policy_passed'
    }
  }

  if (finalPolicyAction === C_POLICY_ACTIONS.DEGRADE) {
    return {
      fromState: 'received',
      toState: 'routed',
      stateReasonCode: 'policy_degraded_pass'
    }
  }

  return {
    fromState: 'received',
    toState: 'error',
    stateReasonCode: 'policy_blocked'
  }
}

function normalizeSecondaryReasonCodes(evaluationResult, primaryPolicyReasonCode) {
  const secondary = []
  const candidateA = normalizeText(evaluationResult.policyConflictReasonCode)
  const candidateB = normalizeText(evaluationResult.reasonCode)

  if (candidateA && candidateA !== primaryPolicyReasonCode) secondary.push(candidateA)
  if (candidateB && candidateB !== primaryPolicyReasonCode) secondary.push(candidateB)

  return [...new Set(secondary)]
}

export function createPolicyOutputBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const auditBuilder = options.auditBuilder || createPolicyAuditBuilder({ nowFn })

  function buildOutput(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const cInput = isPlainObject(request.cInput) ? request.cInput : {}
    const evaluationResult = isPlainObject(request.evaluationResult) ? request.evaluationResult : {}

    const finalPolicyAction = normalizeText(evaluationResult.finalPolicyAction)
    const decisionTimestamp = normalizeText(evaluationResult.decisionTimestamp) || nowIso(nowFn)
    const traceContext = isPlainObject(cInput.TraceContext) ? cInput.TraceContext : {}
    const policySnapshot = isPlainObject(cInput.policySnapshotLite) ? cInput.policySnapshotLite : {}
    const isRoutable = finalPolicyAction === C_POLICY_ACTIONS.ALLOW || finalPolicyAction === C_POLICY_ACTIONS.DEGRADE
    const primaryPolicyReasonCode = resolvePrimaryReasonCode(evaluationResult)
    const constraintsLite = normalizeConstraintsLite(cInput, finalPolicyAction, primaryPolicyReasonCode)
    const stateUpdate = buildStateUpdate(finalPolicyAction)
    const adDecisionLite = isRoutable
      ? {
          allowAd: true,
          decisionSemantic: 'serve_ad',
          noAdReasonCode: ''
        }
      : {
          allowAd: false,
          decisionSemantic: 'no_ad',
          noAdReasonCode: primaryPolicyReasonCode
        }
    const secondaryPolicyReasonCodes = normalizeSecondaryReasonCodes(evaluationResult, primaryPolicyReasonCode)
    const shortCircuitAction = normalizeText(evaluationResult.shortCircuitAction) ||
      (isRoutable ? C_SHORT_CIRCUIT_ACTIONS.ALLOW : C_SHORT_CIRCUIT_ACTIONS.BLOCK)

    const cPolicyDecisionLite = {
      opportunityKey: normalizeText(cInput.opportunityKey),
      traceKey: normalizeText(evaluationResult.traceKey || traceContext.traceKey),
      requestKey: normalizeText(evaluationResult.requestKey || traceContext.requestKey),
      attemptKey: normalizeText(evaluationResult.attemptKey || traceContext.attemptKey),
      finalPolicyAction,
      isRoutable,
      policyDecisionReasonCode: primaryPolicyReasonCode,
      primaryPolicyReasonCode,
      winningGate: normalizeText(evaluationResult.winningGate),
      winningRuleId: normalizeText(evaluationResult.winningRuleId),
      decisionTimestamp,
      policyPackVersion: normalizeText(evaluationResult.policyPackVersion || policySnapshot.policyPackVersion),
      policyRuleVersion: normalizeText(evaluationResult.policyRuleVersion || policySnapshot.policyRuleVersion),
      policySnapshotId: normalizeText(evaluationResult.policySnapshotId || policySnapshot.policySnapshotId),
      policySnapshotVersion: normalizeText(evaluationResult.policySnapshotVersion || policySnapshot.policySnapshotVersion),
      constraintsLite,
      adDecisionLite,
      stateUpdate,
      shortCircuitAction,
      shortCircuitGate: normalizeText(evaluationResult.shortCircuitGate || evaluationResult.winningGate),
      shortCircuitReasonCode: normalizeText(evaluationResult.shortCircuitReasonCode || primaryPolicyReasonCode),
      policyWarnings: stableClone(cInput.mappingWarnings || []),
      secondaryPolicyReasonCodes
    }

    const policyAuditSnapshotLite = auditBuilder.buildPolicyAuditSnapshot({
      cInput,
      evaluationResult,
      cPolicyDecisionLite,
      policyEvaluationStartAt: normalizeText(request.policyEvaluationStartAt),
      policyEvaluationEndAt: normalizeText(request.policyEvaluationEndAt)
    })
    cPolicyDecisionLite.policyAuditSnapshotLite = policyAuditSnapshotLite

    if (isRoutable) {
      cPolicyDecisionLite.routableOpportunityLite = {
        opportunityKey: cPolicyDecisionLite.opportunityKey,
        traceKey: cPolicyDecisionLite.traceKey,
        requestKey: cPolicyDecisionLite.requestKey,
        attemptKey: cPolicyDecisionLite.attemptKey,
        constraintsLite: stableClone(constraintsLite),
        policyDegraded: finalPolicyAction === C_POLICY_ACTIONS.DEGRADE,
        adDecisionLite: stableClone(adDecisionLite)
      }
      cPolicyDecisionLite.policyBlockedResultLite = null
    } else {
      cPolicyDecisionLite.routableOpportunityLite = null
      cPolicyDecisionLite.policyBlockedResultLite = {
        opportunityKey: cPolicyDecisionLite.opportunityKey,
        traceKey: cPolicyDecisionLite.traceKey,
        requestKey: cPolicyDecisionLite.requestKey,
        attemptKey: cPolicyDecisionLite.attemptKey,
        noAdReasonCode: primaryPolicyReasonCode,
        constraintsLite: stableClone(constraintsLite),
        adDecisionLite: stableClone(adDecisionLite)
      }
    }

    return cPolicyDecisionLite
  }

  return {
    buildOutput
  }
}
