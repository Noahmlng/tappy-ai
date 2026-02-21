# Mediation SDK Quickstart (Minimal Runnable)

- Version: v0.1
- Last Updated: 2026-02-21
- Scope: 用最小 HTTP 接入方式在 10 分钟内跑通首条链路（init -> evaluate -> events -> verify）

## 1. Prerequisites

- Node.js 20+
- 在仓库根目录执行命令：`/Users/zeming/Documents/chat-ads-main`
- 已安装依赖：`npm ci`

## 2. Init（最小初始化）

先准备最小接入配置（Hosted API 模式）：

```bash
export MEDIATION_BASE_URL="http://127.0.0.1:3100"
export APP_ID="simulator-chatbot"
```

最小客户端初始化示例（Node.js）：

```js
const mediationClient = {
  baseUrl: process.env.MEDIATION_BASE_URL,
  appId: process.env.APP_ID,
  timeoutMs: 2500,
}
```

启动本地网关（一个终端保持运行）：

```bash
npm --prefix ./projects/ad-aggregation-platform run dev:gateway
```

健康检查（新开终端）：

```bash
curl -sS "$MEDIATION_BASE_URL/api/health"
```

期望响应包含：`{"ok":true}`。

## 3. Evaluate（首条请求）

发送最小请求到 `/api/v1/sdk/evaluate`：

```bash
EVAL_RESP=$(curl -sS -X POST "$MEDIATION_BASE_URL/api/v1/sdk/evaluate" \
  -H 'Content-Type: application/json' \
  -d '{
    "appId":"simulator-chatbot",
    "sessionId":"qs_session_001",
    "turnId":"qs_turn_001",
    "query":"Recommend running shoes for rainy days",
    "answerText":"Consider grip and waterproof materials.",
    "intentScore":0.91,
    "locale":"en-US"
  }')

echo "$EVAL_RESP"
```

提取 `requestId`：

```bash
REQUEST_ID=$(echo "$EVAL_RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.requestId||"")})')
echo "$REQUEST_ID"
```

成功条件：

- `requestId` 非空
- `decision.result` 属于 `blocked|served|no_fill|error`

## 4. Events（事件回传）

将同一次请求的 `requestId` 回传到 `/api/v1/sdk/events`：

```bash
curl -sS -X POST "$MEDIATION_BASE_URL/api/v1/sdk/events" \
  -H 'Content-Type: application/json' \
  -d "{
    \"requestId\":\"$REQUEST_ID\",
    \"appId\":\"simulator-chatbot\",
    \"sessionId\":\"qs_session_001\",
    \"turnId\":\"qs_turn_001\",
    \"query\":\"Recommend running shoes for rainy days\",
    \"answerText\":\"Consider grip and waterproof materials.\",
    \"intentScore\":0.91,
    \"locale\":\"en-US\"
  }"
```

成功条件：响应包含 `{"ok":true}`。

## 5. Verify（链路验证）

查询决策日志：

```bash
curl -sS "$MEDIATION_BASE_URL/api/v1/dashboard/decisions?requestId=$REQUEST_ID"
```

查询事件日志：

```bash
curl -sS "$MEDIATION_BASE_URL/api/v1/dashboard/events?requestId=$REQUEST_ID"
```

首条链路通过判定：

- 决策日志中存在该 `requestId`
- 事件日志中存在 `eventType = sdk_event`

## 6. Smoke（文档验收命令）

建议用最小 E2E 用例做一次自动校验：

```bash
node --test ./projects/ad-aggregation-platform/tests/e2e/minimal-closed-loop.spec.js
```

如果测试通过，说明 init/evaluate/events/archive 的最小闭环可运行。

## 7. 常见自检

- 健康检查失败：确认 `dev:gateway` 进程还在运行，端口是否被占用。
- `requestId` 为空：检查 `appId/sessionId/turnId/query/answerText/intentScore/locale` 是否完整。
- 看不到 `sdk_event`：确认 events 请求中的 `requestId` 与 evaluate 返回值一致。
