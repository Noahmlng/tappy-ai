# 02 - Quickstart (Production API Path)

- Owner: Integrations Team
- Last Updated: 2026-02-22
- Scope: external developer / staging -> prod

## 1. Objective

在 15 分钟内跑通：`config -> evaluate -> events`。

## 2. Prerequisites

1. `MEDIATION_API_BASE_URL`
2. `MEDIATION_API_KEY`
3. `APP_ID`
4. `PLACEMENT_ID`

## 3. Run First Call

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/evaluate" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "appId":"<app_id>",
    "sessionId":"quickstart_session_001",
    "turnId":"quickstart_turn_001",
    "query":"Recommend running shoes",
    "answerText":"Focus on grip.",
    "intentScore":0.9,
    "locale":"en-US"
  }'
```

Expected:

1. `requestId` 非空
2. `decision.result` 存在

## 4. Report Event

```bash
curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"<request_id>",
    "appId":"<app_id>",
    "sessionId":"quickstart_session_001",
    "turnId":"quickstart_turn_001",
    "query":"Recommend running shoes",
    "answerText":"Focus on grip.",
    "intentScore":0.9,
    "locale":"en-US"
  }'
```

Expected:

1. `{ "ok": true }`

## 5. Pass Criteria

- [ ] `evaluate` 成功返回 requestId
- [ ] `events` 成功 ack
- [ ] 失败不阻塞主业务路径（fail-open）
