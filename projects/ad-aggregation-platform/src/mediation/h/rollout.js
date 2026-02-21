import crypto from 'node:crypto'

export const H_ROLLOUT_REASON_CODES = Object.freeze({
  SELECTOR_EXCLUDED: 'h_rollout_selector_excluded',
  SELECTOR_NOT_MATCHED: 'h_rollout_selector_not_matched',
  IN_EXPERIMENT: 'h_rollout_in_experiment',
  OUT_OF_EXPERIMENT: 'h_rollout_out_of_experiment',
  INVALID_PERCENT: 'h_rollout_invalid_percent',
  SPLIT_KEY_FALLBACK_TRACE: 'h_rollout_split_key_missing_fallback_trace',
  CIRCUIT_BREAKER_TRIGGERED: 'h_rollout_circuit_breaker_triggered',
  FORCE_FALLBACK_APPLIED: 'h_rollout_force_fallback_applied',
  POLICY_NOT_FOUND: 'h_rollout_policy_not_found'
})

const REQUIRED_FIELDS = [
  'requestKey',
  'traceKey',
  'appId',
  'placementId',
  'sdkVersion',
  'adapterIds',
  'environment',
  'rolloutPolicyVersion',
  'rolloutAt',
  'rolloutContractVersion'
]

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000
const DEFAULT_HALF_OPEN_PERCENT = 1

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

function normalizeText(value) {
  return String(value || '').trim()
}

function parseSemver(version) {
  const text = normalizeText(version)
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

function normalizeRequestContext(input) {
  const context = isPlainObject(input) ? input : {}
  return {
    requestKey: normalizeText(context.requestKey),
    traceKey: normalizeText(context.traceKey),
    appId: normalizeText(context.appId),
    placementId: normalizeText(context.placementId),
    sdkVersion: normalizeText(context.sdkVersion),
    adapterIds: Array.isArray(context.adapterIds)
      ? context.adapterIds.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    environment: normalizeText(context.environment).toLowerCase(),
    rolloutPolicyVersion: normalizeText(context.rolloutPolicyVersion),
    rolloutAt: normalizeText(context.rolloutAt),
    rolloutContractVersion: normalizeText(context.rolloutContractVersion),
    userBucketHintOrNA: normalizeText(context.userBucketHintOrNA),
    extensions: isPlainObject(context.extensions) ? stableClone(context.extensions) : undefined,
    rolloutMetrics: isPlainObject(context.rolloutMetrics) ? stableClone(context.rolloutMetrics) : {}
  }
}

function normalizePolicy(input) {
  if (!isPlainObject(input)) return null
  return {
    policyId: normalizeText(input.policyId),
    lastStablePolicyId: normalizeText(input.lastStablePolicyId),
    rolloutPercent: Number(input.rolloutPercent),
    controlPercent: Number(input.controlPercent),
    adapterRolloutPercentMap: isPlainObject(input.adapterRolloutPercentMap)
      ? stableClone(input.adapterRolloutPercentMap)
      : {},
    appSelector: isPlainObject(input.appSelector) ? stableClone(input.appSelector) : {},
    placementSelector: isPlainObject(input.placementSelector) ? stableClone(input.placementSelector) : {},
    sdkSelector: isPlainObject(input.sdkSelector) ? stableClone(input.sdkSelector) : {},
    adapterSelector: isPlainObject(input.adapterSelector) ? stableClone(input.adapterSelector) : {},
    errorRateThreshold: Number(input.errorRateThreshold),
    noFillRateThreshold: Number(input.noFillRateThreshold),
    latencyP95ThresholdMs: Number(input.latencyP95ThresholdMs),
    criticalReasonThreshold: Number(input.criticalReasonThreshold),
    cooldownMs: Number(input.cooldownMs)
  }
}

function matchSelectorById(id, selector = {}) {
  const include = Array.isArray(selector.includeAppIds) ? selector.includeAppIds
    : Array.isArray(selector.includePlacementIds) ? selector.includePlacementIds
      : []
  const exclude = Array.isArray(selector.excludeAppIds) ? selector.excludeAppIds
    : Array.isArray(selector.excludePlacementIds) ? selector.excludePlacementIds
      : []

  const normalizedInclude = include.map((item) => normalizeText(item)).filter(Boolean)
  const normalizedExclude = exclude.map((item) => normalizeText(item)).filter(Boolean)

  if (normalizedExclude.includes(id)) {
    return { excluded: true, matched: false }
  }

  if (normalizedInclude.length > 0 && !normalizedInclude.includes(id)) {
    return { excluded: false, matched: false }
  }

  return { excluded: false, matched: true }
}

function matchSdkSelector(sdkVersion, selector = {}) {
  const min = normalizeText(selector.minSdkVersion)
  const max = normalizeText(selector.maxSdkVersionOrNA)

  if (min) {
    const cmp = compareSemver(sdkVersion, min)
    if (cmp === null || cmp < 0) return false
  }
  if (max) {
    const cmp = compareSemver(sdkVersion, max)
    if (cmp === null || cmp > 0) return false
  }
  return true
}

function matchAdapterSelector(adapterIds, selector = {}) {
  const include = Array.isArray(selector.includeAdapterIds)
    ? selector.includeAdapterIds.map((item) => normalizeText(item)).filter(Boolean)
    : []
  const exclude = Array.isArray(selector.excludeAdapterIds)
    ? selector.excludeAdapterIds.map((item) => normalizeText(item)).filter(Boolean)
    : []

  if (adapterIds.some((adapterId) => exclude.includes(adapterId))) {
    return { excluded: true, matched: false }
  }

  if (include.length === 0) {
    return { excluded: false, matched: true }
  }

  const hasIncluded = adapterIds.some((adapterId) => include.includes(adapterId))
  return { excluded: false, matched: hasIncluded }
}

function validateRolloutPercent(value) {
  if (!Number.isFinite(value)) return false
  return value >= 0 && value <= 100
}

function makeSplitKey(input, policyVersion) {
  const fallbackUsed = !normalizeText(input.userBucketHintOrNA)
  const stableKey = fallbackUsed ? input.traceKey : input.userBucketHintOrNA
  const splitSeed = [
    input.appId,
    input.placementId,
    input.sdkVersion,
    stableKey,
    policyVersion
  ].join('|')
  return {
    splitKey: sha256(splitSeed),
    fallbackUsed
  }
}

function bucketFromSplitKey(splitKey) {
  const first16 = splitKey.slice(0, 16)
  const bucket = Number(BigInt(`0x${first16}`) % 10000n) / 100
  return Number(bucket.toFixed(2))
}

function adapterBucket(splitKey, adapterId) {
  const hashed = sha256(`${splitKey}|${adapterId}`)
  return bucketFromSplitKey(hashed)
}

function normalizeDecisionBase(input, policy, splitKey, bucketValue, rolloutPercent) {
  const selectedPolicyId = normalizeText(policy?.policyId) || normalizeText(input.rolloutPolicyVersion)
  return {
    requestKey: input.requestKey,
    traceKey: input.traceKey,
    rolloutAction: 'out_of_experiment',
    selectedPolicyId,
    splitKey,
    bucketValue,
    rolloutPercent,
    allowedAdapters: [],
    blockedAdapters: [],
    reasonCodes: [],
    rolloutAt: input.rolloutAt,
    rolloutContractVersion: input.rolloutContractVersion,
    selectorDigest: {
      appSelectorMatched: true,
      placementSelectorMatched: true,
      sdkSelectorMatched: true,
      adapterSelectorMatched: true
    }
  }
}

function maybeTriggerCircuit(metrics, policy) {
  const conditions = []
  if (Number.isFinite(policy.errorRateThreshold)) {
    conditions.push(Number(metrics.error_rate) >= policy.errorRateThreshold)
  }
  if (Number.isFinite(policy.noFillRateThreshold)) {
    conditions.push(Number(metrics.no_fill_rate) >= policy.noFillRateThreshold)
  }
  if (Number.isFinite(policy.latencyP95ThresholdMs)) {
    conditions.push(Number(metrics.p95_latency_ms) >= policy.latencyP95ThresholdMs)
  }
  if (Number.isFinite(policy.criticalReasonThreshold)) {
    conditions.push(Number(metrics.critical_reason_code_count) >= policy.criticalReasonThreshold)
  }

  return conditions.some(Boolean)
}

function finalizeRolloutDecision(input, decisionInput) {
  const decision = stableClone(decisionInput)
  decision.auditSnapshot = {
    snapshotId: `rollout_${sha256(stableStringify({
      requestKey: input.requestKey,
      traceKey: input.traceKey,
      rolloutPolicyVersion: input.rolloutPolicyVersion,
      splitKey: decision.splitKey,
      bucketValue: decision.bucketValue
    })).slice(0, 16)}`,
    requestKey: input.requestKey,
    traceKey: input.traceKey,
    rolloutAction: decision.rolloutAction,
    selectedPolicyId: decision.selectedPolicyId,
    splitKey: decision.splitKey,
    bucketValue: decision.bucketValue,
    rolloutPercent: decision.rolloutPercent,
    allowedAdapters: [...decision.allowedAdapters],
    blockedAdapters: [...decision.blockedAdapters],
    reasonCodes: [...decision.reasonCodes],
    rolloutPolicyVersion: input.rolloutPolicyVersion,
    generatedAt: input.rolloutAt,
    rolloutContractVersion: input.rolloutContractVersion
  }
  return decision
}

export function createRolloutEvaluator(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const circuitStateMap = new Map()

  function evaluateRolloutSelector(requestContextInput, rolloutPolicyInput) {
    const input = normalizeRequestContext(requestContextInput)
    const policy = normalizePolicy(rolloutPolicyInput)
    const nowMs = nowFn()

    const missingRequired = REQUIRED_FIELDS.some((field) => {
      if (field === 'adapterIds') return input.adapterIds.length === 0
      return !input[field]
    })

    if (missingRequired) {
      const { splitKey } = makeSplitKey(input, input.rolloutPolicyVersion || 'rollout_policy_na')
      return finalizeRolloutDecision(input, {
        ...normalizeDecisionBase(input, policy, splitKey, bucketFromSplitKey(splitKey), 0),
        rolloutAction: 'force_fallback',
        selectedPolicyId: normalizeText(policy?.lastStablePolicyId) || 'last_stable_policy_na',
        reasonCodes: [H_ROLLOUT_REASON_CODES.POLICY_NOT_FOUND, H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED]
      })
    }

    const policyVersion = input.rolloutPolicyVersion
    const { splitKey, fallbackUsed } = makeSplitKey(input, policyVersion)
    const bucketValue = bucketFromSplitKey(splitKey)

    if (!policy) {
      const decision = normalizeDecisionBase(input, policy, splitKey, bucketValue, 0)
      decision.rolloutAction = 'force_fallback'
      decision.selectedPolicyId = 'last_stable_policy_na'
      decision.allowedAdapters = []
      decision.blockedAdapters = [...input.adapterIds]
      decision.reasonCodes = [H_ROLLOUT_REASON_CODES.POLICY_NOT_FOUND, H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED]
      if (fallbackUsed) {
        decision.reasonCodes.unshift(H_ROLLOUT_REASON_CODES.SPLIT_KEY_FALLBACK_TRACE)
      }
      return finalizeRolloutDecision(input, decision)
    }

    const releaseUnitKey = `${input.appId}|${input.placementId}|${policyVersion}`
    const cooldownMs = Number.isFinite(policy.cooldownMs) && policy.cooldownMs > 0 ? policy.cooldownMs : DEFAULT_COOLDOWN_MS
    const circuitState = circuitStateMap.get(releaseUnitKey)

    if (circuitState && circuitState.openUntilMs > nowMs) {
      return finalizeRolloutDecision(input, {
        ...normalizeDecisionBase(input, policy, splitKey, bucketValue, Number(policy.rolloutPercent)),
        rolloutAction: 'force_fallback',
        selectedPolicyId: normalizeText(policy.lastStablePolicyId) || normalizeText(policy.policyId) || 'last_stable_policy_na',
        allowedAdapters: [],
        blockedAdapters: [...input.adapterIds],
        reasonCodes: [H_ROLLOUT_REASON_CODES.CIRCUIT_BREAKER_TRIGGERED, H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED],
        ...(fallbackUsed ? { reasonCodes: [H_ROLLOUT_REASON_CODES.SPLIT_KEY_FALLBACK_TRACE, H_ROLLOUT_REASON_CODES.CIRCUIT_BREAKER_TRIGGERED, H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED] } : {})
      })
    }

    const decision = normalizeDecisionBase(input, policy, splitKey, bucketValue, Number(policy.rolloutPercent))
    if (fallbackUsed) {
      decision.reasonCodes.push(H_ROLLOUT_REASON_CODES.SPLIT_KEY_FALLBACK_TRACE)
    }

    const appMatch = matchSelectorById(input.appId, policy.appSelector)
    const placementMatch = matchSelectorById(input.placementId, policy.placementSelector)
    const sdkMatched = matchSdkSelector(input.sdkVersion, policy.sdkSelector)
    const adapterMatch = matchAdapterSelector(input.adapterIds, policy.adapterSelector)

    decision.selectorDigest = {
      appSelectorMatched: appMatch.matched,
      placementSelectorMatched: placementMatch.matched,
      sdkSelectorMatched: sdkMatched,
      adapterSelectorMatched: adapterMatch.matched
    }

    if (appMatch.excluded || placementMatch.excluded || adapterMatch.excluded) {
      decision.rolloutAction = 'out_of_experiment'
      decision.allowedAdapters = []
      decision.blockedAdapters = [...input.adapterIds]
      decision.reasonCodes.push(H_ROLLOUT_REASON_CODES.SELECTOR_EXCLUDED)
      return finalizeRolloutDecision(input, decision)
    }

    if (!appMatch.matched || !placementMatch.matched || !sdkMatched || !adapterMatch.matched) {
      decision.rolloutAction = 'out_of_experiment'
      decision.allowedAdapters = []
      decision.blockedAdapters = [...input.adapterIds]
      decision.reasonCodes.push(H_ROLLOUT_REASON_CODES.SELECTOR_NOT_MATCHED)
      return finalizeRolloutDecision(input, decision)
    }

    let effectiveRolloutPercent = Number(policy.rolloutPercent)
    if (circuitState && circuitState.openUntilMs <= nowMs) {
      // Half-open probing after cooling period.
      effectiveRolloutPercent = DEFAULT_HALF_OPEN_PERCENT
    }

    if (!validateRolloutPercent(effectiveRolloutPercent)) {
      decision.rolloutAction = 'force_fallback'
      decision.selectedPolicyId = normalizeText(policy.lastStablePolicyId) || normalizeText(policy.policyId) || 'last_stable_policy_na'
      decision.allowedAdapters = []
      decision.blockedAdapters = [...input.adapterIds]
      decision.reasonCodes.push(H_ROLLOUT_REASON_CODES.INVALID_PERCENT, H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED)
      return finalizeRolloutDecision(input, decision)
    }

    decision.rolloutPercent = effectiveRolloutPercent
    decision.rolloutAction = bucketValue < effectiveRolloutPercent ? 'in_experiment' : 'out_of_experiment'
    decision.reasonCodes.push(
      decision.rolloutAction === 'in_experiment'
        ? H_ROLLOUT_REASON_CODES.IN_EXPERIMENT
        : H_ROLLOUT_REASON_CODES.OUT_OF_EXPERIMENT
    )

    const blockedAdapters = []
    const allowedAdapters = []

    for (const adapterId of input.adapterIds) {
      const adapterPercentRaw = policy.adapterRolloutPercentMap[adapterId]
      if (adapterPercentRaw === undefined) {
        allowedAdapters.push(adapterId)
        continue
      }

      const adapterPercent = Number(adapterPercentRaw)
      if (!validateRolloutPercent(adapterPercent)) {
        blockedAdapters.push(adapterId)
        continue
      }

      const adapterBucketValue = adapterBucket(splitKey, adapterId)
      if (adapterBucketValue < adapterPercent) {
        allowedAdapters.push(adapterId)
      } else {
        blockedAdapters.push(adapterId)
      }
    }

    decision.allowedAdapters = allowedAdapters
    decision.blockedAdapters = blockedAdapters

    if (decision.rolloutAction === 'in_experiment' && allowedAdapters.length === 0) {
      decision.rolloutAction = 'force_fallback'
      decision.selectedPolicyId = normalizeText(policy.lastStablePolicyId) || normalizeText(policy.policyId) || 'last_stable_policy_na'
      decision.reasonCodes.push(H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED)
    }

    if (maybeTriggerCircuit(input.rolloutMetrics, policy)) {
      circuitStateMap.set(releaseUnitKey, {
        openedAtMs: nowMs,
        openUntilMs: nowMs + cooldownMs
      })
      decision.rolloutAction = 'force_fallback'
      decision.selectedPolicyId = normalizeText(policy.lastStablePolicyId) || normalizeText(policy.policyId) || 'last_stable_policy_na'
      decision.allowedAdapters = []
      decision.blockedAdapters = [...input.adapterIds]
      decision.reasonCodes.push(H_ROLLOUT_REASON_CODES.CIRCUIT_BREAKER_TRIGGERED, H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED)
    }

    return finalizeRolloutDecision(input, decision)
  }

  return {
    evaluateRolloutSelector,
    _debug: {
      circuitStateMap
    }
  }
}
