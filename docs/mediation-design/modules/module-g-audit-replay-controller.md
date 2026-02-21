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

1. G 对每条记录维护 `archiveWriteStatus`：
   - `pending`
   - `written`
   - `write_failed`
2. `recordStatus` 与 `archiveWriteStatus` 必须组合一致：
   - `committed` -> `written`
   - `duplicate/conflicted/rejected/superseded` -> `written`（审计轨）
   - `new` -> `pending`
3. `write_failed` 走异步补偿，且补偿过程不改变原始 `recordStatus` 语义。

#### 3.9.6 MVP 验收基线（G 接收 F 输出）

1. G 能稳定消费 `fToGArchiveRecordLite`，不依赖隐式字段推断。
2. 同 `recordKey` 重放不会导致重复归档或重复结算。
3. F 输出的状态、版本锚点、关联键在 G/Archive 侧完整保留。
4. 任一归档失败可通过 `recordKey + archiveWriteStatus + traceKey` 分钟级定位。

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
3. `computedAppendKey = sha256(opportunityKey + \"|\" + traceKey + \"|\" + appendAt + \"|\" + auditRecordVersion)`

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
