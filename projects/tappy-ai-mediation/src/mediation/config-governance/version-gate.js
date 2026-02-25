export const H_VERSION_GATE_REASON_CODES = Object.freeze({
  ALL_PASS: 'h_gate_all_pass',
  SCHEMA_COMPATIBLE_DEGRADE: 'h_gate_schema_compatible_degrade',
  SCHEMA_INCOMPATIBLE_REJECT: 'h_gate_schema_incompatible_reject',
  SDK_BELOW_MIN_DEGRADE: 'h_gate_sdk_below_min_degrade',
  SDK_BELOW_MIN_REJECT: 'h_gate_sdk_below_min_reject',
  ADAPTER_PARTIAL_DEGRADE: 'h_gate_adapter_partial_degrade',
  ADAPTER_ALL_BLOCKED_REJECT: 'h_gate_adapter_all_blocked_reject',
  ADAPTER_MIN_VERSION_MISSING_REJECT: 'h_gate_adapter_min_version_missing_reject',
  ADAPTER_MIN_VERSION_MISSING_BLOCKED: 'h_gate_adapter_min_version_missing_blocked',
  INVALID_VERSION_FORMAT: 'h_gate_invalid_version_format',
  MISSING_REQUIRED_VERSION: 'h_gate_missing_required_version',
  POLICY_NOT_FOUND: 'h_gate_policy_not_found'
})

const STAGE_PASS = 'pass'
const STAGE_DEGRADE = 'degrade'
const STAGE_REJECT = 'reject'

const ACTION_ALLOW = 'allow'
const ACTION_DEGRADE = 'degrade'
const ACTION_REJECT = 'reject'

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

function normalizeVersionText(value) {
  return String(value || '').trim()
}

function parseSemver(version) {
  const text = normalizeVersionText(version)
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: String(match[4] || '')
  }
}

function compareSemver(leftText, rightText) {
  const left = parseSemver(leftText)
  const right = parseSemver(rightText)
  if (!left || !right) return null

  if (left.major !== right.major) return left.major > right.major ? 1 : -1
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1

  if (!left.prerelease && right.prerelease) return 1
  if (left.prerelease && !right.prerelease) return -1
  if (left.prerelease !== right.prerelease) return left.prerelease > right.prerelease ? 1 : -1
  return 0
}

function normalizeSchemaPolicy(input) {
  if (typeof input === 'string' && input.trim()) {
    return {
      supported: new Set([input.trim()]),
      degrade: new Set()
    }
  }

  if (!isPlainObject(input)) return null

  const supported = new Set()
  const degrade = new Set()
  const supportedCandidates = [
    input.supported,
    input.fullySupportedSchemaVersions,
    input.passSchemaVersions
  ]
  const degradeCandidates = [
    input.compatibleDegrade,
    input.degradeSchemaVersions,
    input.compatibleButNeedsDegrade
  ]

  for (const candidate of supportedCandidates) {
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      const normalized = normalizeVersionText(item)
      if (normalized) supported.add(normalized)
    }
  }
  for (const candidate of degradeCandidates) {
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      const normalized = normalizeVersionText(item)
      if (normalized) degrade.add(normalized)
    }
  }

  if (supported.size === 0 && degrade.size === 0) return null
  return { supported, degrade }
}

function isGraceDegradeHit(gracePolicyRef, sdkVersion) {
  if (!isPlainObject(gracePolicyRef)) return false
  if (gracePolicyRef.allowBelowMin === true) return true

  const candidates = [
    gracePolicyRef.allowedSdkVersions,
    gracePolicyRef.compatibleDegradeVersions,
    gracePolicyRef.includeSdkVersions
  ]

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    if (candidate.map((item) => normalizeVersionText(item)).includes(sdkVersion)) {
      return true
    }
  }

  return false
}

function normalizeGateInput(gateInput, resolvedConfigSnapshot = {}) {
  const input = isPlainObject(gateInput) ? gateInput : {}
  const effectiveConfig = isPlainObject(resolvedConfigSnapshot.effectiveConfig)
    ? resolvedConfigSnapshot.effectiveConfig
    : {}

  const sdkMinVersion = normalizeVersionText(input.sdkMinVersion || effectiveConfig.sdkMinVersion)
  const missingMinVersionPolicy = normalizeVersionText(
    input.missingMinVersionPolicy || effectiveConfig.missingMinVersionPolicy
  )

  return {
    requestKey: normalizeVersionText(input.requestKey),
    traceKey: normalizeVersionText(input.traceKey),
    schemaVersion: normalizeVersionText(input.schemaVersion),
    sdkVersion: normalizeVersionText(input.sdkVersion),
    adapterVersionMap: isPlainObject(input.adapterVersionMap) ? stableClone(input.adapterVersionMap) : {},
    sdkMinVersion,
    adapterMinVersionMap: isPlainObject(input.adapterMinVersionMap || effectiveConfig.adapterMinVersionMap)
      ? stableClone(input.adapterMinVersionMap || effectiveConfig.adapterMinVersionMap)
      : {},
    missingMinVersionPolicy,
    schemaCompatibilityPolicyRef: input.schemaCompatibilityPolicyRef,
    gateAt: normalizeVersionText(input.gateAt),
    versionGateContractVersion: normalizeVersionText(input.versionGateContractVersion),
    gracePolicyRef: isPlainObject(input.gracePolicyRef) ? stableClone(input.gracePolicyRef) : null,
    extensions: isPlainObject(input.extensions) ? stableClone(input.extensions) : undefined
  }
}

function buildDecisionBase(input) {
  return {
    requestKey: input.requestKey,
    traceKey: input.traceKey,
    gateAction: ACTION_ALLOW,
    gateStageResult: {
      schemaGate: STAGE_PASS,
      sdkGate: STAGE_PASS,
      adapterGate: STAGE_PASS
    },
    compatibleAdapters: [],
    blockedAdapters: [],
    reasonCodes: [],
    gateAt: input.gateAt,
    versionGateContractVersion: input.versionGateContractVersion,
    ...(input.extensions ? { extensions: stableClone(input.extensions) } : {})
  }
}

function finalizeReject(decision, stageName, reasonCode) {
  const result = stableClone(decision)
  result.gateAction = ACTION_REJECT
  result.gateStageResult[stageName] = STAGE_REJECT
  if (stageName === 'schemaGate') {
    result.gateStageResult.sdkGate = STAGE_REJECT
    result.gateStageResult.adapterGate = STAGE_REJECT
  } else if (stageName === 'sdkGate') {
    result.gateStageResult.adapterGate = STAGE_REJECT
  }
  result.reasonCodes = [reasonCode]
  return result
}

function validateRequired(input) {
  const required = [
    input.requestKey,
    input.traceKey,
    input.schemaVersion,
    input.sdkVersion,
    input.sdkMinVersion,
    input.missingMinVersionPolicy,
    input.gateAt,
    input.versionGateContractVersion
  ]
  const hasBaseRequired = required.every(Boolean)
  if (!hasBaseRequired) return false
  if (!isPlainObject(input.adapterVersionMap)) return false
  if (!isPlainObject(input.adapterMinVersionMap)) return false
  return true
}

export function evaluateVersionGate(gateInput, resolvedConfigSnapshot = {}) {
  const input = normalizeGateInput(gateInput, resolvedConfigSnapshot)
  const decision = buildDecisionBase(input)

  if (!validateRequired(input)) {
    return finalizeReject(decision, 'schemaGate', H_VERSION_GATE_REASON_CODES.MISSING_REQUIRED_VERSION)
  }

  const schemaPolicy = normalizeSchemaPolicy(input.schemaCompatibilityPolicyRef)
  if (!schemaPolicy) {
    return finalizeReject(decision, 'schemaGate', H_VERSION_GATE_REASON_CODES.POLICY_NOT_FOUND)
  }

  if (!parseSemver(input.schemaVersion) || !parseSemver(input.sdkVersion) || !parseSemver(input.sdkMinVersion)) {
    return finalizeReject(decision, 'schemaGate', H_VERSION_GATE_REASON_CODES.INVALID_VERSION_FORMAT)
  }

  for (const [adapterId, adapterVersion] of Object.entries(input.adapterVersionMap).sort((a, b) => a[0].localeCompare(b[0]))) {
    const normalizedVersion = normalizeVersionText(adapterVersion)
    if (!parseSemver(normalizedVersion)) {
      return finalizeReject(decision, 'adapterGate', H_VERSION_GATE_REASON_CODES.INVALID_VERSION_FORMAT)
    }

    const minVersion = normalizeVersionText(input.adapterMinVersionMap[adapterId])
    if (minVersion && !parseSemver(minVersion)) {
      return finalizeReject(decision, 'adapterGate', H_VERSION_GATE_REASON_CODES.INVALID_VERSION_FORMAT)
    }
  }

  const degradeReasons = []

  if (schemaPolicy.supported.has(input.schemaVersion)) {
    // pass
  } else if (schemaPolicy.degrade.has(input.schemaVersion)) {
    decision.gateStageResult.schemaGate = STAGE_DEGRADE
    degradeReasons.push(H_VERSION_GATE_REASON_CODES.SCHEMA_COMPATIBLE_DEGRADE)
  } else {
    return finalizeReject(decision, 'schemaGate', H_VERSION_GATE_REASON_CODES.SCHEMA_INCOMPATIBLE_REJECT)
  }

  const sdkCompare = compareSemver(input.sdkVersion, input.sdkMinVersion)
  if (sdkCompare === null) {
    return finalizeReject(decision, 'sdkGate', H_VERSION_GATE_REASON_CODES.INVALID_VERSION_FORMAT)
  }

  if (sdkCompare < 0) {
    if (isGraceDegradeHit(input.gracePolicyRef, input.sdkVersion)) {
      decision.gateStageResult.sdkGate = STAGE_DEGRADE
      degradeReasons.push(H_VERSION_GATE_REASON_CODES.SDK_BELOW_MIN_DEGRADE)
    } else {
      return finalizeReject(decision, 'sdkGate', H_VERSION_GATE_REASON_CODES.SDK_BELOW_MIN_REJECT)
    }
  }

  const compatibleAdapters = []
  const blockedAdapters = []
  let missingMinBlocked = false
  let incompatibleCount = 0

  const adapterIds = Object.keys(input.adapterVersionMap).sort((a, b) => a.localeCompare(b))
  for (const adapterId of adapterIds) {
    const adapterVersion = normalizeVersionText(input.adapterVersionMap[adapterId])
    const minVersion = normalizeVersionText(input.adapterMinVersionMap[adapterId])

    if (!minVersion) {
      if (input.missingMinVersionPolicy === 'reject') {
        return finalizeReject(decision, 'adapterGate', H_VERSION_GATE_REASON_CODES.ADAPTER_MIN_VERSION_MISSING_REJECT)
      }

      blockedAdapters.push(adapterId)
      missingMinBlocked = true
      continue
    }

    const cmp = compareSemver(adapterVersion, minVersion)
    if (cmp === null) {
      return finalizeReject(decision, 'adapterGate', H_VERSION_GATE_REASON_CODES.INVALID_VERSION_FORMAT)
    }

    if (cmp >= 0) {
      compatibleAdapters.push(adapterId)
    } else {
      blockedAdapters.push(adapterId)
      incompatibleCount += 1
    }
  }

  decision.compatibleAdapters = compatibleAdapters
  decision.blockedAdapters = blockedAdapters

  if (adapterIds.length > 0 && compatibleAdapters.length === 0) {
    return finalizeReject(decision, 'adapterGate', H_VERSION_GATE_REASON_CODES.ADAPTER_ALL_BLOCKED_REJECT)
  }

  if (blockedAdapters.length > 0) {
    decision.gateStageResult.adapterGate = STAGE_DEGRADE
    if (missingMinBlocked) {
      degradeReasons.push(H_VERSION_GATE_REASON_CODES.ADAPTER_MIN_VERSION_MISSING_BLOCKED)
    }
    if (incompatibleCount > 0 || missingMinBlocked) {
      degradeReasons.push(H_VERSION_GATE_REASON_CODES.ADAPTER_PARTIAL_DEGRADE)
    }
  }

  if (degradeReasons.length > 0) {
    decision.gateAction = ACTION_DEGRADE
    decision.reasonCodes = degradeReasons
    return decision
  }

  decision.gateAction = ACTION_ALLOW
  decision.reasonCodes = [H_VERSION_GATE_REASON_CODES.ALL_PASS]
  return decision
}
