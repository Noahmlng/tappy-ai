# 02 - Quickstart (Production API Path, V2)

- Owner: Integrations Team
- Last Updated: 2026-02-24
- Scope: external developer / prod-only

## 1. Objective

在 15 分钟内跑通：`config -> v2/bid -> events`。

## 2. Prerequisites

1. `MEDIATION_API_BASE_URL` (example: `http://127.0.0.1:3100/api`)
2. `MEDIATION_API_KEY`
3. `APP_ID`
4. `PLACEMENT_ID` (`chat_inline_v1` or `chat_followup_v1`)

## 3. Step 1: Read Placement Config

```bash
curl -sS -G "$MEDIATION_API_BASE_URL/v1/mediation/config" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  --data-urlencode "appId=$APP_ID" \
  --data-urlencode "placementId=$PLACEMENT_ID" \
  --data-urlencode "environment=prod" \
  --data-urlencode "schemaVersion=schema_v1" \
  --data-urlencode "sdkVersion=1.0.0" \
  --data-urlencode "requestAt=2026-02-24T12:00:00Z"
```

Expected:
1. `placementId` 和请求一致
2. `configVersion` 非空

## 4. Step 2: Request First Bid

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "quickstart_user_001",
    "chatId": "quickstart_chat_001",
    "placementId": "chat_inline_v1",
    "messages": [
      { "role": "user", "content": "Recommend running shoes for rainy days" },
      { "role": "assistant", "content": "Focus on grip and waterproof upper." }
    ]
  }'
```

Expected:
1. `requestId` 非空
2. `status=success`
3. `data.bid` 可能是对象，也可能是 `null`（`No bid` 属于正常结果）

## 5. Step 3: Report Event (Attach Impression)

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "<request_id_from_v2_bid>",
    "sessionId": "quickstart_chat_001",
    "turnId": "quickstart_turn_001",
    "query": "Recommend running shoes for rainy days",
    "answerText": "Focus on grip and waterproof upper.",
    "intentScore": 0.9,
    "locale": "en-US",
    "kind": "impression",
    "placementId": "chat_inline_v1",
    "adId": "v2_bid_xxx"
  }'
```

Expected:
1. `{ "ok": true }`

## 6. Fail-Open Requirement

1. `v2/bid` timeout/失败时，主回答继续输出，不阻塞对话。
2. `data.bid=null` 时不渲染广告，不视为接口故障。

## 7. Pass Criteria

- [ ] `mediation/config` 成功返回有效 placement 配置
- [ ] `v2/bid` 成功返回 `requestId`
- [ ] `events` 成功 ack
- [ ] no-bid 路径已验证
- [ ] ad path 故障不影响主对话（fail-open）
