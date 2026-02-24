# Mediation Public API Reference (External Developer)

- Version: v1.0
- Last Updated: 2026-02-24
- Scope: 面向外部开发者的生产 API 契约

## 1. Base URL and Auth

- Base URL: `https://api.<env>.example.com`（由平台发放）
- Auth header: `Authorization: Bearer <MEDIATION_API_KEY>`
- Content-Type: `application/json`
- Runtime is key-only: `app/account/environment` scope is resolved from `MEDIATION_API_KEY`.

## 2. Public Endpoints

1. `GET /api/v1/mediation/config`
2. `POST /api/v1/sdk/evaluate`
3. `POST /api/v1/sdk/events`

## 3. GET /api/v1/mediation/config

用途：拉取 placement 的当前生效配置，用于客户端缓存与版本协商。

必填参数：

1. `placementId`
2. `environment`（`prod|staging`）
3. `schemaVersion`
4. `sdkVersion`
5. `requestAt`（ISO8601）

可选参数：

1. `ifNoneMatch`
2. `expectedConfigVersionOrNA`
3. `traceKeyOrNA`

成功响应：

1. `200`：返回完整配置快照与版本锚点。
2. `304`：配置未变化，客户端继续使用本地缓存。

重试策略：

1. `4xx`：修正请求后再发。
2. `5xx`：指数退避重试（最多 3 次）。

## 4. POST /api/v1/sdk/evaluate

用途：请求一次广告决策与广告候选。

### 4.1 Attach 请求体（当前主路径）

```json
{
  "sessionId": "sess_001",
  "turnId": "turn_001",
  "query": "Recommend running shoes",
  "answerText": "Focus on grip.",
  "intentScore": 0.9,
  "locale": "en-US"
}
```

必填字段：`sessionId, turnId, query, answerText, intentScore, locale`

### 4.2 Next-Step Intent Card 请求体

```json
{
  "sessionId": "sess_002",
  "turnId": "turn_002",
  "userId": "user_001",
  "event": "followup_generation",
  "placementId": "chat_followup_v1",
  "placementKey": "next_step.intent_card",
  "context": {
    "query": "Need a gift suggestion",
    "answerText": "Try something practical.",
    "locale": "en-US",
    "intent_class": "gifting",
    "intent_score": 0.88,
    "preference_facets": [
      { "facet_key": "recipient", "facet_value": "girlfriend", "confidence": 0.9 }
    ]
  }
}
```

### 4.3 响应体（通用）

```json
{
  "requestId": "adreq_xxx",
  "placementId": "chat_inline_v1",
  "decision": {
    "result": "served",
    "reason": "served",
    "reasonDetail": "runtime_eligible"
  },
  "ads": []
}
```

`decision.result` 枚举：`served|blocked|no_fill|error`

### 4.4 错误与语义

1. `400 INVALID_REQUEST`：字段缺失或类型错误。
2. `500 INTERNAL_ERROR`：服务端异常。
3. `blocked/no_fill` 是业务判定，不等于传输失败。

### 4.5 重试建议

1. `400`：不重试，先修请求。
2. `500`：可重试，200ms 起，最多 3 次。
3. `blocked/no_fill`：不建议立即重试。

### 4.6 幂等约束

`evaluate` 不保证幂等去重；如需幂等，调用方自己管理请求幂等键与去重窗口。

## 5. POST /api/v1/sdk/events

用途：上报 impression/click/dismiss 等事件（兼容模式）。

最小请求体：

```json
{
  "requestId": "adreq_xxx",
  "sessionId": "sess_001",
  "turnId": "turn_001",
  "query": "Recommend running shoes",
  "answerText": "Focus on grip.",
  "intentScore": 0.9,
  "locale": "en-US"
}
```

成功响应：

```json
{ "ok": true }
```

错误与重试：

1. `400`：不重试，修复后再发。
2. `500`：短退避重试。

幂等建议：

1. 采用调用方事件幂等键（例如 `requestId + eventType + creativeId + timestamp_bucket`）。
2. 客户端按 at-least-once 上报，服务端按幂等键去重。

## 6. Fail-open Requirement

调用 `evaluate/events` 失败时：

1. 主对话或主业务响应必须继续返回。
2. 错误进入异步日志，不阻塞用户路径。

## 7. Internal Endpoints (Not for External Integration)

以下接口不属于外部接入合同：

1. `/api/v1/dashboard/*`
2. `/api/v1/dev/*`
3. 任意本地联调专用接口
