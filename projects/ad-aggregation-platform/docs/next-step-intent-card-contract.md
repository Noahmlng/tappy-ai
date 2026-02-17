# Next-Step Intent Card Contract

- Version: v0.1
- Last Updated: 2026-02-17
- Scope: `next_step.intent_card` request/response protocol for SDK `evaluate` flow

## 1. Endpoint and Placement Scope

- Endpoint: `POST /api/v1/sdk/evaluate`
- Event: `followup_generation`
- Placement Key: `next_step.intent_card`
- Placement ID (default in simulator): `chat_followup_v1`

This contract is placement-specific and is separate from the current Attach-only frozen contract.

## 2. Request Contract

Schema:
- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/schemas/next-step-intent-card-request.schema.json`

Required top-level fields:

1. `appId`
2. `sessionId`
3. `turnId`
4. `event` (`followup_generation` or `follow_up_generation`)
5. `placementId`
6. `placementKey` (`next_step.intent_card`)
7. `context`

Required context fields:

1. `query`
2. `locale`
3. `intent_class`
4. `intent_score`
5. `preference_facets`

Request example:

```json
{
  "appId": "simulator-chatbot",
  "sessionId": "session_123",
  "turnId": "turn_045",
  "event": "followup_generation",
  "placementId": "chat_followup_v1",
  "placementKey": "next_step.intent_card",
  "context": {
    "query": "我女朋友喜欢材质鲜艳的，推荐几个礼物",
    "answerText": "你可以考虑围巾、包、家居摆件等。",
    "locale": "zh-CN",
    "intent_class": "gifting",
    "intent_score": 0.82,
    "preference_facets": [
      { "facet_key": "recipient", "facet_value": "girlfriend", "confidence": 0.98, "source": "user_query" },
      { "facet_key": "material", "facet_value": "vivid", "confidence": 0.77, "source": "llm_inference" }
    ],
    "constraints": {
      "must_include": ["gift"],
      "must_exclude": ["adult"]
    }
  }
}
```

## 3. Response Contract

Schema:
- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/schemas/next-step-intent-card-response.schema.json`

Required top-level fields:

1. `requestId`
2. `placementId`
3. `placementKey` (`next_step.intent_card`)
4. `decision`
5. `intent_inference`
6. `ads`

Decision fields:

1. `result` (`served|no_fill|blocked|error`)
2. `reason` (`served|no_fill|blocked|error`)
3. `reasonDetail` (machine-readable detail)
4. `intent_score`

Response example (`served`):

```json
{
  "requestId": "adreq_20260217_001",
  "placementId": "chat_followup_v1",
  "placementKey": "next_step.intent_card",
  "decision": {
    "result": "served",
    "reason": "served",
    "reasonDetail": "runtime_eligible",
    "intent_score": 0.82
  },
  "intent_inference": {
    "intent_class": "gifting",
    "intent_score": 0.82,
    "preference_facets": [
      { "facet_key": "recipient", "facet_value": "girlfriend", "confidence": 0.98, "source": "user_query" },
      { "facet_key": "material", "facet_value": "vivid", "confidence": 0.77, "source": "llm_inference" }
    ],
    "constraints": {
      "must_include": ["gift"],
      "must_exclude": ["adult"]
    },
    "inference_trace": ["intent:gifting", "facet:material=vivid"]
  },
  "ads": [
    {
      "item_id": "cj_8817",
      "title": "Color Bloom Gift Set",
      "snippet": "High-saturation floral gift set for special occasions.",
      "target_url": "https://merchant.example.com/bloom-gift",
      "merchant_or_network": "CJ",
      "price_hint": "$39.99",
      "match_reasons": ["recipient=girlfriend", "material=vivid"],
      "relevance_score": 0.91,
      "disclosure": "Sponsored",
      "tracking": {
        "impression_url": "https://track.example.com/i/123",
        "click_url": "https://track.example.com/c/123"
      }
    }
  ],
  "meta": {
    "retrieval_ms": 84,
    "candidate_count": 47,
    "selected_count": 1,
    "model_version": "intent-llm-v1"
  }
}
```

Response example (`no_fill`):

```json
{
  "requestId": "adreq_20260217_002",
  "placementId": "chat_followup_v1",
  "placementKey": "next_step.intent_card",
  "decision": {
    "result": "no_fill",
    "reason": "no_fill",
    "reasonDetail": "runtime_no_offer",
    "intent_score": 0.71
  },
  "intent_inference": {
    "intent_class": "shopping",
    "intent_score": 0.71,
    "preference_facets": []
  },
  "ads": []
}
```

## 4. Validation and Compatibility

1. `intent_class`, `intent_score`, `preference_facets` are mandatory in the placement contract.
2. If inference fails, set `intent_class=non_commercial`, `intent_score=0`, `preference_facets=[]` and return `ads=[]`.
3. Contract is fail-open for chat flow: invalid ad candidates should not block assistant response.
