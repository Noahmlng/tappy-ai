# Mediation API Reference (A/E/F/G/H)

- Version: v0.1
- Last Updated: 2026-02-21
- 说明：本文档只记录当前代码中已实现且可验证的接口合同。

## 1. 接口映射说明

- 已在网关直接挂载（可直接 HTTP 调用）
  - `POST /api/v1/sdk/evaluate`（A ingress + E delivery 输出）
  - `POST /api/v1/sdk/events`（SDK 兼容事件上报）
- 控制器已实现（建议挂载为生产路由；当前以控制器方法对接）
  - F: `handlePostEvents`（建议 `POST /api/v1/mediation/events`）
  - H: `handleGetConfig`（建议 `GET /api/v1/mediation/config`）
  - H: `handlePostConfigPublish`（建议 `POST /api/v1/mediation/config/publish`）
  - G: `handleAppend`（建议 `POST /api/v1/mediation/audit/append`）
  - G: `handleReplay`（建议 `POST /api/v1/mediation/audit/replay`）

## 2. A/E - POST /api/v1/sdk/evaluate

### 请求（Attach MVP 形态）

```json
{
  "appId": "simulator-chatbot",
  "sessionId": "sess_001",
  "turnId": "turn_001",
  "query": "Recommend running shoes",
  "answerText": "Focus on grip.",
  "intentScore": 0.9,
  "locale": "en-US",
  "requestId": "optional"
}
```

必填字段：`appId, sessionId, turnId, query, answerText, intentScore, locale`。

### 请求（Next-Step Intent Card 形态）

```json
{
  "appId": "simulator-chatbot",
  "sessionId": "sess_002",
  "turnId": "turn_002",
  "userId": "user_001",
  "event": "followup_generation",
  "placementId": "chat_followup_v1",
  "placementKey": "next_step.intent_card",
  "context": {
    "query": "Need a gift suggestion",
    "answerText": "Try something practical.",
    "locale": "en-US",
    "intent_class": "gifting",
    "intent_score": 0.88,
    "preference_facets": [
      { "facet_key": "recipient", "facet_value": "girlfriend", "confidence": 0.9 }
    ]
  }
}
```

### 成功响应（Attach MVP）

```json
{
  "requestId": "adreq_...",
  "placementId": "chat_inline_v1",
  "decision": {
    "result": "blocked|served|no_fill|error",
    "reason": "blocked|served|no_fill|error",
    "reasonDetail": "placement_disabled",
    "intentScore": 0.9
  },
  "ads": []
}
```

### 成功响应（Next-Step）

```json
{
  "requestId": "adreq_...",
  "placementId": "chat_followup_v1",
  "placementKey": "next_step.intent_card",
  "decision": {
    "result": "blocked|served|no_fill|error",
    "reason": "blocked|served|no_fill|error",
    "reasonDetail": "...",
    "intent_score": 0.86
  },
  "intent_inference": {
    "intent_class": "gifting",
    "intent_score": 0.86,
    "preference_facets": []
  },
  "ads": [],
  "meta": {
    "selected_count": 0,
    "model_version": "...",
    "inference_fallback": false,
    "inference_fallback_reason": ""
  }
}
```

### 错误码

- `400`：`error.code = INVALID_REQUEST`
- `500`：`error.code = INTERNAL_ERROR`
- `decision.reasonDetail` 常见值：
  - `placement_not_configured`
  - `placement_disabled`
  - `blocked_topic:<topic>`
  - `intent_below_threshold`
  - `intent_non_commercial`
  - `cooldown`
  - `frequency_cap_session`
  - `frequency_cap_user_day`
  - `revenue_below_min`
  - `runtime_pipeline_error`
  - `runtime_no_offer`
  - `runtime_eligible`

### 重试语义

- `400`：不要重试，先修正请求。
- `500`：可指数退避重试（建议 200ms 起，最多 3 次）。
- `200 + blocked/no_fill`：不是传输失败，不建议立即重试。

### 幂等约束

- 本接口当前不做幂等去重。
- `requestId` 为可选输入字段，不会触发服务端 dedup。

## 3. F (SDK兼容) - POST /api/v1/sdk/events

### 请求

- Attach MVP 形态：`evaluate` 请求体 + `requestId`。
- Next-Step 形态：`evaluate` Next-Step 请求体 + `requestId`（可选但建议传）。

### 成功响应

```json
{ "ok": true }
```

### 错误码

- `400`：`error.code = INVALID_REQUEST`
- `500`：`error.code = INTERNAL_ERROR`

### 重试语义

- `400`：不重试。
- `500`：可短退避重试。

### 幂等约束

- 该兼容接口当前只做事件落库，不做去重。
- 如需逐条 ACK + 幂等，使用下文 F 标准事件接口。

## 4. F (标准) - POST /api/v1/mediation/events

当前实现入口：`createEventsController().handlePostEvents(input)`。

### 请求

```json
{
  "batchId": "batch_001",
  "appId": "app_chat_main",
  "sdkVersion": "1.2.0",
  "sentAt": "2026-02-22T10:00:00.000Z",
  "schemaVersion": "schema_v1",
  "events": [
    {
      "eventId": "evt_001",
      "eventType": "impression",
      "eventAt": "2026-02-22T10:00:01.000Z",
      "traceKey": "trace_001",
      "requestKey": "req_001",
      "attemptKey": "att_001",
      "opportunityKey": "opp_001",
      "responseReference": "resp_001",
      "renderAttemptId": "render_001",
      "creativeId": "creative_001",
      "eventVersion": "f_evt_v1",
      "idempotencyKey": "optional"
    }
  ]
}
```

支持事件类型：
- `opportunity_created`, `auction_started`, `ad_filled`, `impression`, `click`, `interaction`, `postback`, `error`

### 成功响应

```json
{
  "batchId": "batch_001",
  "receivedAt": "2026-02-22T10:00:02.000Z",
  "overallStatus": "accepted_all|partial_success|rejected_all",
  "ackItems": [
    {
      "eventId": "evt_001",
      "eventIndex": 0,
      "ackStatus": "accepted|rejected|duplicate",
      "ackReasonCode": "f_event_accepted",
      "retryable": false,
      "serverEventKey": "f_dedup_v1:..."
    }
  ]
}
```

### 错误码

- 包络级失败（HTTP 400）：
  - `f_envelope_events_invalid`
  - `f_envelope_batch_id_invalid`
  - `f_envelope_schema_unsupported`
- 逐条 ACK 常见：
  - `f_event_accepted`
  - `f_event_missing_required`
  - `f_event_type_unsupported`
  - `f_event_time_invalid`
  - `f_event_seq_missing_required`
  - `f_event_seq_invalid`
  - `f_idempotency_key_invalid_fallback`
  - `f_event_id_invalid_no_fallback`
  - `f_event_id_global_uniqueness_unverified`
  - `f_dedup_committed_duplicate`
  - `f_dedup_payload_conflict`
  - `f_event_subenum_unknown_normalized`

### 重试语义

- HTTP 400（包络非法）：修复请求后再发。
- HTTP 200 + `ackItems[*].ackStatus = rejected`：按单条 `ackReasonCode` 修复后重发该条。
- `duplicate`：无需重发。

### 幂等约束

- 去重键优先级：`idempotencyKey` > `eventId` > 计算键。
- 同 dedup key 同 payload：返回 `duplicate`。
- 同 dedup key 不同 payload：`f_dedup_payload_conflict`。

## 5. H - GET /api/v1/mediation/config

当前实现入口：`createConfigController().handleGetConfig(input)`。

### 请求

- 必填：`appId, placementId, environment(prod|staging), schemaVersion, sdkVersion, requestAt`
- 可选：`ifNoneMatch`（或 `headers.if-none-match`）、`adapterVersionMapOrNA`、`expectedConfigVersionOrNA`、`traceKeyOrNA`

示例：

```json
{
  "appId": "app_chat_main",
  "placementId": "chat_inline_v1",
  "environment": "prod",
  "schemaVersion": "schema_v1",
  "sdkVersion": "2.0.0",
  "requestAt": "2026-02-22T10:00:00.000Z",
  "ifNoneMatch": "\"etag_value\""
}
```

### 成功响应

- `200`

```json
{
  "status": "ok",
  "configKey": "app|placement|env|schema",
  "etag": "...",
  "ttlSec": 60,
  "expireAt": "2026-02-22T10:01:00.000Z",
  "resolvedConfigSnapshot": { "...": "..." },
  "configVersionSnapshot": {
    "globalConfigVersion": "...",
    "appConfigVersionOrNA": "...",
    "placementSourceVersionOrNA": "...",
    "routingStrategyVersion": "...",
    "placementConfigVersion": "..."
  },
  "cacheDecision": "miss|revalidated_not_modified|revalidated_changed|stale_served",
  "reasonCodes": ["h_cfg_cache_miss"],
  "responseAt": "...",
  "getConfigContractVersion": "h_get_config_v1"
}
```

- `304`：`body = null`，并返回 `ETag`、`Cache-Control`。

### 错误码

- `400`
  - `h_cfg_missing_required_after_merge`
  - `h_cfg_invalid_range`
- `503`
  - `h_cfg_cache_expired_revalidate_failed`
- 缓存理由码（`reasonCodes`）：
  - `h_cfg_cache_hit_fresh`
  - `h_cfg_cache_miss`
  - `h_cfg_cache_revalidated_not_modified`
  - `h_cfg_cache_revalidated_changed`
  - `h_cfg_cache_stale_grace_served`
  - `h_cfg_cache_invalid_etag_format`

### 重试语义

- `400`：不重试，修正参数。
- `503`：可退避重试。
- `304`：客户端复用本地缓存。

### 幂等约束

- GET 语义天然幂等。
- 缓存协商使用 `ETag/If-None-Match`。

## 6. H - POST /api/v1/mediation/config/publish

当前实现入口：`createConfigPublishController().handlePostConfigPublish(input)`。

### 请求

```json
{
  "requestId": "req_pub_001",
  "operatorId": "operator_1",
  "authContextLite": {
    "actorId": "operator_1",
    "role": "config_admin",
    "authMethod": "token",
    "issuedAt": "2026-02-21T10:00:00.000Z",
    "expiresAt": "2026-02-23T12:00:00.000Z",
    "scopeBindings": {
      "allowedEnvironments": ["prod"],
      "allowedAppIdsOrWildcard": "*",
      "allowedPlacementIdsOrWildcard": "*"
    },
    "authContextVersion": "auth_v1"
  },
  "environment": "prod",
  "actionType": "publish|rollback",
  "targetScope": "global|app|placement",
  "targetKey": "app_chat_main|chat_inline_v1|prod",
  "changeSetId": "changeset_001",
  "baseVersionSnapshot": {
    "schemaVersion": "schema_v1",
    "routingStrategyVersion": "route_v1",
    "placementConfigVersion": "placement_v1"
  },
  "targetVersionSnapshot": {
    "schemaVersion": "schema_v1",
    "routingStrategyVersion": "route_v2",
    "placementConfigVersion": "placement_v2"
  },
  "rollbackToVersionSnapshot": {
    "schemaVersion": "schema_v1",
    "routingStrategyVersion": "route_v1",
    "placementConfigVersion": "placement_v1"
  },
  "publishAt": "2026-02-22T10:00:00.000Z",
  "publishContractVersion": "h_publish_v1",
  "publishIdempotencyKeyOrNA": "optional",
  "dryRun": false,
  "reason": "optional"
}
```

### 响应

```json
{
  "requestId": "req_pub_001",
  "changeSetId": "changeset_001",
  "actionType": "publish",
  "publishState": "published|rolled_back|validated|failed",
  "ackReasonCode": "h_publish_published",
  "retryable": false,
  "publishOperationId": "pubop_...",
  "responseAt": "...",
  "publishContractVersion": "h_publish_v1"
}
```

### 错误码

- `403`：`h_publish_auth_context_invalid|h_publish_auth_operator_mismatch|h_publish_authz_denied|h_publish_authz_denied_scope`
- `409`：`h_publish_base_version_conflict|h_publish_idempotency_payload_conflict`
- `404`：`h_publish_rollback_target_not_found`
- `400`：`h_publish_validation_failed|h_publish_compensation_triggered|h_publish_compensation_failed`
- 成功/幂等相关：
  - `h_publish_published`
  - `h_publish_rolled_back`
  - `h_publish_dry_run_validated`
  - `h_publish_duplicate_reused_operation`

### 重试语义

- 以返回体 `retryable` 为准。
- `retryable = true` 时可退避重试。
- `retryable = false` 时不要盲重试，需先修复冲突/权限/参数。

### 幂等约束

- 去重键：`publishIdempotencyKeyOrNA`；为空则服务端按请求核心字段计算。
- 默认 dedup 窗口：24h。
- 同键同 payload：复用同 `publishOperationId`，`ackReasonCode = h_publish_duplicate_reused_operation`。
- 同键不同 payload：`h_publish_idempotency_payload_conflict`（409）。

## 7. G - POST /api/v1/mediation/audit/append

当前实现入口：`createAppendController().handleAppend(input)`。

### 请求

```json
{
  "requestId": "append_req_001",
  "appendAt": "2026-02-22T10:00:01.000Z",
  "appendContractVersion": "g_append_v1",
  "idempotencyKey": "optional",
  "processingMode": "sync",
  "forceSync": true,
  "auditRecord": {
    "auditRecordId": "audit_001",
    "opportunityKey": "opp_001",
    "traceKey": "trace_001",
    "requestKey": "req_001",
    "attemptKey": "att_001",
    "responseReferenceOrNA": "resp_001",
    "auditAt": "2026-02-22T10:00:00.900Z",
    "opportunityInputSnapshot": { "...": "..." },
    "adapterParticipation": [{ "...": "..." }],
    "winnerSnapshot": { "...": "..." },
    "renderResultSnapshot": { "...": "..." },
    "keyEventSummary": { "...": "..." },
    "auditRecordVersion": "g_audit_record_v1",
    "auditRuleVersion": "g_audit_rule_v1",
    "auditContractVersion": "g_audit_contract_v1"
  }
}
```

`auditRecord` 结构必须完整（见 `/src/mediation/g/audit-store.js` 的 `validateAuditRecordStructure`）。

### 响应

```json
{
  "requestId": "append_req_001",
  "ackStatus": "accepted|queued|rejected",
  "ackReasonCode": "g_append_accepted_committed",
  "retryable": false,
  "ackAt": "2026-02-22T10:00:00.000Z",
  "appendToken": "g_app_..."
}
```

### 状态码与错误码

- `200`：`accepted` 或 duplicate no-op
- `202`：`queued`
- `400`：`g_append_missing_required|g_append_invalid_schema_version`
- `401`：`g_append_auth_failed`
- `409`：`g_append_payload_conflict`
- `413`：`g_append_payload_too_large`
- `429`：`g_append_rate_limited`
- `503`：`g_append_internal_unavailable`

### 重试语义

- 按 `retryable` 字段执行。
- `payload_conflict`、`invalid_schema_version`、`auth_failed` 为不可重试。

### 幂等约束

- 去重键优先级：`idempotencyKey` > `auditRecordId`。
- 同键同 payload：`g_append_duplicate_accepted_noop`。
- 同键不同 payload：`g_append_payload_conflict`。

## 8. G - POST /api/v1/mediation/audit/replay

当前实现入口：`createReplayController().handleReplay(input)`。

### 请求

```json
{
  "queryMode": "by_opportunity|by_time_range",
  "outputMode": "summary|full",
  "opportunityKey": "opp_001",
  "timeRange": {
    "startAt": "2026-02-22T10:00:00.000Z",
    "endAt": "2026-02-22T10:04:00.000Z"
  },
  "pagination": {
    "pageSize": 10,
    "pageTokenOrNA": "NA"
  },
  "sort": {
    "sortBy": "auditAt|outputAt|eventAt",
    "sortOrder": "asc|desc"
  },
  "replayContractVersion": "g_replay_v1",
  "replayAsOfAt": "2026-02-22T10:05:00.000Z",
  "replayExecutionMode": "snapshot_replay|rule_recompute",
  "pinnedVersions": {
    "schemaVersion": "schema_v1",
    "mappingRuleVersion": "b_mapping_rule_v2",
    "routingPolicyVersion": "d_routing_policy_v3",
    "policyRuleVersion": "c_policy_rule_v2",
    "deliveryRuleVersion": "e_delivery_rule_v4",
    "eventContractVersion": "f_event_contract_v2",
    "dedupFingerprintVersion": "f_dedup_v2"
  }
}
```

### 成功响应

- `200`，核心字段：
  - `queryEcho`
  - `resultMeta`（`totalMatched/returnedCount/hasMore/replayExecutionMode/determinismStatus/...`）
  - `items`
  - `emptyResult`
  - `replayDiffSummaryLite`（`rule_recompute` 时）

### 错误码

- `400`：
  - `g_replay_missing_required`
  - `g_replay_invalid_query_mode`
  - `g_replay_invalid_output_mode`
  - `g_replay_invalid_time_range`
  - `g_replay_invalid_as_of_time`
  - `g_replay_invalid_cursor`
  - `g_replay_invalid_sort`
  - `g_replay_invalid_pagination`
  - `g_replay_invalid_contract_version`
  - `g_replay_missing_version_anchor`
- `409`：
  - `g_replay_opportunity_alias_conflict`
  - `g_replay_version_anchor_conflict`

### 重试语义

- 参数类错误先修请求再调用。
- `409` 先修别名冲突或版本锚点冲突后再调用。

### 幂等约束

- 只读查询接口，不需要幂等键。
- 同请求 + 同 `replayAsOfAt` 预期确定性一致（`determinismStatus=deterministic`）。

## 9. 抽样调用记录（对照实现）

已执行抽样并返回成功：

- `/api/v1/sdk/evaluate`：返回 `requestId + decision + ads`
- `/api/v1/sdk/events`：返回 `{ "ok": true }`
- `handleGetConfig`：返回 `200 + etag + resolvedConfigSnapshot`
- `handlePostConfigPublish`：返回 `published`
- `handleAppend`：返回 `accepted + appendToken`
- `handleReplay`：返回 `200 + resultMeta/emptyResult`
