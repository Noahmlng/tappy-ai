# 11 - End-to-End Playbook (Single Integration Path)

- Owner: Integrations Team
- Last Updated: 2026-02-27

## 1. Target State

对外只保留一条接入链路：
1. Dashboard 完成 key 与 placement 配置
2. 应用侧调用 `runChatTurnWithAd`
3. Runtime 统一走 `POST /api/v2/bid`
4. 事件通过 `POST /api/v1/sdk/events` 回传

## 2. Responsibilities

Platform side:
1. account/app 初始化
2. runtime key 发行和轮换
3. placement 配置和启用
4. quick-start verify 与库存预检

App side:
1. 初始化 SDK（`apiBaseUrl + apiKey`）
2. 每轮调用 `runChatTurnWithAd`
3. 渲染 sponsor card（有 fill 时）

## 3. SDK Template

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

注意：`/api/v2/bid` 不接受 `placementId`，由 Dashboard 配置决定。

## 4. SLA & Reliability

1. 主 SLA：`click -> bid response p95 <= 1000ms`
2. `No bid` 是正常业务结果
3. 广告链路 fail-open，不阻塞聊天主回答

## 5. Diagnostics

客户端：
1. `stageDurationsMs`
2. `bidProbeStatus`
3. `outcomeCategory`

服务端：
1. `diagnostics.timingsMs`
2. `diagnostics.budgetExceeded`
3. `diagnostics.timeoutSignal`
4. `diagnostics.precheck`

Dashboard 主 KPI：
1. `bidFillRateKnown`
2. `bidKnownCount / bidUnknownCount / unknownRate`

## 6. E2E Validation

1. 聊天慢但 bid 快：1s 内返回 bid
2. no-fill 路径：`HTTP 200 + bid=null`
3. 上游慢：fail-open，不阻塞聊天
4. Dashboard 可按 `requestId` 联查 decision/event

远程数据库 CI 建议：
1. `MEDIATION_TEST_HEALTH_TIMEOUT_MS=45000`
