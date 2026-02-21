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
