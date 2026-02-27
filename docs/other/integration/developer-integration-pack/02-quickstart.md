# 02 - Dashboard Quick Start (FastPath, V2)

- Owner: Integrations Team
- Last Updated: 2026-02-27
- Scope: external developer / prod-only runtime path

## 1. Goal

在 15 分钟内完成最小可用接入：
1. 在 Dashboard 侧拿到 runtime key
2. 跑通 `quick-start/verify`
3. 跑通一次 `POST /api/v2/bid`
4. 确认 no-fill/fail-open 行为正确

## 2. Prerequisites

1. `MEDIATION_API_BASE_URL`（示例：`http://127.0.0.1:3100/api`）
2. `ACCOUNT_ID`（示例：`org_mediation`）
3. `APP_ID`（示例：`sample-client-app`）
4. `PLACEMENT_ID`（默认 `chat_from_answer_v1`）
5. 本地 `curl` 可用；建议安装 `jq`（无 `jq` 也可手动复制）

## 3. Step 0: Dashboard 注册并创建 Runtime Key

## 3.1 注册（首次）

```bash
export MEDIATION_API_BASE_URL="http://127.0.0.1:3100/api"
export ACCOUNT_ID="org_mediation"
export APP_ID="sample-client-app"
export PLACEMENT_ID="chat_from_answer_v1"

curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/public/dashboard/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "quickstart_'"$(date +%s)'"'@example.com",
    "password": "pass12345",
    "accountId": "'"$ACCOUNT_ID"'",
    "appId": "'"$APP_ID"'"
  }' > /tmp/mediation-register.json

cat /tmp/mediation-register.json
```

提取登录态 token（Dashboard token）：

```bash
export DASHBOARD_TOKEN="$(jq -r '.session.accessToken // empty' /tmp/mediation-register.json)"
```

## 3.2 创建 Runtime Key（用于 `/api/v2/bid`）

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/public/credentials/keys" \
  -H "Authorization: Bearer $DASHBOARD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "'"$ACCOUNT_ID"'",
    "appId": "'"$APP_ID"'",
    "environment": "prod",
    "name": "quickstart-runtime-key"
  }' > /tmp/mediation-runtime-key.json

cat /tmp/mediation-runtime-key.json
```

提取 runtime key（生产接入时由服务端安全保存）：

```bash
export MEDIATION_API_KEY="$(jq -r '.secret // empty' /tmp/mediation-runtime-key.json)"
```

## 4. Step 1: 预检（推荐，先排除环境问题）

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/public/quick-start/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "'"$ACCOUNT_ID"'",
    "appId": "'"$APP_ID"'",
    "environment": "prod",
    "placementId": "'"$PLACEMENT_ID"'"
  }'
```

判定规则：
1. `200 + ok=true`：可继续接入
2. `409 PRECONDITION_FAILED`：缺少 active runtime key 或 scope 不匹配
3. `409 INVENTORY_EMPTY`：库存预检未通过（平台侧需先补齐 inventory）

## 5. Step 2: 请求首个 Bid（MVP 必需）

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/v2/bid" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "quickstart_user_001",
    "chatId": "quickstart_chat_001",
    "placementId": "'"$PLACEMENT_ID"'",
    "messages": [
      { "role": "user", "content": "Recommend running shoes for rainy days" },
      { "role": "assistant", "content": "Focus on grip and waterproof upper." }
    ]
  }' > /tmp/mediation-v2-bid.json

cat /tmp/mediation-v2-bid.json
```

最小通过标准：
1. HTTP `200`
2. `status=success`
3. `requestId` 非空
4. `filled` 为布尔值
5. `data.bid` 允许为 `object` 或 `null`

`No bid` 边界（正常业务结果）：
1. `HTTP 200`
2. `status=success`
3. `message=No bid`
4. `data.bid=null`

## 6. Step 3: FastPath 与 Fail-Open（接入强制要求）

1. 聊天发送后立即触发 `v2/bid`（FastPath），不要等待流式回答结束。
2. 广告链路失败/超时时必须 fail-open，不阻塞主回答。
3. 目标建议：`click -> bid response` 的 p95 `<= 1000ms`。

默认建议超时：
1. `config=1200ms`
2. `bid=1200ms`
3. `events=800ms`

## 7. Step 4: 事件上报（建议开启）

```bash
export REQUEST_ID="$(jq -r '.requestId // empty' /tmp/mediation-v2-bid.json)"
export BID_ID="$(jq -r '.data.bid.bidId // empty' /tmp/mediation-v2-bid.json)"

curl -sS -X POST "$MEDIATION_API_BASE_URL/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "'"$REQUEST_ID"'",
    "sessionId": "quickstart_chat_001",
    "turnId": "quickstart_turn_001",
    "query": "Recommend running shoes for rainy days",
    "answerText": "Focus on grip and waterproof upper.",
    "intentScore": 0.84,
    "locale": "en-US",
    "kind": "impression",
    "placementId": "'"$PLACEMENT_ID"'",
    "adId": "'"$BID_ID"'"
  }'
```

期望：`{ "ok": true }`

## 8. Dashboard 判读口径（避免误判）

主口径使用 `Known Fill`：
1. `bidFillRateKnown = served / bidKnownCount`
2. `unknown` 不进入 fill 分母，只用于诊断

建议同时看：
1. `bidKnownCount` / `bidUnknownCount` / `unknownRate`
2. `timeoutRelatedCount`
3. `precheckInventoryNotReadyCount`
4. `budgetExceededCount`

## 9. Pass Criteria

- [ ] Dashboard 创建 key 成功并拿到 `secret`
- [ ] `quick-start/verify` 返回 `ok=true`（或明确修复 409 原因）
- [ ] `v2/bid` 返回有效 `requestId`
- [ ] no-fill 路径已验证（不会误报失败）
- [ ] fail-open 已验证（广告异常不影响聊天主链路）
- [ ] 事件上报成功（至少 impression）
