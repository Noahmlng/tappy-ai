# 00 - External Integration Overview (Mediation + Dashboard)

- Owner: Integrations Team
- Version: v1.3
- Last Updated: 2026-02-27
- Audience: external developers (API key already provisioned)

## 1. Scope

本文档只描述外部接入所需内容：
1. 你的应用如何调用 Mediation Runtime API
2. 你如何在 Dashboard 侧做联调可视化与结果核验

不包含：
1. API key 创建、轮换、回收流程
2. Dashboard 管理员开通流程

## 2. External Runtime Contract

对外运行时仅保留两条 API：
1. `POST /api/v2/bid`（必需）
2. `POST /api/v1/sdk/events`（推荐）

强约束：
1. `/api/v2/bid` 不接受 `placementId`，传入会返回 `400 V2_BID_PLACEMENT_ID_NOT_ALLOWED`
2. placement 由 Dashboard 已发布配置自动解析
3. `No bid` 是正常业务结果：`HTTP 200 + status=success + data.bid=null`

## 3. End-to-End Flow (External View)

1. 你的应用调用 `POST /api/v2/bid` 或 SDK `runChatTurnWithAd`
2. Mediation 返回 `requestId` 与 `data.bid`
3. 如果有 `data.bid`，渲染 Sponsored 卡片
4. 曝光/点击/转化通过 `POST /api/v1/sdk/events` 回传
5. Dashboard 按 `requestId` 查看 decision/event/usage 结果

## 4. Recommended SDK Path

```ts
import { createAdsSdkClient } from '@ai-network/tappy-ai-mediation/sdk/client'

const ads = createAdsSdkClient({
  apiBaseUrl: process.env.MEDIATION_RUNTIME_BASE_URL, // 示例: https://runtime.example.com/api
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

## 5. Dashboard Verification (Read-Only)

联调时请固定记录 `requestId`，并在 Dashboard 查询：
1. `Decisions`：确认 `served | no_fill | blocked | error`
2. `Events`：确认 impression/click/postback 是否落档
3. `Usage / Revenue`：确认聚合指标与结算口径

若使用 Dashboard API（需要 Dashboard 登录态）：
1. `GET /api/v1/dashboard/decisions?requestId=<requestId>`
2. `GET /api/v1/dashboard/events?requestId=<requestId>`
3. `GET /api/v1/dashboard/usage-revenue`

## 6. Go-Live Checklist

- [ ] 生产流量仅调用 `POST /api/v2/bid`
- [ ] 客户端不传 `placementId`
- [ ] `No bid` 按正常分支处理（不报错）
- [ ] 广告链路 fail-open，不阻塞主回答
- [ ] Dashboard 可按 `requestId` 查到 decision + event
