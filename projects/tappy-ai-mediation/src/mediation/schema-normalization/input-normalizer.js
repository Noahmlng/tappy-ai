import {
  B_ENUM_DICT_VERSION,
  resolveCanonicalEnum
} from './canonical-dict.js'

export const B_INPUT_REASON_CODES = Object.freeze({
  INPUT_MAPPED_COMPLETE: 'b_input_mapped_complete',
  MISSING_REQUIRED_FIELD: 'b_missing_required_field',
  OPTIONAL_DEFAULT_APPLIED: 'b_optional_default_applied',
  SOURCE_SLOT_EMPTY: 'b_source_slot_empty',
  INVALID_STRUCTURE: 'b_invalid_structure',
  INVALID_TRACE_CONTEXT: 'b_invalid_trace_context',
  INVALID_REQUIRED_ENUM: 'b_invalid_required_enum',
  INVALID_OPTIONAL_ENUM: 'b_invalid_optional_enum',
  VALUE_CORRECTED: 'b_value_corrected',
  INVALID_VALUE_RANGE: 'b_invalid_value_range'
})

const TRACE_KEY_PATTERN = /^[a-z][a-z0-9_:-]{7,}$/i
const APP_CONTEXT_MIN_SLOTS = Object.freeze([
  'language',
  'session_state',
  'device_performance_score',
  'privacy_status'
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function hasValue(value) {
  return value !== undefined && value !== null && normalizeText(value) !== ''
}

function pickFirst(...values) {
  for (const value of values) {
    if (hasValue(value)) {
      return value
    }
  }
  return ''
}

function parseConfidenceBand(rawValue) {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return {
      ok: true,
      corrected: false,
      value: rawValue
    }
  }

  if (typeof rawValue === 'string' && rawValue.trim() !== '') {
    const parsed = Number(rawValue)
    if (Number.isFinite(parsed)) {
      return {
        ok: true,
        corrected: true,
        value: parsed
      }
    }
  }

  return {
    ok: false,
    corrected: false,
    value: NaN
  }
}

function normalizeIngressPacket(input) {
  const packet = isPlainObject(input) ? input : {}
  return {
    opportunitySeed: isPlainObject(packet.opportunitySeed) ? packet.opportunitySeed : null,
    traceInitLite: isPlainObject(packet.traceInitLite) ? packet.traceInitLite : null,
    triggerSnapshotLite: isPlainObject(packet.triggerSnapshotLite) ? packet.triggerSnapshotLite : null,
    sensingDecisionLite: isPlainObject(packet.sensingDecisionLite) ? packet.sensingDecisionLite : null,
    sourceInputBundleLite: isPlainObject(packet.sourceInputBundleLite) ? packet.sourceInputBundleLite : null,
    aErrorLite: isPlainObject(packet.aErrorLite) ? packet.aErrorLite : null,
    aLatencyBudgetLite: isPlainObject(packet.aLatencyBudgetLite) ? packet.aLatencyBudgetLite : null,
    debugHints: isPlainObject(packet.debugHints) ? packet.debugHints : null,
    bInputContractVersion: normalizeText(packet.bInputContractVersion) || 'b_input_contract_v1'
  }
}

function buildRejectedResult(request, reasonCode, mappingAuditSnapshotLite = []) {
  return {
    normalizeAccepted: false,
    normalizeAction: 'reject',
    resultState: 'error',
    reasonCode,
    errorAction: 'reject',
    bInputContractVersion: request.bInputContractVersion,
    enumDictVersion: B_ENUM_DICT_VERSION,
    traceInitLite: {
      traceKey: normalizeText(request?.traceInitLite?.traceKey) || 'NA',
      requestKey: normalizeText(request?.traceInitLite?.requestKey) || 'NA',
      attemptKey: normalizeText(request?.traceInitLite?.attemptKey) || 'NA'
    },
    normalizedIngressPacketOrNA: null,
    mappingWarnings: [],
    mappingAuditSnapshotLite
  }
}

function validateRequiredMatrix(request) {
  const required = [
    request.opportunitySeed,
    request.traceInitLite,
    request.triggerSnapshotLite,
    request.sensingDecisionLite,
    request.sourceInputBundleLite
  ]

  if (required.some((entry) => !isPlainObject(entry))) {
    return B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  if (!hasValue(request.opportunitySeed.opportunityKey) || !hasValue(request.opportunitySeed.state)) {
    return B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  if (normalizeText(request.opportunitySeed.state) !== 'received') {
    return B_INPUT_REASON_CODES.INVALID_VALUE_RANGE
  }

  if (
    !hasValue(request.traceInitLite.traceKey) ||
    !hasValue(request.traceInitLite.requestKey) ||
    !hasValue(request.traceInitLite.attemptKey)
  ) {
    return B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  if (
    !hasValue(request.triggerSnapshotLite.triggerType) ||
    !hasValue(request.triggerSnapshotLite.triggerDecision) ||
    !hasValue(request.sensingDecisionLite.decisionOutcome) ||
    !hasValue(request.sensingDecisionLite.hitType) ||
    request.sensingDecisionLite.confidenceBand === undefined ||
    request.sensingDecisionLite.confidenceBand === null
  ) {
    return B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  const source = request.sourceInputBundleLite
  if (!('appExplicit' in source) || !('placementConfig' in source) || !('defaultPolicy' in source)) {
    return B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  for (const slotName of ['appExplicit', 'placementConfig', 'defaultPolicy']) {
    if (!isPlainObject(source[slotName])) {
      return B_INPUT_REASON_CODES.INVALID_STRUCTURE
    }
  }

  const appExplicit = source.appExplicit
  if (Object.keys(appExplicit).length > 0) {
    if (!isPlainObject(appExplicit.app_context)) {
      return B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD
    }

    for (const slotName of APP_CONTEXT_MIN_SLOTS) {
      if (!(slotName in appExplicit.app_context)) {
        return B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD
      }
    }
  }

  return ''
}

function validateTraceContext(request) {
  const trace = request.traceInitLite
  if (
    !TRACE_KEY_PATTERN.test(normalizeText(trace.traceKey)) ||
    !TRACE_KEY_PATTERN.test(normalizeText(trace.requestKey)) ||
    !TRACE_KEY_PATTERN.test(normalizeText(trace.attemptKey))
  ) {
    return B_INPUT_REASON_CODES.INVALID_TRACE_CONTEXT
  }

  const opportunityRequestKey = normalizeText(request.opportunitySeed.requestKey)
  if (opportunityRequestKey && opportunityRequestKey !== normalizeText(trace.requestKey)) {
    return B_INPUT_REASON_CODES.INVALID_TRACE_CONTEXT
  }

  return ''
}

function pushAuditEntry(auditEntries, entry) {
  auditEntries.push({
    ruleVersion: 'b_input_normalizer_v1',
    ...entry
  })
}

function buildWarning(semanticSlot, rawValue, normalizedValue, reasonCode, disposition) {
  return {
    semanticSlot,
    rawValue: rawValue === undefined ? null : rawValue,
    normalizedValue: normalizedValue === undefined ? null : normalizedValue,
    disposition,
    reasonCode,
    ruleVersion: 'b_input_normalizer_v1'
  }
}

function normalizeConfidenceBand(rawValue, warnings, auditEntries) {
  const parsed = parseConfidenceBand(rawValue)
  if (!parsed.ok) {
    pushAuditEntry(auditEntries, {
      semanticSlot: 'confidenceBand',
      rawValue,
      normalizedValue: null,
      disposition: 'reject',
      reasonCode: B_INPUT_REASON_CODES.INVALID_VALUE_RANGE
    })
    return {
      ok: false,
      reasonCode: B_INPUT_REASON_CODES.INVALID_VALUE_RANGE,
      value: NaN
    }
  }

  let correctedValue = parsed.value
  let corrected = parsed.corrected
  if (correctedValue < 0) {
    correctedValue = 0
    corrected = true
  }
  if (correctedValue > 1) {
    correctedValue = 1
    corrected = true
  }

  if (corrected) {
    const warning = buildWarning(
      'confidenceBand',
      rawValue,
      correctedValue,
      B_INPUT_REASON_CODES.VALUE_CORRECTED,
      'degrade'
    )
    warnings.push(warning)
    pushAuditEntry(auditEntries, warning)
  } else {
    pushAuditEntry(auditEntries, {
      semanticSlot: 'confidenceBand',
      rawValue,
      normalizedValue: correctedValue,
      disposition: 'continue',
      reasonCode: B_INPUT_REASON_CODES.INPUT_MAPPED_COMPLETE
    })
  }

  return {
    ok: true,
    reasonCode: corrected ? B_INPUT_REASON_CODES.VALUE_CORRECTED : '',
    value: correctedValue
  }
}

function mapSemanticSlot(options) {
  const {
    semanticSlot,
    rawValue,
    required,
    warnings,
    auditEntries
  } = options
  const mapping = resolveCanonicalEnum(semanticSlot, rawValue)
  if (!mapping.ok) {
    pushAuditEntry(auditEntries, {
      semanticSlot,
      rawValue,
      normalizedValue: null,
      disposition: 'reject',
      reasonCode: B_INPUT_REASON_CODES.INVALID_STRUCTURE,
      mappingAction: 'reject',
      enumDictVersion: B_ENUM_DICT_VERSION
    })
    return {
      ok: false,
      reasonCode: B_INPUT_REASON_CODES.INVALID_STRUCTURE,
      canonicalValue: ''
    }
  }

  if (mapping.mappingAction === 'unknown_fallback') {
    if (required || mapping.gating) {
      pushAuditEntry(auditEntries, {
        semanticSlot,
        rawValue,
        normalizedValue: mapping.canonicalValue,
        disposition: 'reject',
        reasonCode: B_INPUT_REASON_CODES.INVALID_REQUIRED_ENUM,
        mappingAction: 'reject',
        enumDictVersion: B_ENUM_DICT_VERSION
      })
      return {
        ok: false,
        reasonCode: B_INPUT_REASON_CODES.INVALID_REQUIRED_ENUM,
        canonicalValue: mapping.canonicalValue
      }
    }

    const reasonCode = hasValue(rawValue)
      ? B_INPUT_REASON_CODES.INVALID_OPTIONAL_ENUM
      : B_INPUT_REASON_CODES.OPTIONAL_DEFAULT_APPLIED
    const warning = buildWarning(
      semanticSlot,
      rawValue,
      mapping.canonicalValue,
      reasonCode,
      'degrade'
    )
    warning.mappingAction = 'unknown_fallback'
    warning.enumDictVersion = B_ENUM_DICT_VERSION
    warnings.push(warning)
    pushAuditEntry(auditEntries, warning)

    return {
      ok: true,
      reasonCode,
      canonicalValue: mapping.canonicalValue
    }
  }

  pushAuditEntry(auditEntries, {
    semanticSlot,
    rawValue,
    normalizedValue: mapping.canonicalValue,
    disposition: 'continue',
    reasonCode: B_INPUT_REASON_CODES.INPUT_MAPPED_COMPLETE,
    mappingAction: mapping.mappingAction,
    enumDictVersion: B_ENUM_DICT_VERSION
  })
  return {
    ok: true,
    reasonCode: '',
    canonicalValue: mapping.canonicalValue
  }
}

export function createInputNormalizerService() {
  function normalizeInput(input) {
    const request = normalizeIngressPacket(input)

    const requiredReason = validateRequiredMatrix(request)
    if (requiredReason) {
      return buildRejectedResult(request, requiredReason)
    }

    const traceReason = validateTraceContext(request)
    if (traceReason) {
      return buildRejectedResult(request, traceReason)
    }

    const warnings = []
    const auditEntries = []
    const source = request.sourceInputBundleLite
    for (const slotName of ['appExplicit', 'placementConfig', 'defaultPolicy']) {
      if (Object.keys(source[slotName]).length === 0) {
        const warning = buildWarning(slotName, {}, {}, B_INPUT_REASON_CODES.SOURCE_SLOT_EMPTY, 'degrade')
        warnings.push(warning)
        pushAuditEntry(auditEntries, warning)
      }
    }

    const confidenceBandResult = normalizeConfidenceBand(
      request.sensingDecisionLite.confidenceBand,
      warnings,
      auditEntries
    )
    if (!confidenceBandResult.ok) {
      return buildRejectedResult(request, confidenceBandResult.reasonCode, auditEntries)
    }

    const semanticInputs = {
      triggerDecision: request.triggerSnapshotLite.triggerDecision,
      decisionOutcome: request.sensingDecisionLite.decisionOutcome,
      hitType: request.sensingDecisionLite.hitType,
      placementType: pickFirst(
        request.opportunitySeed.placementType,
        request.sourceInputBundleLite.placementConfig.placementType
      ),
      actorType: pickFirst(
        request.opportunitySeed.actorType,
        request.sourceInputBundleLite.appExplicit.actorType
      ),
      channelType: pickFirst(
        request.opportunitySeed.channelType,
        request.sourceInputBundleLite.appExplicit.channelType
      )
    }

    const mapped = {}
    for (const [semanticSlot, rawValue] of Object.entries(semanticInputs)) {
      const mapping = mapSemanticSlot({
        semanticSlot,
        rawValue,
        required: semanticSlot === 'triggerDecision' || semanticSlot === 'decisionOutcome' || semanticSlot === 'hitType',
        warnings,
        auditEntries
      })
      if (!mapping.ok) {
        return buildRejectedResult(request, mapping.reasonCode, auditEntries)
      }
      mapped[semanticSlot] = mapping.canonicalValue
    }

    const normalizeAction = warnings.length > 0 ? 'degrade' : 'continue'
    const reasonCode = warnings.length > 0 ? warnings[0].reasonCode : B_INPUT_REASON_CODES.INPUT_MAPPED_COMPLETE
    const resultState = warnings.length > 0 ? 'partial' : 'mapped'

    return {
      normalizeAccepted: true,
      normalizeAction,
      resultState,
      reasonCode,
      errorAction: normalizeAction === 'continue' ? 'allow' : 'degrade',
      bInputContractVersion: request.bInputContractVersion,
      enumDictVersion: B_ENUM_DICT_VERSION,
      traceInitLite: {
        traceKey: normalizeText(request.traceInitLite.traceKey),
        requestKey: normalizeText(request.traceInitLite.requestKey),
        attemptKey: normalizeText(request.traceInitLite.attemptKey)
      },
      normalizedIngressPacketOrNA: {
        opportunitySeed: {
          opportunityKey: normalizeText(request.opportunitySeed.opportunityKey),
          state: normalizeText(request.opportunitySeed.state),
          requestKey: normalizeText(request.traceInitLite.requestKey),
          triggerType: normalizeText(request.triggerSnapshotLite.triggerType)
        },
        canonicalSignals: {
          triggerDecision: mapped.triggerDecision,
          decisionOutcome: mapped.decisionOutcome,
          hitType: mapped.hitType,
          placementType: mapped.placementType,
          actorType: mapped.actorType,
          channelType: mapped.channelType,
          confidenceBand: confidenceBandResult.value
        },
        sourceInputBundleLite: request.sourceInputBundleLite
      },
      mappingWarnings: warnings,
      mappingAuditSnapshotLite: auditEntries
    }
  }

  return {
    normalizeInput
  }
}
