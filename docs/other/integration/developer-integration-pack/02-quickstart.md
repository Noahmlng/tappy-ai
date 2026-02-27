# 02 - Quickstart (Existing API Key, External Only)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: external app runtime integration

## 1. Goal

10 分钟内完成最小接入，只有一条运行时路径：
1. 初始化 SDK（推荐）或直连 Runtime API
2. 每轮对话调用一次 `runChatTurnWithAd`（或 `POST /api/v2/bid`）
3. 有广告则渲染，无广告继续主回答

## 2. Inputs You Need

应用侧只需要：
1. `MEDIATION_API_KEY`（已发放，必需）
2. `MEDIATION_RUNTIME_BASE_URL`（可选）

说明：
1. 若你的应用同域挂载 runtime（`/api`），可以不显式配置 `MEDIATION_RUNTIME_BASE_URL`。
2. 若 runtime 是独立域名，配置 `MEDIATION_RUNTIME_BASE_URL`（示例：`https://runtime.example.com/api`）。
3. `APP_ID` 不需要在外部请求里传，运行时会按 key scope 解析。

应用侧不需要处理：
1. key 创建/轮换 API
2. register/login
3. `placementId` 参数

## 3. Minimal SDK Integration

```ts
import { createAdsSdkClient } from '@ai-network/tappy-ai-mediation/sdk/client'

const ads = createAdsSdkClient({
  apiBaseUrl: process.env.MEDIATION_RUNTIME_BASE_URL || '/api',
  apiKey: process.env.MEDIATION_API_KEY,
  fetchImpl: fetch,
  fastPath: true,
  timeouts: { config: 1200, bid: 1200, events: 800 },
})

export async function runTurnWithAd({ userId, chatId, messages, chatDonePromise }) {
  return ads.runChatTurnWithAd({
    userId,
    chatId,
    messages,
    chatDonePromise,
    renderAd: (bid) => renderSponsorCard(bid),
  })
}
```

## 4. Direct API (Without SDK)

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

可选事件上报（建议保留）：

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

## 5. Non-Negotiable Contract

1. `/api/v2/bid` 不接受 `placementId`，传入会返回 `400 V2_BID_PLACEMENT_ID_NOT_ALLOWED`
2. `No bid` 是正常结果：`HTTP 200 + status=success + data.bid=null`
3. 广告链路必须 fail-open，不阻塞聊天主回答

## 6. Pass Checklist

- [ ] 只走 `runChatTurnWithAd` 或 `POST /v2/bid` 单一路径
- [ ] 不传 `placementId`
- [ ] `No bid` 路径按正常逻辑处理
- [ ] 超时/上游异常时 fail-open
- [ ] Dashboard 能按 `requestId` 查询到 decision/event
