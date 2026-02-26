# 03 - API and SDK Reference (V2 Baseline)

- Owner: Integrations Team
- Last Updated: 2026-02-26
- Scope: external runtime integration (`v2/bid` required, `events/config` optional)

## 1. Endpoint Summary

| Endpoint | Method | Purpose | Auth | Idempotency |
| --- | --- | --- | --- | --- |
| `/api/v2/bid` | `POST` | Request single winner bid | Bearer runtime credential | No hard idempotency guarantee |
| `/api/v1/sdk/events` | `POST` | Report SDK events (attach/next-step/postback) | Bearer runtime credential | Postback supports dedup by semantic idempotency key |
| `/api/v1/mediation/config` | `GET` | Read placement config snapshot (diagnostics) | Bearer runtime credential | N/A (read) |

## 2. Authentication and Scope

Runtime endpoints accept either of the following headers:

```http
Authorization: Bearer <token>
```

```http
Authorization: <token>
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

Placement ID contract:
1. Allowed IDs: `chat_from_answer_v1`, `chat_intent_recommendation_v1`
2. Legacy (renamed) IDs are rejected with `400 PLACEMENT_ID_RENAMED`.

Optional query params:
1. `environment` (defaults to `prod`; only `prod` is accepted)

Sample request:

```bash
curl -sS -G "$BASE_URL/api/v1/mediation/config" \
  -H "Authorization: Bearer $API_KEY" \
  --data-urlencode "appId=$APP_ID" \
  --data-urlencode "placementId=chat_from_answer_v1" \
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
  "placementId": "chat_from_answer_v1",
  "placementKey": "attach.post_answer_render",
  "schemaVersion": "schema_v1",
  "sdkVersion": "1.0.0",
  "requestAt": "2026-02-24T12:00:00.000Z",
  "configVersion": 3,
  "ttlSec": 300,
  "placement": {
    "placementId": "chat_from_answer_v1",
    "enabled": true
  }
}
```

## 3.2 `POST /api/v2/bid`

Required top-level fields:
1. `messages` OR (`query` / `prompt`) must provide non-empty user intent text.

Tolerance behavior:
1. Missing `chatId` -> defaults to `userId`; if `userId` missing too, server generates stable `anon_*`.
2. Missing `userId` -> server generates `anon_*`.
3. Missing `placementId` -> defaults to `chat_from_answer_v1`.
4. Legacy placement IDs are auto-mapped (no `PLACEMENT_ID_RENAMED` for `/api/v2/bid`).
5. Extra fields are ignored.
6. Invalid `messages[*].role` is coerced to `user` or `assistant` and surfaced in diagnostics.

Sample request:

```bash
curl -sS -X POST "$BASE_URL/api/v2/bid" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_001",
    "chatId": "chat_001",
    "placementId": "chat_from_answer_v1",
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
  "filled": true,
  "landingUrl": "https://example.com",
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
  "filled": false,
  "landingUrl": null,
  "data": {
    "bid": null
  }
}
```

Legacy placement ID rejection example (`400`):

```json
{
  "error": {
    "code": "PLACEMENT_ID_RENAMED",
    "message": "placementId \"legacy_placement_id_v1\" has been renamed to \"chat_from_answer_v1\".",
    "placementId": "legacy_placement_id_v1",
    "replacementPlacementId": "chat_from_answer_v1",
    "field": "placementId"
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
5. `placementId` (default `chat_from_answer_v1`)

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
| 400 | `INVALID_REQUEST`, `SDK_EVENTS_INVALID_PAYLOAD`, `PLACEMENT_ID_RENAMED` | No | Fix payload/schema mismatch, and migrate to canonical placement ID |
| 401 | `RUNTIME_AUTH_REQUIRED`, `INVALID_API_KEY`, `ACCESS_TOKEN_EXPIRED` | No | Refresh/replace credential |
| 403 | `API_KEY_SCOPE_VIOLATION`, `ACCESS_TOKEN_SCOPE_VIOLATION` | No | Use token with correct scope/app/placement |
| 404 | `PLACEMENT_NOT_FOUND` (config) | No | Check appId + placementId mapping |
| 409 | `PRECONDITION_FAILED`, `INVENTORY_EMPTY` (quick-start verify) | No | Provision runtime key or sync inventory before retry |
| 5xx | runtime/upstream transient failure | Yes (limited) | Backoff retry + fail-open |

No-bid boundary:
1. `No bid` is only the `HTTP 200 + status=success + data.bid=null` case.
2. Any `4xx/5xx` is integration/runtime error, not no-bid.

## 6. Timeout and Retry Recommendations

1. `v2/bid` timeout: `<= 1200ms` recommended on chat path
2. `sdk/events` timeout: `<= 800ms` recommended
3. Retry policy:
- 4xx: do not retry automatically
- 5xx/network timeout: short exponential backoff, max 1-2 retries

## 7. Compatibility Notes

1. Legacy evaluate endpoint is deprecated for new integrations.
2. New integrations must use `config -> v2/bid -> events`.
