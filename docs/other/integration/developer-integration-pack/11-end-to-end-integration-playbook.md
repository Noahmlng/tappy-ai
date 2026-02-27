# 11 - 外部开发者交付文档（最终版）

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Audience: external integration engineers
- Assumption: caller already has a valid runtime API key

## 1. 适用范围

这份文档用于对外交付，覆盖外部接入所需的全部信息：
1. 如何调用 Runtime API
2. 如何上报事件
3. 如何在 Dashboard 验收

不覆盖：
1. API key 签发/轮换/回收
2. Dashboard 管理员开通流程

## 2. 前置条件

你需要提前拿到：
1. `MEDIATION_RUNTIME_BASE_URL`（例如 `https://runtime.example.com/api`）
2. `MEDIATION_API_KEY`
3. `APP_ID`

## 3. 生产唯一接入链路

1. 应用调用 `POST /api/v2/bid`
2. 有广告则渲染 Sponsored 卡片
3. 通过 `POST /api/v1/sdk/events` 回传 impression/click/postback
4. 用 Dashboard 按 `requestId` 做联查与验收

强约束：
1. `/api/v2/bid` 不接受 `placementId`
2. `No bid` 是正常结果：`HTTP 200 + status=success + data.bid=null`
3. 广告链路必须 fail-open，不能阻塞主回答

## 4. 推荐接入方式（SDK）

```ts
import { createAdsSdkClient } from '@ai-network/tappy-ai-mediation/sdk/client'

const ads = createAdsSdkClient({
  apiBaseUrl: process.env.MEDIATION_RUNTIME_BASE_URL,
  apiKey: process.env.MEDIATION_API_KEY,
  fetchImpl: fetch,
  fastPath: true,
  timeouts: { config: 1200, bid: 1200, events: 800 },
})

export async function runTurnWithAd({ appId, userId, chatId, messages, chatDonePromise }) {
  return ads.runChatTurnWithAd({
    appId,
    userId,
    chatId,
    messages,
    chatDonePromise,
    renderAd: (bid) => renderSponsorCard(bid),
  })
}
```

## 5. 直连 API 示例（不使用 SDK）

### 5.1 请求 bid

```bash
curl -sS -X POST "$MEDIATION_RUNTIME_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_001",
    "chatId": "chat_001",
    "messages": [
      { "role": "user", "content": "Recommend running shoes" },
      { "role": "assistant", "content": "Focus on grip and waterproof upper." }
    ]
  }'
```

### 5.2 回传 impression/click

```bash
curl -sS -X POST "$MEDIATION_RUNTIME_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "adreq_xxx",
    "sessionId": "chat_001",
    "turnId": "turn_001",
    "query": "camera for vlogging",
    "answerText": "Consider compact options",
    "intentScore": 0.8,
    "locale": "en-US",
    "kind": "impression",
    "adId": "v2_bid_xxx"
  }'
```

### 5.3 回传 conversion postback

```bash
curl -sS -X POST "$MEDIATION_RUNTIME_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

## 6. 响应与错误处理

1. `POST /api/v2/bid` 成功返回 `status=success`
2. `data.bid` 有值：渲染广告
3. `data.bid=null`：按 no-fill 正常分支处理
4. `400 V2_BID_PLACEMENT_ID_NOT_ALLOWED`：说明请求传了 `placementId`
5. `401 INVALID_API_KEY`：key 无效
6. `403 API_KEY_SCOPE_VIOLATION`：key 与 app/environment 作用域不匹配
7. `5xx`：重试并 fail-open

## 7. Dashboard 验收（按 requestId）

联调时请记录 `requestId`，在 Dashboard 或对应 API 查询：
1. `GET /api/v1/dashboard/decisions?requestId=<requestId>`
2. `GET /api/v1/dashboard/events?requestId=<requestId>`
3. `GET /api/v1/dashboard/usage-revenue`

检查点：
1. decision 有记录（served/no_fill/blocked/error）
2. event 有记录（至少 impression）
3. conversion success 后 revenue 聚合有变化

## 8. 上线验收清单

- [ ] 生产仅调用 `POST /api/v2/bid`
- [ ] 客户端不传 `placementId`
- [ ] no-fill 作为正常业务结果处理
- [ ] 广告链路 fail-open，不影响主回答
- [ ] Dashboard 能按 `requestId` 联查 decision + event
- [ ] 目标 SLA：`click -> bid response p95 <= 1000ms`
