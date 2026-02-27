# 11 - End-to-End Integration Playbook (External Only)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Audience: external integration engineers

## 1. Preconditions

你需要提前拿到：
1. `MEDIATION_RUNTIME_BASE_URL`（例如 `https://runtime.example.com/api`）
2. `MEDIATION_API_KEY`（已激活）
3. `APP_ID`

本文档默认这些前置条件都已满足，不覆盖 key 管理流程。

## 2. Target Runtime Path

生产只保留以下外部链路：
1. 应用调用 `POST /api/v2/bid`
2. 有 fill 则渲染 Sponsored 卡片
3. 事件通过 `POST /api/v1/sdk/events` 回传
4. Dashboard 按 `requestId` 查看 decision/event/usage

## 3. Implementation Steps

### Step A: Integrate SDK (recommended)

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

### Step B: Confirm runtime contract

1. 不要传 `placementId`
2. 对 `No bid` 做正常分支处理（不是异常）
3. 对 5xx/超时做 fail-open，主回答优先

### Step C: Report events

至少回传 `impression`，建议补齐 `click` 与 `postback`。

### Step D: Verify on Dashboard

1. `Decisions` 按 `requestId` 检查结果和 reason
2. `Events` 检查 impression/click/postback 是否入库
3. `Usage / Revenue` 检查聚合指标是否与预期一致

## 4. Acceptance Matrix

- [ ] 标准请求：`/api/v2/bid` 返回 `200 + status=success`
- [ ] no-fill 请求：`200 + data.bid=null`
- [ ] placement 参数保护：传 `placementId` 会返回 `400 V2_BID_PLACEMENT_ID_NOT_ALLOWED`
- [ ] fail-open：模拟超时/上游异常时，不阻塞主回答
- [ ] traceability：Dashboard 可按同一 `requestId` 联查 decision + event

## 5. SLA & Reliability Baseline

1. 目标：`click -> bid response p95 <= 1000ms`
2. 事件上报采用 at-least-once，转化用幂等键去重
3. impression/click 不计收益，只有 successful postback conversion 计收益
