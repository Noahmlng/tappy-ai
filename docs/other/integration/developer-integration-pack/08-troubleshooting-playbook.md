# 08 - Troubleshooting Playbook

- Owner: Integrations QA + On-call Runtime
- Last Updated: 2026-02-25

## 1. Triage Flow

1. Confirm service health.
2. Locate request and trace ids.
3. Classify error type (client/server/adapter/data).
4. Apply known fix.
5. Re-run verification case.

## 2. Incident Index

| Symptom | Detection Signal | Root Cause Pattern | Fix Steps | Escalation |
| --- | --- | --- | --- | --- |
| `v2/bid` no response | client timeout / gateway health flaky | gateway boot issue, local env drift, port conflict | verify `/api/health`, restart gateway with clean test env, retry same payload | Runtime P1 |
| high timeout rate on `v2/bid` | p95 latency increase, request abort spikes | upstream bidder latency or dependency saturation | reduce retries, enforce fail-open, inspect bidder health and placement timeout | Runtime P1 |
| frequent `No bid` | delivery success but no winner | placement disabled, strict threshold, bidders unavailable | validate placement config and bidder enablement; compare with known-good payload | Integrations P2 |
| callback rejection (`400`) | `SDK_EVENTS_INVALID_PAYLOAD` | malformed attach/postback schema | fix payload contract; confirm required fields and enums | Integrations P1 |
| callback auth failure (`401/403`) | scope/auth errors in response | wrong key, expired token, scope mismatch | rotate key/token and align app/account/environment scope | Security + Integrations P1 |

## 3. Log and Metrics Queries

Request lookup query:

```bash
curl -sS "$MEDIATION_API_BASE_URL/v1/dashboard/decisions?requestId=$REQUEST_ID" \
  -H "Authorization: Bearer $DASHBOARD_ACCESS_TOKEN"
```

Event lookup query:

```bash
curl -sS "$MEDIATION_API_BASE_URL/v1/dashboard/events?requestId=$REQUEST_ID" \
  -H "Authorization: Bearer $DASHBOARD_ACCESS_TOKEN"
```

Settlement aggregate query:

```bash
curl -sS "$MEDIATION_API_BASE_URL/v1/dashboard/usage-revenue?accountId=$ACCOUNT_ID&appId=$APP_ID" \
  -H "Authorization: Bearer $DASHBOARD_ACCESS_TOKEN"
```

Local gateway log query:

```bash
tail -n 200 projects/ad-aggregation-platform/.local/gateway-stdout.log
```

If running durable checks, inspect DB-side conversion fact uniqueness by `idempotency_key`.

## 4. Escalation Matrix

| Severity | Who to Page | SLA | Comms Channel |
| --- | --- | --- | --- |
| Sev-1 | Runtime on-call + Security lead + Release owner | acknowledge <= 15m, mitigation <= 60m | incident bridge + ops channel |
| Sev-2 | Runtime on-call + Integrations QA | acknowledge <= 30m, mitigation <= 4h | integrations support channel |
| Sev-3 | Integrations QA | next business cycle | ticket / async update |

## 5. Reproduction Baseline (External Developer Path)

Use this fixed chain before filing bug:

1. `GET /api/v1/mediation/config` with valid runtime key and scoped `appId/placementId`.
2. `POST /api/v2/bid` with valid `userId/chatId/placementId/messages`.
3. `POST /api/v1/sdk/events` attach impression.
4. (optional settlement) `POST /api/v1/sdk/events` postback conversion.
5. Verify dashboard totals for `settledRevenueUsd` and `settledConversions`.
