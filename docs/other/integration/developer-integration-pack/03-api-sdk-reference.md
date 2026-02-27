# 03 - API & SDK Reference (External Runtime)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: external runtime integration (API key already provisioned)

## 1. Runtime Base URL & Auth

1. Runtime base URL 示例：`https://runtime.example.com/api`
2. 建议使用：`Authorization: Bearer <runtime_api_key>`
3. 兼容写法：`Authorization: <runtime_api_key>`

## 2. Runtime Endpoints

| Endpoint | Method | Required | Purpose |
| --- | --- | --- | --- |
| `/api/v2/bid` | `POST` | Yes | 获取本轮广告决策（winner bid 或 no-fill） |
| `/api/v1/sdk/events` | `POST` | Recommended | 回传 impression/click/postback 事件 |

`GET /api/v1/mediation/config` 是运行时能力，不是外部最小接入必需步骤。

## 3. `POST /api/v2/bid`

### Request (minimal)

```json
{
  "userId": "user_001",
  "chatId": "chat_001",
  "messages": [
    { "role": "user", "content": "recommend running shoes" },
    { "role": "assistant", "content": "focus on grip" }
  ]
}
```

### Request rules

1. `placementId` 禁止传入（会返回 `400 V2_BID_PLACEMENT_ID_NOT_ALLOWED`）
2. `messages` 不能为空，角色会被规范化为 `user|assistant|system`
3. 缺失 `userId/chatId` 时，服务端会按规则自动补齐

### Success response (shape)

```json
{
  "requestId": "adreq_xxx",
  "timestamp": "2026-02-27T00:00:00.000Z",
  "status": "success",
  "message": "Bid successful",
  "opportunityId": "opp_xxx",
  "filled": true,
  "landingUrl": "https://example.com",
  "decisionTrace": { "reasonCode": "served" },
  "diagnostics": {
    "timingsMs": { "total": 120 },
    "budgetExceeded": { "total": false }
  },
  "data": {
    "bid": {
      "bidId": "v2_bid_xxx",
      "headline": "...",
      "description": "...",
      "url": "https://example.com"
    }
  }
}
```

`No bid` response:

```json
{
  "requestId": "adreq_xxx",
  "status": "success",
  "message": "No bid",
  "filled": false,
  "landingUrl": null,
  "data": { "bid": null }
}
```

## 4. `POST /api/v1/sdk/events`

### Attach impression/click minimal payload

```json
{
  "requestId": "adreq_xxx",
  "sessionId": "chat_001",
  "turnId": "turn_001",
  "query": "camera for vlogging",
  "answerText": "consider compact options",
  "intentScore": 0.8,
  "locale": "en-US",
  "kind": "impression",
  "adId": "v2_bid_xxx"
}
```

Response (attach/next-step):

```json
{ "ok": true }
```

### Postback payload (conversion)

```json
{
  "eventType": "postback",
  "requestId": "adreq_xxx",
  "adId": "v2_bid_xxx",
  "postbackType": "conversion",
  "postbackStatus": "success",
  "conversionId": "conv_001",
  "eventSeq": "1",
  "eventAt": "2026-02-27T00:00:00.000Z",
  "currency": "USD",
  "cpaUsd": 4.21
}
```

Response (postback):

```json
{ "ok": true, "duplicate": false, "factId": "fact_xxx", "revenueUsd": 4.21 }
```

## 5. SDK Public Surface

`createAdsSdkClient(options)` 对外只保留：
1. `requestBid(input, options?)`
2. `reportEvent(payload, options?)`
3. `runChatTurnWithAd(input)`

生产默认建议：直接使用 `runChatTurnWithAd`。

## 6. Error Model

| HTTP | Code (example) | Meaning | Client action |
| --- | --- | --- | --- |
| 400 | `INVALID_REQUEST` | 请求字段不合法 | 修正请求体 |
| 400 | `V2_BID_PLACEMENT_ID_NOT_ALLOWED` | v2 bid 传入了 placementId | 移除 placementId |
| 401 | `INVALID_API_KEY` | key 无效或已回收 | 更换有效 key |
| 401 | `ACCESS_TOKEN_EXPIRED` | access token 过期 | 刷新 token |
| 403 | `API_KEY_SCOPE_VIOLATION` | key 与 app/environment 不匹配 | 使用正确作用域 key |
| 409 | `INVENTORY_EMPTY` | 严格库存预检失败 | 联系平台侧补库存 |
| 5xx | `INTERNAL_ERROR` 等 | 上游/运行时瞬时异常 | 重试 + fail-open |
