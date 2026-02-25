const MQ_TOPICS = Object.freeze({
  E_TO_F_EVENTS: 'mediation.e_to_f.events',
  F_TO_G_ARCHIVE: 'mediation.f_to_g.archive',
  H_PUBLISH_JOBS: 'mediation.h.publish.jobs',
  REPLAY_JOBS: 'mediation.replay.jobs',
  DEAD_LETTER: 'mediation.dead_letter'
})

const MQ_CONSUMER_GROUPS = Object.freeze({
  F_INGEST: 'cg_f_ingest',
  G_ARCHIVE: 'cg_g_archive',
  H_PUBLISH: 'cg_h_publish',
  REPLAY: 'cg_replay'
})

const MQ_RETRY_BACKOFF_MS = Object.freeze([1000, 5000, 30000, 120000, 600000])

function toSafeInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

function defaultRetryPolicy(overrides = {}) {
  const maxRetries = toSafeInt(overrides.maxRetries, MQ_RETRY_BACKOFF_MS.length)
  const backoffMs = Array.isArray(overrides.backoffMs)
    ? overrides.backoffMs.map((item) => toSafeInt(item, 0)).filter((item) => item > 0)
    : MQ_RETRY_BACKOFF_MS

  return {
    maxRetries: maxRetries > 0 ? maxRetries : backoffMs.length,
    backoffMs,
    deadLetterTopic: overrides.deadLetterTopic || MQ_TOPICS.DEAD_LETTER
  }
}

function nextRetryDelayMs(retryCount, policy = defaultRetryPolicy()) {
  const count = toSafeInt(retryCount, 0)
  if (count >= policy.maxRetries) return null
  const ladder = Array.isArray(policy.backoffMs) && policy.backoffMs.length > 0
    ? policy.backoffMs
    : MQ_RETRY_BACKOFF_MS
  return ladder[Math.min(count, ladder.length - 1)]
}

function shouldDeadLetter(retryCount, policy = defaultRetryPolicy()) {
  const count = toSafeInt(retryCount, 0)
  return count >= policy.maxRetries
}

export {
  MQ_CONSUMER_GROUPS,
  MQ_RETRY_BACKOFF_MS,
  MQ_TOPICS,
  defaultRetryPolicy,
  nextRetryDelayMs,
  shouldDeadLetter
}

