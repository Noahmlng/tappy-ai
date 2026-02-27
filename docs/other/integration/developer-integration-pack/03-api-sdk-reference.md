# 03 - API & SDK Reference (Single Runtime Contract)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: external runtime integration

## 1. Runtime Endpoints

| Endpoint | Method | Required | Purpose |
| --- | --- | --- | --- |
| `/api/v2/bid` | `POST` | Yes | Request one bid decision |
| `/api/v1/sdk/events` | `POST` | Optional | Report impression/click/postback |

`/api/v1/mediation/config` 仅用于平台侧诊断，不是应用方接入必需步骤。

## 2. Authentication

```http
Authorization: Bearer <runtime_key>
```

Common errors:
1. `401 INVALID_API_KEY`
2. `401 ACCESS_TOKEN_EXPIRED`
3. `403 API_KEY_SCOPE_VIOLATION`

## 3. `POST /api/v2/bid`

Request body (minimal):
1. `messages` (required)
2. `userId` (optional, server can auto-generate)
3. `chatId` (optional, server can default to user scope)

`placementId` 不需要传，且该字段在 `/api/v2/bid` 会被拒绝。运行时按 Dashboard 配置决定 placement。

Sample:

```bash
curl -sS -X POST "$BASE_URL/api/v2/bid" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_001",
    "chatId": "chat_001",
    "messages": [
      { "role": "user", "content": "Recommend running shoes" },
      { "role": "assistant", "content": "Focus on grip." }
    ]
  }'
```

Success with fill:

```json
{
  "requestId": "adreq_xxx",
  "status": "success",
  "message": "Bid successful",
  "data": { "bid": { "bidId": "v2_bid_xxx", "url": "https://example.com" } }
}
```

Success with no-fill:

```json
{
  "requestId": "adreq_xxx",
  "status": "success",
  "message": "No bid",
  "data": { "bid": null }
}
```

## 4. `POST /api/v1/sdk/events`

Attach impression minimal payload:

```json
{
  "requestId": "adreq_xxx",
  "sessionId": "chat_001",
  "turnId": "turn_001",
  "query": "camera for vlogging",
  "answerText": "Consider compact options",
  "intentScore": 0.8,
  "locale": "en-US",
  "kind": "impression",
  "adId": "v2_bid_xxx"
}
```

Response:

```json
{ "ok": true }
```

## 5. SDK Surface

`createAdsSdkClient(options)` 对外只保留：
1. `requestBid(input, options?)`
2. `reportEvent(payload, options?)`
3. `runChatTurnWithAd(input)`

推荐默认只用 `runChatTurnWithAd`。

## 6. Error Model

| HTTP | Code (example) | Client action |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Fix payload |
| 401 | `INVALID_API_KEY` | Rotate/replace key |
| 403 | `API_KEY_SCOPE_VIOLATION` | Fix key scope |
| 409 | `INVENTORY_EMPTY` (verify) | Sync inventory |
| 5xx | upstream/runtime transient | Retry with backoff + fail-open |
