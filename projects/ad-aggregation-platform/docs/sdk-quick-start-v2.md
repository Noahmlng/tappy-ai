# Ads SDK Quick Start (Public, V2)

- Version: v1.1
- Last Updated: 2026-02-24
- Audience: External developers integrating ads in AI chat applications

This guide helps you run first integration in 10-15 minutes:
1. fetch placement config
2. request one bid (`/api/v2/bid`)
3. render ad with fail-open behavior
4. report events (`/api/v1/sdk/events`)

## 1. Prerequisites

Required values:
1. `ADS_BASE_URL` (example: `https://your-gateway.example.com/api`)
2. `ADS_API_KEY` (runtime key; should have runtime scopes)
3. `APP_ID`
4. `ENVIRONMENT` (`sandbox` | `staging` | `prod`)
5. enabled placement:
   - `chat_inline_v1` (post-answer sponsored block), or
   - `chat_followup_v1` (next-step intent card)

## 2. API Flow (V2 Baseline)

1. `GET /api/v1/mediation/config`
- returns current placement config and `configVersion`

2. `POST /api/v2/bid`
- unified messages input
- returns **single winner bid** or `data.bid=null`

3. `POST /api/v1/sdk/events`
- reports impression/click/dismiss/postback events
- links events with `requestId`

## 3. Step 1: Fetch Placement Config

```bash
curl -sS -G "$ADS_BASE_URL/v1/mediation/config" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  --data-urlencode "appId=$APP_ID" \
  --data-urlencode "placementId=chat_inline_v1" \
  --data-urlencode "environment=$ENVIRONMENT" \
  --data-urlencode "schemaVersion=schema_v1" \
  --data-urlencode "sdkVersion=1.0.0" \
  --data-urlencode "requestAt=2026-02-24T12:00:00Z"
```

Success response includes:
1. `placementId` / `placementKey`
2. `configVersion`
3. `placement` object (enabled, thresholds, caps, etc.)

## 4. Step 2: Request First Bid

```bash
curl -sS -X POST "$ADS_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_12139050",
    "chatId": "chat_8b5d9f5a",
    "placementId": "chat_inline_v1",
    "messages": [
      { "role": "user", "content": "I want to buy a gift for my girlfriend" },
      { "role": "assistant", "content": "What kind of gift do you want?" },
      { "role": "user", "content": "Camera for vlogging" }
    ]
  }'
```

### Success with bid

```json
{
  "requestId": "adreq_xxx",
  "timestamp": "2026-02-24T10:31:24.787Z",
  "status": "success",
  "message": "Bid successful",
  "data": {
    "bid": {
      "price": 7.86,
      "advertiser": "DJI",
      "headline": "DJI",
      "description": "Explore DJI's lineup for creators.",
      "cta_text": "Learn More",
      "url": "https://example.com",
      "image_url": "https://example.com/cover.jpg",
      "dsp": "partnerstack",
      "bidId": "v2_bid_xxx",
      "placement": "block",
      "variant": "base",
      "pricing": {
        "modelVersion": "rpm_v1",
        "targetRpmUsd": 8,
        "ecpmUsd": 7.86,
        "cpaUsd": 3.21,
        "pClick": 0.026,
        "pConv": 0.0014,
        "network": "partnerstack",
        "rawSignal": {
          "rawBidValue": 3.5,
          "rawUnit": "base_rate_or_bid_value",
          "normalizedFactor": 0.91
        }
      }
    }
  }
}
```

### Success with no bid (normal)

```json
{
  "requestId": "adreq_xxx",
  "timestamp": "2026-02-24T10:31:24.787Z",
  "status": "success",
  "message": "No bid",
  "data": {
    "bid": null
  }
}
```

`No bid` is not an error. Your main chat flow should continue.

## 5. Step 3: Render with Fail-Open

```ts
async function loadAd(messages) {
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
    return bidResp.data.bid
  } catch (err) {
    console.warn('[ads] fail-open', err)
    return null
  }
}
```

Recommended behavior:
1. `data.bid == null`: skip rendering
2. request timeout/failure: swallow ad error, do not block answer rendering

## 6. Step 4: Report Events

### 6.1 Attach impression (`chat_inline_v1`)

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
    "adId": "v2_bid_xxx"
  }'
```

### 6.2 Attach click (`chat_inline_v1`)

Use the same payload and set `kind` to `click`.

### 6.3 Attach postback conversion (`chat_inline_v1`)

For simulator mode, use `bid.pricing.cpaUsd` from `/api/v2/bid` as `cpaUsd`.

```bash
curl -sS -X POST "$ADS_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "postback",
    "requestId": "adreq_xxx",
    "sessionId": "chat_8b5d9f5a",
    "turnId": "turn_001",
    "userId": "user_12139050",
    "placementId": "chat_inline_v1",
    "adId": "v2_bid_xxx",
    "postbackType": "conversion",
    "postbackStatus": "success",
    "conversionId": "conv_adreq_xxx_v2_bid_xxx_turn_001",
    "cpaUsd": 3.21,
    "currency": "USD"
  }'
```

### 6.4 Next-step event (`chat_followup_v1`, optional)

```bash
curl -sS -X POST "$ADS_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $ADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "adreq_xxx",
    "sessionId": "chat_8b5d9f5a",
    "turnId": "turn_002",
    "userId": "user_12139050",
    "event": "followup_generation",
    "kind": "impression",
    "placementId": "chat_followup_v1",
    "placementKey": "next_step.intent_card",
    "adId": "v2_bid_xxx",
    "context": {
      "query": "camera for travel vlogging",
      "answerText": "Let's compare compact options.",
      "locale": "en-US",
      "intent_class": "shopping",
      "intent_score": 0.77,
      "preference_facets": [
        { "facet_key": "use_case", "facet_value": "travel", "confidence": 0.9 }
      ]
    }
  }'
```

## 7. Minimal Contract Rules

1. `/api/v2/bid` only accepts fields: `userId`, `chatId`, `placementId`, `messages`.
2. `messages[*].role` must be `user | assistant | system`.
3. `/api/v1/sdk/events` uses strict payload validation per event type.
4. Unknown extra fields are rejected with `400`.

## 8. Error Handling

1. `400 INVALID_REQUEST` / `400 SDK_EVENTS_INVALID_PAYLOAD`
- payload shape error or missing required fields

2. `401`
- missing/invalid/expired runtime credential

3. `403`
- token scope/app/environment/placement mismatch

4. `5xx` (upstream/proxy/runtime transient failure)
- retry with backoff and keep fail-open on UI path

## 9. Production Checklist

1. fail-open enabled for ad calls
2. request timeout configured (`bid <= 1200ms` recommended)
3. `requestId` persisted in app logs
4. impression/click events use same `requestId`
5. postback success payload uses `bid.pricing.cpaUsd` (simulator mode)
6. no-bid path validated

## 10. Migration Note

Legacy `POST /api/v1/sdk/evaluate` is no longer the primary integration path.
Use `GET /api/v1/mediation/config` + `POST /api/v2/bid` + `POST /api/v1/sdk/events`.
