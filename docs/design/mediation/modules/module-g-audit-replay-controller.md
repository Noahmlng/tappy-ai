### 3.9 Module G: Audit & Replay Controller

#### 3.9.1 审计单元

最小审计单元固定为“单机会对象”，必须贯穿全生命周期。

#### 3.9.2 四段关键决策点（冻结）

1. `Mapping`
2. `Routing`
3. `Delivery`
4. `Event`

每段最小字段：
1. 决策类型
2. 时间戳与耗时
3. 输入摘要与输出摘要
4. 状态与原因码
5. 规则版本
6. 关联键（trace key + `responseReference`）

#### 3.9.3 回放基线

1. 支持按 `responseReference` 或 trace key 回放单请求全链路。
2. 回放覆盖 `Request -> Mapping -> Routing -> Delivery -> Event -> Archive`。
3. 审计写入失败不得阻塞主链路，走异步补偿。

#### 3.9.4 F -> G 输入合同（P0，MVP 冻结）

G 层标准输入对象：
1. `fToGArchiveRecordLite`（定义见 `3.8.26`）。

required（G 接收门槛）：
1. `recordKey`
2. `recordType`
3. `recordStatus`
4. `payloadRef`
5. `sourceKeys`
6. `relationKeys`
7. `versionAnchors`
8. `decisionReasonCode`
9. `outputAt`

接收规则：
1. 缺少任一 required -> 进入隔离轨道，标记 `g_ingest_invalid_record`。
2. 同 `recordKey` 重复输入 -> 幂等接受，不重复写业务事实。
3. `recordStatus=committed` 的 `billable_fact` 才可进入结算下游视图。

#### 3.9.5 Archive 写入与状态对齐（P0）

1. G 对每条记录维护 `archiveWriteStatus`（冻结）：
   - `pending`（已接收，待写入）
   - `writing`（正在执行写入）
   - `written`（写入成功）
   - `write_failed_retryable`（可重试失败）
   - `write_failed_terminal`（不可恢复失败）
2. `recordKey` 幂等写入语义（冻结）：
   - 主索引为 `recordKey`，并保存 `payloadDigest`。
   - 同 `recordKey + payloadDigest` 重放 -> 幂等 no-op，返回已写结果，不新增记录。
   - 同 `recordKey` 但 `payloadDigest` 不一致 -> 拒绝覆盖，标记 `g_archive_recordkey_payload_conflict`。
3. 写入顺序（冻结）：
   - 同一 `closureKeyOrNA + traceKey` 分组内，G 必须先确认 `decision_audit` 达到 `written`，再允许 `billable_fact/attribution_fact` 写入。
   - 若事实记录先到，则进入 `pending` 等待前置审计，原因码 `g_archive_waiting_decision_audit`。
   - 同级写入按 `outputAt` 升序，冲突时按 `recordKey` 字典序稳定裁决。
4. 部分失败补偿（冻结）：
   - `write_failed_retryable` 进入异步补偿队列，重试键固定为 `recordKey`。
   - 与 F 对齐的最小可重试原因码：`g_archive_write_timeout/g_archive_temporarily_unavailable/g_archive_rate_limited`。
   - 重试超过 `15m` 或命中不可重试错误，转 `write_failed_terminal`，并输出 `g_archive_compensation_exhausted`。
5. `recordStatus` 与 `archiveWriteStatus` 组合约束（冻结）：
   - `recordStatus=committed` -> `archiveWriteStatus` 最终必须为 `written` 或 `write_failed_terminal`。
   - `recordStatus in {duplicate,conflicted,rejected,superseded}` -> 必须至少写入审计轨，最终应达 `written` 或 `write_failed_terminal`。
   - `recordStatus=new` -> 只允许 `pending/writing/write_failed_retryable`。
6. 闭环聚合最终一致状态（`fgArchiveConsistencyState`，冻结）：
   - `consistent_committed`：应写记录全部 `written`，且包含 `decision_audit`。
   - `consistent_non_billable`：仅审计轨写入成功，无有效计费事实。
   - `partial_pending`：存在 `pending/writing/write_failed_retryable` 且仍在补偿窗口。
   - `partial_timeout`：存在 `write_failed_terminal` 或补偿窗口耗尽未收敛。

#### 3.9.6 MVP 验收基线（G 接收 F 输出）

1. G 能稳定消费 `fToGArchiveRecordLite`，不依赖隐式字段推断。
2. 同 `recordKey` 重放不会导致重复归档或重复结算。
3. F 输出的状态、版本锚点、关联键在 G/Archive 侧完整保留。
4. 写入顺序始终满足 `decision_audit` 在前、事实记录在后，且可稳定回放。
5. 部分失败可通过同 `recordKey` 补偿收敛；超过窗口进入 `partial_timeout`。
6. 任一归档失败可通过 `recordKey + archiveWriteStatus + traceKey` 分钟级定位。

#### 3.9.7 append(AuditRecord) 接口合同（P0，MVP 冻结）

接口定义：
1. `append(AuditRecord)`
2. 语义：异步写入审计日志，不阻塞主链路。
3. 返回：异步 ACK（`accepted` / `queued` / `rejected`）。

请求对象：`gAppendRequestLite`

required：
1. `requestId`
2. `auditRecord`
3. `appendAt`
4. `appendContractVersion`

optional：
1. `idempotencyKey`
2. `extensions`

#### 3.9.8 AuditRecord 请求体合同（P0，MVP 冻结）

`auditRecord`（`gAuditRecordLite`）required：
1. `auditRecordId`
2. `opportunityKey`
3. `traceKey`
4. `requestKey`
5. `attemptKey`
6. `responseReferenceOrNA`
7. `auditAt`
8. `opportunityInputSnapshot`
   - `requestSchemaVersion`
   - `placementKey`
   - `placementType`
   - `placementSurface`
   - `policyContextDigest`
   - `userContextDigest`
   - `opportunityContextDigest`
   - `ingressReceivedAt`
9. `adapterParticipation[]`
   - `adapterId`
   - `adapterRequestId`
   - `requestSentAt`
   - `responseReceivedAtOrNA`
   - `responseStatus`（`responded` / `timeout` / `error` / `no_bid`）
   - `responseLatencyMsOrNA`
   - `timeoutThresholdMs`
   - `didTimeout`
   - `responseCodeOrNA`
   - `candidateReceivedCount`
   - `candidateAcceptedCount`
   - `filterReasonCodes[]`
10. `winnerSnapshot`
    - `winnerAdapterIdOrNA`
    - `winnerCandidateRefOrNA`
    - `winnerBidPriceOrNA`
    - `winnerCurrencyOrNA`
    - `winnerReasonCode`
    - `winnerSelectedAtOrNA`
11. `renderResultSnapshot`
    - `renderStatus`（`rendered` / `failed` / `not_rendered`）
    - `renderAttemptIdOrNA`
    - `renderStartAtOrNA`
    - `renderEndAtOrNA`
    - `renderLatencyMsOrNA`
    - `renderReasonCodeOrNA`
12. `keyEventSummary`
    - `eventWindowStartAt`
    - `eventWindowEndAt`
    - `impressionCount`
    - `clickCount`
    - `failureCount`
    - `interactionCount`
    - `postbackCount`
    - `terminalEventTypeOrNA`
    - `terminalEventAtOrNA`
13. `auditRecordVersion`
14. `auditRuleVersion`
15. `auditContractVersion`

optional：
1. `closureKeyOrNA`
2. `billingKeyOrNA`
3. `attributionKeyOrNA`
4. `timeRangeTag`
5. `extensions`

结构一致性约束（MVP）：
1. `responseStatus=responded` 时，`responseReceivedAtOrNA` 与 `responseLatencyMsOrNA` 必须存在。
2. `responseStatus=timeout` 时，`didTimeout=true` 且 `timeoutThresholdMs > 0`。
3. `winnerAdapterIdOrNA` 非空时，必须能在 `adapterParticipation[].adapterId` 中找到对应项。
4. `renderStatus in {rendered, failed}` 时，`renderAttemptIdOrNA` 必须存在。
5. `terminalEventTypeOrNA` 非空时，`terminalEventAtOrNA` 必须存在。

#### 3.9.9 幂等键与去重规则（append，P0）

幂等键优先级（高 -> 低）：
1. `idempotencyKey`（请求层）
2. `auditRecord.auditRecordId`
3. `computedAppendKeyV2 = sha256(opportunityKey + \"|\" + traceKey + \"|\" + auditRecordId + \"|\" + auditRecordVersion + \"|\" + payloadDigest)`

`payloadDigest` 计算规则（冻结）：
1. 取 `auditRecord` 的 canonical 序列化结果计算 `sha256`。
2. 计算前必须移除传输态字段（如 `appendAt/requestId/idempotencyKey/extensions`），保证同事实重试键稳定。

去重窗口：
1. `appendDedupWindow = 7d`

去重结果：
1. 窗口内同键重复 -> ACK `accepted`，`ackReasonCode=g_append_duplicate_accepted_noop`（幂等成功，不重复写入）。
2. 同键但 payload 摘要冲突 -> ACK `rejected`，`ackReasonCode=g_append_payload_conflict`。

#### 3.9.10 异步 ACK 语义（P0，MVP 冻结）

ACK 对象：`gAppendAckLite`

required：
1. `requestId`
2. `ackStatus`（`accepted` / `queued` / `rejected`）
3. `ackReasonCode`
4. `retryable`（`true` / `false`）
5. `ackAt`

optional：
1. `appendToken`

语义：
1. `accepted`：G 已完成基本校验并确认幂等写入（包含幂等 no-op）。
2. `queued`：G 已接收并排队异步持久化，最终结果由内部写入状态机追踪。
3. `rejected`：请求未进入标准写入轨道。

状态约束：
1. `accepted/queued` 必须返回 `appendToken`。
2. `rejected` 必须返回可定位 `ackReasonCode`。

#### 3.9.11 失败可重试原因码（P0，MVP 冻结）

`rejected` 原因码（最小集）：
1. `g_append_missing_required`：`retryable=true`
2. `g_append_invalid_schema_version`：`retryable=false`
3. `g_append_payload_too_large`：`retryable=true`
4. `g_append_payload_conflict`：`retryable=false`
5. `g_append_rate_limited`：`retryable=true`
6. `g_append_internal_unavailable`：`retryable=true`
7. `g_append_auth_failed`：`retryable=false`

`queued` 原因码（最小集）：
1. `g_append_async_buffered`
2. `g_append_async_retry_scheduled`

#### 3.9.12 MVP 验收基线（append 接口合同）

1. `append(AuditRecord)` 在同请求同版本下返回确定性 ACK 语义。
2. F 重试同一请求不会导致重复审计写入或语义分叉。
3. `accepted/queued/rejected` 与 `retryable` 组合可直接驱动调用方重试策略。
4. 任一拒绝都可通过 `requestId + ackReasonCode + appendTokenOrNA` 分钟级定位。

#### 3.9.13 MVP 验收基线（AuditRecord 标准结构）

1. 单条 `gAuditRecordLite` 可独立复原：机会输入、adapter 过程、winner 决策、渲染结果、关键事件摘要。
2. 任一 adapter 的响应/延迟/超时/过滤原因都可在结构中定位，不依赖额外日志。
3. winner 与 adapter 列表、render 结果、终态事件在同记录内交叉一致。
4. 任一 dispute 可通过 `auditRecordId + traceKey + responseReferenceOrNA` 分钟级提取证据链。

#### 3.9.14 replay(opportunity_key | time_range) 接口合同（P0，MVP 冻结）

接口定义：
1. `replay(opportunity_key | time_range)`
2. 语义：按机会或时间范围回放审计事实，用于 debug、争议对账、模型训练抽样。
3. 输入方式：二选一（`opportunity_key` 模式或 `time_range` 模式）。

请求对象：`gReplayQueryLite`

required（全局）：
1. `queryMode`（`by_opportunity` / `by_time_range`）
2. `outputMode`（`summary` / `full`）
3. `pagination`
4. `sort`
5. `replayContractVersion`

模式 required：
1. `queryMode=by_opportunity`：
   - `opportunityKey`
2. `queryMode=by_time_range`：
   - `timeRange.startAt`
   - `timeRange.endAt`

optional：
1. `filters`
2. `includeRawPayload`
3. `cursor`
4. `replayAsOfAt`（可选；未提供时默认服务端接收该回放请求时刻）
5. `opportunityId`（兼容 alias，仅 `queryMode=by_opportunity` 可用）
6. `extensions`

`opportunityId` alias 兼容规则（P0，MVP 冻结）：
1. 主键统一为 `opportunityKey`，`opportunityId` 仅作兼容输入 alias，不作为新实现主字段。
2. 当同时提供 `opportunityKey + opportunityId` 时，服务端必须先归一并校验同一性。
3. 若同一性校验失败，拒绝请求并返回 `g_replay_opportunity_alias_conflict`。

#### 3.9.15 查询参数与过滤器（P0，MVP 冻结）

`filters` 可选字段：
1. `traceKey`
2. `requestKey`
3. `attemptKey`
4. `responseReference`
5. `adapterIdIn[]`
6. `recordTypeIn[]`（`billable_fact` / `attribution_fact` / `decision_audit`）
7. `recordStatusIn[]`（`new` / `committed` / `duplicate` / `conflicted` / `rejected` / `superseded`）
8. `hasTimeoutOnly`（`true/false`）
9. `hasConflictOnly`（`true/false`）

过滤约束：
1. `queryMode=by_opportunity` 时，`timeRange` 不允许出现。
2. `queryMode=by_time_range` 时，`opportunityKey/opportunityId` 都不允许出现。
3. `timeRange.endAt` 必须 `>= timeRange.startAt`。
4. `timeRange` 最大跨度：`7d`（超出拒绝）。
5. `replayAsOfAt` 若提供，必须 `<= requestReceivedAt`，否则拒绝（`g_replay_invalid_as_of_time`）。

#### 3.9.16 输出模式合同（summary/full，P0，MVP 冻结）

响应对象：`gReplayResultLite`

required：
1. `queryEcho`
2. `resultMeta`
   - `totalMatched`
   - `returnedCount`
   - `hasMore`
   - `nextCursorOrNA`
   - `replayRunId`
   - `replayExecutionMode`（`snapshot_replay` / `rule_recompute`）
   - `determinismStatus`（`deterministic` / `non_deterministic` / `not_comparable`）
   - `snapshotCutoffAt`（本次回放冻结点，等于解析后的 `replayAsOfAt`）
3. `items[]`
4. `emptyResult`
5. `generatedAt`

`queryEcho` 确定性回显要求（冻结）：
1. 必须包含 `resolvedReplayAsOfAt`（若请求缺省，则为服务端接收时刻）。
2. 翻页请求中 `resolvedReplayAsOfAt` 必须保持不变。

`outputMode=summary`：
1. 每条 `item` 最小字段：
   - `opportunityKey`
   - `traceKey`
   - `responseReferenceOrNA`
   - `terminalStatus`
   - `winnerAdapterIdOrNA`
   - `keyReasonCodes[]`
   - `recordCountByType`
2. 不返回完整快照 payload。

`outputMode=full`：
1. 每条 `item` 包含：
   - `gAuditRecordLite`
   - `fToGArchiveRecordLite[]`
   - `factDecisionAuditLite[]`
2. `includeRawPayload=true` 时才返回 raw payload（受权限与脱敏策略约束）。

#### 3.9.17 分页与排序规则（P0，MVP 冻结）

`pagination` required：
1. `pageSize`（`1..200`）
2. `pageTokenOrNA`

`sort` required：
1. `sortBy`（`auditAt` / `outputAt` / `eventAt`）
2. `sortOrder`（`asc` / `desc`）

规则：
1. 默认排序：`sortBy=auditAt`, `sortOrder=desc`。
2. 稳定排序 tie-break：`traceKey` -> `requestKey` -> `attemptKey` -> `auditRecordId`。
3. 翻页必须复用同一 `queryEcho`（除 `pageTokenOrNA` 外不可变），且 `resolvedReplayAsOfAt` 不可漂移。
4. 若请求 `cursor` 无效，返回错误 `g_replay_invalid_cursor`。

#### 3.9.18 空结果语义（P0，MVP 冻结）

`emptyResult` required：
1. `isEmpty`（`true/false`）
2. `emptyReasonCode`
3. `diagnosticHint`

空结果原因码（最小集）：
1. `g_replay_not_found_opportunity`
2. `g_replay_no_record_in_time_range`
3. `g_replay_filtered_out`
4. `g_replay_access_denied_scope`

语义约束：
1. 空结果不是错误：返回成功响应，`items=[]`。
2. 仅请求非法时返回 `rejected`（非空结果语义）：如 `g_replay_invalid_query_mode`、`g_replay_invalid_time_range`。
   - `opportunityKey/opportunityId` 冲突时返回 `g_replay_opportunity_alias_conflict`。
3. `emptyReasonCode` 必须稳定可用于调用方 UI/自动化处理。

#### 3.9.19 MVP 验收基线（replay 合同）

1. `by_opportunity` 与 `by_time_range` 两种查询模式都可稳定返回可消费结果。
2. `summary/full` 输出在同请求同版本下结构确定性一致。
3. 分页与排序结果稳定，不出现跨页重复或漏项。
4. 空结果语义清晰，不与请求错误语义混淆。
5. 任一回放请求可通过 `queryEcho + replayContractVersion + generatedAt` 分钟级复现。

#### 3.9.20 回放执行模式（快照重放 vs 规则重算，P0，MVP 冻结）

`replayExecutionMode`：
1. `snapshot_replay`：以归档快照为准，不重新运行路由/策略/映射逻辑。
2. `rule_recompute`：基于指定版本重算规则，再与历史快照做差异比较。

MVP 规则：
1. dispute 场景默认且强制 `snapshot_replay`。
2. `rule_recompute` 仅用于内部诊断，不作为对账主口径。
3. 未显式指定时默认 `snapshot_replay`。

#### 3.9.21 版本钉住策略（P0，MVP 冻结）

`rule_recompute` 模式下必须提供或可解析以下版本锚点：
1. `schemaVersion`
2. `mappingRuleVersion`
3. `routingPolicyVersion`
4. `policyRuleVersion`
5. `deliveryRuleVersion`
6. `eventContractVersion`
7. `dedupFingerprintVersion`

钉住规则：
1. 优先使用 AuditRecord/F 输出记录中的历史版本锚点。
2. 若请求显式传入版本锚点，则必须与历史锚点一致；不一致时拒绝。
3. 任一关键锚点缺失时：
   - `snapshot_replay`：允许继续并标记 `determinismStatus=not_comparable`
   - `rule_recompute`：拒绝，原因码 `g_replay_missing_version_anchor`

#### 3.9.22 差异判定与原因码（P0，MVP 冻结）

差异判定对象：`replayDiffSummaryLite`

required：
1. `diffStatus`（`exact_match` / `semantically_equivalent` / `diverged` / `not_comparable`）
2. `diffReasonCodes[]`
3. `fieldDiffCount`
4. `comparedAt`

判定规则（最小）：
1. `exact_match`：关键字段逐项一致（winner、terminal status、billable facts、reason codes）。
2. `semantically_equivalent`：字段有差异但不影响计费/终态语义（如排序或非关键摘要字段）。
3. `diverged`：关键字段差异，影响终态/计费/归因结果。
4. `not_comparable`：缺关键锚点或缺必要快照，无法比较。

标准原因码（最小集）：
1. `g_replay_diff_none`
2. `g_replay_diff_non_key_field_changed`
3. `g_replay_diff_winner_changed`
4. `g_replay_diff_terminal_status_changed`
5. `g_replay_diff_billable_fact_changed`
6. `g_replay_diff_reason_code_changed`
7. `g_replay_diff_missing_snapshot`
8. `g_replay_diff_version_mismatch`
9. `g_replay_diff_not_comparable`

#### 3.9.23 确定性约束与输出语义（P0）

1. 同一 `queryEcho + replayExecutionMode + pinnedVersions` 重放结果必须一致。
   - `queryEcho` 的一致性锚点必须包含 `resolvedReplayAsOfAt`，并与 `resultMeta.snapshotCutoffAt` 相等。
2. `snapshot_replay` 模式下，`determinismStatus` 只能为 `deterministic` 或 `not_comparable`。
3. `rule_recompute` 模式下，必须返回 `replayDiffSummaryLite`。
4. `diffStatus=diverged` 时，必须附至少一个关键原因码（如 `*_winner_changed` / `*_terminal_status_changed` / `*_billable_fact_changed`）。
5. 任一 non-deterministic 结果必须进入审计告警轨道（不阻塞请求返回）。

#### 3.9.24 MVP 验收基线（回放确定性）

1. 同一 case 在同一 `resolvedReplayAsOfAt` 下多次 `snapshot_replay` 输出一致，不出现漂移。
2. `rule_recompute` 在版本钉住完整时可稳定产出 diff 结论。
3. 所有差异结果都可映射到标准 `diffReasonCodes`，便于 dispute 解释。
4. 任一不一致可通过 `replayRunId + queryEcho + diffReasonCodes` 分钟级定位。
