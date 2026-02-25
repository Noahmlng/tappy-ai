import crypto from 'node:crypto'

export const H_CONFIG_FAILURE_SCENARIOS = Object.freeze({
  CONFIG_TIMEOUT: 'config_timeout',
  CONFIG_UNAVAILABLE: 'config_unavailable',
  CONFIG_VERSION_INVALID: 'config_version_invalid'
})

export const H_CONFIG_FAILURE_REASON_CODES = Object.freeze({
  FAIL_OPEN_TIMEOUT_STALE_GRACE: 'h_cfg_fail_open_timeout_stale_grace',
  FAIL_OPEN_UNAVAILABLE_STABLE_SNAPSHOT: 'h_cfg_fail_open_unavailable_stable_snapshot',
  FAIL_CLOSED_NO_STABLE_SNAPSHOT: 'h_cfg_fail_closed_no_stable_snapshot',
  FAIL_CLOSED_VERSION_INVALID: 'h_cfg_fail_closed_version_invalid',
  FAIL_CLOSED_ANCHOR_INVALID: 'h_cfg_fail_closed_anchor_invalid',
  FAIL_CLOSED_POLICY_MISSING: 'h_cfg_fail_closed_policy_missing',
  FAIL_OPEN_RESTRICTED_ROUTE_MODE: 'h_cfg_fail_open_restricted_route_mode',
  FAIL_OPEN_RESTRICTED_TEMPLATE_MODE: 'h_cfg_fail_open_restricted_template_mode',
  FAIL_CLOSED_CONTRACT_VIOLATION: 'h_cfg_fail_closed_contract_violation'
})

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

function stableStringify(value) {
  return JSON.stringify(stableClone(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function nowIso(input) {
  const date = new Date(String(input || Date.now()))
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }
  return date.toISOString()
}

function buildModuleActionsForFailOpen(scenario) {
  if (scenario === H_CONFIG_FAILURE_SCENARIOS.CONFIG_TIMEOUT) {
    return {
      moduleAAction: 'degrade_with_stable_snapshot',
      moduleBAction: 'allow_if_resolved_snapshot_present',
      moduleCAction: 'run_minimal_policy_set',
      moduleDAction: 'use_last_stable_policy_and_compatible_adapters',
      moduleEAction: 'allow_only_if_candidate_and_policy_pass',
      moduleFAction: 'write_audit_with_failure_mode',
      moduleGAction: 'archive_and_replay_index_allowed',
      moduleHAction: 'emit_failure_mode_and_matrix_snapshot'
    }
  }

  return {
    moduleAAction: 'degrade_with_stable_snapshot',
    moduleBAction: 'allow_if_resolved_snapshot_present',
    moduleCAction: 'run_strictest_default_policy',
    moduleDAction: 'restricted_route_main_plus_fallback',
    moduleEAction: 'restricted_template_whitelist_only',
    moduleFAction: 'write_facts_and_failure_facts',
    moduleGAction: 'archive_and_replay_index_allowed',
    moduleHAction: 'emit_unavailable_alert_and_circuit_assessment'
  }
}

function buildModuleActionsForFailClosed(scenario) {
  if (scenario === H_CONFIG_FAILURE_SCENARIOS.CONFIG_VERSION_INVALID) {
    return {
      moduleAAction: 'reject_before_module_b',
      moduleBAction: 'reject_without_mapping_inference',
      moduleCAction: 'reject_and_preserve_reason',
      moduleDAction: 'skip_supply_request',
      moduleEAction: 'skip_delivery_plan',
      moduleFAction: 'write_reject_terminal_event',
      moduleGAction: 'archive_full_failure_snapshot',
      moduleHAction: 'quarantine_invalid_config_version'
    }
  }

  return {
    moduleAAction: 'reject_without_stable_snapshot',
    moduleBAction: 'reject_missing_resolved_snapshot',
    moduleCAction: 'reject_missing_policy_snapshot',
    moduleDAction: 'blocked_by_fail_closed',
    moduleEAction: 'return_error_or_no_fill',
    moduleFAction: 'write_reject_terminal_event',
    moduleGAction: 'archive_full_failure_snapshot',
    moduleHAction: 'emit_fail_closed_snapshot'
  }
}

function pickFailureDecision(input) {
  const scenario = normalizeText(input.configFailureScenario)
  const stableSnapshotRefOrNA = normalizeText(input.stableSnapshotRefOrNA) || 'NA'
  const hasStableSnapshot = stableSnapshotRefOrNA !== 'NA'

  if (scenario === H_CONFIG_FAILURE_SCENARIOS.CONFIG_VERSION_INVALID) {
    return {
      failureMode: 'fail_closed',
      primaryReasonCode: H_CONFIG_FAILURE_REASON_CODES.FAIL_CLOSED_VERSION_INVALID,
      secondaryReasonCodes: [],
      moduleActions: buildModuleActionsForFailClosed(scenario)
    }
  }

  if (scenario === H_CONFIG_FAILURE_SCENARIOS.CONFIG_TIMEOUT) {
    if (hasStableSnapshot) {
      return {
        failureMode: 'fail_open',
        primaryReasonCode: H_CONFIG_FAILURE_REASON_CODES.FAIL_OPEN_TIMEOUT_STALE_GRACE,
        secondaryReasonCodes: [],
        moduleActions: buildModuleActionsForFailOpen(scenario)
      }
    }
    return {
      failureMode: 'fail_closed',
      primaryReasonCode: H_CONFIG_FAILURE_REASON_CODES.FAIL_CLOSED_NO_STABLE_SNAPSHOT,
      secondaryReasonCodes: [],
      moduleActions: buildModuleActionsForFailClosed(scenario)
    }
  }

  if (scenario === H_CONFIG_FAILURE_SCENARIOS.CONFIG_UNAVAILABLE) {
    if (hasStableSnapshot) {
      return {
        failureMode: 'fail_open',
        primaryReasonCode: H_CONFIG_FAILURE_REASON_CODES.FAIL_OPEN_UNAVAILABLE_STABLE_SNAPSHOT,
        secondaryReasonCodes: [
          H_CONFIG_FAILURE_REASON_CODES.FAIL_OPEN_RESTRICTED_ROUTE_MODE,
          H_CONFIG_FAILURE_REASON_CODES.FAIL_OPEN_RESTRICTED_TEMPLATE_MODE
        ],
        moduleActions: buildModuleActionsForFailOpen(scenario)
      }
    }
    return {
      failureMode: 'fail_closed',
      primaryReasonCode: H_CONFIG_FAILURE_REASON_CODES.FAIL_CLOSED_NO_STABLE_SNAPSHOT,
      secondaryReasonCodes: [],
      moduleActions: buildModuleActionsForFailClosed(scenario)
    }
  }

  return {
    failureMode: 'fail_closed',
    primaryReasonCode: H_CONFIG_FAILURE_REASON_CODES.FAIL_CLOSED_CONTRACT_VIOLATION,
    secondaryReasonCodes: [],
    moduleActions: buildModuleActionsForFailClosed(scenario)
  }
}

export function evaluateFailureMatrix(input = {}) {
  const requestKey = normalizeText(input.requestKey)
  const traceKey = normalizeText(input.traceKey)
  const configFailureScenario = normalizeText(input.configFailureScenario)
  const failureDetectedAt = nowIso(input.failureDetectedAt)
  const failureAuditContractVersion = normalizeText(input.failureAuditContractVersion) || 'h_cfg_failure_audit_v1'
  const stableSnapshotRefOrNA = normalizeText(input.stableSnapshotRefOrNA) || 'NA'
  const lastStablePolicyIdOrNA = normalizeText(input.lastStablePolicyIdOrNA) || 'NA'
  const anchorHashOrNA = normalizeText(input.anchorHashOrNA) || 'NA'
  const detectedByModule = normalizeText(input.detectedByModule) || 'Module H'

  const decision = pickFailureDecision({
    configFailureScenario,
    stableSnapshotRefOrNA
  })

  const seed = {
    requestKey,
    traceKey,
    configFailureScenario,
    failureMode: decision.failureMode,
    primaryReasonCode: decision.primaryReasonCode,
    stableSnapshotRefOrNA,
    lastStablePolicyIdOrNA,
    anchorHashOrNA,
    failureDetectedAt
  }
  const snapshotId = `cfgfail_${sha256(stableStringify(seed)).slice(0, 16)}`

  return {
    snapshotId,
    requestKey,
    traceKey,
    configFailureScenario,
    failureDetectedAt,
    detectedByModule,
    failureMode: decision.failureMode,
    primaryReasonCode: decision.primaryReasonCode,
    secondaryReasonCodes: decision.secondaryReasonCodes,
    moduleActions: decision.moduleActions,
    stableSnapshotRefOrNA,
    lastStablePolicyIdOrNA,
    anchorHashOrNA,
    generatedAt: nowIso(Date.now()),
    failureAuditContractVersion
  }
}
