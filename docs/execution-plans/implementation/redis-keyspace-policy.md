# Redis Keyspace Policy (INFRA-004)

- Date: 2026-02-21
- Scope: Mediation A-H runtime cache/idempotency/circuit state

## 1. Prefix Convention

Global format:

1. `med:{env}:{module}:{category}:{key}`
2. `env` values: `dev|prod`
3. `module` values: `a|b|c|d|e|f|g|h|shared`

Examples:

1. `med:prod:f:idem:event:{idempotencyKey}`
2. `med:prod:d:circuit:source:{sourceId}`
3. `med:prod:h:cfg:etag:{configKeyHash}`

## 2. Key Categories and TTL

1. Idempotency keys
   - Prefix: `med:{env}:{module}:idem:*`
   - TTL:
     - A/B event emit: `10m~15m`
     - F event dedupe: `48h`
     - G append dedupe: `24h`
2. Dedup window state
   - Prefix: `med:{env}:{module}:dedup:*`
   - TTL:
     - A dedup window: `120s`
     - F terminal closure window: `>=120s` and aligned to business rule
3. Cache entries
   - Prefix: `med:{env}:{module}:cache:*`
   - TTL:
     - Query cache: `15s` (default)
     - Snapshot cache: `120s` (default)
     - Config cache: by H contract (`ttlSec + staleGraceSec`)
4. Circuit/degradation state
   - Prefix: `med:{env}:d:circuit:*`
   - TTL:
     - `circuitOpenMs` driven, with additional safety grace `+60s`

## 3. Serialization Rules

1. All JSON values must include:
   - `createdAt`
   - `expiresAt`
   - `version`
2. Business payload fields and transport metadata are separated:
   - `payload`
   - `meta`

## 4. Collision and Ownership Rules

1. Module ownership is exclusive by prefix segment (`module`).
2. Cross-module shared keys must use `module=shared`.
3. No raw user-provided strings as direct key body:
   - Use normalized lower-case + hash suffix.
4. Maximum key length target: `< 200 chars`.

## 5. Eviction and Capacity Strategy

1. Redis maxmemory policy recommendation:
   - `volatile-ttl` for runtime environments with strict TTL usage
2. Critical key classes (idem/dedup/circuit) must always set TTL.
3. Background sampling check:
   - Verify stale keys are not accumulating by prefix.

## 6. Security Rules

1. Do not store raw secrets in Redis values.
2. Sensitive identifiers should be hashed when possible.
3. Tenant-scoped keys must include tenant segment (or hashed tenant id) to prevent cross-tenant collision.

## 7. Observability

Required metrics:

1. `redis_key_count_by_prefix`
2. `redis_eviction_count`
3. `redis_hit_ratio_by_cache_type`
4. `redis_idempotency_duplicate_hits`

Required periodic checks:

1. Key cardinality drift by module
2. TTL compliance by key class
