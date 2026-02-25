import crypto from 'node:crypto'

export const H_CONFIG_RESOLUTION_STATUSES = Object.freeze({
  RESOLVED: 'resolved',
  DEGRADED: 'degraded',
  REJECTED: 'rejected'
})

export const H_CONFIG_RESOLUTION_REASON_CODES = Object.freeze({
  MISSING_REQUIRED_AFTER_MERGE: 'h_cfg_missing_required_after_merge',
  INVALID_TYPE: 'h_cfg_invalid_type',
  INVALID_RANGE: 'h_cfg_invalid_range',
  UNKNOWN_FIELD_DROPPED: 'h_cfg_unknown_field_dropped',
  SCOPE_UNAVAILABLE: 'h_cfg_scope_unavailable',
  GLOBAL_UNAVAILABLE_FAIL_CLOSED: 'h_cfg_global_unavailable_fail_closed',
  VERSION_INCOMPATIBLE: 'h_cfg_version_incompatible'
})

const REQUEST_REQUIRED_FIELDS = Object.freeze([
  'requestKey',
  'traceKey',
  'appId',
  'placementId',
  'environment',
  'schemaVersion',
  'resolveAt',
  'configResolutionContractVersion'
])

const ALLOWED_ENVIRONMENTS = new Set(['prod'])
const MISSING_VALUE = Symbol('missing')

const FIELD_SPECS = Object.freeze({
  policyThresholdsRef: Object.freeze({ kind: 'scalar', type: 'string', required: true }),
  routePolicyRef: Object.freeze({ kind: 'scalar', type: 'string', required: true }),
  templateWhitelistRef: Object.freeze({ kind: 'scalar', type: 'string', required: true }),
  blackWhiteListRef: Object.freeze({ kind: 'scalar', type: 'string', required: true }),
  sdkMinVersion: Object.freeze({ kind: 'scalar', type: 'string', required: true }),
  adapterMinVersionMap: Object.freeze({ kind: 'map', valueType: 'string', required: true }),
  missingMinVersionPolicy: Object.freeze({
    kind: 'scalar',
    type: 'string',
    enum: ['reject', 'degrade_block_adapter'],
    required: true
  }),
  ttlSec: Object.freeze({ kind: 'scalar', type: 'number', min: 1, max: 86400, required: true }),
  experimentTagList: Object.freeze({ kind: 'array', itemType: 'string', required: false })
})

const TOP_LEVEL_CONFIG_FIELDS = new Set(Object.keys(FIELD_SPECS))
const SCOPE_META_FIELDS = new Set([
  'available',
  'config',
  'configVersion',
  'globalConfigVersion',
  'appConfigVersion',
  'placementConfigVersion',
  'placementSourceVersion',
  'sourceVersion',
  'schemaVersion',
  'routingStrategyVersion'
])

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

function toStringOrMissing(value) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : MISSING_VALUE
}

function normalizeContext(input) {
  const context = isPlainObject(input) ? input : {}
  const normalized = {}

  for (const field of REQUEST_REQUIRED_FIELDS) {
    normalized[field] = toStringOrMissing(context[field])
  }

  normalized.environment = normalized.environment === MISSING_VALUE
    ? MISSING_VALUE
    : normalized.environment.toLowerCase()
  normalized.routingStrategyVersion = toStringOrMissing(context.routingStrategyVersionOrNA ?? context.routingStrategyVersion)
  normalized.extensions = isPlainObject(context.extensions) ? stableClone(context.extensions) : undefined

  return normalized
}

function normalizeScopeConfig(rawScope = {}) {
  if (isPlainObject(rawScope.config)) {
    return stableClone(rawScope.config)
  }

  return Object.keys(rawScope)
    .filter((key) => !SCOPE_META_FIELDS.has(key))
    .reduce((acc, key) => {
      acc[key] = stableClone(rawScope[key])
      return acc
    }, {})
}

function normalizeScope(scopeName, input) {
  if (!isPlainObject(input)) {
    return {
      scope: scopeName,
      available: false,
      configVersion: scopeName === 'app' ? 'NA' : `${scopeName}_cfg_na`,
      sourceVersion: 'NA',
      schemaVersion: '',
      routingStrategyVersion: '',
      config: {}
    }
  }

  const configVersionFromInput = String(
    input.configVersion
      ?? input.globalConfigVersion
      ?? input.appConfigVersion
      ?? input.placementConfigVersion
      ?? ''
  ).trim()
  const defaultVersion = scopeName === 'app' ? 'NA' : `${scopeName}_cfg_na`

  return {
    scope: scopeName,
    available: input.available !== false,
    configVersion: configVersionFromInput || defaultVersion,
    sourceVersion: String(input.placementSourceVersion ?? input.sourceVersion ?? '').trim() || 'NA',
    schemaVersion: String(input.schemaVersion ?? '').trim(),
    routingStrategyVersion: String(input.routingStrategyVersion ?? '').trim(),
    config: normalizeScopeConfig(input)
  }
}

function addReason(reasonSet, reasonCode) {
  reasonSet.add(reasonCode)
}

function setProvenance(provenanceMap, fieldPath, scopeInfo, fallbackFromScopeOrNA = 'NA') {
  provenanceMap.set(fieldPath, {
    fieldPath,
    winnerScope: scopeInfo.scope,
    winnerVersion: scopeInfo.configVersion,
    fallbackFromScopeOrNA
  })
}

function validateScalarValue(value, spec) {
  if (spec.type === 'string') {
    const text = String(value ?? '').trim()
    if (!text) {
      return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(text)) {
      return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_RANGE }
    }
    return { ok: true, value: text }
  }

  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
    }
    if (typeof spec.min === 'number' && value < spec.min) {
      return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_RANGE }
    }
    if (typeof spec.max === 'number' && value > spec.max) {
      return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_RANGE }
    }
    return { ok: true, value }
  }

  if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
    }
    return { ok: true, value }
  }

  return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
}

function validateArrayValue(value, spec) {
  if (!Array.isArray(value)) {
    return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
  }

  if (spec.itemType === 'string') {
    const normalized = value.map((item) => String(item ?? '').trim()).filter(Boolean)
    if (normalized.length !== value.length) {
      return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
    }
    return { ok: true, value: normalized }
  }

  return { ok: true, value: stableClone(value) }
}

function validateMapValue(value, spec) {
  if (!isPlainObject(value)) {
    return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
  }

  const normalized = {}
  const errors = []
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    const item = value[key]
    if (item === null) {
      normalized[key] = null
      continue
    }

    if (spec.valueType === 'string') {
      const text = String(item ?? '').trim()
      if (!text) {
        errors.push(H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE)
        continue
      }
      normalized[key] = text
      continue
    }

    normalized[key] = stableClone(item)
  }

  if (errors.length > 0) {
    return { ok: false, reasonCode: errors[0] }
  }

  return { ok: true, value: normalized }
}

function validateValueBySpec(value, spec) {
  if (spec.kind === 'scalar') return validateScalarValue(value, spec)
  if (spec.kind === 'array') return validateArrayValue(value, spec)
  if (spec.kind === 'map') return validateMapValue(value, spec)
  return { ok: false, reasonCode: H_CONFIG_RESOLUTION_REASON_CODES.INVALID_TYPE }
}

function applyScope(scopeInfo, effectiveConfig, provenanceMap, reasonSet) {
  let degradedByScope = false
  const scopeConfig = isPlainObject(scopeInfo.config) ? scopeInfo.config : {}

  for (const field of Object.keys(scopeConfig).sort((a, b) => a.localeCompare(b))) {
    if (!TOP_LEVEL_CONFIG_FIELDS.has(field)) {
      addReason(reasonSet, H_CONFIG_RESOLUTION_REASON_CODES.UNKNOWN_FIELD_DROPPED)
      continue
    }

    const spec = FIELD_SPECS[field]
    const rawValue = scopeConfig[field]

    if (rawValue === null) {
      delete effectiveConfig[field]
      provenanceMap.delete(field)
      for (const path of [...provenanceMap.keys()]) {
        if (path.startsWith(`${field}.`)) {
          provenanceMap.delete(path)
        }
      }
      continue
    }

    const validated = validateValueBySpec(rawValue, spec)
    if (!validated.ok) {
      addReason(reasonSet, validated.reasonCode)
      degradedByScope = true
      continue
    }

    if (spec.kind === 'map') {
      const currentMap = isPlainObject(effectiveConfig[field]) ? { ...effectiveConfig[field] } : {}
      const candidateMap = validated.value

      for (const key of Object.keys(candidateMap).sort((a, b) => a.localeCompare(b))) {
        const fieldPath = `${field}.${key}`
        const previousProvenance = provenanceMap.get(fieldPath)
        const fallbackFromScopeOrNA = previousProvenance?.winnerScope || 'NA'
        const itemValue = candidateMap[key]

        if (itemValue === null) {
          delete currentMap[key]
          provenanceMap.delete(fieldPath)
          continue
        }

        currentMap[key] = itemValue
        setProvenance(provenanceMap, fieldPath, scopeInfo, fallbackFromScopeOrNA)
      }

      effectiveConfig[field] = currentMap
      continue
    }

    const previous = provenanceMap.get(field)
    const fallbackFromScopeOrNA = previous?.winnerScope || 'NA'
    effectiveConfig[field] = validated.value
    setProvenance(provenanceMap, field, scopeInfo, fallbackFromScopeOrNA)
  }

  return degradedByScope
}

function buildAppliedVersions(context, globalScope, appScope, placementScope) {
  const routingStrategyVersion = context.routingStrategyVersion !== MISSING_VALUE
    ? context.routingStrategyVersion
    : placementScope.routingStrategyVersion || appScope.routingStrategyVersion || globalScope.routingStrategyVersion || 'routing_v_na'

  return {
    schemaVersion: context.schemaVersion === MISSING_VALUE ? 'schema_v_na' : context.schemaVersion,
    routingStrategyVersion,
    placementConfigVersion: placementScope.configVersion || 'placement_cfg_na',
    globalConfigVersion: globalScope.configVersion || 'global_cfg_na',
    appConfigVersionOrNA: appScope.configVersion || 'NA',
    placementSourceVersionOrNA: placementScope.sourceVersion || 'NA'
  }
}

function buildSnapshot({
  context,
  resolutionStatus,
  reasonCodes,
  effectiveConfig,
  fieldProvenance,
  appliedVersions
}) {
  const configHash = sha256(stableStringify(effectiveConfig))
  const versionSnapshotForEtag = [
    appliedVersions.schemaVersion,
    appliedVersions.globalConfigVersion,
    appliedVersions.appConfigVersionOrNA,
    appliedVersions.placementSourceVersionOrNA,
    appliedVersions.placementConfigVersion,
    appliedVersions.routingStrategyVersion
  ].join('|')
  const etag = sha256(`${configHash}|${versionSnapshotForEtag}`)
  const resolveIdSeed = [
    context.requestKey === MISSING_VALUE ? 'request_na' : context.requestKey,
    context.traceKey === MISSING_VALUE ? 'trace_na' : context.traceKey,
    etag,
    context.configResolutionContractVersion === MISSING_VALUE ? 'contract_v_na' : context.configResolutionContractVersion
  ].join('|')

  return {
    resolveId: `cfgres_${sha256(resolveIdSeed).slice(0, 16)}`,
    requestKey: context.requestKey === MISSING_VALUE ? '' : context.requestKey,
    traceKey: context.traceKey === MISSING_VALUE ? '' : context.traceKey,
    resolutionStatus,
    appliedVersions,
    effectiveConfig,
    fieldProvenance,
    reasonCodes: [...reasonCodes].sort((a, b) => a.localeCompare(b)),
    etag,
    configHash,
    resolvedAt: context.resolveAt === MISSING_VALUE ? new Date(0).toISOString() : context.resolveAt,
    configResolutionContractVersion: context.configResolutionContractVersion === MISSING_VALUE
      ? 'h_config_resolution_v1'
      : context.configResolutionContractVersion,
    ...(context.extensions ? { extensions: context.extensions } : {})
  }
}

function validateRequiredRequestFields(context, reasonSet) {
  let valid = true
  for (const field of REQUEST_REQUIRED_FIELDS) {
    if (context[field] === MISSING_VALUE) {
      valid = false
    }
  }

  if (!valid) {
    addReason(reasonSet, H_CONFIG_RESOLUTION_REASON_CODES.MISSING_REQUIRED_AFTER_MERGE)
  }

  if (context.environment !== MISSING_VALUE && !ALLOWED_ENVIRONMENTS.has(context.environment)) {
    valid = false
    addReason(reasonSet, H_CONFIG_RESOLUTION_REASON_CODES.INVALID_RANGE)
  }

  return valid
}

function validateScopeCompatibility(scopeInfo, schemaVersion, reasonSet) {
  if (!scopeInfo.available) {
    return { available: false, degrade: true }
  }

  if (scopeInfo.schemaVersion && schemaVersion !== MISSING_VALUE && scopeInfo.schemaVersion !== schemaVersion) {
    addReason(reasonSet, H_CONFIG_RESOLUTION_REASON_CODES.VERSION_INCOMPATIBLE)
    return { available: false, degrade: true }
  }

  return { available: true, degrade: false }
}

function hasEffectiveValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return true
}

export function resolveConfig(globalInput, appInput, placementInput, contextInput) {
  const context = normalizeContext(contextInput)
  const globalScope = normalizeScope('global', globalInput)
  const appScope = normalizeScope('app', appInput)
  const placementScope = normalizeScope('placement', placementInput)

  const reasonCodes = new Set()
  const effectiveConfig = {}
  const fieldProvenanceMap = new Map()
  let degraded = false
  let rejected = false

  const requestContextValid = validateRequiredRequestFields(context, reasonCodes)
  if (!requestContextValid) {
    rejected = true
  }

  if (!globalScope.available) {
    addReason(reasonCodes, H_CONFIG_RESOLUTION_REASON_CODES.GLOBAL_UNAVAILABLE_FAIL_CLOSED)
    rejected = true
  }

  const globalCompatibility = validateScopeCompatibility(globalScope, context.schemaVersion, reasonCodes)
  if (!globalCompatibility.available) {
    addReason(reasonCodes, H_CONFIG_RESOLUTION_REASON_CODES.GLOBAL_UNAVAILABLE_FAIL_CLOSED)
    rejected = true
  }

  const appCompatibility = validateScopeCompatibility(appScope, context.schemaVersion, reasonCodes)
  if (!appCompatibility.available) {
    degraded = true
    addReason(reasonCodes, H_CONFIG_RESOLUTION_REASON_CODES.SCOPE_UNAVAILABLE)
  }

  const placementCompatibility = validateScopeCompatibility(placementScope, context.schemaVersion, reasonCodes)
  if (!placementCompatibility.available) {
    degraded = true
    addReason(reasonCodes, H_CONFIG_RESOLUTION_REASON_CODES.SCOPE_UNAVAILABLE)
  }

  if (!rejected) {
    const effectiveScopes = [
      { ...globalScope, available: globalCompatibility.available },
      { ...appScope, available: appCompatibility.available },
      { ...placementScope, available: placementCompatibility.available }
    ]

    for (const scopeInfo of effectiveScopes) {
      if (!scopeInfo.available) continue
      const changed = applyScope(scopeInfo, effectiveConfig, fieldProvenanceMap, reasonCodes)
      if (changed) degraded = true
    }
  }

  const missingRequiredFields = []
  for (const [field, spec] of Object.entries(FIELD_SPECS)) {
    if (!spec.required) continue
    if (!hasEffectiveValue(effectiveConfig[field])) {
      missingRequiredFields.push(field)
    }
  }

  if (missingRequiredFields.length > 0) {
    addReason(reasonCodes, H_CONFIG_RESOLUTION_REASON_CODES.MISSING_REQUIRED_AFTER_MERGE)
    rejected = true
  }

  const appliedVersions = buildAppliedVersions(context, globalScope, appScope, placementScope)
  const fieldProvenance = [...fieldProvenanceMap.values()].sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))
  const resolutionStatus = rejected
    ? H_CONFIG_RESOLUTION_STATUSES.REJECTED
    : degraded
      ? H_CONFIG_RESOLUTION_STATUSES.DEGRADED
      : H_CONFIG_RESOLUTION_STATUSES.RESOLVED

  return buildSnapshot({
    context,
    resolutionStatus,
    reasonCodes,
    effectiveConfig: stableClone(effectiveConfig),
    fieldProvenance,
    appliedVersions
  })
}
