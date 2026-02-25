import crypto from 'node:crypto'

export const A_CREATE_OPPORTUNITY_REASON_CODES = Object.freeze({
  MISSING_REQUIRED_FIELD: 'a_cop_missing_required_field',
  INVALID_KEY_FORMAT: 'a_cop_invalid_key_format',
  IMP_SEED_EMPTY: 'a_cop_imp_seed_empty',
  TIMESTAMP_ORDER_INVALID: 'a_cop_timestamp_order_invalid',
  TRACE_REQUEST_MISMATCH: 'a_cop_trace_request_mismatch',
  DUPLICATE_OPPORTUNITY_KEY: 'a_cop_duplicate_opportunity_key',
  INTERNAL_UNAVAILABLE: 'a_cop_internal_unavailable'
})

export const A_DEDUP_STATES = Object.freeze({
  NEW: 'new',
  INFLIGHT_DUPLICATE: 'inflight_duplicate',
  REUSED_RESULT: 'reused_result',
  EXPIRED_RETRY: 'expired_retry'
})

const KEY_PATTERN = /^[a-z][a-z0-9_:-]{7,}$/i

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function parseDateMs(value) {
  const ms = Date.parse(String(value || ''))
  return Number.isFinite(ms) ? ms : NaN
}

function normalizeImpSeed(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (!isPlainObject(item)) return null
      return {
        impKey: normalizeText(item.impKey),
        placementId: normalizeText(item.placementId),
        placementType: normalizeText(item.placementType),
        slotIndex: Number.isInteger(item.slotIndex) ? item.slotIndex : Number(item.slotIndex)
      }
    })
    .filter(Boolean)
}

function normalizeRequest(input) {
  const request = isPlainObject(input) ? input : {}
  return {
    requestKey: normalizeText(request.requestKey),
    opportunityKey: normalizeText(request.opportunityKey),
    impSeed: normalizeImpSeed(request.impSeed),
    timestamps: {
      requestAt: normalizeText(request?.timestamps?.requestAt),
      triggerAt: normalizeText(request?.timestamps?.triggerAt),
      opportunityCreatedAt: normalizeText(request?.timestamps?.opportunityCreatedAt)
    },
    traceInit: {
      traceKey: normalizeText(request?.traceInit?.traceKey),
      requestKey: normalizeText(request?.traceInit?.requestKey),
      attemptKey: normalizeText(request?.traceInit?.attemptKey)
    },
    schemaVersion: normalizeText(request.schemaVersion),
    state: normalizeText(request.state),
    createOpportunityContractVersion: normalizeText(request.createOpportunityContractVersion),
    experimentTagsOrNA: Array.isArray(request.experimentTagsOrNA)
      ? request.experimentTagsOrNA.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    triggerSnapshotLiteOrNA: isPlainObject(request.triggerSnapshotLiteOrNA) ? request.triggerSnapshotLiteOrNA : undefined,
    sensingDecisionLiteOrNA: isPlainObject(request.sensingDecisionLiteOrNA) ? request.sensingDecisionLiteOrNA : undefined,
    dedupState: normalizeText(request.dedupState || A_DEDUP_STATES.NEW).toLowerCase(),
    previousTraceInitOrNA: isPlainObject(request.previousTraceInitOrNA)
      ? {
          traceKey: normalizeText(request.previousTraceInitOrNA.traceKey),
          requestKey: normalizeText(request.previousTraceInitOrNA.requestKey),
          attemptKey: normalizeText(request.previousTraceInitOrNA.attemptKey)
        }
      : null,
    traceContext: {
      appId: normalizeText(request?.traceContext?.appId),
      sessionId: normalizeText(request?.traceContext?.sessionId),
      placementId: normalizeText(request?.traceContext?.placementId),
      triggerType: normalizeText(request?.traceContext?.triggerType),
      triggerAt: normalizeText(request?.traceContext?.triggerAt)
    },
    extensions: isPlainObject(request.extensions) ? request.extensions : undefined
  }
}

function generateTraceInit(request) {
  const context = request.traceContext
  const seedBase = [
    context.appId,
    context.sessionId,
    context.placementId,
    context.triggerType,
    context.triggerAt,
    request.timestamps.opportunityCreatedAt,
    request.dedupState || A_DEDUP_STATES.NEW,
    request.createOpportunityContractVersion
  ].join('|')

  const requestKey = `req_${sha256(`${seedBase}|request`).slice(0, 16)}`
  const attemptKey = `att_${sha256(`${requestKey}|attempt`).slice(0, 16)}`
  const traceKey = `tr_${sha256(`${context.appId}|${context.sessionId}|${context.placementId}`).slice(0, 16)}`
  return { traceKey, requestKey, attemptKey }
}

function isValidKey(value) {
  return KEY_PATTERN.test(value)
}

function resolveTraceInit(request) {
  const hasCompleteTrace = Boolean(request.traceInit.traceKey && request.traceInit.requestKey && request.traceInit.attemptKey)
  const previous = request.previousTraceInitOrNA
  const dedupState = request.dedupState || A_DEDUP_STATES.NEW

  if (hasCompleteTrace) {
    if (
      (dedupState === A_DEDUP_STATES.INFLIGHT_DUPLICATE || dedupState === A_DEDUP_STATES.REUSED_RESULT) &&
      previous &&
      (
        previous.traceKey !== request.traceInit.traceKey ||
        previous.requestKey !== request.traceInit.requestKey ||
        previous.attemptKey !== request.traceInit.attemptKey
      )
    ) {
      return { ok: false, reasonCode: A_CREATE_OPPORTUNITY_REASON_CODES.TRACE_REQUEST_MISMATCH }
    }

    if (dedupState === A_DEDUP_STATES.EXPIRED_RETRY && previous) {
      // expired_retry must generate new request/attempt; reuse traceKey when stable context is same.
      const generated = generateTraceInit(request)
      return {
        ok: true,
        traceInit: {
          traceKey: previous.traceKey || generated.traceKey,
          requestKey: generated.requestKey,
          attemptKey: generated.attemptKey
        }
      }
    }

    return { ok: true, traceInit: request.traceInit }
  }

  if (dedupState === A_DEDUP_STATES.INFLIGHT_DUPLICATE || dedupState === A_DEDUP_STATES.REUSED_RESULT) {
    if (!previous || !previous.traceKey || !previous.requestKey || !previous.attemptKey) {
      return { ok: false, reasonCode: A_CREATE_OPPORTUNITY_REASON_CODES.TRACE_REQUEST_MISMATCH }
    }
    return { ok: true, traceInit: previous }
  }

  const generated = generateTraceInit(request)
  if (dedupState === A_DEDUP_STATES.EXPIRED_RETRY && previous?.traceKey) {
    return {
      ok: true,
      traceInit: {
        traceKey: previous.traceKey,
        requestKey: generated.requestKey,
        attemptKey: generated.attemptKey
      }
    }
  }

  return { ok: true, traceInit: generated }
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function makeResultBase(request, nowFn) {
  return {
    createAccepted: false,
    createAction: 'rejected',
    opportunityRefOrNA: 'NA',
    resultState: 'error',
    reasonCode: A_CREATE_OPPORTUNITY_REASON_CODES.INTERNAL_UNAVAILABLE,
    errorAction: 'reject',
    traceInit: {
      traceKey: request.traceInit.traceKey || 'NA',
      requestKey: request.traceInit.requestKey || request.requestKey || 'NA',
      attemptKey: request.traceInit.attemptKey || 'NA'
    },
    returnedAt: nowIso(nowFn),
    createOpportunityContractVersion: request.createOpportunityContractVersion || 'a_create_opportunity_v1'
  }
}

function buildABHandoff(opportunity) {
  return {
    requestKey: opportunity.requestKey,
    opportunityKey: opportunity.opportunityKey,
    traceInit: opportunity.traceInit,
    schemaVersion: opportunity.schemaVersion,
    state: opportunity.state,
    impSeed: opportunity.impSeed,
    triggerSnapshotLiteOrNA: opportunity.triggerSnapshotLiteOrNA || null,
    sensingDecisionLiteOrNA: opportunity.sensingDecisionLiteOrNA || null
  }
}

function validateOpportunityPayload(request) {
  const requiredTopLevel = [
    request.schemaVersion,
    request.createOpportunityContractVersion
  ]
  if (requiredTopLevel.some((value) => !value)) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  if (request.state && request.state !== 'received') {
    return A_CREATE_OPPORTUNITY_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  if (!request.timestamps.requestAt || !request.timestamps.triggerAt || !request.timestamps.opportunityCreatedAt) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.MISSING_REQUIRED_FIELD
  }

  const requestAtMs = parseDateMs(request.timestamps.requestAt)
  const triggerAtMs = parseDateMs(request.timestamps.triggerAt)
  const createdAtMs = parseDateMs(request.timestamps.opportunityCreatedAt)
  if (!Number.isFinite(requestAtMs) || !Number.isFinite(triggerAtMs) || !Number.isFinite(createdAtMs)) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.TIMESTAMP_ORDER_INVALID
  }
  if (!(requestAtMs <= triggerAtMs && triggerAtMs <= createdAtMs)) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.TIMESTAMP_ORDER_INVALID
  }

  if (!Array.isArray(request.impSeed) || request.impSeed.length === 0) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.IMP_SEED_EMPTY
  }
  for (const imp of request.impSeed) {
    if (!imp.impKey || !imp.placementId || !imp.placementType || !Number.isFinite(imp.slotIndex)) {
      return A_CREATE_OPPORTUNITY_REASON_CODES.MISSING_REQUIRED_FIELD
    }
  }

  if (!request.requestKey || !request.opportunityKey) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.MISSING_REQUIRED_FIELD
  }
  if (!isValidKey(request.requestKey) || !isValidKey(request.opportunityKey)) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.INVALID_KEY_FORMAT
  }

  if (!request.traceInit.traceKey || !request.traceInit.requestKey || !request.traceInit.attemptKey) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.MISSING_REQUIRED_FIELD
  }
  if (request.traceInit.requestKey !== request.requestKey) {
    return A_CREATE_OPPORTUNITY_REASON_CODES.TRACE_REQUEST_MISMATCH
  }

  return ''
}

export function createCreateOpportunityService(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const store = new Map()
  const failInternal = typeof options.failInternal === 'function' ? options.failInternal : () => false

  function createOpportunity(input) {
    const request = normalizeRequest(input)
    const result = makeResultBase(request, nowFn)

    if (failInternal(request) === true) {
      result.reasonCode = A_CREATE_OPPORTUNITY_REASON_CODES.INTERNAL_UNAVAILABLE
      result.retryable = true
      return result
    }

    const traceResult = resolveTraceInit(request)
    if (!traceResult.ok) {
      result.reasonCode = traceResult.reasonCode
      return result
    }

    request.traceInit = traceResult.traceInit
    if (!request.requestKey) {
      request.requestKey = request.traceInit.requestKey
    }
    if (!request.opportunityKey) {
      request.opportunityKey = `opp_${sha256(`${request.requestKey}|${request.impSeed[0]?.placementId || 'placement'}`).slice(0, 16)}`
    }
    if (!request.state) {
      request.state = 'received'
    }

    const validationReason = validateOpportunityPayload(request)
    if (validationReason) {
      result.reasonCode = validationReason
      result.traceInit = request.traceInit
      return result
    }

    const dedupKey = `${request.opportunityKey}|${request.createOpportunityContractVersion}`
    const existing = store.get(dedupKey)
    if (existing) {
      return {
        createAccepted: true,
        createAction: 'duplicate_noop',
        opportunityRefOrNA: existing.opportunityRefOrNA,
        resultState: existing.resultState,
        reasonCode: A_CREATE_OPPORTUNITY_REASON_CODES.DUPLICATE_OPPORTUNITY_KEY,
        errorAction: 'allow',
        traceInit: existing.traceInit,
        returnedAt: nowIso(nowFn),
        createOpportunityContractVersion: request.createOpportunityContractVersion,
        handoffPacketLiteOrNA: buildABHandoff(existing._opportunity),
        createdEventRefOrNA: 'NA'
      }
    }

    const opportunity = {
      requestKey: request.requestKey,
      opportunityKey: request.opportunityKey,
      impSeed: request.impSeed,
      timestamps: request.timestamps,
      traceInit: request.traceInit,
      schemaVersion: request.schemaVersion,
      state: request.state,
      createOpportunityContractVersion: request.createOpportunityContractVersion,
      experimentTagsOrNA: request.experimentTagsOrNA,
      triggerSnapshotLiteOrNA: request.triggerSnapshotLiteOrNA,
      sensingDecisionLiteOrNA: request.sensingDecisionLiteOrNA,
      extensions: request.extensions
    }

    const created = {
      createAccepted: true,
      createAction: 'created',
      opportunityRefOrNA: request.opportunityKey,
      resultState: 'received',
      reasonCode: 'a_cop_created',
      errorAction: 'allow',
      traceInit: request.traceInit,
      returnedAt: nowIso(nowFn),
      createOpportunityContractVersion: request.createOpportunityContractVersion,
      createdEventRefOrNA: 'evt_pending',
      handoffPacketLiteOrNA: buildABHandoff(opportunity),
      _opportunity: opportunity
    }

    store.set(dedupKey, created)
    return { ...created, _opportunity: undefined }
  }

  return {
    createOpportunity,
    _debug: {
      store
    }
  }
}
