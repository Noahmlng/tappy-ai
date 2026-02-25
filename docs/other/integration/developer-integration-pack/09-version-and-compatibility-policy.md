# 09 - Version and Compatibility Policy

- Owner: API Governance + Integrations
- Last Updated: 2026-02-25

## 1. Versioning Model

1. API versioning scheme:
   - path-based major versioning (`/api/v1/*`, `/api/v2/*`).
   - current external baseline:
     - `GET /api/v1/mediation/config`
     - `POST /api/v2/bid`
     - `POST /api/v1/sdk/events`
2. SDK versioning scheme:
   - semantic versioning for SDK client releases (`major.minor.patch`).
3. Config schema versioning:
   - explicit `schemaVersion` query param, currently `schema_v1`.

## 2. Compatibility Guarantees

Backward-compatible changes:
1. additive response fields.
2. optional request fields (when contract permits).
3. non-breaking metadata additions.

Breaking change definition:
1. removing required field or endpoint.
2. changing field semantics/type for existing required fields.
3. altering auth/scope behavior in a way that rejects previously valid requests.

Notice period:
1. minimum 14 calendar days for planned breaking changes.
2. emergency security fix may shorten window, but must include migration note.

## 3. Deprecation Lifecycle

| Phase | Duration | Requirements |
| --- | --- | --- |
| announce | >= 14 days | changelog entry + migration steps + owner contact |
| transition | 14~30 days | compatibility tests in staging + customer sign-off |
| removal | scheduled window | release note + rollback plan + post-check evidence |

V2-only decision record:
1. On 2026-02-25, external onboarding docs were aligned to `config -> v2/bid -> events`.
2. Legacy evaluate-style onboarding is no longer documented for new integrations.
3. All new certifications must pass V2 path tests.

## 4. Upgrade Path

1. Validate compatibility in staging.
2. Deploy with canary.
3. Monitor key SLIs.
4. Roll back if thresholds breach.

## 5. Failure Handling During Upgrade

| Failure | Signal | Action |
| --- | --- | --- |
| payload rejected after upgrade | `400 INVALID_REQUEST` / schema mismatch | pin client to previous compatible payload and apply migration patch |
| scope failures increase | `403 *_SCOPE_VIOLATION` spikes | verify key issuance scope and app/account mapping |
| bid latency regression | p95 exceeds gate | rollback canary and investigate adapter/runtime changes |
| settlement mismatch | conversion facts and dashboard totals diverge | run idempotency reconciliation and block rollout |
