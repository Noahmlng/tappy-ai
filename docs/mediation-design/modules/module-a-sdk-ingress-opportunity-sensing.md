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

