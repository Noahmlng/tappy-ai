export const E_CANONICAL_REASON_CODES = Object.freeze({
  NO_CANDIDATE_INPUT: 'e_nf_no_candidate_input',
  ALL_CANDIDATE_REJECTED: 'e_nf_all_candidate_rejected',
  CAPABILITY_GATE_REJECTED: 'e_nf_capability_gate_rejected',
  POLICY_BLOCKED: 'e_nf_policy_blocked',
  DISCLOSURE_BLOCKED: 'e_nf_disclosure_blocked',
  FREQUENCY_CAPPED: 'e_nf_frequency_capped',
  INVALID_COMPOSE_INPUT: 'e_er_invalid_compose_input',
  INVALID_VERSION_ANCHOR: 'e_er_invalid_version_anchor',
  TRACKING_CONTRACT_BROKEN: 'e_er_tracking_contract_broken',
  COMPOSE_RUNTIME_FAILURE: 'e_er_compose_runtime_failure',
  COMPOSE_TIMEOUT: 'e_er_compose_timeout',
  UNKNOWN_ERROR: 'e_er_unknown'
})

export const E_ERROR_DEGRADE_REASON_CODES = Object.freeze({
  DECISION_READY: 'e_error_degrade_decision_ready',
  INVALID_INPUT: 'e_compose_invalid_structure',
  INVALID_VERSION_ANCHOR: 'e_compose_invalid_version_anchor',
  INCONSISTENT_CANONICAL_STATUS: 'e_error_degrade_inconsistent_status'
})

const RAW_TO_CANONICAL = new Map([
  ['e_no_candidate_input', E_CANONICAL_REASON_CODES.NO_CANDIDATE_INPUT],
  ['e_candidate_all_rejected', E_CANONICAL_REASON_CODES.ALL_CANDIDATE_REJECTED],
  ['e_material_all_rejected', E_CANONICAL_REASON_CODES.ALL_CANDIDATE_REJECTED],
  ['e_gate_all_modes_rejected', E_CANONICAL_REASON_CODES.CAPABILITY_GATE_REJECTED],
  ['e_gate_policy_mode_disallowed', E_CANONICAL_REASON_CODES.CAPABILITY_GATE_REJECTED],
  ['e_policy_hard_blocked', E_CANONICAL_REASON_CODES.POLICY_BLOCKED],
  ['e_policy_sensitive_scene_blocked', E_CANONICAL_REASON_CODES.POLICY_BLOCKED],
  ['e_disclosure_all_rejected', E_CANONICAL_REASON_CODES.DISCLOSURE_BLOCKED],
  ['e_ui_frequency_hard_cap', E_CANONICAL_REASON_CODES.FREQUENCY_CAPPED],
  ['e_compose_invalid_structure', E_CANONICAL_REASON_CODES.INVALID_COMPOSE_INPUT],
  ['e_compose_inconsistent_auction_result', E_CANONICAL_REASON_CODES.INVALID_COMPOSE_INPUT],
  ['e_candidate_not_renderable_after_compose', E_CANONICAL_REASON_CODES.ALL_CANDIDATE_REJECTED],
  ['e_compose_winner_binding_invalid', E_CANONICAL_REASON_CODES.INVALID_COMPOSE_INPUT],
  ['e_compose_invalid_version_anchor', E_CANONICAL_REASON_CODES.INVALID_VERSION_ANCHOR],
  ['e_tracking_injection_missing', E_CANONICAL_REASON_CODES.TRACKING_CONTRACT_BROKEN],
  ['e_render_compose_error', E_CANONICAL_REASON_CODES.COMPOSE_RUNTIME_FAILURE],
  ['e_render_terminal_missing_timeout', E_CANONICAL_REASON_CODES.COMPOSE_TIMEOUT]
])

const FAIL_STRATEGY_MATRIX = Object.freeze({
  drop_candidate_and_continue: 'fail_open',
  degrade_mode_chain: 'fail_open',
  block_render: 'fail_closed',
  terminal_error: 'fail_closed',
  return_error_safe_payload: 'mixed'
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

function normalizeRawReasonCode(rawReasonCode) {
  const code = normalizeText(rawReasonCode)
  if (!code) return ''
  if (RAW_TO_CANONICAL.has(code)) return code
  if (code.startsWith('e_nf_') || code.startsWith('e_er_')) return code
  return code
}

function toCanonicalReasonCode(rawReasonCode) {
  const normalized = normalizeRawReasonCode(rawReasonCode)
  if (!normalized) return E_CANONICAL_REASON_CODES.UNKNOWN_ERROR
  if (RAW_TO_CANONICAL.has(normalized)) {
    return RAW_TO_CANONICAL.get(normalized)
  }
  if (normalized.startsWith('e_nf_') || normalized.startsWith('e_er_')) {
    return normalized
  }
  return E_CANONICAL_REASON_CODES.UNKNOWN_ERROR
}

function determineAction(rawReasonCode, canonicalReasonCode) {
  const raw = normalizeText(rawReasonCode)
  if (
    raw === 'e_material_missing_required' ||
    raw === 'e_material_invalid_format' ||
    raw === 'e_candidate_not_renderable_after_compose'
  ) {
    return 'drop_candidate_and_continue'
  }
  if (raw === 'e_gate_all_modes_rejected' || raw === 'e_gate_policy_mode_disallowed') {
    return 'degrade_mode_chain'
  }
  if (
    raw === 'e_policy_hard_blocked' ||
    raw === 'e_policy_sensitive_scene_blocked' ||
    raw === 'e_disclosure_all_rejected' ||
    raw === 'e_ui_size_out_of_bound' ||
    raw === 'e_ui_frequency_hard_cap' ||
    raw === 'e_ui_sensitive_scene_blocked'
  ) {
    return 'block_render'
  }
  if (
    raw === 'e_compose_invalid_structure' ||
    raw === 'e_compose_inconsistent_auction_result' ||
    raw === 'e_compose_winner_binding_invalid' ||
    raw === 'e_compose_invalid_version_anchor' ||
    raw === 'e_tracking_injection_missing'
  ) {
    return 'terminal_error'
  }
  if (raw === 'e_render_compose_error' || raw === 'e_render_terminal_missing_timeout') {
    return 'return_error_safe_payload'
  }

  if (canonicalReasonCode.startsWith('e_er_')) return 'terminal_error'
  return 'degrade_mode_chain'
}

function determineStatusAndReason(actionsTaken = []) {
  const canonicalCodes = actionsTaken.map((item) => normalizeText(item.canonicalReasonCode)).filter(Boolean)
  const firstError = canonicalCodes.find((code) => code.startsWith('e_er_'))
  if (firstError) {
    return {
      finalDeliveryStatus: 'error',
      finalCanonicalReasonCode: firstError
    }
  }

  const firstNoFill = canonicalCodes.find((code) => code.startsWith('e_nf_'))
  if (firstNoFill) {
    return {
      finalDeliveryStatus: 'no_fill',
      finalCanonicalReasonCode: firstNoFill
    }
  }

  return {
    finalDeliveryStatus: 'error',
    finalCanonicalReasonCode: E_CANONICAL_REASON_CODES.UNKNOWN_ERROR
  }
}

function determineFailStrategy(actionsTaken = []) {
  const actionSet = new Set(actionsTaken.map((item) => normalizeText(item.action)))
  if (actionSet.size === 0) return 'fail_closed'
  if (actionSet.has('return_error_safe_payload')) return 'mixed'
  if (actionSet.has('terminal_error')) return 'fail_closed'
  if (actionSet.has('block_render')) return 'fail_closed'
  if (actionSet.has('degrade_mode_chain') || actionSet.has('drop_candidate_and_continue')) return 'fail_open'
  return 'mixed'
}

function expectedStatusByPrefix(canonicalReasonCode) {
  if (normalizeText(canonicalReasonCode).startsWith('e_nf_')) return 'no_fill'
  if (normalizeText(canonicalReasonCode).startsWith('e_er_')) return 'error'
  return 'error'
}

function requiredTraceKeys(traceKeys = {}) {
  return [
    normalizeText(traceKeys.traceKey),
    normalizeText(traceKeys.requestKey),
    normalizeText(traceKeys.attemptKey),
    normalizeText(traceKeys.opportunityKey)
  ].every(Boolean)
}

export function createErrorDegradeEngine(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const decisionRuleVersion = normalizeText(options.decisionRuleVersion) || 'e_error_degrade_rule_v1'

  function decide(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const traceKeys = isPlainObject(request.traceKeys) ? request.traceKeys : {}
    if (!requiredTraceKeys(traceKeys)) {
      return {
        ok: false,
        reasonCode: E_ERROR_DEGRADE_REASON_CODES.INVALID_INPUT,
        eErrorDegradeDecisionSnapshotLite: null
      }
    }

    const versionSnapshot = isPlainObject(request.versionSnapshot) ? request.versionSnapshot : {}
    if (!normalizeText(versionSnapshot.renderPolicyVersion) || !normalizeText(versionSnapshot.decisionRuleVersion || decisionRuleVersion)) {
      return {
        ok: false,
        reasonCode: E_ERROR_DEGRADE_REASON_CODES.INVALID_VERSION_ANCHOR,
        eErrorDegradeDecisionSnapshotLite: null
      }
    }

    const sourceActions = Array.isArray(request.actionsTaken)
      ? request.actionsTaken
      : []
    const rawReasonCodes = Array.isArray(request.rawReasonCodes)
      ? request.rawReasonCodes
      : []

    const actionsTaken = []
    for (const action of sourceActions) {
      const stage = normalizeText(action?.stage) || 'unknown_stage'
      const rawReasonCode = normalizeText(action?.rawReasonCode)
      const canonicalReasonCode = toCanonicalReasonCode(rawReasonCode)
      const resolvedAction = normalizeText(action?.action) || determineAction(rawReasonCode, canonicalReasonCode)
      actionsTaken.push({
        stage,
        action: resolvedAction,
        rawReasonCode,
        canonicalReasonCode
      })
    }
    if (actionsTaken.length === 0) {
      for (let index = 0; index < rawReasonCodes.length; index += 1) {
        const rawReasonCode = normalizeText(rawReasonCodes[index])
        const canonicalReasonCode = toCanonicalReasonCode(rawReasonCode)
        actionsTaken.push({
          stage: `stage_${index + 1}`,
          action: determineAction(rawReasonCode, canonicalReasonCode),
          rawReasonCode,
          canonicalReasonCode
        })
      }
    }

    const final = determineStatusAndReason(actionsTaken)
    const expectedStatus = expectedStatusByPrefix(final.finalCanonicalReasonCode)
    if (expectedStatus !== final.finalDeliveryStatus) {
      return {
        ok: false,
        reasonCode: E_ERROR_DEGRADE_REASON_CODES.INCONSISTENT_CANONICAL_STATUS,
        eErrorDegradeDecisionSnapshotLite: null
      }
    }

    const failureClass = final.finalDeliveryStatus === 'error'
      ? 'error'
      : (final.finalDeliveryStatus === 'no_fill' ? 'no_fill' : 'none')
    const failStrategy = determineFailStrategy(actionsTaken)
    const modeDegradePath = Array.isArray(request.modeDegradePath)
      ? request.modeDegradePath
      : []

    const eErrorDegradeDecisionSnapshotLite = {
      traceKeys: {
        traceKey: normalizeText(traceKeys.traceKey),
        requestKey: normalizeText(traceKeys.requestKey),
        attemptKey: normalizeText(traceKeys.attemptKey),
        opportunityKey: normalizeText(traceKeys.opportunityKey)
      },
      finalDeliveryStatus: final.finalDeliveryStatus,
      finalCanonicalReasonCode: final.finalCanonicalReasonCode,
      failureClass,
      failStrategy,
      actionsTaken,
      modeDegradePath,
      decisionRuleVersion: normalizeText(versionSnapshot.decisionRuleVersion) || decisionRuleVersion,
      decidedAt: nowIso(nowFn)
    }

    return {
      ok: true,
      reasonCode: E_ERROR_DEGRADE_REASON_CODES.DECISION_READY,
      finalDeliveryStatus: final.finalDeliveryStatus,
      finalCanonicalReasonCode: final.finalCanonicalReasonCode,
      failureClass,
      failStrategy,
      eErrorDegradeDecisionSnapshotLite
    }
  }

  return {
    decide
  }
}
