import crypto from 'node:crypto'

export const F_FACTS_REASON_CODES = Object.freeze({
  FACTS_MAPPED: 'f_facts_mapped',
  EVENT_TYPE_UNSUPPORTED: 'f_event_type_unsupported',
  MISSING_REQUIRED_FIELD: 'f_fact_missing_required_field',
  BILLING_CONFLICT_DUPLICATE_IMPRESSION: 'f_billing_conflict_duplicate_impression',
  BILLING_CLICK_WITHOUT_IMPRESSION: 'f_billing_click_without_impression',
  BILLING_INELIGIBLE_TERMINAL_FAILURE: 'f_billing_ineligible_terminal_failure',
  BILLING_INELIGIBLE_TERMINAL_NOT_SUCCESS: 'f_billing_ineligible_terminal_not_success',
  BILLABLE_INELIGIBLE_DEDUP_STATUS: 'f_billable_ineligible_dedup_status'
})

const EVENT_TO_ATTRIBUTION = Object.freeze({
  opportunity_created: 'attr_opportunity_created',
  auction_started: 'attr_auction_started',
  ad_filled: 'attr_ad_filled',
  impression: 'attr_impression',
  click: 'attr_click',
  interaction: 'attr_interaction',
  postback: 'attr_postback',
  error: 'attr_error',
  failure: 'attr_failure_terminal'
})

const EVENT_TYPES = new Set(Object.keys(EVENT_TO_ATTRIBUTION))

function normalizeText(value) {
  return String(value ?? '').trim()
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString()
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map((item) => stableClone(item))
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = stableClone(value[key])
        return acc
      }, {})
  }
  return value
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function factId(prefix, sourceEventId, traceKey, extra) {
  return `${prefix}_${sha256(`${prefix}|${sourceEventId}|${traceKey}|${extra}`).slice(0, 20)}`
}

function closureKeyFromEvent(event) {
  const responseReference = normalizeText(event.responseReference)
  const renderAttemptId = normalizeText(event.renderAttemptId)
  if (!responseReference || !renderAttemptId) return ''
  return `${responseReference}|${renderAttemptId}`
}

function billingKeyFor(event, billableType) {
  const responseReference = normalizeText(event.responseReference)
  const renderAttemptId = normalizeText(event.renderAttemptId)
  return `${responseReference}|${renderAttemptId}|${billableType}`
}

function attributionKeyFor(event, attributionType) {
  const eventType = normalizeText(event.eventType)
  const responseReference = normalizeText(event.responseReference) || 'NA'
  const renderAttemptId = normalizeText(event.renderAttemptId) || 'NA'
  return sha256(`${attributionType}|${eventType}|${responseReference}|${renderAttemptId}|${normalizeText(event.eventId)}`)
}

function createAttributionFact(event, attributionType, factVersion, nowMs) {
  const sourceEventId = normalizeText(event.eventId)
  const responseReference = normalizeText(event.responseReference)
  const renderAttemptId = normalizeText(event.renderAttemptId)
  return {
    factId: factId('attr', sourceEventId, normalizeText(event.traceKey), attributionType),
    attributionType,
    sourceEventId,
    eventType: normalizeText(event.eventType),
    responseReferenceOrNA: responseReference || 'NA',
    renderAttemptIdOrNA: renderAttemptId || 'NA',
    opportunityKey: normalizeText(event.opportunityKey),
    traceKey: normalizeText(event.traceKey),
    attributionKey: attributionKeyFor(event, attributionType),
    factAt: nowIso(nowMs),
    factVersion
  }
}

function createBillableFact(event, billableType, factVersion, nowMs) {
  const sourceEventId = normalizeText(event.eventId)
  return {
    factId: factId('bill', sourceEventId, normalizeText(event.traceKey), billableType),
    billableType,
    sourceEventId,
    responseReference: normalizeText(event.responseReference),
    renderAttemptId: normalizeText(event.renderAttemptId),
    opportunityKey: normalizeText(event.opportunityKey),
    traceKey: normalizeText(event.traceKey),
    billingKey: billingKeyFor(event, billableType),
    factAt: nowIso(nowMs),
    factVersion
  }
}

function createDecisionAudit({
  sourceEventId,
  mappingRuleVersion,
  decisionAction,
  decisionReasonCode,
  conflictDecision,
  nowMs
}) {
  return {
    sourceEventId,
    mappingRuleVersion,
    decisionAction,
    decisionReasonCode,
    conflictDecision,
    decidedAt: nowIso(nowMs)
  }
}

export function createFactsMapper(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const mappingRuleVersion = normalizeText(options.mappingRuleVersion) || 'f_mapping_rule_v1'
  const factVersion = normalizeText(options.factVersion) || 'f_fact_v1'

  const billingFactStore = options.billingFactStore instanceof Map ? options.billingFactStore : new Map()
  const closureBillingState = options.closureBillingState instanceof Map ? options.closureBillingState : new Map()

  function mapFacts(input = {}) {
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : nowFn()
    const event = input.event || {}
    const eventType = normalizeText(event.eventType)
    const sourceEventId = normalizeText(event.eventId)
    const dedupAckStatus = normalizeText(input.dedupAckStatus || 'accepted')
    const closureSnapshot = input.closureSnapshot || {}
    const closureState = normalizeText(closureSnapshot.state)
    const closureKey = normalizeText(input.closureKey || closureSnapshot.closureKey || closureKeyFromEvent(event))

    if (!EVENT_TYPES.has(eventType)) {
      return {
        ok: false,
        reasonCode: F_FACTS_REASON_CODES.EVENT_TYPE_UNSUPPORTED,
        billableFacts: [],
        attributionFacts: [],
        factDecisionAuditLite: createDecisionAudit({
          sourceEventId: sourceEventId || 'NA',
          mappingRuleVersion,
          decisionAction: 'drop',
          decisionReasonCode: F_FACTS_REASON_CODES.EVENT_TYPE_UNSUPPORTED,
          conflictDecision: 'none',
          nowMs
        })
      }
    }
    if (!sourceEventId || !normalizeText(event.traceKey) || !normalizeText(event.opportunityKey)) {
      return {
        ok: false,
        reasonCode: F_FACTS_REASON_CODES.MISSING_REQUIRED_FIELD,
        billableFacts: [],
        attributionFacts: [],
        factDecisionAuditLite: createDecisionAudit({
          sourceEventId: sourceEventId || 'NA',
          mappingRuleVersion,
          decisionAction: 'drop',
          decisionReasonCode: F_FACTS_REASON_CODES.MISSING_REQUIRED_FIELD,
          conflictDecision: 'missing_required',
          nowMs
        })
      }
    }

    const attributionTypeBase = EVENT_TO_ATTRIBUTION[eventType]
    let attributionType = attributionTypeBase
    let decisionReasonCode = F_FACTS_REASON_CODES.FACTS_MAPPED
    let conflictDecision = 'none'
    let billableFacts = []
    let attributionFacts = []

    const dedupAllowsBillable = dedupAckStatus === 'accepted'

    if (!dedupAllowsBillable) {
      decisionReasonCode = F_FACTS_REASON_CODES.BILLABLE_INELIGIBLE_DEDUP_STATUS
    }

    if (eventType === 'impression') {
      if (!closureKey || closureState !== 'closed_success') {
        decisionReasonCode = F_FACTS_REASON_CODES.BILLING_INELIGIBLE_TERMINAL_NOT_SUCCESS
      } else if (!dedupAllowsBillable) {
        decisionReasonCode = F_FACTS_REASON_CODES.BILLABLE_INELIGIBLE_DEDUP_STATUS
      } else {
        const billableFact = createBillableFact(event, 'billable_impression', factVersion, nowMs)
        const existing = billingFactStore.get(billableFact.billingKey)
        if (existing) {
          decisionReasonCode = F_FACTS_REASON_CODES.BILLING_CONFLICT_DUPLICATE_IMPRESSION
          conflictDecision = 'billing_key_duplicate'
          attributionType = 'attr_impression_duplicate'
        } else {
          billableFacts = [billableFact]
          billingFactStore.set(billableFact.billingKey, billableFact)
          const closureStateRecord = closureBillingState.get(closureKey) || {}
          closureStateRecord.billableImpressionKey = billableFact.billingKey
          closureBillingState.set(closureKey, closureStateRecord)
        }
      }
    } else if (eventType === 'click') {
      if (!closureKey) {
        decisionReasonCode = F_FACTS_REASON_CODES.BILLING_CLICK_WITHOUT_IMPRESSION
        attributionType = 'attr_click_pending'
      } else {
        const closureRecord = closureBillingState.get(closureKey) || {}
        const hasBillableImpression = Boolean(closureRecord.billableImpressionKey)
        if (closureState === 'closed_failure') {
          decisionReasonCode = F_FACTS_REASON_CODES.BILLING_INELIGIBLE_TERMINAL_FAILURE
          attributionType = 'attr_click_non_billable'
        } else if (!hasBillableImpression) {
          decisionReasonCode = F_FACTS_REASON_CODES.BILLING_CLICK_WITHOUT_IMPRESSION
          attributionType = 'attr_click_pending'
        } else if (!dedupAllowsBillable) {
          decisionReasonCode = F_FACTS_REASON_CODES.BILLABLE_INELIGIBLE_DEDUP_STATUS
          attributionType = 'attr_click_non_billable'
        } else {
          const billableFact = createBillableFact(event, 'billable_click', factVersion, nowMs)
          const existing = billingFactStore.get(billableFact.billingKey)
          if (existing) {
            decisionReasonCode = F_FACTS_REASON_CODES.BILLING_CONFLICT_DUPLICATE_IMPRESSION
            conflictDecision = 'billing_key_duplicate'
            attributionType = 'attr_click_non_billable'
          } else {
            billableFacts = [billableFact]
            billingFactStore.set(billableFact.billingKey, billableFact)
            const closureStateRecord = closureBillingState.get(closureKey) || {}
            closureStateRecord.billableClickKey = billableFact.billingKey
            closureBillingState.set(closureKey, closureStateRecord)
          }
        }
      }
    }

    const attributionFact = createAttributionFact(event, attributionType, factVersion, nowMs)
    attributionFacts = [attributionFact]

    let decisionAction = 'attribution_emit'
    if (billableFacts.length > 0 && attributionFacts.length > 0) decisionAction = 'both_emit'
    else if (billableFacts.length > 0) decisionAction = 'billable_emit'
    else if (attributionFacts.length === 0) decisionAction = 'drop'

    const factDecisionAuditLite = createDecisionAudit({
      sourceEventId,
      mappingRuleVersion,
      decisionAction,
      decisionReasonCode,
      conflictDecision,
      nowMs
    })

    return {
      ok: true,
      reasonCode: F_FACTS_REASON_CODES.FACTS_MAPPED,
      billableFacts: stableClone(billableFacts),
      attributionFacts: stableClone(attributionFacts),
      factDecisionAuditLite
    }
  }

  return {
    mapFacts,
    _debug: {
      billingFactStore,
      closureBillingState
    }
  }
}
