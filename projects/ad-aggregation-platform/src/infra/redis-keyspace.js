const REDIS_ENV_KEYS = new Set(['dev', 'prod'])

const REDIS_MODULE_KEYS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'shared'])

const REDIS_TTL_SECONDS = Object.freeze({
  A_DEDUP_WINDOW: 120,
  A_EVENT_IDEMPOTENCY: 15 * 60,
  B_SIGNAL_EVENT_IDEMPOTENCY: 10 * 60,
  F_EVENT_IDEMPOTENCY: 48 * 60 * 60,
  G_APPEND_IDEMPOTENCY: 24 * 60 * 60,
  QUERY_CACHE: 15,
  SNAPSHOT_CACHE: 120,
  CIRCUIT_SAFETY_GRACE: 60
})

function normalizePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
}

function normalizeEnv(env) {
  const normalized = normalizePart(env)
  if (REDIS_ENV_KEYS.has(normalized)) return normalized
  return 'prod'
}

function normalizeModule(moduleName) {
  const normalized = normalizePart(moduleName)
  if (REDIS_MODULE_KEYS.has(normalized)) return normalized
  throw new Error(`[redis-keyspace] invalid module: ${moduleName}`)
}

function buildRedisKey({ env, moduleName, category, key }) {
  const e = normalizeEnv(env)
  const m = normalizeModule(moduleName)
  const c = normalizePart(category)
  const k = normalizePart(key)
  if (!c) throw new Error('[redis-keyspace] category is required')
  if (!k) throw new Error('[redis-keyspace] key is required')
  return `med:${e}:${m}:${c}:${k}`
}

function buildIdempotencyKey({ env, moduleName, domain, idempotencyKey }) {
  return buildRedisKey({
    env,
    moduleName,
    category: `idem:${normalizePart(domain) || 'default'}`,
    key: idempotencyKey
  })
}

function buildDedupKey({ env, moduleName, domain, dedupKey }) {
  return buildRedisKey({
    env,
    moduleName,
    category: `dedup:${normalizePart(domain) || 'default'}`,
    key: dedupKey
  })
}

function buildCacheKey({ env, moduleName, cacheType, key }) {
  return buildRedisKey({
    env,
    moduleName,
    category: `cache:${normalizePart(cacheType) || 'default'}`,
    key
  })
}

function buildCircuitKey({ env, sourceId }) {
  return buildRedisKey({
    env,
    moduleName: 'd',
    category: 'circuit:source',
    key: sourceId
  })
}

export {
  REDIS_ENV_KEYS,
  REDIS_MODULE_KEYS,
  REDIS_TTL_SECONDS,
  buildCacheKey,
  buildCircuitKey,
  buildDedupKey,
  buildIdempotencyKey,
  buildRedisKey
}
