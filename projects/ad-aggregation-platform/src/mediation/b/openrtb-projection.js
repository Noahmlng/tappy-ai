import { B_REDACTION_REASON_CODES } from './redaction.js'

export const B_PROJECTION_REASON_CODES = Object.freeze({
  MAPPED_COMPLETE: 'b_proj_mapped_complete',
  PARTIAL_OPTIONAL_MISSING: 'b_proj_partial_optional_missing',
  UNMAPPED_REQUIRED_MISSING: 'b_proj_unmapped_required_missing',
  UNMAPPED_INVALID_VALUE: 'b_proj_unmapped_invalid_value'
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

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }
  return ''
}

function pushCoverage(targetCoverage, openrtbPath, mappedFrom, coverageStatus, reasonCode) {
  targetCoverage.push({
    openrtbPath,
    mappedFrom,
    coverageStatus,
    reasonCode
  })
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0
}

export function createOpenrtbProjectionService(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const defaultProjectionVersion = normalizeText(options.openrtbProjectionVersion) || 'b_openrtb_projection_v1'

  function project(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const canonical = isPlainObject(request.sixBlockCanonical) ? request.sixBlockCanonical : {}
    const requestMeta = isPlainObject(canonical.RequestMeta) ? canonical.RequestMeta : {}
    const placementMeta = isPlainObject(canonical.PlacementMeta) ? canonical.PlacementMeta : {}
    const userContext = isPlainObject(canonical.UserContext) ? canonical.UserContext : {}
    const opportunityContext = isPlainObject(canonical.OpportunityContext) ? canonical.OpportunityContext : {}
    const policyContext = isPlainObject(canonical.PolicyContext) ? canonical.PolicyContext : {}
    const traceContext = isPlainObject(canonical.TraceContext) ? canonical.TraceContext : {}
    const sourceInputBundleLite = isPlainObject(request.sourceInputBundleLite) ? request.sourceInputBundleLite : {}
    const redactionResult = isPlainObject(request.redactionResult) ? request.redactionResult : {}
    const redactedValuesByPath = isPlainObject(redactionResult.redactedValuesByPath) ? redactionResult.redactedValuesByPath : {}
    const redactionSnapshotLite = isPlainObject(redactionResult.redactionSnapshotLite) ? redactionResult.redactionSnapshotLite : {}
    const bucketResult = isPlainObject(request.bucketResult) ? request.bucketResult : {}
    const bucketedValues = isPlainObject(bucketResult.bucketedValues) ? bucketResult.bucketedValues : {}
    const traceInitLite = isPlainObject(request.traceInitLite) ? request.traceInitLite : traceContext

    if (!redactionResult.ok || redactionSnapshotLite.beforeAuditEnforced !== true) {
      return {
        ok: false,
        projectionAction: 'reject',
        projectionDisposition: 'unmapped',
        projectionReasonCode: B_REDACTION_REASON_CODES.BEFORE_AUDIT_VIOLATION,
        openrtbProjectionLite: null,
        projectionAuditSnapshotLite: null
      }
    }

    const targetCoverage = []
    const requiredFailures = []
    const optionalMisses = []
    let hasInvalidValue = false

    const bidRequest = {
      id: '',
      imp: [
        {
          id: '',
          tagid: '',
          ext: {}
        }
      ],
      app: {
        id: '',
        ext: {}
      },
      device: {
        id: '',
        ext: {}
      },
      user: {
        id: '',
        ext: {}
      },
      regs: {
        ext: {}
      },
      ext: {
        mediation: {},
        trace: {}
      }
    }

    const requestKey = normalizeText(requestMeta.requestKey)
    if (requestKey) {
      bidRequest.id = requestKey
      pushCoverage(targetCoverage, 'BidRequest.id', 'RequestMeta.requestKey', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.id')
      pushCoverage(targetCoverage, 'BidRequest.id', 'RequestMeta.requestKey', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const requestTs = normalizeText(requestMeta.requestTimestamp)
    if (requestTs) {
      bidRequest.ext.mediation.request_ts = requestTs
      pushCoverage(targetCoverage, 'BidRequest.ext.mediation.request_ts', 'RequestMeta.requestTimestamp', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      optionalMisses.push('BidRequest.ext.mediation.request_ts')
      pushCoverage(targetCoverage, 'BidRequest.ext.mediation.request_ts', 'RequestMeta.requestTimestamp', 'partial', B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
    }

    const channelType = normalizeText(requestMeta.channelType)
    if (channelType) {
      bidRequest.app.ext.channel_type = channelType
      pushCoverage(targetCoverage, 'BidRequest.app.ext.channel_type', 'RequestMeta.channelType', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      optionalMisses.push('BidRequest.app.ext.channel_type')
      pushCoverage(targetCoverage, 'BidRequest.app.ext.channel_type', 'RequestMeta.channelType', 'partial', B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
    }

    const impId = normalizeText(placementMeta.placementKey)
    if (impId) {
      bidRequest.imp[0].id = impId
      pushCoverage(targetCoverage, 'BidRequest.imp[0].id', 'PlacementMeta.placementKey', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.imp[0].id')
      pushCoverage(targetCoverage, 'BidRequest.imp[0].id', 'PlacementMeta.placementKey', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const tagid = normalizeText(placementMeta.placementSurface)
    if (tagid) {
      bidRequest.imp[0].tagid = tagid
      pushCoverage(targetCoverage, 'BidRequest.imp[0].tagid', 'PlacementMeta.placementSurface', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.imp[0].tagid')
      pushCoverage(targetCoverage, 'BidRequest.imp[0].tagid', 'PlacementMeta.placementSurface', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const placementType = normalizeText(placementMeta.placementType)
    if (placementType) {
      bidRequest.imp[0].ext.placement_type = placementType
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.placement_type', 'PlacementMeta.placementType', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.imp[0].ext.placement_type')
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.placement_type', 'PlacementMeta.placementType', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const userId = normalizeText(redactedValuesByPath['UserContext.sessionKey'])
    const deviceId = normalizeText(redactedValuesByPath['device.id'])
    if (userId) {
      bidRequest.user.id = userId
      pushCoverage(targetCoverage, 'BidRequest.user.id', 'UserContext.sessionKey(redacted)', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else if (deviceId) {
      optionalMisses.push('BidRequest.user.id')
      pushCoverage(targetCoverage, 'BidRequest.user.id', 'UserContext.sessionKey(redacted)', 'partial', B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
    } else {
      requiredFailures.push('BidRequest.user.id')
      pushCoverage(targetCoverage, 'BidRequest.user.id', 'UserContext.sessionKey(redacted)', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    if (deviceId) {
      bidRequest.device.id = deviceId
      pushCoverage(targetCoverage, 'BidRequest.device.id', 'device.id(redacted)', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else if (userId) {
      optionalMisses.push('BidRequest.device.id')
      pushCoverage(targetCoverage, 'BidRequest.device.id', 'device.id(redacted)', 'partial', B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
    } else {
      pushCoverage(targetCoverage, 'BidRequest.device.id', 'device.id(redacted)', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const actorType = normalizeText(userContext.actorType)
    if (actorType) {
      bidRequest.user.ext.actor_type = actorType
      pushCoverage(targetCoverage, 'BidRequest.user.ext.actor_type', 'UserContext.actorType', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      optionalMisses.push('BidRequest.user.ext.actor_type')
      pushCoverage(targetCoverage, 'BidRequest.user.ext.actor_type', 'UserContext.actorType', 'partial', B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
    }

    const triggerDecision = normalizeText(opportunityContext.triggerDecision)
    if (triggerDecision) {
      bidRequest.imp[0].ext.trigger_decision = triggerDecision
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.trigger_decision', 'OpportunityContext.triggerDecision', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.imp[0].ext.trigger_decision')
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.trigger_decision', 'OpportunityContext.triggerDecision', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const decisionOutcome = normalizeText(opportunityContext.decisionOutcome)
    if (decisionOutcome) {
      bidRequest.imp[0].ext.decision_outcome = decisionOutcome
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.decision_outcome', 'OpportunityContext.decisionOutcome', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.imp[0].ext.decision_outcome')
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.decision_outcome', 'OpportunityContext.decisionOutcome', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const hitType = normalizeText(opportunityContext.hitType)
    if (hitType) {
      bidRequest.imp[0].ext.hit_type = hitType
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.hit_type', 'OpportunityContext.hitType', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.imp[0].ext.hit_type')
      pushCoverage(targetCoverage, 'BidRequest.imp[0].ext.hit_type', 'OpportunityContext.hitType', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const consentScope = normalizeText(policyContext.consentScope)
    if (consentScope) {
      bidRequest.regs.ext.consent_scope = consentScope
      pushCoverage(targetCoverage, 'BidRequest.regs.ext.consent_scope', 'PolicyContext.consentScope', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.regs.ext.consent_scope')
      pushCoverage(targetCoverage, 'BidRequest.regs.ext.consent_scope', 'PolicyContext.consentScope', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const policyGateHint = normalizeText(policyContext.policyGateHint)
    if (policyGateHint) {
      bidRequest.regs.ext.policy_gate_hint = policyGateHint
      pushCoverage(targetCoverage, 'BidRequest.regs.ext.policy_gate_hint', 'PolicyContext.policyGateHint', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      optionalMisses.push('BidRequest.regs.ext.policy_gate_hint')
      pushCoverage(targetCoverage, 'BidRequest.regs.ext.policy_gate_hint', 'PolicyContext.policyGateHint', 'partial', B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
    }

    const restrictedFlags = policyContext.restrictedCategoryFlags
    if (Array.isArray(restrictedFlags)) {
      bidRequest.regs.ext.restricted_category_flags = restrictedFlags
      pushCoverage(targetCoverage, 'BidRequest.regs.ext.restricted_category_flags', 'PolicyContext.restrictedCategoryFlags', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.regs.ext.restricted_category_flags')
      hasInvalidValue = true
      pushCoverage(targetCoverage, 'BidRequest.regs.ext.restricted_category_flags', 'PolicyContext.restrictedCategoryFlags', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_INVALID_VALUE)
    }

    const traceKey = normalizeText(traceContext.traceKey || traceInitLite.traceKey)
    if (traceKey) {
      bidRequest.ext.trace.trace_key = traceKey
      pushCoverage(targetCoverage, 'BidRequest.ext.trace.trace_key', 'TraceContext.traceKey', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.ext.trace.trace_key')
      pushCoverage(targetCoverage, 'BidRequest.ext.trace.trace_key', 'TraceContext.traceKey', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const traceRequestKey = normalizeText(traceContext.requestKey || traceInitLite.requestKey)
    if (traceRequestKey) {
      bidRequest.ext.trace.request_key = traceRequestKey
      pushCoverage(targetCoverage, 'BidRequest.ext.trace.request_key', 'TraceContext.requestKey', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.ext.trace.request_key')
      pushCoverage(targetCoverage, 'BidRequest.ext.trace.request_key', 'TraceContext.requestKey', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const attemptKey = normalizeText(traceContext.attemptKey || traceInitLite.attemptKey)
    if (attemptKey) {
      bidRequest.ext.trace.attempt_key = attemptKey
      pushCoverage(targetCoverage, 'BidRequest.ext.trace.attempt_key', 'TraceContext.attemptKey', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.ext.trace.attempt_key')
      pushCoverage(targetCoverage, 'BidRequest.ext.trace.attempt_key', 'TraceContext.attemptKey', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const appId = pickFirstNonEmpty(
      sourceInputBundleLite?.appExplicit?.appId,
      sourceInputBundleLite?.placementConfig?.appId,
      sourceInputBundleLite?.defaultPolicy?.appId
    )
    if (appId) {
      bidRequest.app.id = appId
      pushCoverage(targetCoverage, 'BidRequest.app.id', 'sourceInputBundleLite.*.appId', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      requiredFailures.push('BidRequest.app.id')
      pushCoverage(targetCoverage, 'BidRequest.app.id', 'sourceInputBundleLite.*.appId', 'unmapped', B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
    }

    const devicePerfTier = normalizeText(
      bucketedValues.devicePerfScore ||
      sourceInputBundleLite?.appExplicit?.app_context?.device_performance_tier
    )
    if (devicePerfTier) {
      bidRequest.device.ext.performance_tier = devicePerfTier
      pushCoverage(targetCoverage, 'BidRequest.device.ext.performance_tier', 'bucketResult.devicePerfScore', 'mapped', B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    } else {
      optionalMisses.push('BidRequest.device.ext.performance_tier')
      pushCoverage(targetCoverage, 'BidRequest.device.ext.performance_tier', 'bucketResult.devicePerfScore', 'partial', B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
    }

    const openrtbProjectionVersion = normalizeText(request.openrtbProjectionVersion) || defaultProjectionVersion
    const projectionDisposition = requiredFailures.length > 0
      ? 'unmapped'
      : (optionalMisses.length > 0 ? 'partial' : 'mapped')
    const projectionReasonCode = requiredFailures.length > 0
      ? (hasInvalidValue ? B_PROJECTION_REASON_CODES.UNMAPPED_INVALID_VALUE : B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
      : (optionalMisses.length > 0 ? B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING : B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
    const projectionAction = projectionDisposition === 'mapped'
      ? 'continue'
      : (projectionDisposition === 'partial' ? 'degrade' : 'reject')

    return {
      ok: projectionDisposition !== 'unmapped',
      projectionAction,
      projectionDisposition,
      projectionReasonCode,
      openrtbProjectionLite: bidRequest,
      projectionAuditSnapshotLite: {
        traceKey: normalizeText(traceInitLite.traceKey || traceContext.traceKey) || 'NA',
        requestKey: normalizeText(traceInitLite.requestKey || traceContext.requestKey) || 'NA',
        attemptKey: normalizeText(traceInitLite.attemptKey || traceContext.attemptKey) || 'NA',
        openrtbProjectionVersion,
        redactionPolicyVersion: normalizeText(redactionSnapshotLite.redactionPolicyVersion),
        projectionDisposition,
        projectionReasonCode,
        targetCoverage,
        generatedAt: nowIso(nowFn)
      }
    }
  }

  return {
    project
  }
}
