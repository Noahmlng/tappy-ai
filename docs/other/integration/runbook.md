# Mediation Runbook 与排障手册

- Version: v0.1
- Last Updated: 2026-02-21
- Scope: 接入方运行 `evaluate/events/config/replay` 时的常见故障闭环排查。

## 0. 统一分诊入口

先准备环境变量：

```bash
export MEDIATION_BASE_URL="http://127.0.0.1:3100"
export APP_ID="simulator-chatbot"
export PLACEMENT_ID="chat_inline_v1"
```

基础连通性：

```bash
curl -sS "$MEDIATION_BASE_URL/api/health"
```

如果健康检查失败，先确认：

```bash
npm --prefix ./projects/ad-aggregation-platform run dev:gateway
```

---

## 1. 故障卡片：`no_fill` 比例升高

### 现象

- `POST /api/v1/sdk/evaluate` 大量返回 `decision.result = no_fill`。
- 业务层点击率下降，但没有明显 `error`。

### 可能原因

- D 路由阶段无可用 source（例如 allowlist/blockedSourceIds 冲突）。
- 上游 adapter 健康度下降导致候选为空。
- E 阶段渲染门禁触发降级，最终落到 `no_fill`。

### 检查步骤

1. 抽样一次 evaluate，记录 `requestId` 与 `decision.reasonDetail`。

```bash
curl -sS -X POST "$MEDIATION_BASE_URL/api/v1/sdk/evaluate" \
  -H 'Content-Type: application/json' \
  -d '{
    "appId":"simulator-chatbot",
    "sessionId":"rb_nf_001",
    "turnId":"rb_nf_001",
    "query":"recommend shoes",
    "answerText":"need waterproof options",
    "intentScore":0.9,
    "locale":"en-US"
  }'
```

2. 检查近 15 分钟 `no_fill` 日志。

```bash
curl -sS "$MEDIATION_BASE_URL/api/v1/dashboard/decisions?result=no_fill&placementId=$PLACEMENT_ID"
```

3. 跑模块回归，确认是 D/E 逻辑还是接入参数问题。

```bash
npm --prefix ./projects/ad-aggregation-platform run test:integration -- d-route-plan
npm --prefix ./projects/ad-aggregation-platform run test:integration -- e-output
```

### 修复动作

- 若 `reasonDetail` 指向路由无候选：修正 placement 的 source allow/deny 配置。
- 若 adapter 健康度异常：恢复对应 adapter 或启用 fallback source。
- 若渲染门禁过严：按配置治理流程降低 gate 严格度并保留审计记录。

### 验证方式

- 连续 20+ 次 evaluate 抽样中，`no_fill` 比例回到预期区间。
- `d-route-plan`、`e-output` 集成测试通过。
- 决策日志中 `no_fill` 的 `reasonDetail` 分布符合预期（不再集中于单一异常码）。

---

## 2. 故障卡片：`blocked` 比例异常升高

### 现象

- evaluate 返回 `decision.result = blocked` 明显增加。
- 常见 `reasonDetail` 包括 `blocked_topic:*`、`intent_below_threshold`、`intent_non_commercial`。

### 可能原因

- C 策略门禁规则变更后更严格（话题/合规/同意域）。
- placement 阈值或策略配置发布后未按预期生效。
- 上游请求信号质量下降（intent score/上下文缺失）。

### 检查步骤

1. 拉取 blocked 样本并统计 `reasonDetail`。

```bash
curl -sS "$MEDIATION_BASE_URL/api/v1/dashboard/decisions?result=blocked&placementId=$PLACEMENT_ID" > /tmp/blocked.json
node -e 'const fs=require("node:fs");const j=JSON.parse(fs.readFileSync("/tmp/blocked.json","utf8"));const items=j.items||[];const c={};for(const x of items){const k=x.reasonDetail||"NA";c[k]=(c[k]||0)+1;}console.log(c)'
```

2. 运行策略短路与输出合同测试。

```bash
npm --prefix ./projects/ad-aggregation-platform run test:integration -- c-short-circuit
npm --prefix ./projects/ad-aggregation-platform run test:contracts -- c-output
```

3. 如怀疑配置发布导致，联动检查 H 发布记录与版本。

```bash
npm --prefix ./projects/ad-aggregation-platform run test:integration -- h-publish
```

### 修复动作

- 若为 `blocked_topic:*`：校准策略中的敏感类目配置，避免误伤正常流量。
- 若为 `intent_below_threshold`：按 placement 调整阈值，避免与目标流量特征错配。
- 若为同意域阻断：修正 SDK 上传的 consent/上下文字段。

### 验证方式

- blocked 分布恢复到预期结构（单一异常 reasonDetail 不再占主导）。
- `c-short-circuit` 与 `c-output` 均通过。
- 业务关键 placement 的 served/no_fill/blocked 结构恢复稳定。

---

## 3. 故障卡片：回放结果不一致（Replay Determinism）

### 现象

- 同一 `opportunityKey`、同一 `replayAsOfAt` 回放结果不一致。
- `determinismStatus = non_deterministic` 或 diff 状态为 `diverged`。

### 可能原因

- 查询参数漂移（尤其 cursor 与 `replayAsOfAt` 不一致）。
- 回放记录缺失版本锚点，触发 `g_replay_missing_version_anchor`。
- `rule_recompute` 的 pinned versions 与记录锚点冲突。

### 检查步骤

1. 先跑 replay 确定性 E2E。

```bash
npm --prefix ./projects/ad-aggregation-platform run test:e2e -- g-replay-determinism
```

2. 若接了标准 replay API，复现同查询两次并对比输出。

```bash
cat <<'JSON' >/tmp/replay-query.json
{
  "queryMode": "by_opportunity",
  "outputMode": "summary",
  "opportunityKey": "opp_replay_001",
  "pagination": { "pageSize": 10, "pageTokenOrNA": "NA" },
  "sort": { "sortBy": "auditAt", "sortOrder": "desc" },
  "replayContractVersion": "g_replay_v1",
  "replayAsOfAt": "2026-02-22T12:00:00.000Z",
  "replayExecutionMode": "snapshot_replay"
}
JSON

curl -sS -X POST "$MEDIATION_BASE_URL/api/v1/mediation/audit/replay" -H 'Content-Type: application/json' -d @/tmp/replay-query.json > /tmp/replay-1.json
curl -sS -X POST "$MEDIATION_BASE_URL/api/v1/mediation/audit/replay" -H 'Content-Type: application/json' -d @/tmp/replay-query.json > /tmp/replay-2.json
node -e 'const fs=require("node:fs");const a=fs.readFileSync("/tmp/replay-1.json","utf8");const b=fs.readFileSync("/tmp/replay-2.json","utf8");console.log(a===b?"IDENTICAL":"DIFF")'
```

3. 排查是否出现以下原因码：
- `g_replay_invalid_cursor`
- `g_replay_missing_version_anchor`
- `g_replay_version_anchor_conflict`

### 修复动作

- 固定 `replayAsOfAt`，分页时复用返回 cursor，禁止客户端重算 cursor。
- 补齐 append 入库记录的版本锚点字段（schema/mapping/routing/policy/delivery/event/dedup）。
- 规则重算时使用与生产一致的 pinned versions 或切回 `snapshot_replay` 做紧急止血。

### 验证方式

- 同查询重复执行结果 byte-level 一致。
- `g-replay-determinism` 测试通过。
- diff summary 中 `fieldDiffCount = 0` 且 determinism 为 `deterministic`。

---

## 4. 故障卡片：配置发布失败（H Publish）

### 现象

- `POST /api/v1/mediation/config/publish` 返回 `publishState = failed`。
- 常见状态码：`400/403/404/409`。

### 可能原因

- 权限问题：`h_publish_auth_*`。
- 版本冲突：`h_publish_base_version_conflict`。
- 幂等键冲突：`h_publish_idempotency_payload_conflict`。
- 回滚目标不存在：`h_publish_rollback_target_not_found`。

### 检查步骤

1. 先跑 H 发布集成用例确认系统行为。

```bash
npm --prefix ./projects/ad-aggregation-platform run test:integration -- h-publish
```

2. 对照返回体重点看：
- `publishState`
- `ackReasonCode`
- `retryable`
- `publishOperationId`

3. 若为幂等冲突，核对同 `publishIdempotencyKeyOrNA` 的 payload 是否完全一致。

### 修复动作

- `403` 类：修正 `authContextLite`（actor/role/scopeBindings）并确保 `operatorId` 对齐。
- `409` 基线冲突：刷新最新 `baseVersionSnapshot` 后重新发布。
- `409` 幂等 payload 冲突：同键必须同 payload；若 payload 变更请换新幂等键。
- `404` 回滚目标不存在：先确认目标版本确实已发布并可回滚。

### 验证方式

- 再次发布返回 `publishState = published|rolled_back`。
- 预期幂等重放时返回 `h_publish_duplicate_reused_operation`。
- `h-publish` 集成测试通过。

---

## 5. 发布前总体验证（建议）

```bash
npm --prefix ./projects/ad-aggregation-platform run test:functional:p0
npm --prefix ./projects/ad-aggregation-platform run test:e2e
```

判定标准：

- P0 matrix = 100%
- E2E = 100%
- 关键故障卡片（本手册 1~4）均可复现、可修复、可验证。
