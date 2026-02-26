# 04 - Environment and Credentials Guide

- Owner: Integrations Team + Security
- Last Updated: 2026-02-26

## 1. Environment Matrix

| Environment | Base URL | Purpose | Data Policy |
| --- | --- | --- | --- |
| local | `http://127.0.0.1:3100/api` | local development and deterministic testing | local-only data; resettable state |
| prod | `https://api.example.com/api` | production traffic | production policy, strict access control |

## 2. Credentials Required

| Credential | Where Stored | Rotation Owner | Rotation Frequency |
| --- | --- | --- | --- |
| Dashboard user (`email/password`) | dashboard auth store | Security + App Owner | on demand / personnel change |
| Runtime API key (`Authorization: Bearer`) | control-plane key store | App Owner | every 90 days (or incident-triggered) |
| Integration token (one-time) | agent onboarding issuance API | Integrations | short-lived, single onboarding session |
| Access token (token exchange output) | client memory only | Integrations | TTL-based (120s~900s) |
| Durable DB URL (`SUPABASE_DB_URL`, required in prod runtime) | secret manager | Platform | per infra rotation policy |
| Allowed dashboard origins (`MEDIATION_ALLOWED_ORIGINS`, required in prod runtime bootstrap) | secret manager | Platform | update when dashboard domains change |

## 3. Bootstrap Steps

1. Request access and confirm `accountId/appId` (runtime is fixed to `environment=prod`).
2. Create or obtain runtime API key from dashboard.
3. Load env vars:

```bash
export MEDIATION_API_BASE_URL=https://api.example.com/api
export MEDIATION_API_KEY=<issued_runtime_key>
export APP_ID=<your_app_id>
export PLACEMENT_ID=chat_from_answer_v1
```

4. Validate health + config:

```bash
curl -sS "$MEDIATION_API_BASE_URL/v1/mediation/config?appId=$APP_ID&placementId=$PLACEMENT_ID&environment=prod&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-25T00:00:00.000Z" \
  -H "Authorization: Bearer $MEDIATION_API_KEY"
```

Expected minimal response:

```json
{
  "appId": "sample-client-app",
  "placementId": "chat_from_answer_v1",
  "configVersion": 3
}
```

5. Run first `v2/bid` + `events` chain:

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "env_guide_user_001",
    "chatId": "env_guide_chat_001",
    "placementId": "chat_from_answer_v1",
    "messages": [
      { "role": "user", "content": "Recommend waterproof running shoes" },
      { "role": "assistant", "content": "Focus on grip and waterproof uppers." }
    ]
  }'
```

Expected minimal response:

```json
{
  "requestId": "adreq_xxx",
  "status": "success",
  "message": "Bid successful"
}
```

Then report attach event:

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "adreq_xxx",
    "appId": "'"$APP_ID"'",
    "sessionId": "env_guide_chat_001",
    "turnId": "env_guide_turn_001",
    "query": "Recommend waterproof running shoes",
    "answerText": "Focus on grip and waterproof uppers.",
    "intentScore": 0.9,
    "locale": "en-US",
    "kind": "impression",
    "placementId": "chat_from_answer_v1"
  }'
```

Expected response:

```json
{ "ok": true }
```

## 4. Failure Triage (Bootstrap)

| Symptom | Likely Cause | Action |
| --- | --- | --- |
| gateway startup fails with env validation error | missing `SUPABASE_DB_URL` or `MEDIATION_ALLOWED_ORIGINS` in prod runtime | fix runtime env config and restart gateway |
| `401 RUNTIME_AUTH_REQUIRED` | missing/empty bearer token | ensure `Authorization` header is set with active key |
| `401 INVALID_API_KEY` | revoked/expired key | rotate key from dashboard and retry |
| `403 API_KEY_SCOPE_VIOLATION` | key scope doesn't match `appId/placementId` | issue key under correct scope |
| `400 PLACEMENT_ID_RENAMED` | request uses legacy placement ID | migrate to `chat_from_answer_v1` or `chat_intent_recommendation_v1` |
| `409 INVENTORY_EMPTY` (quick-start verify/internal inventory status) | strict inventory mode has empty inventory or missing core networks | platform side runs `npm --prefix ./mediation run inventory:sync:all`, then retry |
| `400 INVALID_REQUEST` on `v2/bid` | payload not in V2 schema | keep only `userId/chatId/placementId/messages` |
| `message=No bid` with `HTTP 200 + status=success` | no eligible bidder under current context | treat as valid no-fill, do not blind retry |

No-bid boundary:
1. `No bid` is business no-fill only when `HTTP 200` and response `status=success`.
2. `4xx/5xx` always indicates integration/config/runtime issues that need correction.

## 5. Security Guardrails

- No hardcoded secrets in source.
- Least privilege for API keys.
- Audit logs required for publish and rollback actions.
