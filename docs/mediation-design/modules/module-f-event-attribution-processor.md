### 3.8 Module F: Event & Attribution Processor

#### 3.8.1 事件合同（当前最小集）

F 层区分两层事件口径：
1. SDK 输入事件类型（`POST /events`）：
   - `opportunity_created`
   - `auction_started`
   - `ad_filled`
   - `impression`
   - `click`
   - `interaction`
   - `postback`
   - `error`
2. 当前标准闭环终态口径（MVP）：
   - `impression`
   - `click`
   - `failure`

核心语义位（按事件类型适用）：
1. `responseReference`
2. 事件类型
3. 事件时间
4. 状态与原因码（适用时）
5. 渲染事件到 M1 的映射规则见 `3.7.24`（必须保持一致）。

#### 3.8.2 处理规则

1. 事件必须先归一再归因。
2. 无 `responseReference` 事件进入隔离轨道，不进标准口径。
3. 事件窗口超时时系统补写 `failure` 终态，保证闭环可完成。

#### 3.8.3 输出合同

1. `billableFacts[]`：可结算事实流（计费口径）。
2. `attributionFacts[]`：归因与实验事实流（分析口径）。
3. `factDecisionAuditLite`：映射与冲突裁决快照（用于回放与审计）。

#### 3.8.4 F 输入合同（`POST /events`，P0，MVP 冻结）

接口定义：
1. `POST /events`
2. 语义：SDK 批量上报事件，服务端返回逐条 ACK。

请求对象：`eventBatchRequestLite`

required：
1. `batchId`（批次唯一键）
2. `appId`
3. `sdkVersion`
4. `sentAt`
5. `schemaVersion`
6. `events[]`（`1..100`，按提交顺序）

optional：
1. `retrySequence`
2. `transportCompression`
3. `extensions`

envelope 级约束：
1. `events[]` 为空、超上限、或非数组 -> 整批拒绝。
2. `batchId` 缺失或非法 -> 整批拒绝。
3. `schemaVersion` 不支持 -> 整批拒绝。

#### 3.8.5 单事件输入合同（P0，MVP 冻结）

事件对象：`sdkEventLite`

通用 required：
1. `eventId`（客户端事件主键）
2. `eventType`
3. `eventAt`
4. `traceKey`
5. `requestKey`
6. `attemptKey`
7. `opportunityKey`
8. `responseReference`（下述例外场景除外）
9. `eventVersion`

optional：
1. `idempotencyKey`（若提供则作为最高优先级幂等键）
2. `eventIdScope`（`global_unique` / `batch_scoped`，默认 `batch_scoped`）

例外场景：
1. `opportunity_created` / `auction_started` 允许无 `responseReference`，但必须有 `opportunityKey + requestKey + attemptKey`。

类型条件必填（最小）：
1. `opportunity_created`：`placementKey`
2. `auction_started`：`auctionChannel`
3. `ad_filled`：`responseReference`, `creativeId`
4. `impression`：`responseReference`, `renderAttemptId`, `creativeId`
5. `click`：`responseReference`, `renderAttemptId`, `clickTarget`
6. `interaction`：`responseReference`, `renderAttemptId`, `interactionType`
7. `postback`：`responseReference`, `postbackType`, `postbackStatus`
8. `error`：`errorStage`, `errorCode`（若关联交付链路则 `responseReference` 必填）

非法值处置（最小）：
1. `eventType` 未知 -> `rejected`，原因码 `f_event_type_unsupported`
2. 必填字段缺失 -> `rejected`，原因码 `f_event_missing_required`
3. 时间戳非法 -> `rejected`，原因码 `f_event_time_invalid`
4. `idempotencyKey` 非法 -> `accepted`（降级使用低优先级键），原因码 `f_idempotency_key_invalid_fallback`
5. `eventId` 非法且 `computedKey` 无法生成 -> `rejected`，原因码 `f_event_id_invalid_no_fallback`
6. `eventIdScope=global_unique` 但缺失唯一性声明或校验失败 -> `rejected`，原因码 `f_event_id_global_uniqueness_unverified`

#### 3.8.6 每条事件 ACK 合同（P0，MVP 冻结）

响应对象：`eventBatchAckLite`

required：
1. `batchId`
2. `receivedAt`
3. `overallStatus`（`accepted_all` / `partial_success` / `rejected_all`）
4. `ackItems[]`（与请求 `events[]` 一一对应）

`ackItemLite` required：
1. `eventId`
2. `eventIndex`
3. `ackStatus`（`accepted` / `rejected` / `duplicate`）
4. `ackReasonCode`
5. `retryable`（`true` / `false`）
6. `serverEventKey`

ACK 约束：
1. `accepted`：事件进入标准处理轨道。
2. `duplicate`：事件被去重，不重复进入计费/归因轨道。
3. `rejected`：事件未进入标准轨道；仅 `retryable=true` 的项允许客户端重试。
4. `duplicate` 场景标准原因码：
   - `f_dedup_inflight_duplicate`
   - `f_dedup_committed_duplicate`

#### 3.8.7 部分成功语义（P0）

判定规则：
1. 所有 `ackItem.ackStatus=accepted` -> `overallStatus=accepted_all`
2. 所有 `ackItem.ackStatus=rejected` 且无任何 `accepted/duplicate` -> `overallStatus=rejected_all`
3. 其余组合 -> `overallStatus=partial_success`

响应语义：
1. envelope 校验通过时，返回逐条 ACK（即使是 `partial_success`）。
2. envelope 校验失败时，整批拒绝，不返回逐条处理结果。
3. 客户端重试范围仅限 `rejected && retryable=true` 的事件，不重发 `accepted/duplicate`。

顺序与可复现约束：
1. `ackItems[]` 保持与请求 `eventIndex` 相同顺序。
2. 同请求同版本下，`ackStatus/ackReasonCode/retryable` 判定必须一致。

#### 3.8.8 MVP 验收基线（F 输入合同）

1. SDK 可稳定按 `eventBatchRequestLite` 上报并解析逐条 ACK。
2. 服务端可在同批次内区分 `accepted/rejected/duplicate`，且不重复入账。
3. `partial_success` 下客户端可精确重试失败项，不会整批重复提交。
4. 任一拒绝都可通过 `batchId + eventId + ackReasonCode` 分钟级定位。
5. `POST /events` 输入合同与 E 输出事件键（`responseReference` 等）可稳定对齐，不发生语义断链。

#### 3.8.9 事件类型 Canonical 字典与分层（billing vs diagnostics，P0，MVP 冻结）

分层定义（冻结）：
1. `billing`：会进入计费/结算/对账口径的事实事件。
2. `diagnostics`：用于归因分析、实验评估、排障与质量观测的事件。

Canonical 字典（最小）：
1. `opportunity_created`
   - 定义：机会对象在 Mediation 主链创建完成。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `placementKey`
2. `auction_started`
   - 定义：供给编排开始执行（首个 route step 启动）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `auctionChannel`
3. `ad_filled`
   - 定义：本次机会已形成可交付填充结果（不代表已计费）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `creativeId`
4. `impression`
   - 定义：渲染成功后产生的有效曝光事实。
   - 层级：`billing`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `renderAttemptId`, `creativeId`
5. `click`
   - 定义：有效点击事实（同一渲染尝试下可归因）。
   - 层级：`billing`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `renderAttemptId`, `clickTarget`
6. `interaction`
   - 定义：非计费互动行为（如展开、停留、关闭）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `renderAttemptId`, `interactionType`
7. `postback`
   - 定义：外部网络/归因回执事件（用于计费回执与结果归因）。
   - 层级：`billing`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `postbackType`, `postbackStatus`
8. `error`
   - 定义：链路异常事实（客户端或服务端阶段错误）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `errorStage`, `errorCode`

分层约束：
1. `billing` 事件必须携带 `responseReference`。
2. `diagnostics` 事件允许部分前置事件无 `responseReference`（如 `opportunity_created/auction_started`）。
3. 单事件只能属于一个层级，不允许双写双层。

#### 3.8.10 unknown 处理规则（P0，MVP 冻结）

1. 未知 `eventType`：
   - 处理：`rejected`
   - 原因码：`f_event_type_unsupported`
   - `retryable=false`
2. 已知 `eventType` 但子枚举未知（如 `interactionType/postbackStatus/auctionChannel/errorStage`）：
   - 处理：归一到 `unknown` 枚举并 `accepted`（进入原层级）。
   - 审计：记录 `rawValue + canonicalValue=unknown + fieldPath`
3. 已知 `eventType` 但 required 缺失：
   - 处理：`rejected`
   - 原因码：`f_event_missing_required`
4. 扩展字段未知：
   - 处理：保留在 `extensions`，不参与 canonical 判定、不影响分层。

一致性约束：
1. unknown 归一不得改变事件层级（`billing/diagnostics`）。
2. 同请求同版本下，unknown 判定与结果必须可复现。

#### 3.8.11 MVP 验收基线（事件字典与分层）

1. 八类事件都可映射到唯一 canonical 定义与唯一层级。
2. `billing` 与 `diagnostics` 口径互不混淆，不出现跨层重复入账。
3. 任一事件都可校验其 required 字段完整性并给出稳定 ACK 结果。
4. `unknown eventType` 被稳定拒绝，`unknown 子枚举` 被稳定归一。
5. 任一分层或归一冲突可通过 `batchId + eventId + ackReasonCode` 分钟级定位。

#### 3.8.12 幂等键生成公式（P0，MVP 冻结）

F 层为每条事件解析 `canonicalDedupKey`，用于去重判定。

生成步骤（固定）：
1. 读取客户端 `idempotencyKey`（若存在且合法）。
2. 读取客户端 `eventId`（若存在且合法）。
3. 生成 `computedKey`（当 1/2 不可用时作为回退）：
   - `computedKey = sha256(computedKeyInputV1)`
   - `computedKeyInputV1 = appId + \"|\" + eventType + \"|\" + requestKey + \"|\" + attemptKey + \"|\" + opportunityKey + \"|\" + responseReferenceOrNA + \"|\" + renderAttemptIdOrNA + \"|\" + semanticPayloadDigest`
4. 统一输出：
   - `canonicalDedupKey = \"f_dedup_v1:\" + keySource + \":\" + keyValue`
   - `keySource in {client_idempotency, client_event_id, computed}`

`client_event_id` 命名空间化规则（P0 冻结）：
1. 当 `keySource=client_event_id` 时，`keyValue` 必须为：
   - `eventIdScoped = appId + \"|\" + batchId + \"|\" + eventId`（默认，`eventIdScope=batch_scoped`）
2. 若客户端显式声明 `eventIdScope=global_unique` 且通过服务端校验，可使用：
   - `eventIdScoped = appId + \"|global|\" + eventId`
3. 任何未命名空间化的裸 `eventId` 不得直接作为 `canonicalDedupKey` 的 `keyValue`。

`semanticPayloadDigest`（按事件类型）：
1. `opportunity_created`：`placementKey`
2. `auction_started`：`auctionChannel`
3. `ad_filled`：`creativeId`
4. `impression`：`creativeId + renderAttemptId`
5. `click`：`renderAttemptId + clickTarget`
6. `interaction`：`renderAttemptId + interactionType`
7. `postback`：`postbackType + postbackStatus`
8. `error`：`errorStage + errorCode`

#### 3.8.13 幂等优先级（client eventId vs computed key，P0）

优先级（高 -> 低）：
1. 客户端 `idempotencyKey`
2. 客户端 `eventIdScoped`（由 `appId|batchId|eventId` 或 `appId|global|eventId` 构成）
3. 服务端 `computedKey`

裁决规则：
1. `idempotencyKey` 合法时，必须作为最终 dedup 键（不回退到低优先级）。
2. 无 `idempotencyKey` 且 `eventId` 合法时，必须先做命名空间化再使用 `eventIdScoped`。
3. 两者缺失/非法时，使用 `computedKey`。
4. 若高优先级键对应历史指纹与当前 `computedKey` 冲突：
   - `ackStatus=rejected`
   - `ackReasonCode=f_dedup_payload_conflict`
   - `retryable=false`
5. 若声明 `eventIdScope=global_unique` 但未通过唯一性校验：
   - `ackStatus=rejected`
   - `ackReasonCode=f_event_id_global_uniqueness_unverified`
   - `retryable=false`

一致性约束：
1. 同请求同版本下，键源选择必须确定性一致。
2. 去重判定必须记录 `keySource + canonicalDedupKey + dedupFingerprintVersion(f_dedup_v1)`。

#### 3.8.14 去重窗口（P0，MVP 冻结）

窗口定义（按层级）：
1. `billing` 事件去重窗口：`14d`
2. `diagnostics` 事件去重窗口：`3d`
3. 并发锁窗口（全事件）：`120s`

窗口规则：
1. 并发锁窗口内同键重复提交 -> `duplicate`（`f_dedup_inflight_duplicate`）。
2. 去重窗口内同键重放 -> `duplicate`（`f_dedup_committed_duplicate`）。
3. `receivedAt - eventAt` 超出对应层级窗口：
   - `ackStatus=rejected`
   - `ackReasonCode=f_event_stale_outside_dedup_window`
   - `retryable=false`

#### 3.8.15 去重状态机（P0，MVP 冻结）

状态集合：
1. `new`
2. `inflight_locked`
3. `accepted_committed`
4. `duplicate_inflight`
5. `duplicate_committed`
6. `rejected_conflict`
7. `expired`

状态迁移（最小）：
1. `new -> inflight_locked`（首次受理）
2. `inflight_locked -> accepted_committed`（校验通过并写入事实流）
3. `inflight_locked -> rejected_conflict`（键冲突/载荷冲突）
4. `inflight_locked -> duplicate_inflight`（并发重复）
5. `accepted_committed -> duplicate_committed`（窗口内重放）
6. `accepted_committed -> expired`（超过去重窗口）
7. `expired -> new`（作为新周期事件重新受理）

ACK 映射：
1. `accepted_committed` -> `ackStatus=accepted`
2. `duplicate_inflight/duplicate_committed` -> `ackStatus=duplicate`
3. `rejected_conflict` -> `ackStatus=rejected`

#### 3.8.16 MVP 验收基线（幂等键与去重规则）

1. 同一事件重复上报只会有一次 `accepted`，其余为 `duplicate`。
2. 并发重复提交不会导致双重计费或双重归因写入。
3. `idempotencyKey/eventId/computedKey` 选键优先级在同请求同版本下可复现。
4. 去重窗口边界行为稳定（窗口内重复必去重，超窗按规则拒绝或新周期处理）。
5. 任一去重冲突可通过 `batchId + eventId + canonicalDedupKey + ackReasonCode` 分钟级定位。

#### 3.8.17 终态闭环键与可闭环事件（P0，MVP 冻结）

闭环主键（冻结）：
1. `closureKey = responseReference + \"|\" + renderAttemptId`
2. `responseReference` 与 `renderAttemptId` 缺一不可；缺失时事件不得进入终态闭环口径。

闭环状态：
1. `open`
2. `closed_success`（终态：`impression`）
3. `closed_failure`（终态：`failure`）

可闭环事件（仅以下可驱动终态）：
1. `impression`（直接闭环为 `closed_success`）
2. `failure`（F 归一终态事件，直接闭环为 `closed_failure`）
3. `error`（仅当 `errorClass=terminal` 且键完整时，归一为 `failure` 后闭环）

不可闭环事件（只做过程/诊断）：
1. `opportunity_created`
2. `auction_started`
3. `ad_filled`
4. `click`
5. `interaction`
6. `postback`
7. 非终态 `error`

#### 3.8.18 超时补写条件（P0，MVP 冻结）

终态等待窗口（固定）：
1. `terminalWaitWindow = 120s`

补写触发条件（全部满足）：
1. 同一 `closureKey` 已进入 `open`（至少收到 `ad_filled` 或可渲染启动信号）。
2. 在 `terminalWaitWindow` 内未收到 `impression/failure` 终态事件。
3. 该 `closureKey` 未被标记为 `closed_success/closed_failure`。

补写动作：
1. 系统生成 `failure` 事件（`terminalSource=system_timeout_synthesized`）。
2. 原因码固定：`f_terminal_timeout_autofill`。
3. 该补写事件参与标准幂等与去重流程，且只能生效一次。

补写约束：
1. 若补写后又到达真实 `failure`，按 duplicate 处理。
2. 若补写后到达 `impression`，按终态优先级规则裁决（见 `3.8.19`）。

#### 3.8.19 impression / failure 互斥与优先级（P0，MVP 冻结）

互斥规则（冻结）：
1. 同一 `closureKey` 只允许一个终态结果生效。
2. 终态一旦写入，闭环状态从 `open` 转为 `closed_*`，不得回退。

优先级规则（高 -> 低）：
1. `impression`
2. `failure`（包含 timeout 补写与 terminal error 归一 failure）

冲突处理：
1. 已有 `impression` 后再到达任意 `failure`：
   - `ackStatus=duplicate`
   - `ackReasonCode=f_terminal_conflict_failure_after_impression`
2. 已有 `failure` 后到达 `impression`：
   - 若 `failure` 来源为 `system_timeout_synthesized`，允许 `impression` 覆盖终态为 `closed_success`，原 timeout failure 标记 `superseded`
   - 若 `failure` 来源为真实终态事件，`impression` 记为冲突事件并隔离，`ackStatus=duplicate`，`ackReasonCode=f_terminal_conflict_impression_after_failure`
3. 同批次同时出现 `impression` 与 `failure`：
   - 按优先级先处理 `impression`，`failure` 按 duplicate 处理

#### 3.8.20 MVP 验收基线（终态闭环规则）

1. 每个 `closureKey` 最终都能落在唯一终态（`closed_success` 或 `closed_failure`）。
2. 超时补写条件可复现，不会对同一 `closureKey` 重复补写。
3. `impression/failure` 冲突时裁决结果在同请求同版本下确定性一致。
4. 终态冲突与补写行为可通过 `responseReference + renderAttemptId + ackReasonCode` 分钟级回放定位。

#### 3.8.21 归因与计费输出对象（P0，MVP 冻结）

F 层标准输出对象：
1. `billableFactLite`
2. `attributionFactLite`
3. `factDecisionAuditLite`

`billableFactLite` required：
1. `factId`
2. `billableType`（`billable_impression` / `billable_click`）
3. `sourceEventId`
4. `responseReference`
5. `renderAttemptId`
6. `opportunityKey`
7. `traceKey`
8. `billingKey`（`responseReference + \"|\" + renderAttemptId + \"|\" + billableType`）
9. `factAt`
10. `factVersion`

`attributionFactLite` required：
1. `factId`
2. `attributionType`
3. `sourceEventId`
4. `eventType`
5. `responseReferenceOrNA`
6. `renderAttemptIdOrNA`
7. `opportunityKey`
8. `traceKey`
9. `attributionKey`
10. `factAt`
11. `factVersion`

`factDecisionAuditLite` required：
1. `sourceEventId`
2. `mappingRuleVersion`
3. `decisionAction`（`billable_emit` / `attribution_emit` / `both_emit` / `drop`）
4. `decisionReasonCode`
5. `conflictDecision`
6. `decidedAt`

#### 3.8.22 事件到 Facts 映射合同（P0，MVP 冻结）

MVP 映射表：
1. `opportunity_created` ->
   - `billable`: 无
   - `attribution`: `attr_opportunity_created`
2. `auction_started` ->
   - `billable`: 无
   - `attribution`: `attr_auction_started`
3. `ad_filled` ->
   - `billable`: 无
   - `attribution`: `attr_ad_filled`
4. `impression` ->
   - `billable`: `billable_impression`
   - `attribution`: `attr_impression`
5. `click` ->
   - `billable`: `billable_click`（满足计费资格约束时）
   - `attribution`: `attr_click`
6. `interaction` ->
   - `billable`: 无
   - `attribution`: `attr_interaction`
7. `postback` ->
   - `billable`: 无（MVP 不直接计费）
   - `attribution`: `attr_postback`
8. `error` ->
   - `billable`: 无
   - `attribution`: `attr_error`
9. `failure`（F 归一终态事件） ->
   - `billable`: 无
   - `attribution`: `attr_failure_terminal`

计费资格约束（MVP）：
1. `billable_impression`：需满足终态 `closed_success` 且未命中去重冲突。
2. `billable_click`：需同 `closureKey` 已存在有效 `billable_impression`，且未命中去重冲突。
3. 资格不满足时仅输出 attribution fact，不输出 billable fact。

#### 3.8.23 单尝试唯一计费约束（P0，MVP 冻结）

唯一键约束：
1. `billingKey` 在全局范围必须唯一。
2. 同一 `closureKey`：
   - 最多 1 条 `billable_impression`
   - 最多 1 条 `billable_click`

写入约束：
1. 首次写入成功的 billable fact 为有效计费事实。
2. 后续同 `billingKey` 输入一律标记 duplicate，不可重复计费。
3. 计费事实一旦写入不得被覆盖或删除；仅允许追加 `adjustmentFlag`（后置流程，不在 MVP 展开）。

#### 3.8.24 冲突裁决规则（P0，MVP 冻结）

裁决优先级（高 -> 低）：
1. 终态一致性规则（`3.8.19`）
2. 计费唯一键约束（`3.8.23`）
3. 事件时间顺序（`eventAt`）
4. 入站时间顺序（`receivedAt`）
5. 事件主键字典序（最终 tie-break）

典型冲突：
1. 同一 `closureKey` 出现多条 impression：
   - 保留最早有效一条作为 `billable_impression`
   - 其余为 duplicate attribution，原因码 `f_billing_conflict_duplicate_impression`
2. click 先于 impression 到达：
   - 先输出 `attr_click_pending`
   - 若 `terminalWaitWindow(120s)` 内补齐有效 impression，则升级生成 `billable_click`
   - 超窗未补齐 impression，保持非计费 attribution，原因码 `f_billing_click_without_impression`
3. 终态为 `closed_failure` 后到达 click：
   - 只保留 attribution，不得生成 billable，原因码 `f_billing_ineligible_terminal_failure`
4. postback 与终态冲突：
   - 仅写 attribution 冲突记录，不影响已生效 billable fact

#### 3.8.25 MVP 验收基线（归因与计费映射合同）

1. 八类输入事件都能稳定映射为可审计的 billable/attribution 输出决策。
2. 同一 `closureKey` 不会产生重复计费事实（impression/click 各最多一次）。
3. 冲突裁决在同请求同版本下确定性一致，可回放。
4. `billableFacts` 可直接供结算口径消费，`attributionFacts` 可直接供实验评估消费。
5. 任一计费争议可通过 `billingKey + sourceEventId + decisionReasonCode` 分钟级定位。

#### 3.8.26 F 输出合同（F -> G/Archive，P0，MVP 冻结）

F 向 G/Archive 输出统一记录对象：`fToGArchiveRecordLite`。

`fToGArchiveRecordLite` required：
1. `recordKey`（F 侧输出主键）
2. `recordType`（`billable_fact` / `attribution_fact` / `decision_audit`）
3. `recordStatus`（`new` / `committed` / `duplicate` / `conflicted` / `rejected` / `superseded`）
4. `payloadRef`
   - `payloadType`（`billableFactLite` / `attributionFactLite` / `factDecisionAuditLite`）
   - `payloadKey`
5. `sourceKeys`
   - `eventId`
   - `sourceEventId`
   - `traceKey`
   - `requestKey`
   - `attemptKey`
   - `opportunityKey`
   - `responseReferenceOrNA`
   - `renderAttemptIdOrNA`
6. `relationKeys`
   - `closureKeyOrNA`
   - `billingKeyOrNA`
   - `attributionKeyOrNA`
   - `canonicalDedupKey`
7. `versionAnchors`
   - `eventContractVersion`
   - `mappingRuleVersion`
   - `dedupFingerprintVersion`
   - `closureRuleVersion`
   - `billingRuleVersion`
   - `archiveContractVersion`
8. `decisionReasonCode`
9. `outputAt`

optional：
1. `conflictWithRecordKey`
2. `supersededRecordKey`
3. `extensions`

#### 3.8.27 F 输出状态机（P0，MVP 冻结）

状态集合：
1. `new`
2. `committed`
3. `duplicate`
4. `conflicted`
5. `rejected`
6. `superseded`

状态迁移（最小）：
1. `new -> committed`（记录被 G 成功接收并写入 Archive）
2. `new -> duplicate`（命中去重/唯一键冲突）
3. `new -> conflicted`（终态或映射冲突，需保留冲突轨迹）
4. `new -> rejected`（合同校验失败或不可恢复错误）
5. `committed -> superseded`（仅允许 timeout failure 被后续 impression 覆盖的场景）

约束：
1. `duplicate/conflicted/rejected` 为终态，不得回迁到 `committed`。
2. `superseded` 仅允许从 `committed` 迁入。
3. 任一迁移必须附 `decisionReasonCode + decidedAt + ruleVersionSnapshot`。

#### 3.8.28 版本锚点与关联键约束（P0）

版本锚点约束：
1. `versionAnchors` 任一关键字段缺失 -> `recordStatus=rejected`，原因码 `f_output_missing_version_anchor`。
2. 同一 `recordKey` 的版本锚点不可在生命周期内变化。

关联键约束：
1. `recordType=billable_fact` 时 `billingKeyOrNA` 必填。
2. `recordType=attribution_fact` 时 `attributionKeyOrNA` 必填。
3. `closureKeyOrNA` 对终态相关记录必填（`impression/failure` 相关）。
4. `traceKey + responseReferenceOrNA + renderAttemptIdOrNA` 必须可回放定位到单机会链路。

#### 3.8.29 F -> G/Archive 交付规则（P0）

1. `recordKey` 幂等语义（冻结）：
   - `recordKey` 必须由 F 按确定性规则生成：`sha256(recordType + "|" + payloadRef.payloadKey + "|" + relationKeys.canonicalDedupKey + "|" + versionAnchors.archiveContractVersion)`。
   - 同一业务语义记录重发必须复用同一 `recordKey`；不同业务语义记录不得复用同一 `recordKey`。
   - 同 `recordKey` 且 payload 摘要一致 -> 幂等 no-op；同 `recordKey` 且 payload 摘要不一致 -> `recordStatus=conflicted`，原因码 `f_output_recordkey_payload_mismatch`。
2. 写入顺序（冻结）：
   - 同一 `closureKeyOrNA + traceKey` 分组内，写入顺序固定为：`decision_audit` -> `billable_fact` -> `attribution_fact`。
   - 同级排序使用 `outputAt` 升序，若仍冲突则按 `recordKey` 字典序稳定裁决。
   - `billable_fact/attribution_fact` 在其前置 `decision_audit` 未确认 `written` 前不得进入 Archive 最终写入位。
3. 部分失败补偿（冻结）：
   - G 返回可重试失败（`g_archive_write_timeout/g_archive_temporarily_unavailable/g_archive_rate_limited`）时，F 必须以同一 `recordKey` 重试，不得派生新键。
   - 重试节奏：指数退避（`1s -> 5s -> 30s -> 120s` 循环），最大补偿窗口 `15m`。
   - 超出补偿窗口仍未写入时，记录进入 `recordStatus=conflicted`，原因码 `f_output_archive_compensation_exhausted`，并保留审计轨迹。
4. 最终一致状态（冻结，闭环聚合态）：
   - `consistent_committed`：该闭环下应写记录全部 `written`，且包含 `decision_audit`。
   - `consistent_non_billable`：仅审计轨记录 `written`（如 `duplicate/rejected/conflicted/superseded`），无有效计费事实写入。
   - `partial_pending`：存在可重试失败且仍在补偿窗口内。
   - `partial_timeout`：补偿窗口耗尽仍存在未写记录。
5. F 对 `duplicate/conflicted/rejected/superseded` 记录仍需输出到 G（用于审计与回放），但不得进入计费事实结算口径。

#### 3.8.30 MVP 验收基线（F 输出合同）

1. F 输出到 G/Archive 的记录对象结构稳定，三类记录均可独立消费。
2. 任一输出记录都具备完整状态、版本锚点与关联键，可追溯到源事件。
3. `E -> F -> G -> Archive` 在同请求同版本下可完整回放且语义一致。
4. 非 `committed` 记录不会污染计费结算口径，但可用于审计与实验分析。
5. `recordKey` 重试幂等、写入顺序、补偿策略在同请求同版本下确定性一致。
6. 闭环聚合态只能落在 `consistent_committed/consistent_non_billable/partial_pending/partial_timeout` 之一。
7. 任一断链可通过 `recordKey + sourceEventId + traceKey` 分钟级定位。
