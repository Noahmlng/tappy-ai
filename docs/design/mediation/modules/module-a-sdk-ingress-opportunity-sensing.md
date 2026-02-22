### 3.3 Module A: SDK Ingress & Opportunity Sensing

#### 3.3.1 职责边界

1. 承接 SDK 请求入口并做基础规范化。
2. 识别当前对话/任务中是否存在广告机会（opportunity sensing）。
3. 生成机会种子对象，交给下游做标准化翻译。

不负责：
1. 交易级路由决策。
2. 最终 Delivery 组装。
3. 事件归因与结算逻辑。

#### 3.3.2 输入合同（最小）

1. 应用与会话基础信息。
2. placement 触发信息（与 `/Users/zeming/Documents/chat-ads-main/docs/design/ai-assistant-placement-framework.md` 对齐）。
3. 请求时间与接入通道。
4. 最小追踪上下文（trace key 初始化所需）。

#### 3.3.3 处理规则

1. 统一入口接收后先做输入校验，再进入机会识别。
2. 缺失非关键字段时受控降级，不阻断主链路。
3. 机会识别结果必须给出确定状态：命中机会 / 未命中机会 / 受策略阻断。

#### 3.3.4 输出合同

1. 机会种子对象（状态初始为 `received`）。
2. 机会触发解释摘要（用于审计与排障）。
3. 追踪主键与请求级时间戳。

#### 3.3.5 Module A 当前版本范围（MVP）

当前版本仅实现“走通主链路”的最小能力，避免过度工程化。

MVP 必做：
1. `Ingress Request Envelope`（最小 required 壳层）
2. `Opportunity Trigger Taxonomy`（最小触发类型集）
3. `Sensing Decision Output Contract`（最小结构化结论）
4. `Trace Initialization`（最小三键：`traceKey/requestKey/attemptKey`）
5. `A-layer Latency Budget`（单一软/硬预算）
6. `Idempotency / De-dup`（`clientRequestId` + in-flight 去重）
7. `A-layer Error Code`（primary code + 处置动作映射）

#### 3.3.6 MVP 输入与输出合同（最小）

输入最小集：
1. 应用/会话基础信息
2. placement 触发信息
3. 请求时间与接入通道
4. `clientRequestId`（缺失可平台生成）

输出最小集（A -> B）：
1. `opportunity seed`（状态 `received`）
2. `triggerSnapshotLite`（`triggerType`, `triggerDecision`）
3. `sensingDecisionLite`（`decisionOutcome`, `hitType`, `confidenceBand`, `reasonCode`）
4. `traceInitLite`（`traceKey`, `requestKey`, `attemptKey`）
5. `aLatencyBudgetLite`（`latencyDecision`, `latencyReasonCode`）
6. `aErrorLite`（`primaryErrorCode`, `errorAction`）

#### 3.3.7 MVP 运行护栏（最小）

1. 去重：
   - 同 `clientRequestId` 的并发重复请求不重复下游调用。
2. 时延：
   - A 层软预算超限执行降级；硬预算超限执行截断。
3. 错误码：
   - 每次异常必须产出标准 `primaryErrorCode`，禁止裸文本主诊断。
4. 处置一致性：
   - 同异常、同版本必须得到同动作（放行/降级/拦截）。

#### 3.3.8 当前明确延后（不在本阶段实现）

以下内容保留为后续优化项，本阶段不实现细节：
1. 完整 `Auth + Source Trust` 分级体系
2. 完整 `Fail-open / Fail-closed` 异常矩阵
3. 完整 `Context Extraction Boundary`（多窗口 + 完整脱敏策略）
4. 去重存储退化治理（跨节点/跨地域一致性）
5. 完整 `Error Code Taxonomy` 分层与聚合规则
6. 触发类型长尾扩展与跨 SDK 一致性分析
7. 时延预算分档精细化（`L0/L1/L2` 全量策略）
8. Trace lineage 高级谱系与复杂回放能力

延后模块仅在后置规划章节保留索引，不在当前版本展开详细设计。

#### 3.3.9 MVP 验收基线（Module A）

1. 请求可稳定进入 A 并输出结构化最小结果。
2. 重试/重复请求不会重复触发供给调用。
3. A 层超时不会拖垮主链路 `Request -> Delivery` SLA。
4. 任一异常都能通过 `traceKey + primaryErrorCode` 快速定位。
5. A -> B 输入合同稳定，无需 B 侧推断补齐关键字段。

#### 3.3.10 `trigger(placement_id, app_context)` 输入合同（P0，MVP 冻结）

调用语义：宿主 App 同步调用 A 层入口，不直接抛业务异常，统一返回结构化结果。

请求对象：`aTriggerRequestLite`

required：
1. `placementId`
2. `appContext`
   - `appId`
   - `sessionId`
   - `channelType`
   - `requestAt`
3. `triggerContext`
   - `triggerType`
   - `triggerAt`
4. `sdkVersion`
5. `ingressEnvelopeVersion`
6. `triggerContractVersion`

optional：
1. `clientRequestId`（缺失时由 SDK 生成）
2. `conversationTurnIdOrNA`
3. `intentScoreOrNA`
4. `traceHintOrNA`
5. `experimentTagsOrNA`
6. `extensions`

输入校验约束：
1. `placementId` 必须能映射到当前可用 placement 配置。
2. `triggerType` 必须命中 `Opportunity Trigger Taxonomy`。
3. `requestAt/triggerAt` 必须为可解析时间戳，且偏差不超过 `clockSkewLimitSec`。
4. required 缺失或结构非法时，直接返回 `reject`（不进入 createOpportunity 流程）。

#### 3.3.11 同步返回合同（P0，MVP 冻结）

返回对象：`aTriggerSyncResultLite`

required：
1. `requestAccepted`（`true/false`）
2. `triggerAction`（`create_opportunity` / `no_op` / `reject`）
3. `decisionOutcome`（`opportunity_eligible` / `opportunity_ineligible` / `opportunity_blocked_by_policy`）
4. `reasonCode`
5. `errorAction`（`allow` / `degrade` / `reject`）
6. `traceInitLite`
   - `traceKey`
   - `requestKey`
   - `attemptKey`
7. `opportunityRefOrNA`
8. `retryable`
9. `returnedAt`
10. `triggerContractVersion`

optional：
1. `generatedClientRequestIdOrNA`
2. `latencyDecisionOrNA`
3. `debugHints`

返回语义约束：
1. `triggerAction=create_opportunity` 时，`opportunityRefOrNA` 必须存在。
2. `triggerAction=no_op` 用于幂等重复、策略不命中等可预期不创建场景。
3. `triggerAction=reject` 时，`errorAction` 必须为 `reject`，且给出标准 `reasonCode`。
4. 同请求同版本下，同步返回必须确定性一致。

#### 3.3.12 错误码与动作映射（P0，MVP 冻结）

最小原因码与动作：
1. `a_trg_missing_required_field` -> `errorAction=reject`, `triggerAction=reject`
2. `a_trg_invalid_context_structure` -> `errorAction=reject`, `triggerAction=reject`
3. `a_trg_invalid_placement_id` -> `errorAction=reject`, `triggerAction=reject`
4. `a_trg_invalid_trigger_type` -> `errorAction=reject`, `triggerAction=reject`
5. `a_trg_duplicate_inflight` -> `errorAction=allow`, `triggerAction=no_op`
6. `a_trg_duplicate_reused_result` -> `errorAction=allow`, `triggerAction=no_op`
7. `a_trg_soft_budget_exceeded` -> `errorAction=degrade`, `triggerAction=create_opportunity`
8. `a_trg_hard_budget_exceeded` -> `errorAction=reject`, `triggerAction=reject`
9. `a_trg_config_timeout_with_snapshot` -> `errorAction=degrade`, `triggerAction=create_opportunity`
10. `a_trg_config_timeout_no_snapshot` -> `errorAction=reject`, `triggerAction=reject`
11. `a_trg_config_unavailable_with_snapshot` -> `errorAction=degrade`, `triggerAction=create_opportunity`
12. `a_trg_config_unavailable_no_snapshot` -> `errorAction=reject`, `triggerAction=reject`
13. `a_trg_config_version_invalid` -> `errorAction=reject`, `triggerAction=reject`
14. `a_trg_internal_unavailable` -> `errorAction=reject`, `triggerAction=reject`, `retryable=true`

一致性约束：
1. `config_*` 相关故障动作必须与 H 的失效矩阵一致（见 `3.10.47~3.10.53`）；该矩阵是 A 层执行约束的上位规则。
2. 同 `reasonCode` 在同版本下动作不得漂移。
3. `retryable=true` 仅允许出现在可重试内部故障，不得用于结构/合同错误。

#### 3.3.13 MVP 验收基线（trigger 合同）

1. 宿主 App 可稳定按同步调用语义接收 `aTriggerSyncResultLite`，无隐式异常通道。
2. required/optional 边界清晰，非法输入不会进入后续创建流程。
3. 错误码与动作映射在同请求同版本下确定性一致。
4. `triggerAction=create_opportunity/no_op/reject` 三种结果均可被审计与回放复原。

#### 3.3.14 `createOpportunity(opportunity_v1)` 输入合同（P0，MVP 冻结）

调用语义：A 内部同步调用；仅负责机会对象创建与最小必填校验，不做收益或路由决策。

输入对象：`opportunity_v1`

required：
1. `requestKey`
2. `opportunityKey`
3. `impSeed[]`（至少 1 个）
   - `impKey`
   - `placementId`
   - `placementType`
   - `slotIndex`
4. `timestamps`
   - `requestAt`
   - `triggerAt`
   - `opportunityCreatedAt`
5. `traceInit`
   - `traceKey`
   - `requestKey`（必须与顶层一致）
   - `attemptKey`
6. `schemaVersion`
7. `state`（固定初始值 `received`）
8. `createOpportunityContractVersion`

optional：
1. `experimentTagsOrNA`
2. `triggerSnapshotLiteOrNA`
3. `sensingDecisionLiteOrNA`
4. `extensions`

输入约束：
1. `requestKey/opportunityKey` 必须为全局唯一可追踪键；空值或非法格式直接拒绝。
2. `impSeed[]` 不能为空；空数组视为合同错误。
3. `timestamps` 必须单调合理：`requestAt <= triggerAt <= opportunityCreatedAt`。
4. `traceInit.requestKey` 与顶层 `requestKey` 必须一致，否则拒绝。

#### 3.3.15 createOpportunity 同步返回合同（P0，MVP 冻结）

返回对象：`aCreateOpportunityResultLite`

required：
1. `createAccepted`（`true/false`）
2. `createAction`（`created` / `duplicate_noop` / `rejected`）
3. `opportunityRefOrNA`
4. `resultState`（`received` / `error`）
5. `reasonCode`
6. `errorAction`（`allow` / `degrade` / `reject`）
7. `traceInit`
8. `returnedAt`
9. `createOpportunityContractVersion`

optional：
1. `createdEventRefOrNA`（`opportunity_created` 事件引用）
2. `debugHints`

返回约束：
1. `createAction=created` 时，`opportunityRefOrNA` 必须存在且状态为 `received`。
2. `createAction=duplicate_noop` 时，不得创建新 `opportunityKey`。
3. `createAction=rejected` 时，`errorAction` 必须为 `reject`。

#### 3.3.16 createOpportunity 错误码与动作映射（P0，MVP 冻结）

最小原因码与动作：
1. `a_cop_missing_required_field` -> `errorAction=reject`, `createAction=rejected`
2. `a_cop_invalid_key_format` -> `errorAction=reject`, `createAction=rejected`
3. `a_cop_imp_seed_empty` -> `errorAction=reject`, `createAction=rejected`
4. `a_cop_timestamp_order_invalid` -> `errorAction=reject`, `createAction=rejected`
5. `a_cop_trace_request_mismatch` -> `errorAction=reject`, `createAction=rejected`
6. `a_cop_duplicate_opportunity_key` -> `errorAction=allow`, `createAction=duplicate_noop`
7. `a_cop_internal_unavailable` -> `errorAction=reject`, `createAction=rejected`, `retryable=true`

一致性约束：
1. 同 `opportunityKey + createOpportunityContractVersion` 下，返回动作必须一致。
2. `duplicate_noop` 不得改变既有对象状态与关键时间戳。
3. `retryable=true` 仅允许内部可恢复错误，不允许合同类错误。

#### 3.3.17 MVP 验收基线（createOpportunity 合同）

1. `requestKey/opportunityKey/impSeed[]/timestamps/traceInit` 五类必填在字段级可判定。
2. 无 `impSeed` 或关键键不一致的请求不会进入 B。
3. 成功创建的机会对象都以 `state=received` 进入后续链路。
4. 任一创建失败都可通过 `traceKey + opportunityKey + reasonCode` 分钟级定位。

#### 3.3.18 `opportunity_created` 事件合同（P0，MVP 冻结）

事件对象：`aOpportunityCreatedEventLite`

required：
1. `eventKey`（事件主键）
2. `eventIdempotencyKey`（幂等键）
3. `eventType`（固定 `opportunity_created`）
4. `eventAt`
5. `requestKey`
6. `opportunityKey`
7. `traceKey`
8. `attemptKey`
9. `placementId`
10. `impSeedRefs[]`（至少 1 个 `impKey`）
11. `createOpportunityContractVersion`
12. `opportunityEventContractVersion`

optional：
1. `experimentTagsOrNA`
2. `debugHints`

#### 3.3.19 事件主键与幂等键规则（P0，MVP 冻结）

1. 事件主键：
   - `eventKey = "evt_oc_" + uuidv7`
   - 全局唯一，不随重发变化。
2. 幂等键：
   - `eventIdempotencyKey = sha256(requestKey + "|" + opportunityKey + "|" + attemptKey + "|opportunity_created|" + opportunityEventContractVersion)`
   - 同一机会对象重发必须复用同一幂等键。
3. 冲突规则：
   - 同 `eventIdempotencyKey` 且 payload 摘要一致 -> 视为重复事件（幂等 no-op）。
   - 同 `eventIdempotencyKey` 且 payload 摘要不一致 -> 合同冲突，直接拒绝并审计。

#### 3.3.20 触发时机（P0，MVP 冻结）

1. 仅当 `createOpportunity` 返回 `createAction=created` 时触发 `opportunity_created`。
2. 触发顺序固定：
   - 先机会对象创建成功（`state=received`）
   - 后发出 `opportunity_created`
   - 再进入 A -> B 正常主链路
3. `createAction=duplicate_noop/rejected` 时不得重新触发该事件。
4. `eventAt` 必须满足：`opportunityCreatedAt <= eventAt <= handoffToBAt`。

#### 3.3.21 ACK 与重发语义（P0，MVP 冻结）

ACK 对象：`aOpportunityEventAckLite`

required：
1. `eventKey`
2. `eventIdempotencyKey`
3. `ackStatus`（`accepted` / `duplicate` / `rejected`）
4. `ackReasonCode`
5. `retryable`
6. `ackedAt`

语义与动作：
1. `accepted`：事件已进入标准处理轨道；不重发。
2. `duplicate`：幂等重复成功；不重发。
3. `rejected && retryable=true`：按指数退避重发（`1s -> 5s -> 30s -> 120s`），最大窗口 `15m`。
4. `rejected && retryable=false`：不重发，写失败审计并保留机会链路。

重发约束：
1. 重发必须复用同一 `eventKey + eventIdempotencyKey`。
2. 重发不得修改业务 payload（仅允许补充传输层元数据）。
3. 超过重发窗口仍失败 -> 记录 `a_oc_emit_retry_exhausted`，进入审计告警轨道。

#### 3.3.22 事件原因码（P0，MVP 冻结）

1. `a_oc_emit_accepted`
2. `a_oc_emit_duplicate_noop`
3. `a_oc_emit_rejected_retryable`
4. `a_oc_emit_rejected_non_retryable`
5. `a_oc_emit_payload_conflict`
6. `a_oc_emit_retry_exhausted`
7. `a_oc_emit_contract_invalid`

#### 3.3.23 MVP 验收基线（opportunity_created 事件合同）

1. 每个成功创建的机会对象都可产生且仅产生一个业务语义等价的 `opportunity_created` 事件。
2. 事件主键与幂等键在重发场景下稳定不变。
3. ACK 与重发行为在同请求同版本下确定性一致。
4. 任一事件异常可通过 `eventKey + eventIdempotencyKey + ackReasonCode` 分钟级定位。

#### 3.3.24 Trigger Taxonomy 字典（P0，MVP 冻结）

字典对象：`triggerTaxonomyLite`

canonical `triggerType`（最小集）：
1. `answer_end`
2. `intent_spike`
3. `session_resume`
4. `tool_result_ready`
5. `workflow_checkpoint`
6. `manual_refresh`
7. `policy_forced_trigger`
8. `blocked_by_policy`
9. `unknown_trigger_type`

治理规则：
1. 独立版本：`triggerTaxonomyVersion`。
2. `triggerType` 必须先命中字典，再做下游映射。
3. 未命中字典统一归一到 `unknown_trigger_type`，并按 `reject` 处理。

#### 3.3.25 `triggerType -> decisionOutcome/hitType/reasonCode` 映射表（P0，MVP 冻结）

| triggerType | decisionOutcome | hitType | reasonCode |
|---|---|---|---|
| `answer_end` | `opportunity_eligible` | `workflow_hit` | `a_trg_map_answer_end_eligible` |
| `intent_spike` | `opportunity_eligible` | `explicit_hit` | `a_trg_map_intent_spike_eligible` |
| `session_resume` | `opportunity_eligible` | `scheduled_hit` | `a_trg_map_session_resume_eligible` |
| `tool_result_ready` | `opportunity_eligible` | `contextual_hit` | `a_trg_map_tool_result_ready_eligible` |
| `workflow_checkpoint` | `opportunity_eligible` | `workflow_hit` | `a_trg_map_workflow_checkpoint_eligible` |
| `manual_refresh` | `opportunity_ineligible` | `no_hit` | `a_trg_map_manual_refresh_ineligible` |
| `policy_forced_trigger` | `opportunity_eligible` | `policy_forced_hit` | `a_trg_map_policy_forced_eligible` |
| `blocked_by_policy` | `opportunity_blocked_by_policy` | `no_hit` | `a_trg_map_blocked_by_policy` |
| `unknown_trigger_type` | `opportunity_ineligible` | `no_hit` | `a_trg_map_unknown_trigger_reject` |

映射约束：
1. 映射结果必须使用 B 字典中的 canonical 值（`decisionOutcome/hitType`）。
2. `unknown_trigger_type` 不得进入创建流程，必须返回 `triggerAction=reject`。
3. 同 `triggerType + triggerTaxonomyVersion` 下映射结果必须确定性一致。

#### 3.3.26 映射执行顺序与冲突处理（P0，MVP 冻结）

执行顺序：
1. `triggerType` canonical 归一。
2. 查 `triggerTaxonomyLite` 映射表生成 `decisionOutcome/hitType/reasonCode`。
3. 与策略层结果做一致性检查（如 `blocked_by_policy`）。
4. 输出到 `sensingDecisionLite` 与 `triggerSnapshotLite`。

冲突处理：
1. 若 `triggerType` 映射为 `eligible` 但策略层判定 `blocked`，最终以策略层为准：
   - `decisionOutcome=opportunity_blocked_by_policy`
   - `hitType=no_hit`
   - `reasonCode=a_trg_map_overridden_by_policy`
2. 若映射结果与返回动作冲突（如 `eligible` + `triggerAction=reject`），必须补充 `secondaryReasonCodes[]` 解释冲突来源。

#### 3.3.27 MVP 验收基线（Trigger Taxonomy）

1. 所有 `triggerType` 都能稳定映射到唯一 `decisionOutcome/hitType/reasonCode` 三元组。
2. 未知触发类型不会静默放行，必须稳定拒绝并返回标准原因码。
3. 同请求同版本下映射与冲突处理结果完全可复现。
4. 任一触发映射可通过 `traceKey + triggerType + triggerTaxonomyVersion + reasonCode` 分钟级定位。

#### 3.3.28 A 层去重窗口规则（P0，MVP 冻结）

去重对象：`aDedupSnapshotLite`

去重键优先级：
1. `clientRequestId`（非空且格式合法时优先）。
2. `computedDedupKey`（当 `clientRequestId` 缺失时使用）：
   - `sha256(appId + "|" + sessionId + "|" + placementId + "|" + triggerType + "|" + triggerAt)`
3. `dedupFingerprintVersion` 固定为 `a_dedup_v1`。

最小状态机：
1. `new`
2. `inflight_duplicate`
3. `reused_result`
4. `expired_retry`

去重窗口（最小）：
1. `dedupWindowSec = 120`。
2. 同键命中且首请求仍在处理中 -> `dedupState=inflight_duplicate`，返回 `triggerAction=no_op`，`reasonCode=a_trg_duplicate_inflight`。
3. 同键命中且首请求已完成 -> `dedupState=reused_result`，复用首请求结论，不再执行二次创建/下游调用。
4. 超出窗口 -> `dedupState=expired_retry`，按新请求处理。

输出约束：
1. A 输出必须携带 `aDedupSnapshotLite`：`dedupKeySource/dedupFingerprintVersion/dedupState/dedupWindowSec`。
2. 同 `dedupKey + dedupWindowSec + dedupFingerprintVersion` 下，去重判定必须确定性一致。

#### 3.3.29 Trace 初始化与继承规则（P0，MVP 冻结）

规则对象：`traceInitLite`

主键集合（最小）：
1. `traceKey`
2. `requestKey`
3. `attemptKey`

初始化与继承：
1. 首次受理请求（`dedupState=new`）必须生成完整三键。
2. `inflight_duplicate/reused_result` 必须复用首请求的 `traceKey/requestKey/attemptKey`，禁止派生新 attempt。
3. `expired_retry` 视为新请求：必须生成新 `requestKey/attemptKey`；若 `appId + sessionId + placementId` 未变化可复用 `traceKey`。
4. 进入 `createOpportunity` 时，`traceInitLite` 三键必须原样透传；任一键不一致按合同错误拒绝。

可观测约束：
1. A 的每次返回都必须可通过 `traceKey + requestKey + attemptKey` 唯一定位。
2. trace 初始化失败必须返回 `a_trg_internal_unavailable`，并保留 `retryable=true` 语义。

#### 3.3.30 A 层执行约束：显式引用 H 失效矩阵（P0，MVP 冻结）

上位约束来源：
1. A 在处理配置失效时，必须以 H 的 `3.10.47~3.10.53` 为执行基线。
2. 若 A 层局部规则与 H 冲突，以 H 的 `fail-open/fail-closed` 决策为准。

场景绑定（A）：
1. `config_timeout`
   - 有稳定快照：`errorAction=degrade`, `triggerAction=create_opportunity`, `reasonCode=a_trg_config_timeout_with_snapshot`
   - 无稳定快照：`errorAction=reject`, `triggerAction=reject`, `reasonCode=a_trg_config_timeout_no_snapshot`
2. `config_unavailable`
   - 有稳定快照：`errorAction=degrade`, `triggerAction=create_opportunity`, `reasonCode=a_trg_config_unavailable_with_snapshot`
   - 无稳定快照：`errorAction=reject`, `triggerAction=reject`, `reasonCode=a_trg_config_unavailable_no_snapshot`
3. `config_version_invalid`
   - 强制 `errorAction=reject`, `triggerAction=reject`, `reasonCode=a_trg_config_version_invalid`
   - 不得进入 B/C/D/E。

审计约束（A -> F/G）：
1. A 必须输出并透传 `configFailureScenario + failureMode + primaryReasonCode`。
2. 若 H 返回 `hConfigFailureDecisionSnapshotLite.snapshotId`，A 必须挂入本次请求审计上下文，保证后续回放可对齐。
