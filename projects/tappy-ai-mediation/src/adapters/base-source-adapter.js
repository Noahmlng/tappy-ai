import crypto from 'node:crypto'

const MIN_CAPABILITIES = Object.freeze([
  'request_adapt',
  'candidate_normalize',
  'error_normalize',
  'source_trace'
])

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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  return fallback
}

function buildSourceRequestId(seed, network) {
  return `sr_${network}_${sha256(seed).slice(0, 18)}`
}

function getNested(input, path, fallback = '') {
  const parts = String(path)
    .split('.')
    .map((item) => item.trim())
    .filter(Boolean)

  let cursor = input
  for (const part of parts) {
    if (cursor === null || cursor === undefined || !(part in cursor)) return fallback
    cursor = cursor[part]
  }

  return cursor
}

function pickFirstText(values = [], fallback = '') {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }
  return fallback
}

export function createBaseSourceAdapter(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const connector = options.connector || {}
  const network = normalizeText(options.network) || 'source'
  const sourceId = normalizeText(options.sourceId) || `source_${network}`
  const sourceType = normalizeText(options.sourceType) || 'alliance'
  const adapterId = normalizeText(options.adapterId) || `adapter_${network}_v1`
  const adapterContractVersion = normalizeText(options.adapterContractVersion) || 'd_adapter_contract_v1'
  const capabilityProfileVersion = normalizeText(options.capabilityProfileVersion) || 'd_capability_profile_v1'
  const defaultTimeoutPolicyMs = Math.max(1, toFiniteNumber(options.timeoutPolicyMs, 3000))
  const owner = normalizeText(options.owner) || 'mediation_supply_team'
  const supportedCapabilities = normalizeStringArray(options.supportedCapabilities)
  const supportedPlacementTypes = normalizeStringArray(options.supportedPlacementTypes)
  const tags = normalizeStringArray(options.tags)
  const extensions = isPlainObject(options.extensions) ? options.extensions : {}

  const runtime = {
    started: true,
    lastStartedAt: nowIso(nowFn),
    lastStoppedAt: ''
  }

  async function start() {
    runtime.started = true
    runtime.lastStartedAt = nowIso(nowFn)
    return {
      ok: true,
      started: true,
      startedAt: runtime.lastStartedAt
    }
  }

  async function stop() {
    runtime.started = false
    runtime.lastStoppedAt = nowIso(nowFn)
    return {
      ok: true,
      started: false,
      stoppedAt: runtime.lastStoppedAt
    }
  }

  function buildRegistryEntry(overrides = {}) {
    return {
      sourceId,
      adapterId,
      sourceType,
      status: 'active',
      adapterContractVersion,
      capabilityProfileVersion,
      supportedCapabilities: supportedCapabilities.length > 0 ? supportedCapabilities : [...MIN_CAPABILITIES],
      supportedPlacementTypes: supportedPlacementTypes.length > 0 ? supportedPlacementTypes : ['chat_inline'],
      timeoutPolicyMs: defaultTimeoutPolicyMs,
      owner,
      updatedAt: nowIso(nowFn),
      tags,
      extensions,
      ...overrides
    }
  }

  function requestAdapt(input = {}, context = {}) {
    const registryEntry = isPlainObject(context.registryEntry) ? context.registryEntry : {}
    const placementType = pickFirstText([
      input.placementType,
      getNested(input, 'PlacementMeta.placementType'),
      getNested(input, 'routableOpportunityLite.placementType')
    ], 'unknown_placement_type')
    const channelType = pickFirstText([
      input.channelType,
      getNested(input, 'RequestMeta.channelType')
    ], 'unknown_channel_type')
    const actorType = pickFirstText([
      input.actorType,
      getNested(input, 'UserContext.actorType')
    ], 'unknown_actor_type')
    const opportunityKey = pickFirstText([input.opportunityKey], 'NA')
    const traceKey = pickFirstText([input.traceKey, getNested(input, 'TraceContext.traceKey')], 'NA')
    const requestKey = pickFirstText([input.requestKey, getNested(input, 'TraceContext.requestKey')], 'NA')
    const attemptKey = pickFirstText([input.attemptKey, getNested(input, 'TraceContext.attemptKey')], 'NA')
    const finalPolicyAction = pickFirstText([input.finalPolicyAction], 'allow')
    const policyDecisionReasonCode = pickFirstText([
      input.policyDecisionReasonCode,
      input.primaryPolicyReasonCode
    ], 'c_policy_pass')

    const policySnapshotId = pickFirstText([
      input.policySnapshotId,
      getNested(input, 'policySnapshotLite.policySnapshotId')
    ], 'NA')
    const policySnapshotVersion = pickFirstText([
      input.policySnapshotVersion,
      getNested(input, 'policySnapshotLite.policySnapshotVersion')
    ], 'NA')

    const configSnapshotLite = isPlainObject(input.configSnapshotLite) ? input.configSnapshotLite : {}
    const constraintsLite = isPlainObject(input.constraintsLite) ? input.constraintsLite : {}
    const routeContext = isPlainObject(input.routeContext) ? input.routeContext : {}
    const routeBudgetMs = Math.max(0, toFiniteNumber(input.remainingRouteBudgetMs, toFiniteNumber(input.routeBudgetMs, Number.POSITIVE_INFINITY)))
    const timeoutPolicyMs = Math.max(1, toFiniteNumber(registryEntry.timeoutPolicyMs, defaultTimeoutPolicyMs))
    const timeoutBudgetMs = Math.max(0, Math.min(routeBudgetMs, timeoutPolicyMs))

    const sourceRequestIdSeed = [
      sourceId,
      opportunityKey,
      requestKey,
      attemptKey,
      routeContext.routePath || 'primary',
      String(routeContext.routeHop || 1)
    ].join('|')

    return {
      sourceId: registryEntry.sourceId || sourceId,
      sourceRequestId: buildSourceRequestId(sourceRequestIdSeed, network),
      opportunityKey,
      traceKey,
      requestKey,
      attemptKey,
      placementType,
      channelType,
      actorType,
      policyDecision: {
        finalPolicyAction,
        policyDecisionReasonCode
      },
      policySnapshot: {
        policySnapshotId,
        policySnapshotVersion
      },
      configSnapshot: {
        configSnapshotId: pickFirstText([configSnapshotLite.configSnapshotId], 'NA'),
        resolvedConfigRef: pickFirstText([configSnapshotLite.resolvedConfigRef], 'NA'),
        configHash: pickFirstText([configSnapshotLite.configHash], 'NA'),
        effectiveAt: pickFirstText([configSnapshotLite.effectiveAt], 'NA')
      },
      policyConstraints: {
        bcat: normalizeStringArray(getNested(constraintsLite, 'categoryConstraints.bcat', [])),
        badv: normalizeStringArray(getNested(constraintsLite, 'categoryConstraints.badv', [])),
        nonPersonalizedOnly: getNested(constraintsLite, 'personalizationConstraints.nonPersonalizedOnly', false) === true,
        disallowRenderModes: normalizeStringArray(getNested(constraintsLite, 'renderConstraints.disallowRenderModes', [])),
        sourceSelectionMode: pickFirstText([getNested(constraintsLite, 'sourceConstraints.sourceSelectionMode')], 'all_except_blocked'),
        allowedSourceIds: normalizeStringArray(getNested(constraintsLite, 'sourceConstraints.allowedSourceIds', [])),
        blockedSourceIds: normalizeStringArray(getNested(constraintsLite, 'sourceConstraints.blockedSourceIds', []))
      },
      routeContext: {
        routePath: pickFirstText([routeContext.routePath], 'primary'),
        routeHop: Math.max(1, Math.floor(toFiniteNumber(routeContext.routeHop, 1))),
        routingPolicyVersion: pickFirstText([routeContext.routingPolicyVersion], 'd_routing_policy_v1'),
        strategyType: pickFirstText([routeContext.strategyType], 'waterfall'),
        dispatchMode: pickFirstText([routeContext.dispatchMode], 'sequential')
      },
      timeoutBudgetMs,
      sentAt: nowIso(nowFn),
      adapterContractVersion,
      sourceHints: {
        network,
        searchTerm: pickFirstText([input.searchTerm, getNested(input, 'sourceHints.searchTerm')])
      },
      extensions: {
        [`x_${sourceId}_adapter`]: adapterId,
        [`x_${sourceId}_runtime_started`]: runtime.started
      }
    }
  }

  async function dispatch(sourceRequestLite, options = {}) {
    const search = pickFirstText([
      sourceRequestLite?.sourceHints?.searchTerm,
      options.search
    ])
    if (typeof connector.fetchOffers === 'function') {
      const result = await connector.fetchOffers({
        search,
        limit: options.limit
      })
      return result
    }
    if (typeof connector.fetchLinksCatalog === 'function') {
      const result = await connector.fetchLinksCatalog({
        search,
        limit: options.limit
      })
      return result
    }
    return {
      offers: [],
      debug: {
        mode: `${network}_no_dispatch`,
        errors: []
      }
    }
  }

  function candidateNormalize(payload = {}) {
    const offers = Array.isArray(payload.offers)
      ? payload.offers
      : (Array.isArray(payload) ? payload : [])
    return offers.map((item, index) => {
      const candidate = isPlainObject(item) ? item : {}
      return {
        sourceId,
        candidateId: pickFirstText([candidate.offerId, candidate.id], `${sourceId}_cand_${index + 1}`),
        title: pickFirstText([candidate.title, candidate.name], 'untitled'),
        clickUrl: pickFirstText([candidate.clickUrl, candidate.trackingUrl, candidate.url]),
        payout: toFiniteNumber(candidate.payout, 0),
        currency: pickFirstText([candidate.currency], 'USD'),
        raw: candidate
      }
    })
  }

  function errorNormalize(error) {
    const statusCode = toFiniteNumber(error?.statusCode, 0)
    const retryable = statusCode >= 500 || statusCode === 429 || statusCode === 408 || error?.name === 'AbortError'
    return {
      sourceId,
      adapterId,
      errorCode: statusCode > 0 ? `HTTP_${statusCode}` : 'SOURCE_REQUEST_FAILED',
      retryable,
      message: normalizeText(error?.message) || 'source request failed'
    }
  }

  function sourceTrace(input = {}) {
    return {
      sourceId,
      adapterId,
      traceKey: normalizeText(input.traceKey),
      requestKey: normalizeText(input.requestKey),
      attemptKey: normalizeText(input.attemptKey),
      sourceRequestId: normalizeText(input.sourceRequestId),
      observedAt: nowIso(nowFn)
    }
  }

  async function healthCheck(params = {}) {
    if (typeof connector.healthCheck === 'function') {
      return connector.healthCheck(params)
    }
    return {
      ok: true,
      network,
      checkedAt: nowIso(nowFn)
    }
  }

  return {
    adapterId,
    sourceId,
    sourceType,
    adapterContractVersion,
    capabilityProfileVersion,
    supportedCapabilities: supportedCapabilities.length > 0 ? supportedCapabilities : [...MIN_CAPABILITIES],
    supportedPlacementTypes: supportedPlacementTypes.length > 0 ? supportedPlacementTypes : ['chat_inline'],
    timeoutPolicyMs: defaultTimeoutPolicyMs,
    owner,
    start,
    stop,
    buildRegistryEntry,
    requestAdapt,
    dispatch,
    candidateNormalize,
    errorNormalize,
    sourceTrace,
    healthCheck,
    _runtime: runtime
  }
}
