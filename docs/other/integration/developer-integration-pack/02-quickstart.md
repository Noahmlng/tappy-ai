# 02 - Quickstart (Single Path)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: external app runtime integration

## 1. Goal

10 分钟内完成最小接入，只保留一条路径：
1. Dashboard 发放 runtime key（平台侧）
2. 应用侧初始化 SDK
3. 每轮调用一次 `runChatTurnWithAd`（FastPath）

## 2. App Side Required Inputs

应用方只需要：
1. `MEDIATION_API_BASE_URL`
2. `MEDIATION_API_KEY`
3. `APP_ID`

应用方不需要处理：
1. register/login
2. key 创建接口
3. placementId 路由参数

## 3. Minimal SDK Integration

```ts
import { createAdsSdkClient } from '@ai-network/tappy-ai-mediation/sdk/client'

const ads = createAdsSdkClient({
  apiBaseUrl: process.env.MEDIATION_API_BASE_URL,
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

## 4. Direct API (If Not Using SDK)

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
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

默认不传 `placementId`。placement 由 Dashboard 配置解析。

## 5. Behavior Contract

1. `No bid` 为正常结果：`HTTP 200 + status=success + data.bid=null`
2. 广告链路必须 fail-open，不阻塞聊天主回答
3. 主 SLA：`click -> bid response p95 <= 1000ms`

## 6. Pass Checklist

- [ ] 应用侧仅使用单一路径（SDK helper 或 `POST /v2/bid`）
- [ ] 不需要传 `placementId`
- [ ] `No bid` 路径正常
- [ ] fail-open 路径正常
- [ ] Dashboard 能按 `requestId` 查到 decision/event
