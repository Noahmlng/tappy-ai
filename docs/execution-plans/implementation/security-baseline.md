# Security Baseline (INFRA-006)

- Date: 2026-02-21
- Scope: mediation API, internal workers, config publish and replay paths
- Primary backend: Supabase Postgres (`project_ref=bkqjenmznafkqqwvwrad`)

## 1. Security Boundaries

1. External caller (`SDK/client`) -> `mediation-api` uses app credential + signed request.
2. Internal service-to-service calls use short-lived service tokens (`HS256`, `kid`-based rotation).
3. Supabase DB is accessed by backend service role only, never by untrusted client keys.

## 2. Secret Classes and Storage

1. P0 secrets (must rotate):
   - `SERVICE_TOKEN_KEYS_JSON`
   - Ads network credentials
   - Supabase service role connection string / DB password
2. P1 secrets:
   - observability sink tokens
   - non-production API keys
3. Storage policy:
   - production secrets in secret manager only
   - local dev can use `.env` but must never commit real values

## 3. AuthN/AuthZ Model

1. Role model (minimum):
   - `publisher`: read config + request publish
   - `reviewer`: approve publish + audit read
   - `admin`: wildcard scope
2. Required control points:
   - publish endpoint requires `config:publish` and reviewer/admin gate
   - replay/dispute endpoints require `audit:read` or admin
   - event ingest write path requires `event:write`
3. Any auth failure returns deterministic reason codes and writes audit record.

## 4. Token Lifecycle

1. SDK access token TTL: 15 minutes
2. Internal service token TTL: 5 minutes
3. Publish action token TTL: 2 minutes
4. Refresh token TTL: 24 hours
5. Clock skew tolerance: 10 seconds

## 5. Key Rotation Policy

1. Active signing key identified by `SERVICE_TOKEN_ACTIVE_KID`.
2. `SERVICE_TOKEN_KEYS_JSON` keeps at least two keys (`active` + `previous`) during overlap.
3. Rotation steps:
   - add new key with new `kid`
   - switch `SERVICE_TOKEN_ACTIVE_KID`
   - observe dual-key verification window
   - remove old key after max token TTL + buffer
4. Rotate immediately on leak suspicion.

## 6. Audit and Forensics

Mandatory audit fields:

1. `requestId`
2. `actorId`
3. `actorRole`
4. `authAction`
5. `requiredScope`
6. `result`
7. `reasonCode`
8. `traceKey`
9. `timestamp`

## 7. Supabase Hardening Baseline

1. Enable SSL-only DB connections.
2. Restrict DB access to backend runtime (service role / DB password managed via secrets manager).
3. Keep migration role separate from runtime role.
4. Apply row-level security only when direct client-table access is introduced (current phase is server-only access).

## 8. Runtime Readiness Gate

Must all pass before Go:

1. auth integration tests pass (`npm --prefix ./projects/tappy-ai-mediation run test:integration -- auth`)
2. no endpoint bypasses `authorizeServiceRequest`
3. audit logging on deny path is enabled
4. key rotation runbook verified in staging
