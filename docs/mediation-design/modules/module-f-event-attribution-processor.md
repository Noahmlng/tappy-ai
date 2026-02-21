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

1. 事件归一记录与关联结果。
2. 闭环终态更新信号。

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
9. `idempotencyKey`
10. `eventVersion`

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
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `placementKey`, `idempotencyKey`
2. `auction_started`
   - 定义：供给编排开始执行（首个 route step 启动）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `auctionChannel`, `idempotencyKey`
3. `ad_filled`
   - 定义：本次机会已形成可交付填充结果（不代表已计费）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `creativeId`, `idempotencyKey`
4. `impression`
   - 定义：渲染成功后产生的有效曝光事实。
   - 层级：`billing`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `renderAttemptId`, `creativeId`, `idempotencyKey`
5. `click`
   - 定义：有效点击事实（同一渲染尝试下可归因）。
   - 层级：`billing`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `renderAttemptId`, `clickTarget`, `idempotencyKey`
6. `interaction`
   - 定义：非计费互动行为（如展开、停留、关闭）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `renderAttemptId`, `interactionType`, `idempotencyKey`
7. `postback`
   - 定义：外部网络/归因回执事件（用于计费回执与结果归因）。
   - 层级：`billing`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `responseReference`, `postbackType`, `postbackStatus`, `idempotencyKey`
8. `error`
   - 定义：链路异常事实（客户端或服务端阶段错误）。
   - 层级：`diagnostics`
   - required：`eventId`, `eventType`, `eventAt`, `traceKey`, `requestKey`, `attemptKey`, `opportunityKey`, `errorStage`, `errorCode`, `idempotencyKey`

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
