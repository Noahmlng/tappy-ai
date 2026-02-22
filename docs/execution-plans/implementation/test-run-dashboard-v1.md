# Dashboard v1 External Onboarding E2E Runbook

- Version: v1.0
- Last Updated: 2026-02-22
- Scope: `DASH-A-012` v1 外部接入 E2E（happy path + fail-open）

## 1. Command

```bash
cd /Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform
node --test ./tests/e2e/dashboard-v1-external.spec.js
```

## 2. Coverage

1. Happy path:
   - `GET /api/v1/public/credentials/keys`
   - `GET /api/v1/mediation/config`
   - `POST /api/v1/sdk/evaluate`
   - `POST /api/v1/sdk/events`
   - Evidence check via `GET /api/v1/dashboard/decisions` + `GET /api/v1/dashboard/events`
2. Fail-open path:
   - Evaluate `400` (invalid payload) does not block primary response.
   - Evaluate network error does not block primary response.

## 3. Pass Criteria

1. Happy path returns non-empty `requestId`.
2. `decision.result` is one of `served|blocked|no_fill|error`.
3. `events` returns `{ "ok": true }`.
4. In failure scenarios, `primaryResponse.ok` remains `true` and `failOpenApplied=true`.
