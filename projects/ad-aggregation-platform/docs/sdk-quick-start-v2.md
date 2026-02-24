# SDK Quick Start（V2 单 Bid）

本指南目标：10 分钟内跑通 `requestBid -> 渲染 -> events 上报`。

## 1. 前置准备

1. 打开 Dashboard：`http://localhost:3003`
2. 在 `API Keys` 页面创建一个 `staging` key
3. 在 `Config` 页面确认 placement 已启用
   - `chat_inline_v1`（主回答后附加广告）
   - `chat_followup_v1`（follow-up 位）
4. 记下：
   - `API_BASE_URL`（本地默认 `http://127.0.0.1:3100/api`）
   - `API_KEY`

## 2. 初始化 SDK Client

当前仓库 SDK 实现在：
`projects/ad-aggregation-platform/src/sdk/client.js`

```ts
import { createAdsSdkClient } from '../ad-aggregation-platform/src/sdk/client.js'

const sdk = createAdsSdkClient({
  apiBaseUrl: 'http://127.0.0.1:3100/api',
  apiKey: process.env.AI_ADS_API_KEY,
})
```

## 3. 请求单 Bid（核心）

```ts
const placementId = 'chat_inline_v1'
const chatId = `chat_${Date.now()}`
const turnId = `turn_${Date.now()}`

const messages = [
  { role: 'user', content: 'I want to buy a gift for my girlfriend' },
  { role: 'assistant', content: 'Sure, what category are you considering?' },
  { role: 'user', content: 'camera for vlogging' },
]

const bidResp = await sdk.requestBid({
  userId: 'user_001',
  chatId,
  placementId,
  messages,
})

// no-bid 也是 200：status=success + data.bid=null
if (!bidResp.data.bid) {
  // fail-open：主流程继续，不阻塞聊天
  return
}

const bid = bidResp.data.bid
// bid 字段：price/advertiser/headline/description/cta_text/url/image_url/dsp/bidId...
```

## 4. 渲染广告（最小建议）

收到 `bidResp.data.bid` 后，按你 UI 结构渲染：

1. 标题：`headline`
2. 描述：`description`
3. CTA：`cta_text`
4. 落地链接：`url`
5. 图片（可选）：`image_url`
6. 广告标识：`Sponsored`

## 5. 上报事件（impression/click）

`chat_inline_v1` 事件上报走 `POST /api/v1/sdk/events`，最小字段示例：

```ts
// impression
await sdk.reportEvent({
  requestId: bidResp.requestId,
  sessionId: chatId,
  turnId,
  query: bidResp._sdkSignals?.query || messages[messages.length - 1].content,
  answerText: bidResp._sdkSignals?.answerText || '',
  intentScore: 0.8,
  locale: 'en-US',
  kind: 'impression', // impression | click
  placementId,
  adId: bid.bidId,
})

// click（用户点击时）
await sdk.reportEvent({
  requestId: bidResp.requestId,
  sessionId: chatId,
  turnId,
  query: bidResp._sdkSignals?.query || messages[messages.length - 1].content,
  answerText: bidResp._sdkSignals?.answerText || '',
  intentScore: 0.8,
  locale: 'en-US',
  kind: 'click',
  placementId,
  adId: bid.bidId,
})
```

## 6. Fail-open 约定（强烈建议）

广告链路任何异常都不要阻塞主回答：

```ts
try {
  const bidResp = await sdk.requestBid(...)
  // render + events
} catch (err) {
  console.warn('[ads] fail-open:', err)
  // 忽略广告错误，继续主对话
}
```

## 7. 自助验收（Dashboard）

在 `Home` 页面 `Self-Serve Integration` 区域点 `Run Verify`：

会执行：
1. config 检查
2. `POST /api/v2/bid`
3. `POST /api/v1/sdk/events`

并返回 `requestId` 与证据；随后在 `Logs` 页面可按 `requestId` 查到记录。

## 8. 直接 HTTP 接入（不使用 SDK helper）

```bash
curl -sS -X POST "http://127.0.0.1:3100/api/v2/bid" \
  -H "Authorization: Bearer $AI_ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"user_001",
    "chatId":"chat_001",
    "placementId":"chat_inline_v1",
    "messages":[
      {"role":"user","content":"camera for vlogging"}
    ]
  }'
```

## 9. 常见问题

1. `401/403`：API key 无效或 scope 不匹配。
2. `400`：`messages` 字段不合法（role 只能 `user|assistant|system`，content 不能为空）。
3. 返回 `No bid`：属于正常语义（`HTTP 200` + `data.bid=null`），不要当作异常。
4. 看不到日志：先确认 `events` 上报是否携带了同一个 `requestId`。

