import crypto from 'node:crypto'

const RENDER_MODES = new Set([
  'native_card',
  'webview',
  'mraid_container',
  'video_vast_container'
])
const DELIVERY_STATUSES = new Set(['served', 'no_fill', 'error'])

export const E_COMPOSE_REASON_CODES = Object.freeze({
  RENDER_PLAN_READY: 'e_compose_render_plan_ready',
  MISSING_AUCTION_REQUIRED: 'e_compose_missing_auction_required',
  MISSING_PLACEMENT_REQUIRED: 'e_compose_missing_placement_required',
  MISSING_DEVICE_CAPABILITIES: 'e_compose_missing_device_capabilities',
  OPTIONAL_DEFAULT_APPLIED: 'e_compose_optional_default_applied',
  INVALID_STRUCTURE: 'e_compose_invalid_structure',
  INVALID_RENDER_MODE: 'e_compose_invalid_render_mode',
  INVALID_NUMERIC_CORRECTED: 'e_compose_invalid_numeric_corrected',
  INCONSISTENT_AUCTION_RESULT: 'e_compose_inconsistent_auction_result',
  WINNER_BINDING_INVALID: 'e_compose_winner_binding_invalid',
  INVALID_VERSION_ANCHOR: 'e_compose_invalid_version_anchor',
  UI_CONSTRAINT_INVALID: 'e_ui_constraint_invalid',
  TRACKING_INJECTION_MISSING: 'e_tracking_injection_missing',
  TTL_CORRECTED_DEFAULT: 'e_ttl_corrected_default'
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))]
}

function hashId(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20)
}

function fail(reasonCode, warnings = [], details = {}) {
  return {
    ok: false,
    reasonCode,
    warnings,
    details,
    renderPlanLite: null
  }
}

function makeWarning(reasonCode, fieldPath, action, originalValue, correctedValue = null) {
  return {
    reasonCode,
    fieldPath,
    action,
    originalValue: originalValue === undefined ? null : originalValue,
    correctedValue
  }
}

function getByPath(value, path) {
  const parts = String(path).split('.').filter(Boolean)
  let cursor = value
  for (const part of parts) {
    if (!isPlainObject(cursor) || !(part in cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

function validateRequiredFields(source, fields) {
  const missing = []
  for (const field of fields) {
    const value = getByPath(source, field)
    if (value === undefined || value === null) missing.push(field)
  }
  return missing
}

function normalizeCandidates(raw = []) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (isPlainObject(item) ? item : {}))
    .map((candidate) => ({
      sourceId: normalizeText(candidate.sourceId),
      candidateId: normalizeText(candidate.candidateId || candidate.sourceCandidateId),
      routeTier: normalizeText(candidate.routeTier) || 'primary',
      pricing: isPlainObject(candidate.pricing)
        ? {
            bidValue: toFiniteNumber(candidate.pricing.bidValue ?? candidate.pricing.value, 0),
            currency: normalizeText(candidate.pricing.currency) || 'NA'
          }
        : {
            bidValue: toFiniteNumber(candidate.bidValue, 0),
            currency: normalizeText(candidate.currency) || 'NA'
          },
      creativeRef: isPlainObject(candidate.creativeRef)
        ? {
            creativeId: normalizeText(candidate.creativeRef.creativeId) || 'none',
            landingType: normalizeText(candidate.creativeRef.landingType) || 'none'
          }
        : {
            creativeId: normalizeText(candidate.creativeId) || 'none',
            landingType: normalizeText(candidate.landingType) || 'none'
          },
      assetRefs: Array.isArray(candidate.assetRefs) ? stableClone(candidate.assetRefs) : [],
      destinationRef: normalizeText(candidate.destinationRef) || 'none'
    }))
    .filter((item) => item.sourceId && item.candidateId)
}

function createSafeDefaultCapabilities() {
  return {
    platformType: 'unknown',
    sdkVersion: 'unknown',
    supportedRenderModes: ['native_card'],
    webviewSupported: false,
    mraidSupported: false,
    videoVastSupported: false,
    maxRenderSlotCount: 1
  }
}

function normalizeDeviceCapabilities(raw, warnings) {
  if (!isPlainObject(raw) || Object.keys(raw).length === 0) {
    warnings.push(
      makeWarning(
        E_COMPOSE_REASON_CODES.MISSING_DEVICE_CAPABILITIES,
        'deviceCapabilitiesLite',
        'degrade',
        raw,
        createSafeDefaultCapabilities()
      )
    )
    return {
      capabilities: createSafeDefaultCapabilities(),
      degraded: true
    }
  }

  const supportedRenderModesRaw = normalizeStringArray(raw.supportedRenderModes)
  const supportedRenderModes = supportedRenderModesRaw.filter((mode) => RENDER_MODES.has(mode))
  if (supportedRenderModesRaw.length !== supportedRenderModes.length) {
    warnings.push(
      makeWarning(
        E_COMPOSE_REASON_CODES.INVALID_RENDER_MODE,
        'deviceCapabilitiesLite.supportedRenderModes',
        'degrade',
        supportedRenderModesRaw,
        supportedRenderModes
      )
    )
  }

  let maxRenderSlotCount = Math.floor(toFiniteNumber(raw.maxRenderSlotCount, 1))
  if (maxRenderSlotCount <= 0) {
    warnings.push(
      makeWarning(
        E_COMPOSE_REASON_CODES.INVALID_NUMERIC_CORRECTED,
        'deviceCapabilitiesLite.maxRenderSlotCount',
        'degrade',
        raw.maxRenderSlotCount,
        1
      )
    )
    maxRenderSlotCount = 1
  }

  return {
    capabilities: {
      platformType: normalizeText(raw.platformType) || 'unknown',
      sdkVersion: normalizeText(raw.sdkVersion) || 'unknown',
      supportedRenderModes,
      webviewSupported: raw.webviewSupported === true,
      mraidSupported: raw.mraidSupported === true,
      videoVastSupported: raw.videoVastSupported === true,
      maxRenderSlotCount
    },
    degraded: false
  }
}

function normalizePlacementSpec(raw, warnings) {
  if (!isPlainObject(raw) || Object.keys(raw).length === 0) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.INVALID_STRUCTURE,
      placementSpecLite: null
    }
  }

  const requiredMissing = validateRequiredFields(raw, [
    'placementKey',
    'placementType',
    'placementSurface',
    'allowedRenderModes',
    'maxRenderCount',
    'uiConstraintProfile',
    'disclosurePolicy'
  ])
  if (requiredMissing.length > 0) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.MISSING_PLACEMENT_REQUIRED,
      placementSpecLite: null,
      missing: requiredMissing
    }
  }

  const allowedModesRaw = normalizeStringArray(raw.allowedRenderModes)
  const allowedRenderModes = allowedModesRaw.filter((mode) => RENDER_MODES.has(mode))
  if (allowedModesRaw.length !== allowedRenderModes.length) {
    warnings.push(
      makeWarning(
        E_COMPOSE_REASON_CODES.INVALID_RENDER_MODE,
        'placementSpecLite.allowedRenderModes',
        'degrade',
        allowedModesRaw,
        allowedRenderModes
      )
    )
  }
  if (allowedRenderModes.length === 0) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.INVALID_RENDER_MODE,
      placementSpecLite: null
    }
  }

  let maxRenderCount = Math.floor(toFiniteNumber(raw.maxRenderCount, 1))
  if (maxRenderCount <= 0) {
    warnings.push(
      makeWarning(
        E_COMPOSE_REASON_CODES.INVALID_NUMERIC_CORRECTED,
        'placementSpecLite.maxRenderCount',
        'degrade',
        raw.maxRenderCount,
        1
      )
    )
    maxRenderCount = 1
  }

  if (!isPlainObject(raw.uiConstraintProfile) || !isPlainObject(raw.disclosurePolicy)) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.UI_CONSTRAINT_INVALID,
      placementSpecLite: null
    }
  }

  return {
    ok: true,
    reasonCode: E_COMPOSE_REASON_CODES.RENDER_PLAN_READY,
    placementSpecLite: {
      placementKey: normalizeText(raw.placementKey),
      placementType: normalizeText(raw.placementType),
      placementSurface: normalizeText(raw.placementSurface),
      allowedRenderModes,
      maxRenderCount,
      uiConstraintProfile: stableClone(raw.uiConstraintProfile),
      disclosurePolicy: stableClone(raw.disclosurePolicy)
    }
  }
}

function normalizeComposeContext(raw, warnings, nowFn) {
  const context = isPlainObject(raw) ? raw : {}
  const composeRequestAt = normalizeText(context.composeRequestAt) || nowIso(nowFn)
  const composeMode = normalizeText(context.composeMode) || 'sync_delivery'
  if (!normalizeText(context.composeRequestAt) || !normalizeText(context.composeMode)) {
    warnings.push(
      makeWarning(
        E_COMPOSE_REASON_CODES.OPTIONAL_DEFAULT_APPLIED,
        'composeContextLite',
        'continue',
        raw,
        { composeRequestAt, composeMode }
      )
    )
  }

  return {
    composeRequestAt,
    composeMode
  }
}

function validateDOutput(dToEOutputLite) {
  if (!isPlainObject(dToEOutputLite) || Object.keys(dToEOutputLite).length === 0) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.INVALID_STRUCTURE
    }
  }

  const missing = validateRequiredFields(dToEOutputLite, [
    'opportunityKey',
    'traceKey',
    'requestKey',
    'attemptKey',
    'auctionDecisionLite',
    'hasCandidate',
    'candidateCount',
    'normalizedCandidates',
    'policyConstraintsLite.constraintSetVersion',
    'policyConstraintsLite.categoryConstraints.bcat',
    'policyConstraintsLite.categoryConstraints.badv',
    'policyConstraintsLite.personalizationConstraints.nonPersonalizedOnly',
    'policyConstraintsLite.renderConstraints.disallowRenderModes',
    'routeConclusion',
    'routeAuditSnapshotLite',
    'stateUpdate'
  ])
  if (missing.length > 0) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.MISSING_AUCTION_REQUIRED,
      missing
    }
  }

  const auction = isPlainObject(dToEOutputLite.auctionDecisionLite) ? dToEOutputLite.auctionDecisionLite : {}
  const auctionMissing = validateRequiredFields(auction, [
    'served',
    'winner.sourceId',
    'winner.candidateId',
    'price.value',
    'price.currency',
    'creativeHandle.creativeId',
    'creativeHandle.landingType',
    'debugRef.routePlanId'
  ])
  if (auctionMissing.length > 0) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.MISSING_AUCTION_REQUIRED,
      missing: auctionMissing
    }
  }

  const served = auction.served === true
  const winnerSourceId = normalizeText(auction?.winner?.sourceId)
  const winnerCandidateId = normalizeText(auction?.winner?.candidateId)
  const priceValue = toFiniteNumber(auction?.price?.value, 0)
  const creativeId = normalizeText(auction?.creativeHandle?.creativeId)
  const landingType = normalizeText(auction?.creativeHandle?.landingType)

  if (served) {
    if (
      !winnerSourceId ||
      !winnerCandidateId ||
      winnerSourceId === 'none' ||
      winnerCandidateId === 'none' ||
      priceValue <= 0 ||
      creativeId === 'none' ||
      !creativeId ||
      landingType === 'none' ||
      !landingType
    ) {
      return {
        ok: false,
        reasonCode: E_COMPOSE_REASON_CODES.WINNER_BINDING_INVALID
      }
    }
  }

  const normalizedCandidates = normalizeCandidates(dToEOutputLite.normalizedCandidates)
  const hasCandidate = dToEOutputLite.hasCandidate === true
  const candidateCount = Math.floor(toFiniteNumber(dToEOutputLite.candidateCount, 0))
  if (hasCandidate && (candidateCount < 1 || normalizedCandidates.length === 0)) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.INCONSISTENT_AUCTION_RESULT
    }
  }
  if (!hasCandidate && (candidateCount !== 0 || normalizedCandidates.length !== 0)) {
    return {
      ok: false,
      reasonCode: E_COMPOSE_REASON_CODES.INCONSISTENT_AUCTION_RESULT
    }
  }

  if (served) {
    const foundWinner = normalizedCandidates.some(
      (item) => item.sourceId === winnerSourceId && item.candidateId === winnerCandidateId
    )
    if (!foundWinner) {
      return {
        ok: false,
        reasonCode: E_COMPOSE_REASON_CODES.WINNER_BINDING_INVALID
      }
    }
  }

  return {
    ok: true,
    reasonCode: E_COMPOSE_REASON_CODES.RENDER_PLAN_READY,
    normalizedCandidates
  }
}

function resolveVersionAnchors(input = {}) {
  const root = isPlainObject(input.versionAnchors) ? input.versionAnchors : {}
  const dAnchors = isPlainObject(input?.dToEOutputLite?.versionAnchors) ? input.dToEOutputLite.versionAnchors : {}
  const policyConstraintsLite = isPlainObject(input?.dToEOutputLite?.policyConstraintsLite)
    ? input.dToEOutputLite.policyConstraintsLite
    : {}
  const dRouteConclusion = isPlainObject(input?.dToEOutputLite?.routeConclusion) ? input.dToEOutputLite.routeConclusion : {}

  const normalized = {
    eComposeInputContractVersion: normalizeText(root.eComposeInputContractVersion),
    dOutputContractVersion: normalizeText(root.dOutputContractVersion || dAnchors.dOutputContractVersion),
    schemaVersion: normalizeText(root.schemaVersion),
    placementConfigVersion: normalizeText(root.placementConfigVersion),
    renderPolicyVersion: normalizeText(root.renderPolicyVersion),
    deviceCapabilityProfileVersion: normalizeText(root.deviceCapabilityProfileVersion),
    routingPolicyVersion: normalizeText(root.routingPolicyVersion || dAnchors.routingPolicyVersion || dRouteConclusion.routingPolicyVersion),
    constraintSetVersion: normalizeText(root.constraintSetVersion || policyConstraintsLite.constraintSetVersion),
    trackingInjectionVersion: normalizeText(root.trackingInjectionVersion) || 'e_tracking_injection_v1',
    uiConstraintProfileVersion: normalizeText(root.uiConstraintProfileVersion) || 'e_ui_constraint_profile_v1'
  }

  const required = [
    'eComposeInputContractVersion',
    'dOutputContractVersion',
    'schemaVersion',
    'placementConfigVersion',
    'renderPolicyVersion',
    'deviceCapabilityProfileVersion',
    'routingPolicyVersion',
    'constraintSetVersion'
  ]
  const missing = required.filter((field) => !normalizeText(normalized[field]))
  return {
    ok: missing.length === 0,
    missing,
    versionAnchors: normalized
  }
}

function isModeSupportedByDevice(mode, deviceCapabilities) {
  if (mode === 'webview') return deviceCapabilities.webviewSupported
  if (mode === 'mraid_container') return deviceCapabilities.mraidSupported
  if (mode === 'video_vast_container') return deviceCapabilities.videoVastSupported
  return true
}

function evaluateRenderModes({ placementSpecLite, deviceCapabilitiesLite, policyConstraintsLite }) {
  const policyDisallowModes = normalizeStringArray(policyConstraintsLite?.renderConstraints?.disallowRenderModes)
  const allowed = placementSpecLite.allowedRenderModes
  const supported = deviceCapabilitiesLite.supportedRenderModes

  const modeEvaluations = []
  for (const mode of allowed) {
    if (!supported.includes(mode)) {
      modeEvaluations.push({
        mode,
        gateResult: 'fail',
        gateReasonCode: 'e_render_mode_not_supported'
      })
      continue
    }
    if (!isModeSupportedByDevice(mode, deviceCapabilitiesLite)) {
      modeEvaluations.push({
        mode,
        gateResult: 'fail',
        gateReasonCode: 'e_render_mode_not_supported'
      })
      continue
    }
    if (policyDisallowModes.includes(mode)) {
      modeEvaluations.push({
        mode,
        gateResult: 'fail',
        gateReasonCode: 'e_nf_policy_blocked'
      })
      continue
    }
    modeEvaluations.push({
      mode,
      gateResult: 'pass',
      gateReasonCode: 'e_render_mode_pass'
    })
  }

  const eligibleModes = modeEvaluations
    .filter((item) => item.gateResult === 'pass')
    .map((item) => item.mode)

  return {
    modeEvaluations,
    eligibleModes,
    policyDisallowModes
  }
}

function buildRenderContainer(mode, placementSpecLite, selectedCandidate) {
  if (mode === 'native_card') {
    return {
      containerType: 'native_card',
      containerParams: {
        slotId: placementSpecLite.placementKey,
        templateId: normalizeText(placementSpecLite.uiConstraintProfile.templateId) || 'default_native_template',
        maxCardCount: placementSpecLite.maxRenderCount
      }
    }
  }
  if (mode === 'webview') {
    const creativeId = normalizeText(selectedCandidate?.creativeRef?.creativeId) || 'none'
    return {
      containerType: 'webview',
      containerParams: {
        url: `https://render.invalid/webview/${creativeId}`,
        sandboxFlags: ['allow-scripts'],
        allowedDomains: ['render.invalid']
      }
    }
  }
  if (mode === 'mraid_container') {
    const creativeId = normalizeText(selectedCandidate?.creativeRef?.creativeId) || 'none'
    return {
      containerType: 'mraid_container',
      containerParams: {
        htmlSnippetRef: `mraid:${creativeId}`,
        mraidVersion: '3.0',
        expandPolicy: 'user_gesture_required'
      }
    }
  }
  if (mode === 'video_vast_container') {
    const creativeId = normalizeText(selectedCandidate?.creativeRef?.creativeId) || 'none'
    return {
      containerType: 'video_vast_container',
      containerParams: {
        vastTagUrl: `https://render.invalid/vast/${creativeId}`,
        videoSlotSpec: {
          width: 320,
          height: 180
        },
        autoplayPolicy: 'muted_autoplay'
      }
    }
  }
  return {
    containerType: 'none',
    containerParams: {}
  }
}

function composeDeliveryStatus(dToEOutputLite, selectedCandidate, capabilityGateFail) {
  const routeOutcome = normalizeText(dToEOutputLite?.routeConclusion?.routeOutcome)
  const dServed = dToEOutputLite?.auctionDecisionLite?.served === true
  if (dServed && selectedCandidate && !capabilityGateFail) return 'served'
  if (routeOutcome === 'error') return 'error'
  return 'no_fill'
}

function buildTrackingInjection(responseReference, traceKey) {
  const keySeed = `${responseReference}:${traceKey}`
  return {
    onRenderStart: {
      eventName: 'ad_render_started',
      responseReference,
      traceKey,
      idempotencyKey: `trk_start_${hashId(`${keySeed}:start`)}`
    },
    onRenderSuccess: {
      eventName: 'ad_rendered',
      responseReference,
      traceKey,
      idempotencyKey: `trk_success_${hashId(`${keySeed}:success`)}`
    },
    onRenderFailure: {
      eventName: 'ad_render_failed',
      responseReference,
      traceKey,
      idempotencyKey: `trk_fail_${hashId(`${keySeed}:failure`)}`
    },
    onClick: {
      eventName: 'ad_clicked',
      responseReference,
      traceKey,
      idempotencyKey: `trk_click_${hashId(`${keySeed}:click`)}`
    }
  }
}

function buildUiConstraints(placementSpecLite, policyConstraintsLite) {
  const uiProfile = placementSpecLite.uiConstraintProfile
  const disclosurePolicy = placementSpecLite.disclosurePolicy

  return {
    layoutConstraint: {
      maxHeightPx: Math.max(1, Math.floor(toFiniteNumber(uiProfile.maxHeightPx, 320))),
      maxWidthPx: Math.max(1, Math.floor(toFiniteNumber(uiProfile.maxWidthPx, 320))),
      safeAreaRequired: uiProfile.safeAreaRequired !== false
    },
    disclosureConstraint: {
      disclosureLabel: normalizeText(disclosurePolicy.disclosureLabel) || 'Sponsored',
      labelPosition: normalizeText(disclosurePolicy.labelPosition) || 'top_left',
      mustBeVisible: disclosurePolicy.mustBeVisible !== false
    },
    interactionConstraint: {
      clickGuardEnabled: uiProfile.clickGuardEnabled !== false,
      closeable: uiProfile.closeable !== false,
      frequencyCapHint: Math.max(
        0,
        Math.floor(toFiniteNumber(uiProfile.frequencyCapHint, 0))
      )
    },
    policyConstraintSnapshot: {
      nonPersonalizedOnly: policyConstraintsLite.personalizationConstraints.nonPersonalizedOnly === true
    }
  }
}

function createDropRefs(candidates, selectedCandidate) {
  return candidates
    .filter((candidate) => {
      if (!selectedCandidate) return true
      return !(
        candidate.sourceId === selectedCandidate.sourceId &&
        candidate.candidateId === selectedCandidate.candidateId
      )
    })
    .map((candidate) => ({
      sourceId: candidate.sourceId,
      candidateId: candidate.candidateId,
      dropReasonCode: 'e_candidate_not_selected'
    }))
}

export function createComposeService(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const renderPlanContractVersion = normalizeText(options.renderPlanContractVersion) || 'e_render_plan_contract_v1'
  const gateRuleVersion = normalizeText(options.gateRuleVersion) || 'e_gate_rule_v1'
  const validationRuleVersion = normalizeText(options.validationRuleVersion) || 'e_validation_rule_v1'
  const decisionRuleVersion = normalizeText(options.decisionRuleVersion) || 'e_decision_rule_v1'

  function compose(input = {}) {
    const request = isPlainObject(input) ? input : {}
    if (!isPlainObject(input)) {
      return fail(E_COMPOSE_REASON_CODES.INVALID_STRUCTURE)
    }

    const warnings = []

    if (!isPlainObject(request.dToEOutputLite)) {
      return fail(E_COMPOSE_REASON_CODES.MISSING_AUCTION_REQUIRED)
    }
    if (!isPlainObject(request.placementSpecLite)) {
      return fail(E_COMPOSE_REASON_CODES.MISSING_PLACEMENT_REQUIRED)
    }

    const dOutputValidation = validateDOutput(request.dToEOutputLite)
    if (!dOutputValidation.ok) {
      return fail(dOutputValidation.reasonCode, warnings, {
        missing: dOutputValidation.missing || []
      })
    }

    const placementNormalization = normalizePlacementSpec(request.placementSpecLite, warnings)
    if (!placementNormalization.ok) {
      return fail(placementNormalization.reasonCode, warnings, {
        missing: placementNormalization.missing || []
      })
    }

    const deviceNormalization = normalizeDeviceCapabilities(request.deviceCapabilitiesLite, warnings)
    if (
      deviceNormalization.degraded &&
      !placementNormalization.placementSpecLite.allowedRenderModes.includes('native_card')
    ) {
      return fail(E_COMPOSE_REASON_CODES.MISSING_DEVICE_CAPABILITIES, warnings)
    }
    if (deviceNormalization.capabilities.supportedRenderModes.length === 0) {
      return fail(E_COMPOSE_REASON_CODES.INVALID_RENDER_MODE, warnings)
    }

    const versionAnchorResolution = resolveVersionAnchors(request)
    if (!versionAnchorResolution.ok) {
      return fail(E_COMPOSE_REASON_CODES.INVALID_VERSION_ANCHOR, warnings, {
        missing: versionAnchorResolution.missing
      })
    }

    const dToEOutputLite = request.dToEOutputLite
    const placementSpecLite = placementNormalization.placementSpecLite
    const deviceCapabilitiesLite = deviceNormalization.capabilities
    const composeContextLite = normalizeComposeContext(request.composeContextLite, warnings, nowFn)
    const versionAnchors = versionAnchorResolution.versionAnchors

    const normalizedCandidates = dOutputValidation.normalizedCandidates
    const auctionWinnerSourceId = normalizeText(dToEOutputLite?.auctionDecisionLite?.winner?.sourceId)
    const auctionWinnerCandidateId = normalizeText(dToEOutputLite?.auctionDecisionLite?.winner?.candidateId)
    const winnerCandidate = normalizedCandidates.find(
      (item) => item.sourceId === auctionWinnerSourceId && item.candidateId === auctionWinnerCandidateId
    ) || null

    const gateEvaluation = evaluateRenderModes({
      placementSpecLite,
      deviceCapabilitiesLite,
      policyConstraintsLite: dToEOutputLite.policyConstraintsLite
    })
    const selectedRenderMode = gateEvaluation.eligibleModes[0] || 'none'

    let selectedCandidate = null
    let consumptionReasonCode = 'e_no_candidate_input'
    if (dToEOutputLite.auctionDecisionLite.served === true) {
      if (winnerCandidate && selectedRenderMode !== 'none') {
        selectedCandidate = winnerCandidate
        consumptionReasonCode = 'e_candidate_selected'
      } else {
        consumptionReasonCode = 'e_candidate_not_renderable_after_compose'
      }
    } else if (normalizedCandidates.length > 0 && selectedRenderMode !== 'none') {
      selectedCandidate = normalizedCandidates[0]
      consumptionReasonCode = 'e_candidate_selected'
    } else if (normalizedCandidates.length > 0) {
      consumptionReasonCode = 'e_candidate_all_rejected'
    }

    const capabilityGateFail = selectedRenderMode === 'none'
    const deliveryStatus = composeDeliveryStatus(
      dToEOutputLite,
      selectedCandidate,
      capabilityGateFail
    )
    if (!DELIVERY_STATUSES.has(deliveryStatus)) {
      return fail(E_COMPOSE_REASON_CODES.INVALID_STRUCTURE, warnings)
    }

    if (deliveryStatus === 'served' && selectedRenderMode === 'none') {
      return fail(E_COMPOSE_REASON_CODES.INVALID_RENDER_MODE, warnings)
    }

    const traceKey = normalizeText(dToEOutputLite.traceKey)
    const requestKey = normalizeText(dToEOutputLite.requestKey)
    const attemptKey = normalizeText(dToEOutputLite.attemptKey)
    const opportunityKey = normalizeText(dToEOutputLite.opportunityKey)
    const responseReference = `resp_${hashId(`${traceKey}:${requestKey}:${attemptKey}:${opportunityKey}`)}`

    const trackingInjection = buildTrackingInjection(responseReference, traceKey)
    const trackingRequiredMissing = validateRequiredFields(trackingInjection, [
      'onRenderStart.responseReference',
      'onRenderStart.traceKey',
      'onRenderSuccess.responseReference',
      'onRenderSuccess.traceKey',
      'onRenderFailure.responseReference',
      'onRenderFailure.traceKey',
      'onClick.responseReference',
      'onClick.traceKey'
    ])
    if (trackingRequiredMissing.length > 0 && deliveryStatus === 'served') {
      return fail(E_COMPOSE_REASON_CODES.TRACKING_INJECTION_MISSING, warnings)
    }

    const uiConstraints = buildUiConstraints(placementSpecLite, dToEOutputLite.policyConstraintsLite)
    const uiMissing = validateRequiredFields(uiConstraints, [
      'layoutConstraint.maxHeightPx',
      'layoutConstraint.maxWidthPx',
      'layoutConstraint.safeAreaRequired',
      'disclosureConstraint.disclosureLabel',
      'disclosureConstraint.labelPosition',
      'disclosureConstraint.mustBeVisible',
      'interactionConstraint.clickGuardEnabled',
      'interactionConstraint.closeable',
      'interactionConstraint.frequencyCapHint'
    ])
    if (uiMissing.length > 0) {
      return fail(E_COMPOSE_REASON_CODES.UI_CONSTRAINT_INVALID, warnings, { missing: uiMissing })
    }

    let renderTtlMs = Math.floor(toFiniteNumber(request?.composeContextLite?.renderTtlMs, 5000))
    if (renderTtlMs <= 0) {
      warnings.push(
        makeWarning(
          E_COMPOSE_REASON_CODES.TTL_CORRECTED_DEFAULT,
          'composeContextLite.renderTtlMs',
          'degrade',
          request?.composeContextLite?.renderTtlMs,
          5000
        )
      )
      renderTtlMs = 5000
    }
    const composeRequestAtEpoch = Date.parse(composeContextLite.composeRequestAt)
    const composeStart = Number.isFinite(composeRequestAtEpoch) ? composeRequestAtEpoch : nowFn()
    const expireAt = new Date(composeStart + renderTtlMs).toISOString()

    const renderMode = deliveryStatus === 'served' ? selectedRenderMode : 'none'
    const renderContainer = buildRenderContainer(renderMode, placementSpecLite, selectedCandidate)
    const selectedCandidateRefs = selectedCandidate
      ? [{
          sourceId: selectedCandidate.sourceId,
          candidateId: selectedCandidate.candidateId,
          renderMode
        }]
      : []
    const droppedCandidateRefs = createDropRefs(normalizedCandidates, selectedCandidate)

    const finalCanonicalReasonCode = deliveryStatus === 'served'
      ? 'none'
      : (deliveryStatus === 'no_fill'
        ? (consumptionReasonCode === 'e_no_candidate_input' ? 'e_nf_no_candidate_input' : 'e_nf_all_candidate_rejected')
        : 'e_er_invalid_compose_input')
    const failureClass = deliveryStatus === 'served' ? 'none' : deliveryStatus

    const renderPlanLite = {
      opportunityKey,
      traceKey,
      requestKey,
      attemptKey,
      responseReference,
      deliveryStatus,
      renderMode,
      renderContainer,
      creativeBinding: {
        creativeId: selectedCandidate ? selectedCandidate.creativeRef.creativeId : 'none',
        assetRefs: selectedCandidate ? stableClone(selectedCandidate.assetRefs) : [],
        destinationRef: selectedCandidate ? selectedCandidate.destinationRef : 'none'
      },
      trackingInjection,
      uiConstraints: {
        layoutConstraint: uiConstraints.layoutConstraint,
        disclosureConstraint: uiConstraints.disclosureConstraint,
        interactionConstraint: uiConstraints.interactionConstraint
      },
      ttl: {
        renderTtlMs,
        expireAt
      },
      versionAnchors: {
        renderPlanContractVersion,
        renderPolicyVersion: versionAnchors.renderPolicyVersion,
        placementConfigVersion: versionAnchors.placementConfigVersion,
        trackingInjectionVersion: versionAnchors.trackingInjectionVersion,
        uiConstraintProfileVersion: versionAnchors.uiConstraintProfileVersion
      },
      candidateConsumptionDecision: {
        selectionMode: 'top1_strict',
        scannedCandidateCount: normalizedCandidates.length,
        selectedCandidateRefs,
        droppedCandidateRefs,
        consumptionReasonCode
      },
      renderCapabilityGateSnapshotLite: {
        traceKeys: {
          traceKey,
          requestKey,
          attemptKey,
          opportunityKey
        },
        placementModes: {
          allowedRenderModes: stableClone(placementSpecLite.allowedRenderModes)
        },
        deviceModes: {
          supportedRenderModes: stableClone(deviceCapabilitiesLite.supportedRenderModes),
          webviewSupported: deviceCapabilitiesLite.webviewSupported,
          mraidSupported: deviceCapabilitiesLite.mraidSupported,
          videoVastSupported: deviceCapabilitiesLite.videoVastSupported
        },
        policyModes: {
          disallowRenderModes: stableClone(gateEvaluation.policyDisallowModes),
          nonPersonalizedOnly: dToEOutputLite.policyConstraintsLite.personalizationConstraints.nonPersonalizedOnly === true,
          bcat: stableClone(dToEOutputLite.policyConstraintsLite.categoryConstraints.bcat || []),
          badv: stableClone(dToEOutputLite.policyConstraintsLite.categoryConstraints.badv || [])
        },
        modeEvaluations: gateEvaluation.modeEvaluations,
        selectionDecision: {
          eligibleModes: stableClone(gateEvaluation.eligibleModes),
          selectedRenderMode: renderMode,
          degradePath: renderMode === 'none' ? ['capability_gate_rejected'] : [],
          finalGateReasonCode: renderMode === 'none' ? 'e_nf_capability_gate_rejected' : 'e_render_mode_pass'
        },
        versionSnapshot: {
          renderPolicyVersion: versionAnchors.renderPolicyVersion,
          deviceCapabilityProfileVersion: versionAnchors.deviceCapabilityProfileVersion,
          placementConfigVersion: versionAnchors.placementConfigVersion,
          gateRuleVersion
        },
        snapshotAt: nowIso(nowFn)
      },
      eValidationSnapshotLite: {
        traceKeys: {
          traceKey,
          requestKey,
          attemptKey,
          opportunityKey
        },
        validationStages: [
          {
            stageName: 'compose_input_contract',
            stageAction: 'allow',
            stageReasonCode: E_COMPOSE_REASON_CODES.RENDER_PLAN_READY
          },
          {
            stageName: 'render_capability_gate',
            stageAction: renderMode === 'none' ? 'block' : 'allow',
            stageReasonCode: renderMode === 'none' ? 'e_nf_capability_gate_rejected' : 'e_render_mode_pass'
          }
        ],
        finalValidationAction: renderMode === 'none' ? 'block' : 'allow',
        finalValidationReasonCode: renderMode === 'none' ? 'e_nf_capability_gate_rejected' : 'e_render_mode_pass',
        degradeAdjustments: renderMode === 'none'
          ? [{ fieldPath: 'renderMode', from: selectedRenderMode, to: 'none' }]
          : [],
        validationRuleVersion,
        validatedAt: nowIso(nowFn)
      },
      eErrorDegradeDecisionSnapshotLite: {
        traceKeys: {
          traceKey,
          requestKey,
          attemptKey,
          opportunityKey
        },
        finalDeliveryStatus: deliveryStatus,
        finalCanonicalReasonCode,
        failureClass,
        failStrategy: deliveryStatus === 'served' ? 'mixed' : 'fail_closed',
        actionsTaken: [
          {
            stage: 'candidate_consumption',
            action: selectedCandidate ? 'selected' : 'dropped',
            rawReasonCode: consumptionReasonCode,
            canonicalReasonCode: finalCanonicalReasonCode
          }
        ],
        modeDegradePath: renderMode === 'none' ? ['capability_gate_rejected'] : [],
        decisionRuleVersion,
        decidedAt: nowIso(nowFn)
      }
    }

    if (warnings.length > 0) {
      renderPlanLite.warnings = stableClone(warnings)
    }

    return {
      ok: true,
      reasonCode: E_COMPOSE_REASON_CODES.RENDER_PLAN_READY,
      warnings,
      renderPlanLite
    }
  }

  return {
    compose
  }
}
