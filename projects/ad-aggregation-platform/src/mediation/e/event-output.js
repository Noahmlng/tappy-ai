import crypto from 'node:crypto'

export const E_EVENT_OUTPUT_REASON_CODES = Object.freeze({
  EVENT_READY: 'e_event_output_ready',
  EVENT_IGNORED: 'e_event_source_render_event_ignored',
  INVALID_INPUT: 'e_event_invalid_input',
  MISSING_RESPONSE_REFERENCE: 'e_event_missing_response_reference',
  IMPRESSION_FORBIDDEN_STATUS: 'e_event_impression_forbidden_status',
  TERMINAL_EVENT_CONFLICT: 'e_event_terminal_conflict'
})

const SOURCE_TO_EVENT_TYPE = Object.freeze({
  ad_rendered: 'impression',
  on_click: 'click',
  ad_render_failed: 'failure'
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function createEventId(responseReference, renderAttemptId, eventType) {
  return `evt_${stableHash(`${responseReference}:${renderAttemptId}:${eventType}`).slice(0, 20)}`
}

function createIdempotencyKey(responseReference, renderAttemptId, eventType) {
  return `e_idem_${stableHash(`${responseReference}:${renderAttemptId}:${eventType}`).slice(0, 20)}`
}

function toEventType(sourceRenderEventType) {
  const normalized = normalizeText(sourceRenderEventType)
  return SOURCE_TO_EVENT_TYPE[normalized] || ''
}

function isTerminalEventType(eventType) {
  return eventType === 'impression' || eventType === 'failure'
}

function normalizeEventReasonCode(sourceRenderEventType, fallbackReasonCode) {
  const explicit = normalizeText(fallbackReasonCode)
  if (explicit) return explicit
  const source = normalizeText(sourceRenderEventType)
  if (source === 'ad_rendered') return 'e_impression_reported'
  if (source === 'on_click') return 'e_click_reported'
  if (source === 'ad_render_failed') return 'e_render_failed'
  return 'e_event_unknown'
}

export function createEventOutputBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const eventContractVersion = normalizeText(options.eventContractVersion) || 'e_to_f_event_contract_v1'
  const terminalEventByAttempt = new Map()

  function buildEvent(input = {}) {
    const request = isPlainObject(input) ? input : {}
    const eDeliveryResponseLite = isPlainObject(request.eDeliveryResponseLite) ? request.eDeliveryResponseLite : {}
    const sourceRenderEventType = normalizeText(request.sourceRenderEventType)
    const eventType = toEventType(sourceRenderEventType)

    if (!isPlainObject(request) || !isPlainObject(eDeliveryResponseLite)) {
      return {
        ok: false,
        emitted: false,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.INVALID_INPUT,
        eToFEventLite: null
      }
    }

    if (sourceRenderEventType === 'ad_render_started') {
      return {
        ok: true,
        emitted: false,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.EVENT_IGNORED,
        eToFEventLite: null
      }
    }
    if (!eventType) {
      return {
        ok: false,
        emitted: false,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.INVALID_INPUT,
        eToFEventLite: null
      }
    }

    const responseReference = normalizeText(
      request.responseReference ||
      eDeliveryResponseLite.responseReference ||
      eDeliveryResponseLite?.renderPlanLite?.responseReference
    )
    if (!responseReference) {
      return {
        ok: true,
        emitted: false,
        quarantined: true,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.MISSING_RESPONSE_REFERENCE,
        eToFEventLite: null
      }
    }

    const deliveryStatusSnapshot = normalizeText(
      request.deliveryStatusSnapshot || eDeliveryResponseLite.deliveryStatus
    )
    if (!['served', 'no_fill', 'error'].includes(deliveryStatusSnapshot)) {
      return {
        ok: false,
        emitted: false,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.INVALID_INPUT,
        eToFEventLite: null
      }
    }

    if (eventType === 'impression' && (deliveryStatusSnapshot === 'no_fill' || deliveryStatusSnapshot === 'error')) {
      return {
        ok: false,
        emitted: false,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.IMPRESSION_FORBIDDEN_STATUS,
        eToFEventLite: null
      }
    }

    const renderAttemptId = normalizeText(request.renderAttemptId) ||
      `ra_${stableHash(`${responseReference}:${normalizeText(eDeliveryResponseLite.attemptKey)}`).slice(0, 16)}`

    const existingTerminal = terminalEventByAttempt.get(renderAttemptId)
    if (existingTerminal && isTerminalEventType(eventType)) {
      return {
        ok: false,
        emitted: false,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.TERMINAL_EVENT_CONFLICT,
        eToFEventLite: null,
        details: {
          renderAttemptId,
          existingTerminalEventType: existingTerminal
        }
      }
    }

    const traceKey = normalizeText(eDeliveryResponseLite.traceKey)
    const requestKey = normalizeText(eDeliveryResponseLite.requestKey)
    const attemptKey = normalizeText(eDeliveryResponseLite.attemptKey)
    const opportunityKey = normalizeText(eDeliveryResponseLite.opportunityKey)
    if (!traceKey || !requestKey || !attemptKey || !opportunityKey) {
      return {
        ok: false,
        emitted: false,
        reasonCode: E_EVENT_OUTPUT_REASON_CODES.INVALID_INPUT,
        eToFEventLite: null
      }
    }

    const eventReasonCode = normalizeEventReasonCode(sourceRenderEventType, request.eventReasonCode || eDeliveryResponseLite.finalReasonCode)
    const eventId = createEventId(responseReference, renderAttemptId, eventType)
    const idempotencyKey = createIdempotencyKey(responseReference, renderAttemptId, eventType)

    const eToFEventLite = {
      eventId,
      eventType,
      sourceRenderEventType,
      responseReference,
      traceKey,
      requestKey,
      attemptKey,
      opportunityKey,
      renderAttemptId,
      idempotencyKey,
      deliveryStatusSnapshot,
      eventReasonCode,
      eventAt: normalizeText(request.eventAt) || nowIso(nowFn),
      eventContractVersion
    }

    if (isTerminalEventType(eventType)) {
      terminalEventByAttempt.set(renderAttemptId, eventType)
    }

    return {
      ok: true,
      emitted: true,
      reasonCode: E_EVENT_OUTPUT_REASON_CODES.EVENT_READY,
      eToFEventLite
    }
  }

  function reset() {
    terminalEventByAttempt.clear()
  }

  return {
    buildEvent,
    reset
  }
}
