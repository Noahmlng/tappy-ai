export const E_DELIVERY_OUTPUT_REASON_CODES = Object.freeze({
  DELIVERY_READY: 'e_delivery_output_ready',
  MISSING_REQUIRED_FIELD: 'e_delivery_missing_required_field',
  INVALID_STATUS_CONSISTENCY: 'e_delivery_status_inconsistent',
  INVALID_STATE_TRANSITION: 'e_delivery_invalid_state_transition',
  INVALID_FINAL_REASON_CODE: 'e_delivery_invalid_final_reason_code',
  INVALID_ROUTE_CONSISTENCY: 'e_delivery_route_consistency_invalid',
  INVALID_VERSION_ANCHOR: 'e_delivery_invalid_version_anchor'
})

const ROUTE_OUTCOMES = new Set(['served_candidate', 'no_fill', 'error'])
const DELIVERY_STATUSES = new Set(['served', 'no_fill', 'error'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function getPath(obj, path) {
  const parts = String(path).split('.').filter(Boolean)
  let cursor = obj
  for (const part of parts) {
    if (!isPlainObject(cursor) || !(part in cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

function missingFields(obj, fields = []) {
  return fields.filter((field) => {
    const value = getPath(obj, field)
    return value === undefined || value === null || (typeof value === 'string' && !value.trim())
  })
}

function isCanonicalNoFill(code) {
  return normalizeText(code).startsWith('e_nf_')
}

function isCanonicalError(code) {
  return normalizeText(code).startsWith('e_er_')
}

function resolveFinalReasonCode(renderPlanLite, explicitReasonCode) {
  const explicit = normalizeText(explicitReasonCode)
  if (explicit) return explicit
  const fromDecision = normalizeText(renderPlanLite?.eErrorDegradeDecisionSnapshotLite?.finalCanonicalReasonCode)
  if (fromDecision) return fromDecision
  const status = normalizeText(renderPlanLite?.deliveryStatus)
  if (status === 'served') return 'e_delivery_served'
  if (status === 'no_fill') return 'e_nf_all_candidate_rejected'
  return 'e_er_unknown'
}

function resolveRouteConsistency({
  routeOutcome,
  deliveryStatus,
  finalReasonCode,
  winnerMatched
}) {
  if (!ROUTE_OUTCOMES.has(routeOutcome)) {
    return {
      ok: false,
      reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_ROUTE_CONSISTENCY
    }
  }
  if (!DELIVERY_STATUSES.has(deliveryStatus)) {
    return {
      ok: false,
      reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_STATUS_CONSISTENCY
    }
  }

  if ((routeOutcome === 'no_fill' || routeOutcome === 'error') && deliveryStatus === 'served') {
    return {
      ok: false,
      reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_ROUTE_CONSISTENCY
    }
  }

  if (routeOutcome === 'served_candidate' && deliveryStatus === 'served' && !winnerMatched) {
    return {
      ok: false,
      reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_ROUTE_CONSISTENCY
    }
  }

  if (routeOutcome === deliveryStatus || (routeOutcome === 'served_candidate' && deliveryStatus === 'served')) {
    return {
      ok: true,
      reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.DELIVERY_READY,
      consistencyAction: 'pass_through',
      consistencyReasonCode: 'none'
    }
  }

  if (routeOutcome === 'served_candidate' && (deliveryStatus === 'no_fill' || deliveryStatus === 'error')) {
    return {
      ok: true,
      reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.DELIVERY_READY,
      consistencyAction: 'override_by_e',
      consistencyReasonCode: normalizeText(finalReasonCode)
    }
  }

  return {
    ok: false,
    reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_ROUTE_CONSISTENCY
  }
}

function resolveWinnerMatch(dToEOutputLite, renderPlanLite) {
  const routeOutcome = normalizeText(dToEOutputLite?.routeConclusion?.routeOutcome)
  if (routeOutcome !== 'served_candidate') return true

  const winnerSourceId = normalizeText(dToEOutputLite?.auctionDecisionLite?.winner?.sourceId)
  const winnerCandidateId = normalizeText(dToEOutputLite?.auctionDecisionLite?.winner?.candidateId)
  if (!winnerSourceId || !winnerCandidateId || winnerSourceId === 'none' || winnerCandidateId === 'none') {
    return false
  }

  const selected = Array.isArray(renderPlanLite?.candidateConsumptionDecision?.selectedCandidateRefs)
    ? renderPlanLite.candidateConsumptionDecision.selectedCandidateRefs
    : []
  if (selected.length === 0) return false

  return selected.some((item) => (
    normalizeText(item?.sourceId) === winnerSourceId &&
    normalizeText(item?.candidateId) === winnerCandidateId
  ))
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

export function createDeliveryOutputBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const eDeliveryContractVersion = normalizeText(options.eDeliveryContractVersion) || 'e_delivery_contract_v1'
  const stateRuleVersion = normalizeText(options.stateRuleVersion) || 'e_state_transition_rule_v1'

  function buildDeliveryResponse(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const dToEOutputLite = isPlainObject(request.dToEOutputLite) ? request.dToEOutputLite : {}
    const renderPlanLite = isPlainObject(request.renderPlanLite) ? request.renderPlanLite : {}

    const missing = [
      ...missingFields(dToEOutputLite, [
        'opportunityKey',
        'traceKey',
        'requestKey',
        'attemptKey',
        'routeConclusion.routeOutcome',
        'routeConclusion.finalReasonCode'
      ]),
      ...missingFields(renderPlanLite, [
        'opportunityKey',
        'traceKey',
        'requestKey',
        'attemptKey',
        'responseReference',
        'deliveryStatus',
        'versionAnchors.renderPlanContractVersion'
      ])
    ]
    if (missing.length > 0) {
      return {
        ok: false,
        reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.MISSING_REQUIRED_FIELD,
        eDeliveryResponseLite: null,
        details: { missing: [...new Set(missing)] }
      }
    }

    const deliveryStatus = normalizeText(renderPlanLite.deliveryStatus)
    if (!DELIVERY_STATUSES.has(deliveryStatus)) {
      return {
        ok: false,
        reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_STATUS_CONSISTENCY,
        eDeliveryResponseLite: null
      }
    }

    const finalReasonCode = resolveFinalReasonCode(renderPlanLite, request.finalReasonCode)
    if (deliveryStatus === 'no_fill' && !isCanonicalNoFill(finalReasonCode)) {
      return {
        ok: false,
        reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_FINAL_REASON_CODE,
        eDeliveryResponseLite: null
      }
    }
    if (deliveryStatus === 'error' && !isCanonicalError(finalReasonCode)) {
      return {
        ok: false,
        reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_FINAL_REASON_CODE,
        eDeliveryResponseLite: null
      }
    }

    const routeOutcome = normalizeText(dToEOutputLite?.routeConclusion?.routeOutcome)
    const winnerMatched = resolveWinnerMatch(dToEOutputLite, renderPlanLite)
    const routeConsistency = resolveRouteConsistency({
      routeOutcome,
      deliveryStatus,
      finalReasonCode,
      winnerMatched
    })
    if (!routeConsistency.ok) {
      return {
        ok: false,
        reasonCode: routeConsistency.reasonCode,
        eDeliveryResponseLite: null
      }
    }

    if (routeConsistency.consistencyAction === 'override_by_e' && !normalizeText(routeConsistency.consistencyReasonCode)) {
      return {
        ok: false,
        reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_ROUTE_CONSISTENCY,
        eDeliveryResponseLite: null
      }
    }

    const stateTransitionLite = {
      fromState: 'routed',
      toState: deliveryStatus,
      stateReasonCode: finalReasonCode,
      stateRuleVersion,
      transitionAt: nowIso(nowFn)
    }
    if (stateTransitionLite.toState !== deliveryStatus || stateTransitionLite.fromState !== 'routed') {
      return {
        ok: false,
        reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_STATE_TRANSITION,
        eDeliveryResponseLite: null
      }
    }

    const versionAnchors = {
      eDeliveryContractVersion,
      renderPlanContractVersion: normalizeText(renderPlanLite?.versionAnchors?.renderPlanContractVersion),
      routingPolicyVersion: normalizeText(request.routingPolicyVersion || dToEOutputLite?.versionAnchors?.routingPolicyVersion),
      decisionRuleVersion: normalizeText(request.decisionRuleVersion || renderPlanLite?.eErrorDegradeDecisionSnapshotLite?.decisionRuleVersion || 'e_decision_rule_v1')
    }
    const anchorMissing = missingFields(versionAnchors, [
      'eDeliveryContractVersion',
      'renderPlanContractVersion',
      'routingPolicyVersion',
      'decisionRuleVersion'
    ])
    if (anchorMissing.length > 0) {
      return {
        ok: false,
        reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.INVALID_VERSION_ANCHOR,
        eDeliveryResponseLite: null,
        details: { missing: anchorMissing }
      }
    }

    const eDeliveryResponseLite = {
      opportunityKey: normalizeText(renderPlanLite.opportunityKey),
      traceKey: normalizeText(renderPlanLite.traceKey),
      requestKey: normalizeText(renderPlanLite.requestKey),
      attemptKey: normalizeText(renderPlanLite.attemptKey),
      responseReference: normalizeText(renderPlanLite.responseReference),
      deliveryStatus,
      finalReasonCode,
      renderPlanLite: stableClone(renderPlanLite),
      stateTransitionLite,
      routeDeliveryConsistencyLite: {
        routeOutcome,
        routeFinalReasonCode: normalizeText(dToEOutputLite?.routeConclusion?.finalReasonCode),
        consistencyAction: routeConsistency.consistencyAction,
        consistencyReasonCode: routeConsistency.consistencyReasonCode
      },
      versionAnchors
    }

    if (Array.isArray(request.warnings) && request.warnings.length > 0) {
      eDeliveryResponseLite.warnings = stableClone(request.warnings)
    }
    if (isPlainObject(request.extensions) && Object.keys(request.extensions).length > 0) {
      eDeliveryResponseLite.extensions = stableClone(request.extensions)
    }

    return {
      ok: true,
      reasonCode: E_DELIVERY_OUTPUT_REASON_CODES.DELIVERY_READY,
      eDeliveryResponseLite
    }
  }

  return {
    buildDeliveryResponse
  }
}
