# Mediation SDK Quickstart (External Developer, Production Path)

- Version: v1.0
- Last Updated: 2026-02-22
- Scope: 15 分钟完成首条生产风格链路（config -> evaluate -> events）

## 1. Prerequisites

你需要先从平台侧拿到：

1. `MEDIATION_API_BASE_URL`（按环境发放，例如 `https://api.<env>.example.com`）
2. `MEDIATION_API_KEY`（服务端调用凭证）
3. `APP_ID`（你的应用标识）
4. `PLACEMENT_ID`（例如 `chat_inline_v1`）
5. 允许的回调域名或调用来源（如果平台要求）

## 2. Minimal Client Init

```bash
export MEDIATION_API_BASE_URL="https://api.<env>.example.com"
export MEDIATION_API_KEY="<issued_api_key>"
export APP_ID="<your_app_id>"
```

Node.js client baseline:

```js
const mediationClient = {
  baseUrl: process.env.MEDIATION_API_BASE_URL,
  apiKey: process.env.MEDIATION_API_KEY,
  appId: process.env.APP_ID,
  timeoutMs: 2500,
}
```

## 3. Pull Runtime Config

```bash
curl -sS "$MEDIATION_API_BASE_URL/api/v1/mediation/config?appId=$APP_ID&placementId=chat_inline_v1&environment=prod&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z" \
  -H "Authorization: Bearer $MEDIATION_API_KEY"
```

成功标准：

1. 返回 `200` 或 `304`。
2. 可拿到 `etag`、`ttlSec` 或配置快照。

## 4. Send Evaluate Request

```bash
EVAL_RESP=$(curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/evaluate" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{
    \"appId\":\"$APP_ID\",
    \"sessionId\":\"ext_session_001\",
    \"turnId\":\"ext_turn_001\",
    \"query\":\"Recommend running shoes for rainy days\",
    \"answerText\":\"Focus on grip and waterproof materials.\",
    \"intentScore\":0.91,
    \"locale\":\"en-US\"
  }")

echo "$EVAL_RESP"
```

成功标准：

1. `requestId` 非空。
2. `decision.result` 在 `served|blocked|no_fill|error` 里。

## 5. Report Events

```bash
REQUEST_ID=$(echo "$EVAL_RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.requestId||"")})')

curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{
    \"requestId\":\"$REQUEST_ID\",
    \"appId\":\"$APP_ID\",
    \"sessionId\":\"ext_session_001\",
    \"turnId\":\"ext_turn_001\",
    \"query\":\"Recommend running shoes for rainy days\",
    \"answerText\":\"Focus on grip and waterproof materials.\",
    \"intentScore\":0.91,
    \"locale\":\"en-US\"
  }"
```

成功标准：响应包含 `{ "ok": true }`。

## 6. Verify and Signoff

验收必看字段：

1. `evaluate.requestId`
2. `evaluate.decision.result`
3. `evaluate.decision.reasonDetail`
4. `events.ok`

建议把以上结果纳入你的接入验收报告（可直接贴 JSON 响应片段）。

## 7. External-Mode Self-check

1. 不要调用任何 `/api/v1/dashboard/*` 内部接口。
2. 不要依赖本地 `127.0.0.1` 网关路径。
3. 失败重试只对网络/5xx，`blocked|no_fill` 不应当作传输失败重试。
4. 广告调用失败时主回答必须继续（fail-open）。
