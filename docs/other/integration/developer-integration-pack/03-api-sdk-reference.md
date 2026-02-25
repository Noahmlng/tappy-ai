# 03 - API and SDK Reference (V2 Baseline)

- Owner: Integrations Team
- Last Updated: 2026-02-24
- Scope: external runtime integration (`config -> v2/bid -> events`)

## 1. Endpoint Summary

| Endpoint | Method | Purpose | Auth | Idempotency |
| --- | --- | --- | --- | --- |
| `/api/v1/mediation/config` | `GET` | Read placement config snapshot | Bearer runtime credential | N/A (read) |
| `/api/v2/bid` | `POST` | Request single winner bid | Bearer runtime credential | No hard idempotency guarantee |
| `/api/v1/sdk/events` | `POST` | Report SDK events (attach/next-step/postback) | Bearer runtime credential | Postback supports dedup by semantic idempotency key |

## 2. Authentication and Scope

All endpoints require runtime credential in header:

```http
Authorization: Bearer <token>
```

Common auth failures:
1. `401 RUNTIME_AUTH_REQUIRED`
2. `401 INVALID_API_KEY`
3. `401 ACCESS_TOKEN_EXPIRED`
4. `403 API_KEY_SCOPE_VIOLATION` / `403 ACCESS_TOKEN_SCOPE_VIOLATION`

## 3. Contracts

## 3.1 `GET /api/v1/mediation/config`

Required query params:
1. `appId`
2. `placementId`
3. `schemaVersion`
4. `sdkVersion`
5. `requestAt` (ISO-8601)

Optional query params:
1. `environment` (defaults to `prod`; only `prod` is accepted)

Sample request:

```bash
curl -sS -G "$BASE_URL/api/v1/mediation/config" \
  -H "Authorization: Bearer $API_KEY" \
  --data-urlencode "appId=$APP_ID" \
  --data-urlencode "placementId=chat_inline_v1" \
  --data-urlencode "environment=prod" \
  --data-urlencode "schemaVersion=schema_v1" \
  --data-urlencode "sdkVersion=1.0.0" \
  --data-urlencode "requestAt=2026-02-24T12:00:00Z"
```

Sample response (`200`):

```json
{
  "appId": "app_demo",
  "accountId": "org_demo",
  "environment": "prod",
  "placementId": "chat_inline_v1",
  "placementKey": "attach.post_answer_render",
  "schemaVersion": "schema_v1",
  "sdkVersion": "1.0.0",
  "requestAt": "2026-02-24T12:00:00.000Z",
  "configVersion": 3,
  "ttlSec": 300,
  "placement": {
    "placementId": "chat_inline_v1",
    "enabled": true
  }
}
```

## 3.2 `POST /api/v2/bid`

Required top-level fields:
1. `userId: string`
2. `chatId: string`
3. `placementId: chat_inline_v1 | chat_followup_v1`
4. `messages: Array<{ role, content, timestamp? }>`

`messages[*].role` must be `user | assistant | system`.

Sample request:

```bash
curl -sS -X POST "$BASE_URL/api/v2/bid" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_001",
    "chatId": "chat_001",
    "placementId": "chat_inline_v1",
    "messages": [
      { "role": "user", "content": "Recommend running shoes" },
      { "role": "assistant", "content": "Focus on grip." }
    ]
  }'
```

Sample success response:

```json
{
  "requestId": "adreq_xxx",
  "timestamp": "2026-02-24T10:31:24.787Z",
  "status": "success",
  "message": "Bid successful",
  "data": {
    "bid": {
      "price": 12.34,
      "advertiser": "Brand",
      "headline": "Brand Camera",
      "description": "Compact camera for creators.",
      "cta_text": "Learn More",
      "url": "https://example.com",
      "dsp": "partnerstack",
      "bidId": "v2_bid_xxx",
      "placement": "block",
      "variant": "base"
    }
  }
}
```

No-bid response (normal):

```json
{
  "requestId": "adreq_xxx",
  "timestamp": "2026-02-24T10:31:24.787Z",
  "status": "success",
  "message": "No bid",
  "data": {
    "bid": null
  }
}
```

## 3.3 `POST /api/v1/sdk/events` (Attach)

Attach payload required fields:
1. `sessionId`
2. `turnId`
3. `query`
4. `answerText`
5. `intentScore` (`0~1`)
6. `locale`

Optional fields:
1. `requestId`
2. `appId`
3. `kind` (`impression` | `click`, default `impression`)
4. `adId`
5. `placementId` (default `chat_inline_v1`)

Sample response:

```json
{ "ok": true }
```

## 3.4 `POST /api/v1/sdk/events` (Next-Step)

Next-step payload required fields:
1. `sessionId`
2. `turnId`
3. `event` (`followup_generation` | `follow_up_generation`)
4. `placementId`
5. `placementKey` (must be `next_step.intent_card`)
6. `context.query`
7. `context.locale`

Optional fields:
1. `requestId`
2. `userId`
3. `kind` (`impression` | `click` | `dismiss`, default `impression`)
4. `adId`
5. `context.intent_class`
6. `context.intent_score`
7. `context.preference_facets`

Sample response:

```json
{ "ok": true }
```

## 3.5 `POST /api/v1/sdk/events` (Postback Conversion)

Postback trigger condition:
1. payload includes `eventType=postback`, or
2. includes postback-specific fields (`postbackType`, `postbackStatus`, `conversionId`)

Required fields:
1. `requestId`
2. `postbackType` (`conversion`, default `conversion`)
3. `postbackStatus` (`pending | success | failed`, default `success`)
4. if status is `success`, `cpaUsd` is required

Sample response:

```json
{
  "ok": true,
  "duplicate": false,
  "factId": "fact_xxx",
  "revenueUsd": 12.34
}
```

## 4. Validation Rules

1. `v2/bid` only allows: `userId`, `chatId`, `placementId`, `messages`.
2. `sdk/events` validates allowed fields by payload type.
3. Unknown fields are rejected with `400`.

## 5. Error Model

| HTTP Code | Error Code (examples) | Retryable | Client Action |
| --- | --- | --- | --- |
| 400 | `INVALID_REQUEST`, `SDK_EVENTS_INVALID_PAYLOAD` | No | Fix payload/schema mismatch |
| 401 | `RUNTIME_AUTH_REQUIRED`, `INVALID_API_KEY`, `ACCESS_TOKEN_EXPIRED` | No | Refresh/replace credential |
| 403 | `API_KEY_SCOPE_VIOLATION`, `ACCESS_TOKEN_SCOPE_VIOLATION` | No | Use token with correct scope/app/placement |
| 404 | `PLACEMENT_NOT_FOUND` (config) | No | Check appId + placementId mapping |
| 5xx | runtime/upstream transient failure | Yes (limited) | Backoff retry + fail-open |

## 6. Timeout and Retry Recommendations

1. `v2/bid` timeout: `<= 1200ms` recommended on chat path
2. `sdk/events` timeout: `<= 800ms` recommended
3. Retry policy:
- 4xx: do not retry automatically
- 5xx/network timeout: short exponential backoff, max 1-2 retries

## 7. Compatibility Notes

1. Legacy evaluate endpoint is deprecated for new integrations.
2. New integrations must use `config -> v2/bid -> events`.
