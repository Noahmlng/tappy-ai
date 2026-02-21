const SLI_KEYS = Object.freeze({
  REQUEST_AVAILABILITY: 'request_availability',
  EVENT_ACK_SUCCESS: 'event_ack_success',
  CLOSED_LOOP_COMPLETION: 'closed_loop_completion',
  REPLAY_DETERMINISM: 'replay_determinism',
  PUBLISH_SUCCESS: 'publish_success'
})

const DEFAULT_SLO_TARGETS = Object.freeze({
  [SLI_KEYS.REQUEST_AVAILABILITY]: 0.999,
  [SLI_KEYS.EVENT_ACK_SUCCESS]: 0.999,
  [SLI_KEYS.CLOSED_LOOP_COMPLETION]: 0.995,
  [SLI_KEYS.REPLAY_DETERMINISM]: 0.9999,
  [SLI_KEYS.PUBLISH_SUCCESS]: 0.995
})

function toSafeRatio(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function normalizeSliSnapshot(snapshot = {}) {
  return {
    [SLI_KEYS.REQUEST_AVAILABILITY]: toSafeRatio(snapshot[SLI_KEYS.REQUEST_AVAILABILITY], 0),
    [SLI_KEYS.EVENT_ACK_SUCCESS]: toSafeRatio(snapshot[SLI_KEYS.EVENT_ACK_SUCCESS], 0),
    [SLI_KEYS.CLOSED_LOOP_COMPLETION]: toSafeRatio(snapshot[SLI_KEYS.CLOSED_LOOP_COMPLETION], 0),
    [SLI_KEYS.REPLAY_DETERMINISM]: toSafeRatio(snapshot[SLI_KEYS.REPLAY_DETERMINISM], 0),
    [SLI_KEYS.PUBLISH_SUCCESS]: toSafeRatio(snapshot[SLI_KEYS.PUBLISH_SUCCESS], 0)
  }
}

function evaluateSloCompliance(snapshot = {}, sloTargets = DEFAULT_SLO_TARGETS) {
  const normalizedSnapshot = normalizeSliSnapshot(snapshot)
  const violations = []

  for (const [sliKey, target] of Object.entries(sloTargets)) {
    const value = normalizedSnapshot[sliKey]
    if (value < target) {
      violations.push({
        sliKey,
        value,
        target,
        deficit: Number((target - value).toFixed(6))
      })
    }
  }

  return {
    snapshot: normalizedSnapshot,
    violations,
    pass: violations.length === 0
  }
}

export {
  DEFAULT_SLO_TARGETS,
  SLI_KEYS,
  evaluateSloCompliance,
  normalizeSliSnapshot
}
