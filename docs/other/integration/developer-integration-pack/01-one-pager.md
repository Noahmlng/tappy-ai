# 01 - Product and System One Pager

- Owner: Integrations Team + Runtime Platform
- Last Updated: 2026-02-25
- Scope: prod-only runtime path

## 1. Problem and Value

This mediation layer provides a production-style ad request path for external SDK integrations with three goals:

1. External developer can finish onboarding in one chain: `config -> v2/bid -> events`.
2. Revenue is visible in-product (Dashboard) without external export dependency.
3. Settlement facts are archived for later analytics and reconciliation.

Primary business outcomes:
1. Faster partner onboarding (first valid `requestId` in <= 15 minutes).
2. Consistent attribution from bid decision to SDK event to conversion fact.
3. Measurable settled revenue (`settledRevenueUsd`) for account/app/placement scopes.

Target users:
1. External app developers integrating runtime ad APIs.
2. Internal integration QA and release managers.
3. Product/ops owners monitoring settlement outcomes in dashboard.

## 2. System Boundaries

In scope:
1. Runtime API contracts:
   - `GET /api/v1/mediation/config`
   - `POST /api/v2/bid`
   - `POST /api/v1/sdk/events` (attach / next-step / postback conversion)
2. Runtime auth and scope enforcement (API key / short-lived access token).
3. Settlement conversion fact persistence and dashboard aggregation.

Out of scope:
1. Payout/export to external finance systems.
2. Legacy evaluate endpoint onboarding.
3. Non-HTTP transport integrations.

Upstream dependencies:
1. Control-plane state (app/account/placement/key ownership).
2. Bid source adapters (partnerstack / cj / house fallback).
3. Optional Supabase/Postgres durable storage.

Downstream consumers:
1. External SDK caller.
2. Dashboard (`/api/v1/dashboard/*`) for usage/revenue views.
3. Offline analysis pipelines consuming settlement fact tables/snapshots.

## 3. Architecture Snapshot

Request path:
1. SDK reads placement config from `/api/v1/mediation/config`.
2. SDK requests bid from `/api/v2/bid` with message context.
3. SDK reports attach/next-step/postback events to `/api/v1/sdk/events`.

Decision path:
1. Placement rules + bidder fanout resolve winner/no-bid.
2. Gateway returns `requestId` + `status=success` + `message`.
3. Fail-open is preserved: ad failure must not block primary chat response.

Event attribution path:
1. SDK events append runtime event logs keyed by `requestId`.
2. Postback conversion success creates settlement conversion fact.
3. Conversion facts dedupe on `idempotency_key` and roll into settlement aggregates.

Config governance path:
1. Placement config is versioned (`configVersion`) and scoped by `appId/accountId` under fixed `environment=prod`.
2. Dashboard/config APIs update placement settings with auth/scope checks.
3. Runtime reads config snapshot via versioned query parameters.

## 4. Reliability Targets

1. Availability target: >= 99.9% for public runtime endpoints.
2. Latency target:
   - `mediation/config` p95 <= 300ms
   - `v2/bid` p95 <= 1200ms on chat path
   - `sdk/events` p95 <= 800ms
3. Event ack success target: >= 99.5% for valid payloads.
4. Reconciliation tolerance:
   - Duplicate conversion write rate <= 0.1%
   - Settlement discrepancy within one fact record per replay window (must be explainable by idempotency).

## 5. Known Risks and Mitigations

| Risk | Impact | Mitigation | Owner |
| --- | --- | --- | --- |
| No-bid interpreted as API failure | Client retries incorrectly, noisy traffic | Treat `message=No bid` as normal success path, no blind retry | Integrations |
| Duplicate postback conversion | Revenue double count risk | Enforce semantic idempotency key + unique constraint on settlement fact | Runtime Platform |
| Scope mismatch between credential and app/account | Data leakage or unauthorized access | Return `403 *_SCOPE_VIOLATION` and audit deny logs | Security + Runtime |
| Durable store unavailable | Startup failures or data loss risk | Fast-first CI with state-file mode + dedicated durable verification suite | QA + Release |
