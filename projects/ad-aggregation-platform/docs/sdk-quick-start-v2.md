# Ads SDK Quick Start (Public, V2)

- Version: v1.0
- Last Updated: 2026-02-24
- Audience: External developers integrating chat ads in AI applications

This guide helps you complete first integration in 10 minutes:
1. request one ad bid
2. render ad safely (fail-open)
3. report impression/click events
4. verify with requestId in dashboard/logs

## 1. Prerequisites

You need:
1. `ADS_BASE_URL` (example: `https://your-gateway.example.com/api`)
2. `ADS_API_KEY` (runtime API key)
3. one enabled placement:
   - `chat_inline_v1` (post-answer ad block)
   - `chat_followup_v1` (follow-up ad card)

## 2. Endpoint Overview

1. `POST /api/v2/bid`
- unified messages input
- returns **single winner bid**

2. `POST /api/v1/sdk/events`
- report impression/click/dismiss/postback events
- correlate with `requestId`

## 3. First Bid Request

### Request

```bash
curl -sS -X POST "$ADS_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_12139050",
    "chatId": "chat_8b5d9f5a",
    "placementId": "chat_inline_v1",
    "messages": [
      { "role": "user", "content": "i want to buy a gift to my girlfriend" },
      { "role": "assistant", "content": "what type of gift do you want?" },
      { "role": "user", "content": "camera for vlogging" }
    ]
  }'
```

### Success Response (with bid)

```json
{
  "requestId": "adreq_xxx",
  "timestamp": "2026-02-24T10:31:24.787Z",
  "status": "success",
  "message": "Bid successful",
  "data": {
    "bid": {
      "price": 12.34,
      "advertiser": "DJI",
      "headline": "DJI",
      "description": "Explore DJI’s lineup for creators.",
      "cta_text": "Learn More",
      "url": "https://...",
      "image_url": "https://...",
      "dsp": "gravity",
      "bidId": "v1_bid_xxx",
      "placement": "block",
      "variant": "base"
    }
  }
}
```

### No-Bid Response (normal)

```json
{
  "requestId": "adreq_xxx",
  "timestamp": "2026-02-24T10:31:24.787Z",
  "status": "success",
  "message": "No bid",
  "data": { "bid": null }
}
```

`No bid` is **not an error**. Always keep your main chat response path running.

## 4. Render (Fail-Open)

Recommended behavior:
1. if `data.bid == null`: skip ad render
2. if request fails: swallow ad error, do not block assistant reply

```ts
async function loadAd() {
  try {
    const bidResp = await fetch(`${ADS_BASE_URL}/v2/bid`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'user_12139050',
        chatId: 'chat_8b5d9f5a',
        placementId: 'chat_inline_v1',
        messages,
      }),
    }).then((r) => r.json())

    if (!bidResp?.data?.bid) return null
    return bidResp
  } catch (err) {
    console.warn('[ads] fail-open', err)
    return null
  }
}
```

## 5. Report Events

### 5.1 Impression (`chat_inline_v1`)

```bash
curl -sS -X POST "$ADS_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "adreq_xxx",
    "sessionId": "chat_8b5d9f5a",
    "turnId": "turn_001",
    "query": "camera for vlogging",
    "answerText": "You can compare Sony ZV-1 and DJI options.",
    "intentScore": 0.80,
    "locale": "en-US",
    "kind": "impression",
    "placementId": "chat_inline_v1",
    "adId": "v1_bid_xxx"
  }'
```

### 5.2 Click (`chat_inline_v1`)

Same payload, change `kind` to `click`.

### 5.3 Follow-up placement note

For `chat_followup_v1`, events require next-step fields (`event`, `placementKey`, `context`).
If you are integrating follow-up cards, use the dedicated next-step contract from platform support docs.

## 6. Minimal Client Contract

### 6.1 `/api/v2/bid` required fields

1. `userId: string`
2. `chatId: string`
3. `placementId: chat_inline_v1 | chat_followup_v1`
4. `messages: Array<{ role: user|assistant|system; content: string; timestamp?: ISO-8601 }>`

### 6.2 `/api/v1/sdk/events` minimal required fields for inline placement

1. `requestId`
2. `sessionId`
3. `turnId`
4. `query`
5. `answerText`
6. `intentScore` (0~1)
7. `locale`
8. `kind` (`impression` or `click`)
9. `placementId`
10. `adId`

## 7. Error Handling

1. `400 INVALID_REQUEST`
- bad payload shape or missing required fields

2. `401/403`
- missing/invalid API key or scope mismatch

3. `409 PRECONDITION_FAILED`
- typically no active key / setup incomplete

4. `429`
- rate limited, retry with backoff

5. `5xx`
- server-side transient issue, retry with backoff + fail-open

## 8. Production Checklist

1. Fail-open enabled for all ad calls
2. `requestId` persisted in app logs
3. impression/click events report same `requestId`
4. timeout configured (recommended: bid <= 1200ms)
5. no-bid path tested
6. dashboard/log search by `requestId` verified

## 9. Migration Note

Legacy endpoint `/api/v1/sdk/evaluate` has been removed.
Use `/api/v2/bid` as the only bid entry.
