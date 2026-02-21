const REQUIRED_CAPABILITIES = Object.freeze([
  'request_adapt',
  'candidate_normalize',
  'error_normalize',
  'source_trace'
])

const STATUS_VALUES = new Set(['active', 'paused', 'draining', 'disabled'])
const SOURCE_TYPE_VALUES = new Set(['alliance', 'simulated_inventory'])

const SOURCE_CAPABILITY_TO_METHOD = Object.freeze({
  request_adapt: 'requestAdapt',
  candidate_normalize: 'candidateNormalize',
  error_normalize: 'errorNormalize',
  source_trace: 'sourceTrace'
})

const SOURCE_REQUEST_REQUIRED_FIELDS = Object.freeze([
  'sourceId',
  'sourceRequestId',
  'opportunityKey',
  'traceKey',
  'requestKey',
  'attemptKey',
  'placementType',
  'channelType',
  'actorType',
  'policyDecision',
  'policySnapshot',
  'configSnapshot',
  'policyConstraints',
  'routeContext',
  'timeoutBudgetMs',
  'sentAt',
  'adapterContractVersion'
])

export const D_ADAPTER_REGISTRY_REASON_CODES = Object.freeze({
  REGISTERED: 'd_adapter_registered',
  SOURCE_ID_DUPLICATE: 'd_adapter_source_id_duplicate',
  INVALID_REGISTRY_ENTRY: 'd_adapter_registry_entry_invalid',
  MIN_CAPABILITY_MISSING: 'd_adapter_min_capability_missing',
  PLACEMENT_CAPABILITY_EMPTY: 'd_adapter_supported_placement_empty',
  CONTRACT_METHOD_MISSING: 'd_adapter_contract_method_missing',
  NOT_REGISTERED: 'd_adapter_not_registered',
  STATUS_REASON_REQUIRED: 'd_adapter_status_reason_required',
  STATUS_UPDATED: 'd_adapter_status_updated',
  STATUS_NOT_ACTIVE: 'd_adapter_status_not_active',
  NOT_RUNNING: 'd_adapter_not_running',
  PLACEMENT_NOT_SUPPORTED: 'd_adapter_placement_not_supported',
  STARTED: 'd_adapter_started',
  STOPPED: 'd_adapter_stopped',
  START_FAILED: 'd_adapter_start_failed',
  STOP_FAILED: 'd_adapter_stop_failed',
  REQUEST_ADAPT_OK: 'd_adapter_request_adapt_ok',
  REQUEST_ADAPT_FAILED: 'd_adapter_request_adapt_failed',
  REQUEST_ADAPT_CONTRACT_INVALID: 'd_adapter_request_adapt_contract_invalid'
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item)).filter(Boolean)
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  return fallback
}

function hasRequiredCapabilities(capabilities = []) {
  const set = new Set(capabilities)
  return REQUIRED_CAPABILITIES.every((item) => set.has(item))
}

function validateRegistryEntry(entry) {
  if (!isPlainObject(entry)) {
    return { ok: false, reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.INVALID_REGISTRY_ENTRY }
  }

  const sourceId = normalizeText(entry.sourceId)
  const adapterId = normalizeText(entry.adapterId)
  const sourceType = normalizeText(entry.sourceType)
  const status = normalizeText(entry.status)
  const adapterContractVersion = normalizeText(entry.adapterContractVersion)
  const capabilityProfileVersion = normalizeText(entry.capabilityProfileVersion)
  const supportedCapabilities = normalizeStringArray(entry.supportedCapabilities)
  const supportedPlacementTypes = normalizeStringArray(entry.supportedPlacementTypes)
  const owner = normalizeText(entry.owner)
  const updatedAt = normalizeText(entry.updatedAt)
  const timeoutPolicyMs = Math.max(1, Math.floor(toFiniteNumber(entry.timeoutPolicyMs, 0)))

  if (!sourceId || !adapterId || !adapterContractVersion || !capabilityProfileVersion || !owner || !updatedAt) {
    return { ok: false, reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.INVALID_REGISTRY_ENTRY }
  }

  if (!SOURCE_TYPE_VALUES.has(sourceType)) {
    return { ok: false, reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.INVALID_REGISTRY_ENTRY }
  }

  if (!STATUS_VALUES.has(status)) {
    return { ok: false, reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.INVALID_REGISTRY_ENTRY }
  }

  if (!hasRequiredCapabilities(supportedCapabilities)) {
    return { ok: false, reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.MIN_CAPABILITY_MISSING }
  }

  if (supportedPlacementTypes.length === 0) {
    return { ok: false, reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.PLACEMENT_CAPABILITY_EMPTY }
  }

  return {
    ok: true,
    reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REGISTERED,
    registryEntry: {
      sourceId,
      adapterId,
      sourceType,
      status,
      statusReasonCode: normalizeText(entry.statusReasonCode) || '',
      adapterContractVersion,
      capabilityProfileVersion,
      supportedCapabilities,
      supportedPlacementTypes,
      timeoutPolicyMs,
      owner,
      updatedAt,
      extensions: isPlainObject(entry.extensions) ? entry.extensions : {},
      tags: normalizeStringArray(entry.tags)
    }
  }
}

function validateAdapterImplementation(adapter, capabilities) {
  if (!isPlainObject(adapter)) {
    return {
      ok: false,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.CONTRACT_METHOD_MISSING,
      missingMethod: 'adapter_object'
    }
  }

  for (const capability of capabilities) {
    const methodName = SOURCE_CAPABILITY_TO_METHOD[capability]
    if (!methodName) continue
    if (typeof adapter[methodName] !== 'function') {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.CONTRACT_METHOD_MISSING,
        missingMethod: methodName
      }
    }
  }

  return {
    ok: true,
    reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REGISTERED,
    missingMethod: ''
  }
}

function checkSourceRequestContract(sourceRequest) {
  if (!isPlainObject(sourceRequest)) {
    return {
      ok: false,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REQUEST_ADAPT_CONTRACT_INVALID,
      missingFields: [...SOURCE_REQUEST_REQUIRED_FIELDS]
    }
  }

  const missingFields = SOURCE_REQUEST_REQUIRED_FIELDS.filter((field) => {
    if (!(field in sourceRequest)) return true
    const value = sourceRequest[field]
    if (value === undefined || value === null) return true
    if (typeof value === 'string' && normalizeText(value) === '') return true
    return false
  })

  if (missingFields.length > 0) {
    return {
      ok: false,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REQUEST_ADAPT_CONTRACT_INVALID,
      missingFields
    }
  }

  return {
    ok: true,
    reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REQUEST_ADAPT_OK,
    missingFields: []
  }
}

export function createAdapterRegistry(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const registryVersion = normalizeText(options.adapterRegistryVersion) || 'd_adapter_registry_v1'
  const records = new Map()

  function registerAdapter(entry, adapter) {
    const validation = validateRegistryEntry(entry)
    if (!validation.ok) {
      return {
        ok: false,
        reasonCode: validation.reasonCode
      }
    }

    const registryEntry = validation.registryEntry
    if (records.has(registryEntry.sourceId)) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.SOURCE_ID_DUPLICATE
      }
    }

    const adapterValidation = validateAdapterImplementation(adapter, registryEntry.supportedCapabilities)
    if (!adapterValidation.ok) {
      return {
        ok: false,
        reasonCode: adapterValidation.reasonCode,
        missingMethod: adapterValidation.missingMethod
      }
    }

    records.set(registryEntry.sourceId, {
      registryEntry,
      adapter,
      lifecycleState: 'running',
      lifecycleUpdatedAt: nowIso(nowFn)
    })

    return {
      ok: true,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REGISTERED,
      adapterRegistryEntryLite: registryEntry
    }
  }

  function unregisterAdapter(sourceId) {
    const normalizedSourceId = normalizeText(sourceId)
    if (!records.has(normalizedSourceId)) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.NOT_REGISTERED
      }
    }
    records.delete(normalizedSourceId)
    return {
      ok: true,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REGISTERED
    }
  }

  function updateAdapterStatus(sourceId, status, statusReasonCode) {
    const normalizedSourceId = normalizeText(sourceId)
    const normalizedStatus = normalizeText(status)
    const normalizedReason = normalizeText(statusReasonCode)
    const record = records.get(normalizedSourceId)
    if (!record) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.NOT_REGISTERED
      }
    }

    if (!STATUS_VALUES.has(normalizedStatus)) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.INVALID_REGISTRY_ENTRY
      }
    }

    if (!normalizedReason) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.STATUS_REASON_REQUIRED
      }
    }

    record.registryEntry = {
      ...record.registryEntry,
      status: normalizedStatus,
      statusReasonCode: normalizedReason,
      updatedAt: nowIso(nowFn)
    }

    return {
      ok: true,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.STATUS_UPDATED,
      adapterRegistryEntryLite: record.registryEntry
    }
  }

  async function startAdapter(sourceId) {
    const normalizedSourceId = normalizeText(sourceId)
    const record = records.get(normalizedSourceId)
    if (!record) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.NOT_REGISTERED
      }
    }

    try {
      if (typeof record.adapter.start === 'function') {
        await record.adapter.start({
          sourceId: normalizedSourceId,
          registryEntry: record.registryEntry
        })
      }
      record.lifecycleState = 'running'
      record.lifecycleUpdatedAt = nowIso(nowFn)
      return {
        ok: true,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.STARTED
      }
    } catch (error) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.START_FAILED,
        message: normalizeText(error?.message)
      }
    }
  }

  async function stopAdapter(sourceId) {
    const normalizedSourceId = normalizeText(sourceId)
    const record = records.get(normalizedSourceId)
    if (!record) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.NOT_REGISTERED
      }
    }

    try {
      if (typeof record.adapter.stop === 'function') {
        await record.adapter.stop({
          sourceId: normalizedSourceId,
          registryEntry: record.registryEntry
        })
      }
      record.lifecycleState = 'stopped'
      record.lifecycleUpdatedAt = nowIso(nowFn)
      return {
        ok: true,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.STOPPED
      }
    } catch (error) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.STOP_FAILED,
        message: normalizeText(error?.message)
      }
    }
  }

  function listRegisteredAdapters() {
    return [...records.values()].map((item) => ({
      ...item.registryEntry,
      lifecycleState: item.lifecycleState,
      lifecycleUpdatedAt: item.lifecycleUpdatedAt
    }))
  }

  function listRoutableAdapters(options = {}) {
    const placementType = normalizeText(options.placementType)
    return [...records.values()]
      .filter((item) => item.registryEntry.status === 'active')
      .filter((item) => item.lifecycleState !== 'stopped')
      .filter((item) => {
        if (!placementType) return true
        return item.registryEntry.supportedPlacementTypes.includes(placementType)
      })
      .map((item) => ({
        ...item.registryEntry,
        lifecycleState: item.lifecycleState
      }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  }

  function getAdapterSnapshot(sourceId) {
    const normalizedSourceId = normalizeText(sourceId)
    const record = records.get(normalizedSourceId)
    if (!record) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.NOT_REGISTERED,
        adapterSnapshot: null
      }
    }
    return {
      ok: true,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REGISTERED,
      adapterSnapshot: {
        adapterRegistryVersion: registryVersion,
        sourceId: record.registryEntry.sourceId,
        registryEntry: record.registryEntry,
        lifecycleState: record.lifecycleState,
        lifecycleUpdatedAt: record.lifecycleUpdatedAt
      }
    }
  }

  function resolveAdapterForRoute(sourceId, placementType) {
    const normalizedSourceId = normalizeText(sourceId)
    const normalizedPlacementType = normalizeText(placementType)
    const record = records.get(normalizedSourceId)
    if (!record) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.NOT_REGISTERED
      }
    }

    if (record.registryEntry.status !== 'active') {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.STATUS_NOT_ACTIVE,
        adapterRegistryEntryLite: record.registryEntry
      }
    }

    if (record.lifecycleState === 'stopped') {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.NOT_RUNNING,
        adapterRegistryEntryLite: record.registryEntry
      }
    }

    if (
      normalizedPlacementType &&
      !record.registryEntry.supportedPlacementTypes.includes(normalizedPlacementType)
    ) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.PLACEMENT_NOT_SUPPORTED,
        adapterRegistryEntryLite: record.registryEntry
      }
    }

    return {
      ok: true,
      reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REGISTERED,
      adapterRegistryEntryLite: record.registryEntry,
      adapter: record.adapter
    }
  }

  async function adaptRequest(sourceId, orchestrationInput = {}) {
    const placementType = normalizeText(orchestrationInput.placementType) ||
      normalizeText(orchestrationInput?.PlacementMeta?.placementType)
    const resolved = resolveAdapterForRoute(sourceId, placementType)
    if (!resolved.ok) {
      return resolved
    }

    try {
      const sourceRequestLite = await resolved.adapter.requestAdapt(orchestrationInput, {
        sourceId: resolved.adapterRegistryEntryLite.sourceId,
        registryEntry: resolved.adapterRegistryEntryLite
      })
      const contractValidation = checkSourceRequestContract(sourceRequestLite)
      if (!contractValidation.ok) {
        return {
          ok: false,
          reasonCode: contractValidation.reasonCode,
          missingFields: contractValidation.missingFields,
          adapterRegistryEntryLite: resolved.adapterRegistryEntryLite
        }
      }
      return {
        ok: true,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REQUEST_ADAPT_OK,
        adapterRegistryEntryLite: resolved.adapterRegistryEntryLite,
        sourceRequestLite
      }
    } catch (error) {
      return {
        ok: false,
        reasonCode: D_ADAPTER_REGISTRY_REASON_CODES.REQUEST_ADAPT_FAILED,
        message: normalizeText(error?.message),
        adapterRegistryEntryLite: resolved.adapterRegistryEntryLite
      }
    }
  }

  return {
    registerAdapter,
    unregisterAdapter,
    updateAdapterStatus,
    startAdapter,
    stopAdapter,
    listRegisteredAdapters,
    listRoutableAdapters,
    getAdapterSnapshot,
    resolveAdapterForRoute,
    adaptRequest,
    _debug: {
      records
    }
  }
}
