import crypto from 'node:crypto'

export const F_TERMINAL_CLOSURE_REASON_CODES = Object.freeze({
  CLOSURE_UPDATED: 'f_terminal_closure_updated',
  CLOSURE_KEY_MISSING: 'f_terminal_closure_key_missing',
  TERMINAL_TIMEOUT_AUTOFILL: 'f_terminal_timeout_autofill',
  TERMINAL_CONFLICT_FAILURE_AFTER_IMPRESSION: 'f_terminal_conflict_failure_after_impression',
  TERMINAL_CONFLICT_IMPRESSION_AFTER_FAILURE: 'f_terminal_conflict_impression_after_failure',
  TERMINAL_DUPLICATE_FAILURE_AFTER_SYNTHESIZED: 'f_terminal_duplicate_failure_after_synthesized',
  TERMINAL_EVENT_IGNORED: 'f_terminal_event_ignored'
})

const CLOSURE_STATES = Object.freeze({
  OPEN: 'open',
  CLOSED_SUCCESS: 'closed_success',
  CLOSED_FAILURE: 'closed_failure'
})

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

function closureKeyFor(event) {
  const responseReference = normalizeText(event.responseReference)
  const renderAttemptId = normalizeText(event.renderAttemptId)
  if (!responseReference || !renderAttemptId) return ''
  return `${responseReference}|${renderAttemptId}`
}

function normalizeTerminalType(eventType, event) {
  const type = normalizeText(eventType)
  if (type === 'impression') return 'impression'
  if (type === 'failure') return 'failure'
  if (type === 'error' && normalizeText(event.errorClass) === 'terminal') return 'failure'
  return ''
}

function makeSyntheticFailureEvent(closureKey, nowMs) {
  const [responseReference, renderAttemptId] = closureKey.split('|')
  const eventId = `evt_timeout_${crypto.createHash('sha256').update(`${closureKey}|${nowMs}`).digest('hex').slice(0, 16)}`
  return {
    eventId,
    eventType: 'failure',
    eventAt: nowIso(nowMs),
    responseReference,
    renderAttemptId,
    terminalSource: 'system_timeout_synthesized',
    failureReasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_TIMEOUT_AUTOFILL
  }
}

export function createTerminalClosureEngine(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const terminalWaitWindowMs = Number.isFinite(Number(options.terminalWaitWindowMs))
    ? Number(options.terminalWaitWindowMs)
    : 120_000
  const closureStore = options.closureStore instanceof Map ? options.closureStore : new Map()

  function ensureClosure(closureKey, nowMs) {
    if (!closureStore.has(closureKey)) {
      closureStore.set(closureKey, {
        closureKey,
        state: CLOSURE_STATES.OPEN,
        terminalSource: '',
        openedAtMs: nowMs,
        closedAtMs: null,
        supersededTerminalEventId: '',
        history: [
          {
            at: nowIso(nowMs),
            action: 'open',
            reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED
          }
        ]
      })
    }
    return closureStore.get(closureKey)
  }

  function openIfSignal(eventType, event, nowMs) {
    const type = normalizeText(eventType)
    if (type !== 'ad_filled' && type !== 'ad_render_started') return null
    const closureKey = closureKeyFor(event)
    if (!closureKey) return {
      ok: false,
      reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_KEY_MISSING
    }
    const closure = ensureClosure(closureKey, nowMs)
    closure.state = CLOSURE_STATES.OPEN
    closure.history.push({
      at: nowIso(nowMs),
      action: 'open_signal',
      eventType: type,
      reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED
    })
    closureStore.set(closureKey, closure)
    return {
      ok: true,
      ackStatus: 'accepted',
      reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED,
      closureKey,
      closureState: closure.state
    }
  }

  function processEvent(input = {}) {
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : nowFn()
    const event = input.event || {}
    const eventType = normalizeText(input.eventType || event.eventType)
    const maybeOpen = openIfSignal(eventType, event, nowMs)
    if (maybeOpen) return maybeOpen

    const terminalType = normalizeTerminalType(eventType, event)
    if (!terminalType) {
      return {
        ok: true,
        ackStatus: 'accepted',
        reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_EVENT_IGNORED,
        closureKey: '',
        closureState: ''
      }
    }

    const closureKey = closureKeyFor(event)
    if (!closureKey) {
      return {
        ok: false,
        ackStatus: 'rejected',
        reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_KEY_MISSING
      }
    }
    const closure = ensureClosure(closureKey, nowMs)

    if (terminalType === 'impression') {
      if (closure.state === CLOSURE_STATES.CLOSED_SUCCESS) {
        closure.history.push({
          at: nowIso(nowMs),
          action: 'duplicate_terminal',
          eventType: 'impression',
          reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_IMPRESSION_AFTER_FAILURE
        })
        return {
          ok: true,
          ackStatus: 'duplicate',
          reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_IMPRESSION_AFTER_FAILURE,
          closureKey,
          closureState: closure.state
        }
      }
      if (closure.state === CLOSURE_STATES.CLOSED_FAILURE) {
        if (closure.terminalSource === 'system_timeout_synthesized') {
          closure.state = CLOSURE_STATES.CLOSED_SUCCESS
          closure.supersededTerminalEventId = closure.terminalEventId || ''
          closure.terminalSource = 'impression'
          closure.terminalEventId = normalizeText(event.eventId) || 'impression_event'
          closure.closedAtMs = nowMs
          closure.history.push({
            at: nowIso(nowMs),
            action: 'override_to_success',
            eventType: 'impression',
            reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED
          })
          closureStore.set(closureKey, closure)
          return {
            ok: true,
            ackStatus: 'accepted',
            reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED,
            closureKey,
            closureState: closure.state
          }
        }
        closure.history.push({
          at: nowIso(nowMs),
          action: 'conflict_duplicate',
          eventType: 'impression',
          reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_IMPRESSION_AFTER_FAILURE
        })
        return {
          ok: true,
          ackStatus: 'duplicate',
          reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_IMPRESSION_AFTER_FAILURE,
          closureKey,
          closureState: closure.state
        }
      }

      closure.state = CLOSURE_STATES.CLOSED_SUCCESS
      closure.terminalSource = 'impression'
      closure.terminalEventId = normalizeText(event.eventId) || 'impression_event'
      closure.closedAtMs = nowMs
      closure.history.push({
        at: nowIso(nowMs),
        action: 'close_success',
        eventType: 'impression',
        reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED
      })
      closureStore.set(closureKey, closure)
      return {
        ok: true,
        ackStatus: 'accepted',
        reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED,
        closureKey,
        closureState: closure.state
      }
    }

    if (terminalType === 'failure') {
      if (closure.state === CLOSURE_STATES.CLOSED_SUCCESS) {
        closure.history.push({
          at: nowIso(nowMs),
          action: 'conflict_duplicate',
          eventType: 'failure',
          reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_FAILURE_AFTER_IMPRESSION
        })
        return {
          ok: true,
          ackStatus: 'duplicate',
          reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_FAILURE_AFTER_IMPRESSION,
          closureKey,
          closureState: closure.state
        }
      }
      if (closure.state === CLOSURE_STATES.CLOSED_FAILURE) {
        const reason = closure.terminalSource === 'system_timeout_synthesized'
          ? F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_DUPLICATE_FAILURE_AFTER_SYNTHESIZED
          : F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_CONFLICT_IMPRESSION_AFTER_FAILURE
        closure.history.push({
          at: nowIso(nowMs),
          action: 'duplicate_terminal',
          eventType: 'failure',
          reasonCode: reason
        })
        return {
          ok: true,
          ackStatus: 'duplicate',
          reasonCode: reason,
          closureKey,
          closureState: closure.state
        }
      }

      closure.state = CLOSURE_STATES.CLOSED_FAILURE
      closure.terminalSource = normalizeText(event.terminalSource) || 'real_failure'
      closure.terminalEventId = normalizeText(event.eventId) || 'failure_event'
      closure.closedAtMs = nowMs
      closure.history.push({
        at: nowIso(nowMs),
        action: 'close_failure',
        eventType: 'failure',
        reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED
      })
      closureStore.set(closureKey, closure)
      return {
        ok: true,
        ackStatus: 'accepted',
        reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.CLOSURE_UPDATED,
        closureKey,
        closureState: closure.state
      }
    }

    return {
      ok: true,
      ackStatus: 'accepted',
      reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_EVENT_IGNORED,
      closureKey,
      closureState: closure.state
    }
  }

  function processBatch(events = [], nowMsInput) {
    const nowMs = Number.isFinite(Number(nowMsInput)) ? Number(nowMsInput) : nowFn()
    const normalized = Array.isArray(events) ? events.map((item) => item || {}) : []
    const prioritized = [...normalized].sort((a, b) => {
      const aType = normalizeTerminalType(a.eventType, a)
      const bType = normalizeTerminalType(b.eventType, b)
      const aScore = aType === 'impression' ? 2 : (aType === 'failure' ? 1 : 0)
      const bScore = bType === 'impression' ? 2 : (bType === 'failure' ? 1 : 0)
      if (aScore !== bScore) return bScore - aScore
      return 0
    })
    return prioritized.map((event) => processEvent({ event, nowMs }))
  }

  function scanTimeouts(nowMsInput) {
    const nowMs = Number.isFinite(Number(nowMsInput)) ? Number(nowMsInput) : nowFn()
    const synthesized = []

    for (const [closureKey, closure] of closureStore.entries()) {
      if (closure.state !== CLOSURE_STATES.OPEN) continue
      if (!Number.isFinite(closure.openedAtMs)) continue
      if (nowMs - closure.openedAtMs < terminalWaitWindowMs) continue

      const syntheticEvent = makeSyntheticFailureEvent(closureKey, nowMs)
      const result = processEvent({
        event: syntheticEvent,
        eventType: 'failure',
        nowMs
      })
      if (result.ok && result.ackStatus === 'accepted') {
        synthesized.push({
          closureKey,
          event: syntheticEvent,
          reasonCode: F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_TIMEOUT_AUTOFILL
        })
      }
    }

    return synthesized
  }

  function replay(closureKey) {
    const closure = closureStore.get(normalizeText(closureKey))
    if (!closure) return null
    return stableClone(closure)
  }

  return {
    processEvent,
    processBatch,
    scanTimeouts,
    replay,
    _debug: {
      closureStore
    }
  }
}
