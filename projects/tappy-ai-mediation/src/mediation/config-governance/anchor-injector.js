import crypto from 'node:crypto'

export const H_ANCHOR_REASON_CODES = Object.freeze({
  ALL_PASS: 'h_anchor_all_pass',
  MISSING_REQUIRED: 'h_anchor_missing_required',
  INJECTION_FAILED: 'h_anchor_injection_failed',
  MUTATION_FORBIDDEN: 'h_anchor_mutation_forbidden',
  SWITCH_DETECTED_PRE_ROUTE: 'h_anchor_switch_detected_pre_route',
  SWITCH_DETECTED_POST_ROUTE: 'h_anchor_switch_detected_post_route',
  SNAPSHOT_HASH_MISMATCH: 'h_anchor_snapshot_hash_mismatch'
})

const FREEZE_POINT_INGRESS = 'freeze_point_ingress'
const FREEZE_POINT_ROUTING = 'freeze_point_routing'
const FREEZE_POINT_DELIVERY = 'freeze_point_delivery'
const FREEZE_POINT_EVENT = 'freeze_point_event'

const FREEZE_ORDER = [
  FREEZE_POINT_INGRESS,
  FREEZE_POINT_ROUTING,
  FREEZE_POINT_DELIVERY,
  FREEZE_POINT_EVENT
]

const STRICT_SWITCH_FIELDS = new Set([
  'schemaVersion',
  'routingStrategyVersion',
  'placementConfigVersion',
  'configResolutionContractVersion',
  'versionGateContractVersion'
])

const REQUIRED_ANCHOR_FIELDS = [
  'schemaVersion',
  'routingStrategyVersion',
  'placementConfigVersion',
  'globalConfigVersion',
  'appConfigVersionOrNA',
  'placementSourceVersionOrNA',
  'configResolutionContractVersion',
  'versionGateContractVersion',
  'enumDictVersion',
  'mappingRuleVersion',
  'policyRuleVersion',
  'routingPolicyVersion',
  'deliveryRuleVersion',
  'eventContractVersion',
  'dedupFingerprintVersion',
  'closureRuleVersion',
  'billingRuleVersion',
  'archiveContractVersion'
]

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

function stableStringify(value) {
  return JSON.stringify(stableClone(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function freezeRank(freezePoint) {
  const index = FREEZE_ORDER.indexOf(freezePoint)
  return index >= 0 ? index : -1
}

function normalizeText(value) {
  return String(value || '').trim()
}

function calculateAnchorHash(anchorSet) {
  return sha256(stableStringify(anchorSet))
}

function buildInitialAnchorSet(input) {
  const appliedVersions = isPlainObject(input?.resolvedConfigSnapshot?.appliedVersions)
    ? input.resolvedConfigSnapshot.appliedVersions
    : {}
  const moduleRef = isPlainObject(input?.moduleVersionRefs)
    ? input.moduleVersionRefs
    : {}

  return {
    schemaVersion: normalizeText(appliedVersions.schemaVersion),
    routingStrategyVersion: normalizeText(appliedVersions.routingStrategyVersion),
    placementConfigVersion: normalizeText(appliedVersions.placementConfigVersion),
    globalConfigVersion: normalizeText(appliedVersions.globalConfigVersion),
    appConfigVersionOrNA: normalizeText(appliedVersions.appConfigVersionOrNA) || 'NA',
    placementSourceVersionOrNA: normalizeText(appliedVersions.placementSourceVersionOrNA) || 'NA',
    configResolutionContractVersion: normalizeText(input?.resolvedConfigSnapshot?.configResolutionContractVersion),
    versionGateContractVersion: normalizeText(input?.versionGateDecision?.versionGateContractVersion),
    enumDictVersion: normalizeText(moduleRef.enumDictVersion),
    mappingRuleVersion: normalizeText(moduleRef.mappingRuleVersion),
    policyRuleVersion: normalizeText(moduleRef.policyRuleVersion),
    routingPolicyVersion: normalizeText(moduleRef.routingPolicyVersion),
    deliveryRuleVersion: normalizeText(moduleRef.deliveryRuleVersion),
    eventContractVersion: normalizeText(moduleRef.eventContractVersion),
    dedupFingerprintVersion: normalizeText(moduleRef.dedupFingerprintVersion),
    closureRuleVersion: normalizeText(moduleRef.closureRuleVersion),
    billingRuleVersion: normalizeText(moduleRef.billingRuleVersion),
    archiveContractVersion: normalizeText(moduleRef.archiveContractVersion)
  }
}

function buildFreezeState(previous, freezePoint) {
  if (!previous) {
    return {
      currentFreezePoint: freezePoint,
      completedFreezePoints: [freezePoint]
    }
  }

  const priorList = Array.isArray(previous.completedFreezePoints)
    ? previous.completedFreezePoints.filter((item) => FREEZE_ORDER.includes(item))
    : []
  const set = new Set(priorList)
  set.add(freezePoint)
  const completedFreezePoints = FREEZE_ORDER.filter((item) => set.has(item))

  return {
    currentFreezePoint: freezePoint,
    completedFreezePoints
  }
}

function missingRequiredField(anchorSet) {
  for (const field of REQUIRED_ANCHOR_FIELDS) {
    if (!normalizeText(anchorSet[field])) {
      return field
    }
  }
  return ''
}

function buildRejectedSnapshot(baseInput, freezeState, anchorSet, reasonCode) {
  const safeAnchorSet = stableClone(anchorSet)
  return {
    requestKey: normalizeText(baseInput.requestKey),
    traceKey: normalizeText(baseInput.traceKey),
    anchorSet: safeAnchorSet,
    anchorHash: calculateAnchorHash(safeAnchorSet),
    freezeState: {
      ...freezeState,
      anchorAction: 'reject'
    },
    reasonCodes: [reasonCode],
    injectedAt: normalizeText(baseInput.injectAt),
    versionAnchorContractVersion: normalizeText(baseInput.versionAnchorContractVersion)
  }
}

export function injectVersionAnchors(input = {}) {
  try {
    const requestKey = normalizeText(input.requestKey)
    const traceKey = normalizeText(input.traceKey)
    const injectAt = normalizeText(input.injectAt)
    const versionAnchorContractVersion = normalizeText(input.versionAnchorContractVersion)
    const freezePoint = FREEZE_ORDER.includes(input.freezePoint) ? input.freezePoint : FREEZE_POINT_INGRESS
    const previous = isPlainObject(input.previousAnchorSnapshot) ? input.previousAnchorSnapshot : null

    if (!requestKey || !traceKey || !injectAt || !versionAnchorContractVersion) {
      return buildRejectedSnapshot(
        { requestKey, traceKey, injectAt, versionAnchorContractVersion },
        buildFreezeState(previous?.freezeState, freezePoint),
        previous?.anchorSet || {},
        H_ANCHOR_REASON_CODES.MISSING_REQUIRED
      )
    }

    if (previous && normalizeText(previous.anchorHash)) {
      const expected = calculateAnchorHash(previous.anchorSet || {})
      if (expected !== previous.anchorHash) {
        return buildRejectedSnapshot(
          { requestKey, traceKey, injectAt, versionAnchorContractVersion },
          buildFreezeState(previous.freezeState, freezePoint),
          previous.anchorSet || {},
          H_ANCHOR_REASON_CODES.SNAPSHOT_HASH_MISMATCH
        )
      }
    }

    const baseAnchorSet = previous ? stableClone(previous.anchorSet || {}) : {}
    const nextAnchorSet = buildInitialAnchorSet(input)

    const previousFreezeState = previous?.freezeState
    const previousFreezePoint = normalizeText(previousFreezeState?.currentFreezePoint)
    const previousRank = freezeRank(previousFreezePoint || FREEZE_POINT_INGRESS)
    const currentRank = freezeRank(freezePoint)

    if (previous && currentRank >= 0 && previousRank >= 0 && currentRank < previousRank) {
      return buildRejectedSnapshot(
        { requestKey, traceKey, injectAt, versionAnchorContractVersion },
        buildFreezeState(previousFreezeState, previousFreezePoint || FREEZE_POINT_INGRESS),
        baseAnchorSet,
        H_ANCHOR_REASON_CODES.MUTATION_FORBIDDEN
      )
    }

    const reasonCodes = []
    for (const [field, incomingValueRaw] of Object.entries(nextAnchorSet).sort((a, b) => a[0].localeCompare(b[0]))) {
      const incomingValue = normalizeText(incomingValueRaw)
      if (!incomingValue) continue

      const existingValue = normalizeText(baseAnchorSet[field])
      if (!existingValue) {
        baseAnchorSet[field] = incomingValue
        continue
      }

      if (existingValue === incomingValue) {
        continue
      }

      if (STRICT_SWITCH_FIELDS.has(field)) {
        if (currentRank < freezeRank(FREEZE_POINT_ROUTING)) {
          return buildRejectedSnapshot(
            { requestKey, traceKey, injectAt, versionAnchorContractVersion },
            buildFreezeState(previousFreezeState, freezePoint),
            baseAnchorSet,
            H_ANCHOR_REASON_CODES.SWITCH_DETECTED_PRE_ROUTE
          )
        }

        reasonCodes.push(H_ANCHOR_REASON_CODES.SWITCH_DETECTED_POST_ROUTE)
        continue
      }

      return buildRejectedSnapshot(
        { requestKey, traceKey, injectAt, versionAnchorContractVersion },
        buildFreezeState(previousFreezeState, freezePoint),
        baseAnchorSet,
        H_ANCHOR_REASON_CODES.MUTATION_FORBIDDEN
      )
    }

    const missingField = missingRequiredField(baseAnchorSet)
    if (missingField) {
      return buildRejectedSnapshot(
        { requestKey, traceKey, injectAt, versionAnchorContractVersion },
        buildFreezeState(previousFreezeState, freezePoint),
        baseAnchorSet,
        H_ANCHOR_REASON_CODES.MISSING_REQUIRED
      )
    }

    const freezeState = {
      ...buildFreezeState(previousFreezeState, freezePoint),
      anchorAction: reasonCodes.includes(H_ANCHOR_REASON_CODES.SWITCH_DETECTED_POST_ROUTE) ? 'degrade' : 'allow'
    }
    const anchorHash = calculateAnchorHash(baseAnchorSet)

    return {
      requestKey,
      traceKey,
      anchorSet: stableClone(baseAnchorSet),
      anchorHash,
      freezeState,
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : [H_ANCHOR_REASON_CODES.ALL_PASS],
      injectedAt: injectAt,
      versionAnchorContractVersion
    }
  } catch {
    return {
      requestKey: normalizeText(input.requestKey),
      traceKey: normalizeText(input.traceKey),
      anchorSet: {},
      anchorHash: calculateAnchorHash({}),
      freezeState: {
        currentFreezePoint: FREEZE_POINT_INGRESS,
        completedFreezePoints: [FREEZE_POINT_INGRESS],
        anchorAction: 'reject'
      },
      reasonCodes: [H_ANCHOR_REASON_CODES.INJECTION_FAILED],
      injectedAt: normalizeText(input.injectAt),
      versionAnchorContractVersion: normalizeText(input.versionAnchorContractVersion)
    }
  }
}
