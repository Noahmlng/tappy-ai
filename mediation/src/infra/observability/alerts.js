import { DEFAULT_SLO_TARGETS, evaluateSloCompliance } from './sli-definitions.js'

const ALERT_LEVELS = Object.freeze({
  P0: 'P0',
  P1: 'P1',
  P2: 'P2'
})

function toSafeNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function buildAlertDecisions(input = {}) {
  const sloTargets = input.sloTargets || DEFAULT_SLO_TARGETS
  const sloEvaluation = evaluateSloCompliance(input.sliSnapshot || {}, sloTargets)
  const queueLagSeconds = toSafeNumber(input.queueLagSeconds, 0)
  const deadLetterCount = toSafeNumber(input.deadLetterCount, 0)

  const alerts = []

  for (const violation of sloEvaluation.violations) {
    const level = violation.sliKey === 'replay_determinism' ? ALERT_LEVELS.P0 : ALERT_LEVELS.P1
    alerts.push({
      level,
      code: `SLO_BREACH_${violation.sliKey.toUpperCase()}`,
      message: `${violation.sliKey}=${violation.value} below target=${violation.target}`,
      meta: violation
    })
  }

  if (queueLagSeconds > 300) {
    alerts.push({
      level: ALERT_LEVELS.P0,
      code: 'MQ_LAG_TOO_HIGH',
      message: `queue lag ${queueLagSeconds}s exceeded 300s threshold`
    })
  }

  if (deadLetterCount >= 100) {
    alerts.push({
      level: ALERT_LEVELS.P0,
      code: 'DLQ_SPIKE',
      message: `dead-letter count ${deadLetterCount} exceeded emergency threshold`
    })
  } else if (deadLetterCount >= 20) {
    alerts.push({
      level: ALERT_LEVELS.P1,
      code: 'DLQ_ELEVATED',
      message: `dead-letter count ${deadLetterCount} exceeded warning threshold`
    })
  }

  return {
    pass: alerts.length === 0,
    alerts,
    sloEvaluation,
    summary: {
      total: alerts.length,
      p0: alerts.filter((item) => item.level === ALERT_LEVELS.P0).length,
      p1: alerts.filter((item) => item.level === ALERT_LEVELS.P1).length,
      p2: alerts.filter((item) => item.level === ALERT_LEVELS.P2).length
    }
  }
}

export {
  ALERT_LEVELS,
  buildAlertDecisions
}
