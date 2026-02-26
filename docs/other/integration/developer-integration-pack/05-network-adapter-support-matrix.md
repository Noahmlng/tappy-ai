# 05 - Network and Adapter Support Matrix

- Owner: Runtime Platform + Integrations QA
- Last Updated: 2026-02-26

## 1. Adapter Matrix

| Adapter | Status | Supported Regions | Formats | Timeout | Notes |
| --- | --- | --- | --- | --- | --- |
| `partnerstack` | supported | global (mediation baseline) | card / text-link payload mapped to bid schema | default 800ms | primary bidder in default config |
| `cj` | supported | global (mediation baseline) | card / text-link payload mapped to bid schema | default 800ms | secondary bidder in default config |
| `house` | supported (fallback) | global | internal house-ads payload | follows placement timeout budget | enabled when fallback store switch is on |

## 2. Feature Coverage

| Feature | Adapter A | Adapter B | Adapter C | Notes |
| --- | --- | --- | --- | --- |
| fill | partnerstack: yes | cj: yes | house: yes | no-fill is a valid terminal outcome |
| click tracking | partnerstack: yes | cj: yes | house: yes | click recorded via `/api/v1/sdk/events` |
| postback | partnerstack: yes | cj: yes | house: yes | conversion revenue counted only on `postbackStatus=success` |
| dedup support | partnerstack: idempotent by request/event | cj: idempotent by request/event | house: idempotent by request/event | settlement fact dedupe by `idempotency_key` |

## 3. Fallback Rules

1. Primary route:
   - run enabled external bidders for placement (`partnerstack`, then `cj` when both active).
2. Fallback route order:
   - if no external winner and placement fallback store enabled -> `house`.
3. Circuit breaker rule:
   - transient external bidder failures should degrade to no-bid/house path, not fail closed.
4. Cooldown rule:
   - follow placement-level cooldown settings to avoid repeat over-serving.

## 4. Example Validation (per adapter)

Use a scoped runtime key and run:

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "adapter_matrix_user_001",
    "chatId": "adapter_matrix_chat_001",
    "placementId": "chat_from_answer_v1",
    "messages": [
      { "role": "user", "content": "Recommend lightweight hiking shoes" },
      { "role": "assistant", "content": "Prioritize traction and ankle support." }
    ]
  }'
```

Expected minimal response:

```json
{
  "requestId": "adreq_xxx",
  "status": "success",
  "message": "Bid successful",
  "data": {
    "bid": {
      "dsp": "partnerstack"
    }
  }
}
```

If no winner, `message` can be `No bid` and `data.bid` can be `null`; this is still success.

## 5. Failure Troubleshooting

| Symptom | Likely Cause | Action |
| --- | --- | --- |
| `message=No bid` rate spikes | partner timeouts or strict placement rules | inspect placement config and bidder health, then run staged replay |
| `409 INVENTORY_EMPTY` during preflight | strict inventory snapshot empty or missing core network coverage | platform side runs `npm --prefix ./mediation run inventory:sync:all`, then re-run preflight |
| adapter-specific DSP disappears | adapter disabled in placement config | verify bidder list and `enabled=true` flags |
| postback counted twice concern | duplicate callback replay | confirm same `idempotency_key` returns duplicate path and no extra revenue |
| frequent `5xx` from bidder path | upstream dependency instability | keep fail-open, throttle retries, temporarily rely on fallback route |
