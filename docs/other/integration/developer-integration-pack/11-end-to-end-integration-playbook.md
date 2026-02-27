# 11 - End-to-End Developer Integration Playbook (FastPath + Known Fill)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: application developers integrating full Ads mediation chain

## 1. Success Definition

你完成接入后，至少应达到：
1. 接入工作量：应用方仅需初始化一次 + 每轮调用一次 helper
2. 稳定性：广告失败不影响聊天主回答（fail-open）
3. 时延：`click -> bid response` p95 `<= 1000ms`
4. 口径：Dashboard 以 `Known Fill` 作为主指标

## 2. Architecture You Integrate

1. Dashboard / Control Plane：账号、key、白名单、排障查询
2. Runtime `/api/v2/bid`：广告决策主入口
3. Runtime `/api/v1/sdk/events`：曝光/点击/转化回传
4. App SDK 层：FastPath 触发 + UI 渲染 + 诊断埋点

推荐调用顺序：
1. `GET /api/v1/mediation/config`（可选诊断）
2. `POST /api/v2/bid`（必需）
3. `POST /api/v1/sdk/events`（建议）

## 3. Provisioning (Dashboard Side)

## 3.1 Create dashboard user/session

`POST /api/v1/public/dashboard/register` 或 `POST /api/v1/public/dashboard/login`

## 3.2 Issue runtime key

`POST /api/v1/public/credentials/keys`，使用 dashboard access token。

关键点：
1. `environment` 当前固定 `prod`
2. 生产环境必须安全保存 `secret`
3. key scope 与 `accountId/appId` 必须一致

## 3.3 Optional: configure allowed origins

`GET/PUT /api/v1/dashboard/security/origins`

## 3.4 Run preflight verify

`POST /api/v1/public/quick-start/verify`

目的：先排除 key、placement、inventory readiness 问题，再接入 UI。

## 4. App Integration (Recommended: SDK FastPath)

## 4.1 Minimal runtime options

1. `fastPath: true`（默认开启）
2. `timeouts`: `{ config: 1200, bid: 1200, events: 800 }`
3. `onDiagnostics`: 收集链路时延与分类

## 4.2 One-turn helper integration

```ts
import { createAdsSdkClient } from '@ai-network/tappy-ai-mediation/sdk/client'

const ads = createAdsSdkClient({
  apiBaseUrl: '/api',
  fetchImpl: fetch,
  headers: () => ({ Authorization: `Bearer ${runtimeKey}` }),
  fastPath: true,
  timeouts: { config: 1200, bid: 1200, events: 800 },
  onDiagnostics: (diagnostics) => {
    // send to your telemetry sink
    console.log('[ads-diagnostics]', diagnostics)
  },
})

async function onUserSend(messages, chatDonePromise) {
  const clickTs = Date.now()

  const result = await ads.runChatTurnWithAd({
    appId,
    userId,
    chatId,
    placementId: 'chat_from_answer_v1',
    placementKey: 'attach.post_answer_render',
    clickTs,
    messages,
    bidPayload: { userId, chatId, placementId: 'chat_from_answer_v1', messages },
    chatDonePromise,
    renderAd: (bid) => {
      renderSponsorCard(bid)
    },
  })

  // result.diagnostics contains stageDurationsMs, bidProbeStatus, outcomeCategory
  return result
}
```

## 4.3 Fail-open contract (must)

1. `/api/v2/bid` 超时或异常：返回 no-fill 路径，主回答继续
2. `data.bid=null`：不渲染广告，不视为系统故障
3. 广告上报失败不应反向阻塞聊天

## 5. Event Reporting (Attribution)

至少上报：
1. impression（有展示时）
2. click（有点击时）

建议上报：
1. postback conversion（如有成交/转化回传）

Endpoint：`POST /api/v1/sdk/events`

## 6. Diagnostics and KPI Mapping

## 6.1 Client-side diagnostics

建议采集时间点：
1. `clickTs`
2. `bidStartTs`
3. `bidEndTs`
4. `uiRenderTs`
5. `chatDoneTs`

建议产出：
1. `stageDurationsMs`
2. `bidProbeStatus`（`seen | timeout | not_started_before_case_end`）
3. `outcomeCategory`（`ui_fill | bid_fill_only | no_fill_confirmed | pre_bid_timeout | other_error`）

## 6.2 Mediation diagnostics (server response)

`/api/v2/bid` diagnostics 可用字段：
1. `timingsMs`
2. `budgetMs`
3. `budgetExceeded`
4. `timeoutSignal`
5. `precheck`

这些字段用于定位，不作为阶段硬中断条件。

## 6.3 Dashboard metrics

主 KPI：
1. `bidFillRateKnown`

配套诊断：
1. `bidKnownCount`
2. `bidUnknownCount`
3. `unknownRate`
4. `resultBreakdown`
5. `timeoutRelatedCount`
6. `precheckInventoryNotReadyCount`
7. `budgetExceededCount`

## 7. Validation Checklist

## 7.1 Functional

- [ ] 有 fill 时可渲染 sponsor card
- [ ] no-fill 时 UI 不报错
- [ ] bid 异常时主回答不中断

## 7.2 Latency

- [ ] `click -> bid response` p95 <= 1000ms
- [ ] `click -> sponsor-card render` p95 <= 1500ms（有 fill 样本）

## 7.3 Data quality

- [ ] Dashboard 能看到 requestId 对应 decision/event
- [ ] Known Fill 分母仅使用 known 样本
- [ ] unknown 进入诊断区，不污染主 fill rate

## 8. Error Handling Matrix

1. `400 INVALID_REQUEST`：请求结构/字段错误，修 payload
2. `401 INVALID_API_KEY|ACCESS_TOKEN_EXPIRED`：替换/刷新 key
3. `403 *_SCOPE_VIOLATION`：校验 account/app/environment/placement scope
4. `409 PRECONDITION_FAILED`：先修 runtime key 前置条件
5. `409 INVENTORY_EMPTY`：先补 inventory readiness
6. `5xx`：短退避重试（最多 1-2 次）+ UI fail-open

## 9. Rollout Strategy

1. Stage 1：灰度 5%-10% 流量，验证 Known Fill 与延迟
2. Stage 2：放量至 30%-50%，观察 timeout/precheck 诊断计数
3. Stage 3：全量并持续按 requestId 抽样审计

## 10. Reference Docs

1. `02-quickstart.md`
2. `03-api-sdk-reference.md`
3. `08-troubleshooting-playbook.md`
4. `mediation/docs/sdk-quick-start-v2.md`
