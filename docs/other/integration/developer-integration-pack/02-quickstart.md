# 02 - Quickstart (External, FastPath Default)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: external app developer (runtime integration only)

## 1. Goal

在 10-15 分钟内完成首个可用接入，且不需要每次请求手改 placement：
1. Dashboard 里配置好 app/placement，并生成 runtime key（平台操作）
2. 应用侧只做 SDK 初始化 + 每轮调用一次
3. 走 `POST /api/v2/bid`，默认从 Dashboard 配置解析 placement

## 2. What External Integrator Needs

应用方只需要这 3 项：
1. `MEDIATION_API_BASE_URL`（示例：`https://<your-domain>/api`）
2. `MEDIATION_API_KEY`（由 Dashboard 发放）
3. `APP_ID`

不需要应用方调用：
1. `dashboard/register`
2. `credentials/keys` 创建流程

这些属于 Dashboard/平台侧运营动作。

## 3. Dashboard One-Time Setup (Operator Side)

由平台同学在 Dashboard 完成：
1. 生成 runtime key
2. 配置 placement（启用/禁用、优先级、bidders）
3. 验证预检（quick-start verify）

说明：
1. SDK/Runtime 会优先按 Dashboard 配置选择默认 placement
2. 未显式传 `placementId` 时，不再要求接入方手工每次指定

## 4. App Integration (Minimal)

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
    // no placementId required in the common path
    renderAd: (bid) => renderSponsorCard(bid),
  })
}
```

## 5. Runtime Request (If Calling API Directly)

最小请求（推荐）：

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_001",
    "chatId": "chat_001",
    "messages": [
      { "role": "user", "content": "Recommend running shoes for rainy days" },
      { "role": "assistant", "content": "Focus on grip and waterproof upper." }
    ]
  }'
```

可选：若你要覆盖默认配置，再显式传 `placementId`。

## 6. Behavior Contract

1. `No bid` 是正常结果：`HTTP 200 + status=success + data.bid=null`
2. 广告失败/超时必须 fail-open，不阻塞主回答
3. 主 SLA：`click -> bid response p95 <= 1000ms`

## 7. Dashboard KPI Standard

主指标：
1. `bidFillRateKnown = served / bidKnownCount`

诊断指标（不进 fill 分母）：
1. `bidUnknownCount`
2. `unknownRate`
3. `timeoutRelatedCount`
4. `precheckInventoryNotReadyCount`
5. `budgetExceededCount`

## 8. Pass Criteria

- [ ] 应用侧仅初始化一次 SDK，无需每次手改 placement
- [ ] `v2/bid` 返回有效 `requestId`
- [ ] no-fill 路径已验证
- [ ] fail-open 路径已验证
- [ ] Dashboard 能看到 request 对应的 decision/event
