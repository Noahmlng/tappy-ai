# Ads SDK Quick Start (Single Path)

- Version: v1.2
- Last Updated: 2026-02-27
- Audience: external app developers

## 1. What You Need

1. `ADS_BASE_URL` (e.g. `https://your-domain/api`)
2. `ADS_API_KEY` (runtime key from Dashboard)
3. `APP_ID`

默认不需要传 `placementId`。

## 2. Recommended Integration

```ts
import { createAdsSdkClient } from '@ai-network/tappy-ai-mediation/sdk/client'

const ads = createAdsSdkClient({
  apiBaseUrl: process.env.ADS_BASE_URL,
  apiKey: process.env.ADS_API_KEY,
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

## 3. Direct API Example

```bash
curl -sS -X POST "$ADS_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_12139050",
    "chatId": "chat_8b5d9f5a",
    "messages": [
      { "role": "user", "content": "camera for vlogging" },
      { "role": "assistant", "content": "consider compact options" }
    ]
  }'
```

## 4. Response Handling

1. `data.bid` is object: render sponsor card
2. `data.bid` is `null`: no-fill (normal)
3. request timeout/error: fail-open and continue chat

## 5. Event Reporting (Optional but Recommended)

```bash
curl -sS -X POST "$ADS_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "adreq_xxx",
    "sessionId": "chat_8b5d9f5a",
    "turnId": "turn_001",
    "query": "camera for vlogging",
    "answerText": "consider compact options",
    "intentScore": 0.8,
    "locale": "en-US",
    "kind": "impression",
    "adId": "v2_bid_xxx"
  }'
```

## 6. SLA Guidance

1. `click -> bid response p95 <= 1000ms`
2. bid timeout should fail-open
3. keep chat experience as primary path
