# 06 - Callback and Signature Validation Guide

- Owner: Security + Runtime Platform
- Last Updated: 2026-02-25

## 1. Callback Types

| Callback | Trigger | Required Fields | Retry Behavior |
| --- | --- | --- | --- |
| impression | ad render/attach event | `requestId`, `sessionId`, `turnId`, `query`, `answerText`, `intentScore`, `locale` | no automatic retry on 4xx; short retry on transient network/5xx |
| click | ad click event | same as impression + `kind=click` (and optional `adId`) | same as impression |
| conversion (postback) | downstream conversion callback | `requestId`, `eventType=postback`, `postbackType=conversion`, `postbackStatus`, (`cpaUsd` required when `success`) | client may retry with same idempotency key on timeout |

## 2. Signature Verification

Current runtime baseline:
1. `/api/v1/sdk/events` requires runtime credential (`Authorization: Bearer ...`).
2. No mandatory third-party callback signature header is enforced inside gateway.
3. Transport requirement is HTTPS + scoped runtime credential.

Recommended edge policy (if your callback source can sign payloads):
1. Signature header: `X-Callback-Signature`
2. Timestamp header: `X-Callback-Timestamp`
3. Hash algorithm: `HMAC-SHA256`
4. Canonical string: `<timestamp>.<raw_body>`
5. Clock skew tolerance: <= 300 seconds
6. Reject unsigned/expired payloads before forwarding to runtime gateway.

## 3. Idempotency Policy

1. Idempotency key source (conversion postback):
   - use client-provided `idempotencyKey` when available, otherwise semantic fallback key.
2. Dedup retention:
   - durable mode: unique key persists in settlement fact table.
   - state-file mode: retained until reset/state truncation.
3. Duplicate behavior:
   - duplicate postback must not create extra conversion fact or revenue.

## 4. Validation Examples

Attach/click style event:

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "adreq_xxx",
    "appId": "simulator-chatbot",
    "sessionId": "cb_session_001",
    "turnId": "cb_turn_001",
    "query": "Recommend waterproof running shoes",
    "answerText": "Focus on grip and waterproof uppers.",
    "intentScore": 0.9,
    "locale": "en-US",
    "kind": "impression",
    "placementId": "chat_inline_v1"
  }'
```

Conversion postback:

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "adreq_xxx",
    "eventType": "postback",
    "postbackType": "conversion",
    "postbackStatus": "success",
    "conversionId": "order_20260225_001",
    "eventSeq": 1,
    "cpaUsd": 6.25,
    "occurredAt": "2026-02-25T08:30:00.000Z",
    "idempotencyKey": "postback_order_20260225_001_success"
  }'
```

Success response:

```json
{
  "ok": true,
  "duplicate": false,
  "factId": "fact_xxx",
  "revenueUsd": 6.25
}
```

## 5. Failure Handling

| Failure | HTTP Response | Retryable | Alert |
| --- | --- | --- | --- |
| invalid signature (edge policy enabled) | `401` at edge gateway (blocked before runtime) | no | yes (security) |
| timestamp expired (edge policy enabled) | `401` at edge gateway | no | yes (security) |
| malformed payload | `400 SDK_EVENTS_INVALID_PAYLOAD` | no | yes (integration) |
| missing `cpaUsd` on success postback | `400 SDK_EVENTS_INVALID_PAYLOAD` | no | yes (integration) |
| duplicate conversion postback | `200` with `duplicate=true` | no extra retry needed | monitor only |
