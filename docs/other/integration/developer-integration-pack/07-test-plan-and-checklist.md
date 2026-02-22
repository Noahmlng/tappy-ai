# 07 - Integration Test Plan and Checklist

- Owner: QA + Integrations
- Last Updated: 2026-02-22
- Scope: external production-style API integration

## 1. Test Scope

1. Functional: `config/evaluate/events` 主链路
2. Reliability: 超时、重试、降级（fail-open）
3. Data Quality: `requestId` 追踪一致性、事件对齐
4. Security: 鉴权、重放、最小权限

## 2. P0 Cases (Must Pass)

| ID | Priority | Scenario | Expected | Evidence |
| --- | --- | --- | --- | --- |
| P0-01 | P0 | evaluate 基本成功 | 返回 requestId，decision.result 合法 | 响应 JSON |
| P0-02 | P0 | events 基本成功 | 返回 `{ "ok": true }` | 响应 JSON |
| P0-03 | P0 | evaluate 4xx | 客户端不盲重试，能报错 | 客户端日志 |
| P0-04 | P0 | evaluate 5xx/超时 | 按退避重试，且主流程 fail-open | 业务日志 + trace |
| P0-05 | P0 | blocked/no_fill | 不误判为传输失败重试 | 客户端日志 |
| P0-06 | P0 | requestId 贯通 | evaluate 与 events 关联一致 | requestId 样本表 |

## 3. P1 Cases (Recommended)

| ID | Priority | Scenario | Expected | Evidence |
| --- | --- | --- | --- | --- |
| P1-01 | P1 | Next-Step payload | 返回 next_step 合同结构 | 响应 JSON |
| P1-02 | P1 | 高频请求压测 | 错误率与延迟在阈值内 | 压测报告 |
| P1-03 | P1 | 重放事件 | 幂等策略生效，无重复计费风险 | 事件去重日志 |
| P1-04 | P1 | 鉴权失效 | 401/403 且无脏数据写入 | API 响应 + 审计 |

## 4. Suggested Validation Commands

```bash
# health / config
curl -sS "$MEDIATION_API_BASE_URL/api/v1/mediation/config?appId=<app_id>&placementId=<placement_id>&environment=staging&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z" \
  -H "Authorization: Bearer $MEDIATION_API_KEY"

# evaluate
curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/evaluate" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"appId":"<app_id>","sessionId":"t1","turnId":"1","query":"q","answerText":"a","intentScore":0.8,"locale":"en-US"}'

# events
curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/events" \
  -H "Authorization: Bearer $MEDIATION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"<request_id>","appId":"<app_id>","sessionId":"t1","turnId":"1","query":"q","answerText":"a","intentScore":0.8,"locale":"en-US"}'
```

## 5. Exit Criteria

- [ ] P0 全通过
- [ ] P1 通过率 >= 95%
- [ ] 无 Sev-1/Sev-2 未关闭问题
- [ ] 已完成一次灰度前回滚演练
