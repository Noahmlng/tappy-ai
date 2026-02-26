# 02 - Quickstart (Production API Path, V2)

- Owner: Integrations Team
- Last Updated: 2026-02-26
- Scope: external developer / prod-only

## 1. Objective

在 15 分钟内跑通：`v2/bid`（首发必需）；`events` 后续补齐。

## 2. Prerequisites

1. `MEDIATION_API_BASE_URL` (example: `http://127.0.0.1:3100/api`)
2. `MEDIATION_API_KEY`
3. `APP_ID`
4. (Optional) `PLACEMENT_ID` (`chat_from_answer_v1` or `chat_intent_recommendation_v1`)
5. Platform runtime must be configured with `SUPABASE_DB_URL` and `MEDIATION_ALLOWED_ORIGINS` before serving traffic.

## 3. Step 0: Preflight Verify (Recommended)

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/public/quick-start/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "'"$APP_ID"'",
    "accountId": "<your_account_id>",
    "placementId": "'"$PLACEMENT_ID"'"
  }'
```

Expected:
1. `200` with `ok=true` when runtime key + inventory preconditions are both ready.
2. `409 PRECONDITION_FAILED`: missing active runtime key for this app/environment.
3. `409 INVENTORY_EMPTY`: strict inventory precondition failed. Platform side should run `npm --prefix ./mediation run inventory:sync:all` and retry.

## 4. Step 1: Request First Bid (MVP required)

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "quickstart_user_001",
    "chatId": "quickstart_chat_001",
    "placementId": "chat_from_answer_v1",
    "messages": [
      { "role": "user", "content": "Recommend running shoes for rainy days" },
      { "role": "assistant", "content": "Focus on grip and waterproof upper." }
    ]
  }'
```

Expected:
1. `requestId` 非空
2. `status=success`
3. 返回包含 `filled` 和 `landingUrl`（有 bid 时为 URL，no-bid 为 `null`）
4. `data.bid` 可能是对象，也可能是 `null`（`No bid` 属于正常结果）
5. 仅当 `HTTP 200 + status=success + message=No bid` 才是正常 no-fill；`4xx` 需要按错误码修复。

## 5. Step 2: Report Event (Optional enhancement)

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
    "placementId": "chat_from_answer_v1",
    "adId": "v2_bid_xxx"
  }'
```

Expected:
1. `{ "ok": true }`

## 6. Optional: Read Placement Config (diagnostics only)

```bash
curl -sS -G "$MEDIATION_API_BASE_URL/v1/mediation/config" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  --data-urlencode "appId=$APP_ID" \
  --data-urlencode "placementId=${PLACEMENT_ID:-chat_from_answer_v1}" \
  --data-urlencode "environment=prod" \
  --data-urlencode "schemaVersion=schema_v1" \
  --data-urlencode "sdkVersion=1.0.0" \
  --data-urlencode "requestAt=2026-02-24T12:00:00Z"
```

## 7. Fail-Open Requirement

1. `v2/bid` timeout/失败时，主回答继续输出，不阻塞对话。
2. `data.bid=null` 时不渲染广告，不视为接口故障。

## 8. Pass Criteria

- [ ] `quick-start/verify` 返回 `ok=true`（或明确修复 `PRECONDITION_FAILED`/`INVENTORY_EMPTY`）
- [ ] `v2/bid` 成功返回 `requestId`
- [ ] （可选）`events` 成功 ack
- [ ] （可选）`mediation/config` 成功返回有效 placement 配置
- [ ] no-bid 路径已验证
- [ ] ad path 故障不影响主对话（fail-open）
