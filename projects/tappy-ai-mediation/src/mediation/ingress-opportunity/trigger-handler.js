import crypto from 'node:crypto'

export const A_TRIGGER_ACTIONS = Object.freeze({
  CREATE_OPPORTUNITY: 'create_opportunity',
  NO_OP: 'no_op',
  REJECT: 'reject'
})

export const A_TRIGGER_OUTCOMES = Object.freeze({
  ELIGIBLE: 'opportunity_eligible',
  INELIGIBLE: 'opportunity_ineligible',
  BLOCKED_BY_POLICY: 'opportunity_blocked_by_policy'
})

export const A_TRIGGER_REASON_CODES = Object.freeze({
  MISSING_REQUIRED_FIELD: 'a_trg_missing_required_field',
  INVALID_CONTEXT_STRUCTURE: 'a_trg_invalid_context_structure',
  INVALID_PLACEMENT_ID: 'a_trg_invalid_placement_id',
  INVALID_TRIGGER_TYPE: 'a_trg_invalid_trigger_type',
  DUPLICATE_INFLIGHT: 'a_trg_duplicate_inflight',
  DUPLICATE_REUSED_RESULT: 'a_trg_duplicate_reused_result',
  SOFT_BUDGET_EXCEEDED: 'a_trg_soft_budget_exceeded',
  HARD_BUDGET_EXCEEDED: 'a_trg_hard_budget_exceeded',
  CONFIG_TIMEOUT_WITH_SNAPSHOT: 'a_trg_config_timeout_with_snapshot',
  CONFIG_TIMEOUT_NO_SNAPSHOT: 'a_trg_config_timeout_no_snapshot',
  CONFIG_UNAVAILABLE_WITH_SNAPSHOT: 'a_trg_config_unavailable_with_snapshot',
  CONFIG_UNAVAILABLE_NO_SNAPSHOT: 'a_trg_config_unavailable_no_snapshot',
  CONFIG_VERSION_INVALID: 'a_trg_config_version_invalid',
  INTERNAL_UNAVAILABLE: 'a_trg_internal_unavailable'
})

const CANONICAL_TRIGGER_TYPES = new Set([
  'answer_end',
  'intent_spike',
  'session_resume',
  'tool_result_ready',
  'workflow_checkpoint',
  'manual_refresh',
  'policy_forced_trigger',
  'blocked_by_policy'
])

const DEFAULT_PLACEMENTS = new Set([
  'chat_from_answer_v1',
  'chat_intent_recommendation_v1',
  'search_parallel_v1'
])

const ACTION_BY_REASON = Object.freeze({
  [A_TRIGGER_REASON_CODES.MISSING_REQUIRED_FIELD]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.INVALID_CONTEXT_STRUCTURE]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.INVALID_PLACEMENT_ID]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.INVALID_TRIGGER_TYPE]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.DUPLICATE_INFLIGHT]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.NO_OP,
    errorAction: 'allow',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.DUPLICATE_REUSED_RESULT]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.NO_OP,
    errorAction: 'allow',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.SOFT_BUDGET_EXCEEDED]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.CREATE_OPPORTUNITY,
    errorAction: 'degrade',
    decisionOutcome: A_TRIGGER_OUTCOMES.ELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.HARD_BUDGET_EXCEEDED]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.BLOCKED_BY_POLICY,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.CONFIG_TIMEOUT_WITH_SNAPSHOT]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.CREATE_OPPORTUNITY,
    errorAction: 'degrade',
    decisionOutcome: A_TRIGGER_OUTCOMES.ELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.CONFIG_TIMEOUT_NO_SNAPSHOT]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.CONFIG_UNAVAILABLE_WITH_SNAPSHOT]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.CREATE_OPPORTUNITY,
    errorAction: 'degrade',
    decisionOutcome: A_TRIGGER_OUTCOMES.ELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.CONFIG_UNAVAILABLE_NO_SNAPSHOT]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.CONFIG_VERSION_INVALID]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.BLOCKED_BY_POLICY,
    retryable: false
  }),
  [A_TRIGGER_REASON_CODES.INTERNAL_UNAVAILABLE]: Object.freeze({
    triggerAction: A_TRIGGER_ACTIONS.REJECT,
    errorAction: 'reject',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: true
  })
})

const ELIGIBLE_TRIGGER_TYPES = new Set([
  'answer_end',
  'intent_spike',
  'session_resume',
  'tool_result_ready',
  'workflow_checkpoint',
  'policy_forced_trigger'
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function parseDateMs(value) {
  const ms = Date.parse(String(value || ''))
  return Number.isFinite(ms) ? ms : NaN
}

function normalizeRequest(input) {
  const request = isPlainObject(input) ? input : {}
  return {
    placementId: normalizeText(request.placementId),
    appContext: isPlainObject(request.appContext) ? request.appContext : null,
    triggerContext: isPlainObject(request.triggerContext) ? request.triggerContext : null,
    sdkVersion: normalizeText(request.sdkVersion),
    ingressEnvelopeVersion: normalizeText(request.ingressEnvelopeVersion),
    triggerContractVersion: normalizeText(request.triggerContractVersion),
    clientRequestId: normalizeText(request.clientRequestId),
    conversationTurnIdOrNA: normalizeText(request.conversationTurnIdOrNA),
    intentScoreOrNA: request.intentScoreOrNA,
    traceHintOrNA: normalizeText(request.traceHintOrNA),
    experimentTagsOrNA: Array.isArray(request.experimentTagsOrNA)
      ? request.experimentTagsOrNA.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    extensions: isPlainObject(request.extensions) ? request.extensions : undefined
  }
}

function buildTraceInitLite(normalizedRequest) {
  const appId = normalizeText(normalizedRequest.appContext?.appId)
  const sessionId = normalizeText(normalizedRequest.appContext?.sessionId)
  const triggerType = normalizeText(normalizedRequest.triggerContext?.triggerType)
  const triggerAt = normalizeText(normalizedRequest.triggerContext?.triggerAt)

  const requestKeySeed = [appId, sessionId, normalizedRequest.placementId, triggerType, triggerAt].join('|')
  const requestKey = `req_${sha256(requestKeySeed).slice(0, 16)}`
  const attemptKey = `att_${sha256(`${requestKey}|${normalizedRequest.triggerContractVersion}`).slice(0, 16)}`
  const traceKey = normalizedRequest.traceHintOrNA
    ? normalizedRequest.traceHintOrNA
    : `tr_${sha256(`${requestKey}|${normalizedRequest.ingressEnvelopeVersion}`).slice(0, 16)}`

  return {
    traceKey,
    requestKey,
    attemptKey
  }
}

function decideReasonCode(normalizedRequest) {
  const triggerContext = normalizedRequest.triggerContext || {}
  const triggerType = normalizeText(triggerContext.triggerType)

  const dedupState = normalizeText(triggerContext.dedupState).toLowerCase()
  if (dedupState === 'inflight_duplicate') {
    return A_TRIGGER_REASON_CODES.DUPLICATE_INFLIGHT
  }
  if (dedupState === 'reused_result') {
    return A_TRIGGER_REASON_CODES.DUPLICATE_REUSED_RESULT
  }

  const budgetState = normalizeText(triggerContext.budgetState).toLowerCase()
  if (budgetState === 'soft_exceeded') {
    return A_TRIGGER_REASON_CODES.SOFT_BUDGET_EXCEEDED
  }
  if (budgetState === 'hard_exceeded') {
    return A_TRIGGER_REASON_CODES.HARD_BUDGET_EXCEEDED
  }

  const configState = normalizeText(triggerContext.configState).toLowerCase()
  if (configState === 'timeout_with_snapshot') {
    return A_TRIGGER_REASON_CODES.CONFIG_TIMEOUT_WITH_SNAPSHOT
  }
  if (configState === 'timeout_no_snapshot') {
    return A_TRIGGER_REASON_CODES.CONFIG_TIMEOUT_NO_SNAPSHOT
  }
  if (configState === 'unavailable_with_snapshot') {
    return A_TRIGGER_REASON_CODES.CONFIG_UNAVAILABLE_WITH_SNAPSHOT
  }
  if (configState === 'unavailable_no_snapshot') {
    return A_TRIGGER_REASON_CODES.CONFIG_UNAVAILABLE_NO_SNAPSHOT
  }
  if (configState === 'version_invalid') {
    return A_TRIGGER_REASON_CODES.CONFIG_VERSION_INVALID
  }
  if (configState === 'internal_unavailable') {
    return A_TRIGGER_REASON_CODES.INTERNAL_UNAVAILABLE
  }

  if (triggerType === 'manual_refresh') {
    return A_TRIGGER_REASON_CODES.DUPLICATE_REUSED_RESULT
  }
  if (triggerType === 'blocked_by_policy') {
    return A_TRIGGER_REASON_CODES.HARD_BUDGET_EXCEEDED
  }

  return 'a_trg_map_trigger_eligible'
}

function resolveActionPlan(reasonCode, triggerType) {
  const reasonPlan = ACTION_BY_REASON[reasonCode]
  if (reasonPlan) return reasonPlan

  if (ELIGIBLE_TRIGGER_TYPES.has(triggerType)) {
    return {
      triggerAction: A_TRIGGER_ACTIONS.CREATE_OPPORTUNITY,
      errorAction: 'allow',
      decisionOutcome: A_TRIGGER_OUTCOMES.ELIGIBLE,
      retryable: false
    }
  }

  return {
    triggerAction: A_TRIGGER_ACTIONS.NO_OP,
    errorAction: 'allow',
    decisionOutcome: A_TRIGGER_OUTCOMES.INELIGIBLE,
    retryable: false
  }
}

function buildResult(normalizedRequest, reasonCode, actionPlan, options = {}) {
  const nowFn = options.nowFn || (() => Date.now())
  const traceInitLite = buildTraceInitLite(normalizedRequest)
  const clientRequestId = normalizedRequest.clientRequestId
    ? normalizedRequest.clientRequestId
    : `cli_${sha256(`${traceInitLite.requestKey}|${normalizeText(normalizedRequest.appContext?.requestAt)}`).slice(0, 12)}`
  const opportunityRefOrNA = actionPlan.triggerAction === A_TRIGGER_ACTIONS.CREATE_OPPORTUNITY
    ? `opp_${sha256(`${traceInitLite.requestKey}|${normalizedRequest.placementId}`).slice(0, 16)}`
    : 'NA'

  return {
    requestAccepted: actionPlan.triggerAction !== A_TRIGGER_ACTIONS.REJECT,
    triggerAction: actionPlan.triggerAction,
    decisionOutcome: actionPlan.decisionOutcome,
    reasonCode,
    errorAction: actionPlan.errorAction,
    traceInitLite,
    opportunityRefOrNA,
    retryable: actionPlan.retryable,
    returnedAt: new Date(nowFn()).toISOString(),
    triggerContractVersion: normalizedRequest.triggerContractVersion,
    generatedClientRequestIdOrNA: normalizedRequest.clientRequestId ? 'NA' : clientRequestId,
    ...(normalizedRequest.extensions ? { debugHints: { hasExtensions: true } } : {})
  }
}

function validateRequiredAndStructure(normalizedRequest, options = {}) {
  if (!normalizedRequest.placementId) {
    return A_TRIGGER_REASON_CODES.MISSING_REQUIRED_FIELD
  }
  if (!normalizedRequest.appContext || !normalizedRequest.triggerContext) {
    return A_TRIGGER_REASON_CODES.INVALID_CONTEXT_STRUCTURE
  }

  const appContext = normalizedRequest.appContext
  const triggerContext = normalizedRequest.triggerContext
  const appRequired = ['appId', 'sessionId', 'channelType', 'requestAt']
  for (const field of appRequired) {
    if (!normalizeText(appContext[field])) {
      return A_TRIGGER_REASON_CODES.MISSING_REQUIRED_FIELD
    }
  }
  const triggerRequired = ['triggerType', 'triggerAt']
  for (const field of triggerRequired) {
    if (!normalizeText(triggerContext[field])) {
      return A_TRIGGER_REASON_CODES.MISSING_REQUIRED_FIELD
    }
  }
  if (!normalizedRequest.sdkVersion || !normalizedRequest.ingressEnvelopeVersion || !normalizedRequest.triggerContractVersion) {
    return A_TRIGGER_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  const requestAtMs = parseDateMs(appContext.requestAt)
  const triggerAtMs = parseDateMs(triggerContext.triggerAt)
  if (!Number.isFinite(requestAtMs) || !Number.isFinite(triggerAtMs)) {
    return A_TRIGGER_REASON_CODES.INVALID_CONTEXT_STRUCTURE
  }

  const clockSkewLimitSec = Number.isFinite(options.clockSkewLimitSec) ? options.clockSkewLimitSec : 300
  if (Math.abs(triggerAtMs - requestAtMs) > clockSkewLimitSec * 1000) {
    return A_TRIGGER_REASON_CODES.INVALID_CONTEXT_STRUCTURE
  }

  const placementExists = typeof options.isPlacementAvailable === 'function'
    ? options.isPlacementAvailable(normalizedRequest.placementId)
    : DEFAULT_PLACEMENTS.has(normalizedRequest.placementId)
  if (!placementExists) {
    return A_TRIGGER_REASON_CODES.INVALID_PLACEMENT_ID
  }

  const triggerType = normalizeText(triggerContext.triggerType)
  if (!CANONICAL_TRIGGER_TYPES.has(triggerType)) {
    return A_TRIGGER_REASON_CODES.INVALID_TRIGGER_TYPE
  }

  return ''
}

export function createTriggerHandler(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const isPlacementAvailable = typeof options.isPlacementAvailable === 'function'
    ? options.isPlacementAvailable
    : (placementId) => DEFAULT_PLACEMENTS.has(placementId)

  function trigger(requestInput) {
    const normalizedRequest = normalizeRequest(requestInput)
    const baseOptions = {
      ...options,
      nowFn,
      isPlacementAvailable
    }

    const validationReasonCode = validateRequiredAndStructure(normalizedRequest, baseOptions)
    if (validationReasonCode) {
      return buildResult(
        normalizedRequest,
        validationReasonCode,
        ACTION_BY_REASON[validationReasonCode],
        baseOptions
      )
    }

    const triggerType = normalizeText(normalizedRequest.triggerContext.triggerType)
    const reasonCode = decideReasonCode(normalizedRequest)
    const actionPlan = resolveActionPlan(reasonCode, triggerType)
    return buildResult(normalizedRequest, reasonCode, actionPlan, baseOptions)
  }

  return {
    trigger
  }
}
