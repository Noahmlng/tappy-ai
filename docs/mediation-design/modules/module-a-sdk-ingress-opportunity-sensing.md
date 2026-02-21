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
2. placement 触发信息（与 `/Users/zeming/Documents/chat-ads-main/docs/ai-assistant-placement-framework.md` 对齐）。
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
4. 完整 `Idempotency` 窗口与存储退化治理
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
6. `a_trg_soft_budget_exceeded` -> `errorAction=degrade`, `triggerAction=create_opportunity`
7. `a_trg_hard_budget_exceeded` -> `errorAction=reject`, `triggerAction=reject`
8. `a_trg_config_timeout_with_snapshot` -> `errorAction=degrade`, `triggerAction=create_opportunity`
9. `a_trg_config_unavailable_no_snapshot` -> `errorAction=reject`, `triggerAction=reject`
10. `a_trg_config_version_invalid` -> `errorAction=reject`, `triggerAction=reject`
11. `a_trg_internal_unavailable` -> `errorAction=reject`, `triggerAction=reject`, `retryable=true`

一致性约束：
1. `config_*` 相关故障动作必须与 H 的失效矩阵一致（见 `3.10.47~3.10.53`）。
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
