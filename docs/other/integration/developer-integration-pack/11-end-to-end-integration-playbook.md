# 11 - End-to-End Integration Playbook (External-Friendly)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: production app integration (Dashboard-configured runtime)

## 1. Design Principle

外部接入目标：
1. 应用方只关心“配置接入 + 发送请求”
2. 注册/账号初始化/key 发行属于 Dashboard 运营动作，不在应用请求链路里
3. placement 默认由 Dashboard 配置决定，不要求应用每次手改请求体

## 2. Responsibility Split

## 2.1 Dashboard / Platform side

一次性完成：
1. account/app 初始化
2. runtime key 生成与轮换
3. placement 配置（启用状态、优先级、bidders、cap）
4. quick-start verify 与库存预检

## 2.2 Application side

持续执行：
1. SDK 初始化（baseUrl + apiKey + appId）
2. 每轮调用广告 helper（FastPath）
3. 渲染 fill 结果并上报事件

## 3. Request Model (Simplified)

默认路径下，应用请求不需要显式传 `placementId`。

Runtime 会按以下顺序解析 placement：
1. credential scope（若 token 限定了 placement）
2. Dashboard 默认 placement（当前 app 的启用优先项）
3. fallback placement（仅兜底）

这保证了 Dashboard 配置对运行时真正生效。

## 4. SDK Integration Template

```ts
import { createAdsSdkClient } from '@ai-network/tappy-ai-mediation/sdk/client'

const ads = createAdsSdkClient({
  apiBaseUrl: process.env.MEDIATION_API_BASE_URL,
  apiKey: process.env.MEDIATION_API_KEY,
  fetchImpl: fetch,
  fastPath: true,
  timeouts: { config: 1200, bid: 1200, events: 800 },
  onDiagnostics: (diagnostics, flow) => {
    console.log('[ads diagnostics]', diagnostics, flow?.decision)
  },
})

export async function runTurnWithAds({ appId, userId, chatId, messages, chatDonePromise }) {
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

## 5. API Direct Call Template (Optional)

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_001",
    "chatId": "chat_001",
    "messages": [
      { "role": "user", "content": "best camera for vlogging" },
      { "role": "assistant", "content": "consider sony zv-e10" }
    ]
  }'
```

只有在多 slot 明确路由时，才建议显式传 `placementId`。

## 6. Timeout and Reliability

默认建议：
1. `config=1200ms`
2. `bid=1200ms`
3. `events=800ms`

原则：
1. 广告链路 fail-open
2. 聊天主回答优先，不被广告失败阻塞

## 7. Diagnostics and KPI

## 7.1 Client-side

采集：
1. `stageDurationsMs`
2. `bidProbeStatus`
3. `outcomeCategory`

## 7.2 Server-side diagnostics

关注：
1. `timingsMs`
2. `budgetMs`
3. `budgetExceeded`
4. `timeoutSignal`
5. `precheck`

## 7.3 Dashboard KPI

主 KPI：
1. `bidFillRateKnown`

诊断：
1. `bidKnownCount` / `bidUnknownCount` / `unknownRate`
2. `timeoutRelatedCount`
3. `precheckInventoryNotReadyCount`
4. `budgetExceededCount`

## 8. Validation Checklist

- [ ] App 侧不依赖 register/key-create API
- [ ] 不传 `placementId` 也能按 Dashboard 配置运行
- [ ] `No bid` 路径正常
- [ ] fail-open 路径正常
- [ ] Dashboard 可按 requestId 回溯 decision/event

## 9. CI / E2E Notes

远程数据库场景建议：
1. `MEDIATION_TEST_HEALTH_TIMEOUT_MS=45000`
2. 避免 12s 固定超时导致冷启动误判
