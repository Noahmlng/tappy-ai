const MODE_ORDER = Object.freeze([
  'video_vast_container',
  'mraid_container',
  'webview',
  'native_card'
])

const MODE_FAIL_CODES = Object.freeze({
  mraid_container: 'e_gate_mraid_not_supported',
  webview: 'e_gate_webview_not_supported',
  native_card: 'e_gate_native_not_supported',
  video_vast_container: 'e_gate_video_not_supported'
})

export const E_RENDER_GATE_REASON_CODES = Object.freeze({
  GATE_READY: 'e_gate_ready',
  INVALID_INPUT: 'e_compose_invalid_structure',
  INVALID_VERSION_ANCHOR: 'e_compose_invalid_version_anchor',
  POLICY_MODE_DISALLOWED: 'e_gate_policy_mode_disallowed',
  ALL_MODES_REJECTED: 'e_gate_all_modes_rejected',
  MODE_PASS: 'e_gate_mode_pass'
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))]
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
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

function requiredTraceKeys(traceKeys) {
  return [
    normalizeText(traceKeys.traceKey),
    normalizeText(traceKeys.requestKey),
    normalizeText(traceKeys.attemptKey),
    normalizeText(traceKeys.opportunityKey)
  ].every(Boolean)
}

function validateVersionSnapshot(versionSnapshot) {
  return [
    normalizeText(versionSnapshot.renderPolicyVersion),
    normalizeText(versionSnapshot.deviceCapabilityProfileVersion),
    normalizeText(versionSnapshot.placementConfigVersion)
  ].every(Boolean)
}

function buildModeChain(allowedRenderModes) {
  if (allowedRenderModes.includes('video_vast_container')) {
    return ['video_vast_container', 'mraid_container', 'webview', 'native_card']
  }
  return ['mraid_container', 'webview', 'native_card']
}

function evaluateOneMode({
  mode,
  allowedRenderModes,
  supportedRenderModes,
  deviceCapabilities,
  disallowRenderModes
}) {
  const placementPass = allowedRenderModes.includes(mode)
  let devicePass = false
  if (mode === 'mraid_container') {
    devicePass = supportedRenderModes.includes(mode) && deviceCapabilities.mraidSupported === true
  } else if (mode === 'webview') {
    devicePass = supportedRenderModes.includes(mode) && deviceCapabilities.webviewSupported === true
  } else if (mode === 'native_card') {
    devicePass = supportedRenderModes.includes(mode) && Number(deviceCapabilities.maxRenderSlotCount) >= 1
  } else if (mode === 'video_vast_container') {
    devicePass = supportedRenderModes.includes(mode) && deviceCapabilities.videoVastSupported === true
  }
  const policyPass = !disallowRenderModes.includes(mode)

  if (!policyPass) {
    return {
      mode,
      gateResult: 'fail',
      gateReasonCode: E_RENDER_GATE_REASON_CODES.POLICY_MODE_DISALLOWED
    }
  }
  if (placementPass && devicePass) {
    return {
      mode,
      gateResult: 'pass',
      gateReasonCode: E_RENDER_GATE_REASON_CODES.MODE_PASS
    }
  }
  return {
    mode,
    gateResult: 'fail',
    gateReasonCode: MODE_FAIL_CODES[mode]
  }
}

export function createRenderGate(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const gateRuleVersion = normalizeText(options.gateRuleVersion) || 'e_gate_rule_v1'

  function evaluate(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const traceKeys = isPlainObject(request.traceKeys) ? request.traceKeys : {}
    const placementSpecLite = isPlainObject(request.placementSpecLite) ? request.placementSpecLite : {}
    const deviceCapabilitiesLite = isPlainObject(request.deviceCapabilitiesLite) ? request.deviceCapabilitiesLite : {}
    const policyConstraintsLite = isPlainObject(request.policyConstraintsLite) ? request.policyConstraintsLite : {}
    const versionSnapshot = isPlainObject(request.versionSnapshot) ? request.versionSnapshot : {}

    if (!requiredTraceKeys(traceKeys)) {
      return {
        ok: false,
        reasonCode: E_RENDER_GATE_REASON_CODES.INVALID_INPUT,
        renderCapabilityGateSnapshotLite: null
      }
    }
    if (
      !isPlainObject(placementSpecLite) ||
      !isPlainObject(deviceCapabilitiesLite) ||
      !isPlainObject(policyConstraintsLite)
    ) {
      return {
        ok: false,
        reasonCode: E_RENDER_GATE_REASON_CODES.INVALID_INPUT,
        renderCapabilityGateSnapshotLite: null
      }
    }
    if (!validateVersionSnapshot(versionSnapshot)) {
      return {
        ok: false,
        reasonCode: E_RENDER_GATE_REASON_CODES.INVALID_VERSION_ANCHOR,
        renderCapabilityGateSnapshotLite: null
      }
    }

    const allowedRenderModes = normalizeStringArray(placementSpecLite.allowedRenderModes)
    const supportedRenderModes = normalizeStringArray(deviceCapabilitiesLite.supportedRenderModes)
    const disallowRenderModes = normalizeStringArray(policyConstraintsLite?.renderConstraints?.disallowRenderModes)
    const bcat = normalizeStringArray(policyConstraintsLite?.categoryConstraints?.bcat)
    const badv = normalizeStringArray(policyConstraintsLite?.categoryConstraints?.badv)
    const modeChain = buildModeChain(allowedRenderModes)

    const modeEvaluations = MODE_ORDER.map((mode) => (
      evaluateOneMode({
        mode,
        allowedRenderModes,
        supportedRenderModes,
        deviceCapabilities: deviceCapabilitiesLite,
        disallowRenderModes
      })
    ))

    const evaluationMap = new Map(modeEvaluations.map((item) => [item.mode, item]))
    const eligibleModes = modeChain.filter((mode) => evaluationMap.get(mode)?.gateResult === 'pass')
    const selectedRenderMode = eligibleModes[0] || 'none'

    const degradePath = []
    for (const mode of modeChain) {
      if (mode === selectedRenderMode) break
      const modeEval = evaluationMap.get(mode)
      if (!modeEval || modeEval.gateResult !== 'fail') continue
      degradePath.push({
        rejectedMode: mode,
        rejectReasonCode: modeEval.gateReasonCode
      })
    }
    if (selectedRenderMode === 'none') {
      for (const mode of modeChain) {
        const modeEval = evaluationMap.get(mode)
        if (!modeEval || modeEval.gateResult !== 'fail') continue
        if (!degradePath.find((item) => item.rejectedMode === mode)) {
          degradePath.push({
            rejectedMode: mode,
            rejectReasonCode: modeEval.gateReasonCode
          })
        }
      }
    }

    const hasPolicyDisallowed = modeEvaluations.some(
      (item) => item.gateResult === 'fail' && item.gateReasonCode === E_RENDER_GATE_REASON_CODES.POLICY_MODE_DISALLOWED
    )
    const finalGateReasonCode = selectedRenderMode !== 'none'
      ? E_RENDER_GATE_REASON_CODES.MODE_PASS
      : (hasPolicyDisallowed
        ? E_RENDER_GATE_REASON_CODES.POLICY_MODE_DISALLOWED
        : E_RENDER_GATE_REASON_CODES.ALL_MODES_REJECTED)

    const renderCapabilityGateSnapshotLite = {
      traceKeys: {
        traceKey: normalizeText(traceKeys.traceKey),
        requestKey: normalizeText(traceKeys.requestKey),
        attemptKey: normalizeText(traceKeys.attemptKey),
        opportunityKey: normalizeText(traceKeys.opportunityKey)
      },
      placementModes: {
        allowedRenderModes
      },
      deviceModes: {
        supportedRenderModes,
        webviewSupported: deviceCapabilitiesLite.webviewSupported === true,
        mraidSupported: deviceCapabilitiesLite.mraidSupported === true,
        videoVastSupported: deviceCapabilitiesLite.videoVastSupported === true
      },
      policyModes: {
        disallowRenderModes,
        nonPersonalizedOnly: policyConstraintsLite?.personalizationConstraints?.nonPersonalizedOnly === true,
        bcat,
        badv
      },
      modeEvaluations,
      selectionDecision: {
        eligibleModes,
        selectedRenderMode,
        degradePath,
        finalGateReasonCode
      },
      versionSnapshot: {
        renderPolicyVersion: normalizeText(versionSnapshot.renderPolicyVersion),
        deviceCapabilityProfileVersion: normalizeText(versionSnapshot.deviceCapabilityProfileVersion),
        placementConfigVersion: normalizeText(versionSnapshot.placementConfigVersion),
        gateRuleVersion: normalizeText(versionSnapshot.gateRuleVersion) || gateRuleVersion
      },
      snapshotAt: nowIso(nowFn)
    }

    return {
      ok: true,
      reasonCode: E_RENDER_GATE_REASON_CODES.GATE_READY,
      selectedRenderMode,
      deliveryHint: selectedRenderMode === 'none' ? 'no_fill' : 'served',
      renderCapabilityGateSnapshotLite: stableClone(renderCapabilityGateSnapshotLite)
    }
  }

  return {
    evaluate
  }
}
