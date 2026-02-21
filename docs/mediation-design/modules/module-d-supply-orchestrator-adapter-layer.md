### 3.6 Module D: Supply Orchestrator & Adapter Layer

#### 3.6.1 供给范围（当前最小）

1. 广告联盟供给源。
2. 模拟广告库供给源。

#### 3.6.2 Supply Adapter 标准合同（冻结）

每个 adapter 至少实现四件事：
1. `request adapt`
2. `candidate normalize`
3. `error normalize`
4. `source trace`

边界约束：
1. 私有字段只能进 `extensions`。
2. `extensions` 不得污染主语义与核心口径。

#### 3.6.3 路由与执行策略模型（规则 DAG + Strategy Contract）

1. 当前版本固定规则 DAG，不引入复杂优化器。
2. 执行策略必须通过 `executionStrategyLite` 显式声明，禁止由实现侧隐式推断。
3. `strategyType` 仅允许：`waterfall` / `bidding` / `hybrid`。
4. 每次切换必须记录原因：`no_fill/timeout/error/policy_block/strategy_fallback`。

`executionStrategyLite`（MVP 冻结）：
1. `strategyType`（`waterfall` / `bidding` / `hybrid`）
2. `parallelFanout`（并发扇出上限；`bidding/hybrid` 下 required，`waterfall` 固定 `1`）
3. `strategyTimeoutMs`（策略级总时延预算）
4. `fallbackPolicy`（`on_no_fill_only` / `on_no_fill_or_error` / `disabled`）
5. `executionStrategyVersion`

策略语义：
1. `waterfall`：按 `primary -> secondary -> fallback` 顺序串行执行。
2. `bidding`：在同 tier 内按 `parallelFanout` 并发请求并做统一 winner selection；是否进入 fallback 由 `fallbackPolicy` 决定。
3. `hybrid`：先执行 `bidding` primary，再按策略降级到顺序 fallback。

超时与状态：
1. source 超时遵循 `timeoutBudgetMs`，策略总超时遵循 `strategyTimeoutMs`。
2. `no_fill` 为正常无候选。
3. `error` 为处理异常（可重试/不可重试分类）。

可用性边界：
1. 默认 fail-open。
2. 强策略场景允许 fail-closed。

详细执行合同见 `3.6.24` ~ `3.6.27`（Route Plan + Strategy 冻结）。

#### 3.6.4 输出合同

1. 标准候选结果集合或空结果。
2. 路由轨迹与降级轨迹。
3. 状态更新（进入 `routed` 并最终走向终态）。
4. 详细字段合同见 `3.6.29` ~ `3.6.33`（`D -> E` 与路由审计快照冻结）。

#### 3.6.5 D 输入合同（C -> D，MVP 冻结）

`Module C -> Module D` 标准输入对象冻结为 `dOrchestrationInputLite`。

required：
1. `cPolicyDecisionLite`
   - `opportunityKey`
   - `traceKey`
   - `requestKey`
   - `attemptKey`
   - `finalPolicyAction`
   - `isRoutable=true`（D 仅消费可路由路径）
   - `policyDecisionReasonCode`
   - `policySnapshotId`
   - `policySnapshotVersion`
   - `constraintsLite`
     - `constraintSetVersion`
     - `categoryConstraints`（`bcat`, `badv`）
     - `personalizationConstraints`（`nonPersonalizedOnly`）
     - `renderConstraints`（`disallowRenderModes`）
     - `sourceConstraints`（`sourceSelectionMode`, `allowedSourceIds`, `blockedSourceIds`）
   - `stateUpdate`（`fromState=received`, `toState=routed`）
   - `policyPackVersion`
   - `policyRuleVersion`
2. `routableOpportunityLite`
   - 可路由机会对象（供 adapter 请求改写）
   - 策略降级标记（若有）
3. `policyAuditSnapshotLite`
4. `routingContextLite`
   - `routingPolicyVersion`
   - `routeBudgetMs`
   - `fallbackProfileVersion`
   - `executionStrategyLite`
     - `strategyType`
     - `parallelFanout`
     - `strategyTimeoutMs`
     - `fallbackPolicy`
     - `executionStrategyVersion`

optional：
1. `policyWarnings`
2. `extensions`

版本锚点（输入必须可定位版本）：
1. `dInputContractVersion`
2. `schemaVersion`（来自上游对象）
3. `policyPackVersion`
4. `policyRuleVersion`
5. `routingPolicyVersion`
6. `fallbackProfileVersion`
7. `policySnapshotVersion`
8. `constraintSetVersion`
9. `executionStrategyVersion`

#### 3.6.6 缺失字段处置（MVP）

缺失处置动作只允许：`continue` / `degrade` / `reject`。

1. required 缺失：
   - 动作：`reject`。
   - 原因码：`d_missing_required_field`。
2. optional 缺失：
   - 动作：`continue`（记录 warning，不阻断主链）。
   - 原因码：`d_optional_missing_ignored`。
3. `isRoutable != true` 或 `stateUpdate.toState != routed`：
   - 动作：`reject`（输入路径非法）。
   - 原因码：`d_invalid_route_input_state`。

一致性约束：
1. 同请求同版本下，缺失处置动作必须一致。
2. D 不得静默补齐 required 字段。

#### 3.6.7 非法值处置（MVP）

1. 结构非法（关键对象非对象、trace 主键缺失）：
   - 动作：`reject`。
   - 原因码：`d_invalid_structure`。
2. 版本锚点非法或缺失（`routingPolicyVersion` 等）：
   - 动作：`reject`。
   - 原因码：`d_invalid_version_anchor`。
3. 路由预算非法（`routeBudgetMs <= 0` 或非数值）：
   - 动作：`degrade` 到默认预算并继续。
   - 原因码：`d_invalid_route_budget_corrected`。
4. 供给上下文非法（source 列表为空且无 fallback）：
   - 动作：`reject`。
   - 原因码：`d_invalid_supply_context`。
5. 执行策略合同非法（`strategyType` 非法、`parallelFanout` 与策略不匹配、`strategyTimeoutMs <= 0`）：
   - 动作：`reject`。
   - 原因码：`d_invalid_execution_strategy_contract`。

审计要求：
1. 记录 `traceKey`、字段路径、原值、处置动作、原因码、规则版本。

#### 3.6.8 MVP 验收基线（D 输入合同）

1. D 仅接收 `isRoutable=true` 的 C 输出，不接收阻断路径对象。
2. required 缺失或非法输入不会触发 adapter 调用。
3. 版本锚点完整，可定位“按哪套路由规则执行”。
4. 同请求在同版本下输入判定与处置动作可复现。
5. 任一输入拒绝可通过 `traceKey + reasonCode` 分钟级定位。
6. `sourceConstraints` 缺失或非法时不得进入正常路由执行。
7. `executionStrategyLite` 缺失或非法时不得进入 Route Plan 生成。

#### 3.6.9 Adapter 注册与能力声明（MVP 冻结）

每个 adapter 在进入路由编排前必须完成注册并声明能力；未注册或声明不完整不得参与编排。

`adapterRegistryEntryLite` required：
1. `sourceId`（全局唯一、稳定不变）
2. `adapterId`
3. `sourceType`（`alliance` / `simulated_inventory`）
4. `status`（`active` / `paused` / `draining` / `disabled`）
5. `adapterContractVersion`
6. `capabilityProfileVersion`
7. `supportedCapabilities`
   - 最小集合：`request_adapt`, `candidate_normalize`, `error_normalize`, `source_trace`
8. `supportedPlacementTypes`（最小可支持列表）
9. `timeoutPolicyMs`（该 source 的默认超时策略）
10. `owner`（责任归属）
11. `updatedAt`

optional：
1. `extensions`
2. `tags`

#### 3.6.10 能力声明约束与启停状态语义（MVP）

能力约束：
1. `supportedCapabilities` 必须覆盖四项最小能力，否则注册拒绝。
2. `adapterContractVersion` 与 `capabilityProfileVersion` 必须显式声明，禁止隐式继承。
3. `supportedPlacementTypes` 为空时视为无可服务能力，不可进入可用池。

启停状态语义：
1. `active`：可参与新请求路由。
2. `paused`：不参与新请求；在途请求允许完成。
3. `draining`：仅处理已分配在途，不接收新分配。
4. `disabled`：完全不可用，不参与任何路由与回退。

路由消费规则：
1. D 仅从 `active` source 选主路由。
2. `paused/draining/disabled` source 不得成为新主路由候选。
3. 状态变更必须带 `statusReasonCode` 并写审计。

#### 3.6.11 MVP 验收基线（Adapter 注册与能力声明）

1. 未注册 adapter 无法进入路由编排路径。
2. 缺少最小能力声明的 source 会被稳定拒绝并给出标准原因码。
3. source 启停状态切换后，路由行为能在单版本下稳定一致。
4. 单请求可回放“所选 source 的注册快照 + 能力快照 + 状态快照”。
5. 同 `sourceId` 在同版本下能力声明不可漂移，变更必须版本化。

#### 3.6.12 request adapt 子合同（MVP 冻结）

`request adapt` 输入输出冻结为：
1. 输入：`dOrchestrationInputLite + adapterRegistryEntryLite`
2. 输出：`sourceRequestLite`

`sourceRequestLite` required：
1. `sourceId`
2. `sourceRequestId`
3. `opportunityKey`
4. `traceKey`
5. `requestKey`
6. `attemptKey`
7. `placementType`
8. `channelType`
9. `actorType`
10. `policyDecision`（`finalPolicyAction`, `policyDecisionReasonCode`）
11. `policySnapshot`（`policySnapshotId`, `policySnapshotVersion`）
12. `policyConstraints`
   - `bcat`
   - `badv`
   - `nonPersonalizedOnly`
   - `disallowRenderModes`
   - `sourceSelectionMode`
   - `allowedSourceIds`
   - `blockedSourceIds`
13. `routeContext`（`routePath`, `routeHop`, `routingPolicyVersion`, `strategyType`, `dispatchMode`）
14. `timeoutBudgetMs`
15. `sentAt`
16. `adapterContractVersion`

optional：
1. `sourceHints`
2. `extensions`

#### 3.6.13 超时预算传递规则（MVP）

预算传递采用“全局预算 -> source 预算”的单向扣减模型：
1. 输入预算：`routeBudgetMs`（来自 `routingContextLite`）。
2. source 默认预算：`timeoutPolicyMs`（来自 `adapterRegistryEntryLite`）。
3. 实际 `timeoutBudgetMs = min(remainingRouteBudgetMs, timeoutPolicyMs)`。
4. 若 `timeoutBudgetMs <= 0`，本路不发请求，直接进入下一路由并记录原因码 `d_route_budget_exhausted`。

预算一致性约束：
1. 每次 route hop 都必须记录预算快照（before/after）。
2. budget 计算必须可复现，禁止 source 自行改写预算。

#### 3.6.14 扩展字段边界（MVP）

1. source 私有字段仅允许写入 `extensions`，不得进入主语义 required 字段。
2. `extensions` 禁止覆盖或改写 canonical 字段（如 `placementType`, `policyDecision`, `timeoutBudgetMs`）。
3. `extensions` 的 key 必须命名空间化：`x_<sourceId>_*`。
4. `extensions` 超过体积上限时执行截断并记录 `d_extensions_truncated`。

违规处置：
1. 主语义污染 -> `reject`，原因码 `d_extension_pollution_detected`。
2. 非法命名或超限 -> `degrade` 并保留最小主语义。

#### 3.6.15 MVP 验收基线（request adapt）

1. 任一 source request 都包含最小 required 字段且可被下游 source 消费。
2. 超时预算传递在多 hop 路由下可审计回放且结果一致。
3. `extensions` 不会污染主语义字段。
4. 同请求同版本下 `sourceRequestLite` 可稳定复现。
5. `request adapt` 失败不会造成主链路状态断裂，且可通过 `traceKey + reasonCode` 定位。

#### 3.6.16 candidate normalize 子合同（MVP 冻结）

`candidate normalize` 输入输出冻结为：
1. 输入：`sourceCandidateRawLite`
2. 输出：`normalizedCandidateLite`

`normalizedCandidateLite` required：
1. `sourceId`
2. `sourceCandidateId`
3. `opportunityKey`
4. `traceKey`
5. `requestKey`
6. `attemptKey`
7. `candidateStatus`（`eligible` / `no_fill` / `error`）
8. `pricing`
   - `bidValue`
   - `currency`
9. `creativeRef`
   - `creativeId`
   - `landingType`
10. `policyFlags`
11. `normalizeMeta`
   - `candidateNormalizeVersion`
   - `mappingProfileVersion`
   - `normalizedAt`

optional：
1. `qualityScore`
2. `predictedCtr`
3. `latencyMs`
4. `extensions`

#### 3.6.17 排序字段与排序规则（MVP）

候选排序字段（固定优先级）：
1. `rankPrimary`：`bidValue`（高优先）
2. `rankSecondary`：`qualityScore`（高优先，缺失按最小值）
3. `rankTertiary`：`latencyMs`（低优先）
4. `rankTieBreak`：`sourceId + sourceCandidateId` 字典序

排序约束：
1. 仅 `candidateStatus=eligible` 参与正常排序。
2. `no_fill/error` 候选不参与排名，但必须保留审计记录。
3. 同请求同版本下排序结果必须确定性一致。

#### 3.6.18 缺失处理与 canonical 映射（MVP）

缺失处理：
1. required 缺失：
   - 动作：丢弃该候选（不阻断整请求）。
   - 原因码：`d_candidate_required_missing`。
2. optional 缺失：
   - 动作：补默认值或 `unknown_*`，继续参与流程。
   - 原因码：`d_candidate_optional_default_applied`。

canonical 映射规则：
1. 先做 raw 预处理（trim/lowercase/alias 归一），再映射 canonical 枚举。
2. `candidateStatus`、`currency`、`landingType` 必须映射到 canonical 集合。
3. canonical 失败：
   - required 枚举失败 -> 丢弃候选，原因码 `d_candidate_invalid_required_enum`。
   - optional 枚举失败 -> 回退 `unknown_*`，原因码 `d_candidate_invalid_optional_enum`。

映射审计最小字段（每候选必填）：
1. `raw`
2. `normalized`
3. `mappingAction`（`exact_match` / `alias_map` / `unknown_fallback` / `drop`）
4. `ruleVersion`

#### 3.6.19 MVP 验收基线（candidate normalize）

1. 任一 source 候选可稳定归一成 `normalizedCandidateLite` 或被可解释丢弃。
2. 候选排序在同请求同版本下稳定一致，不出现随机顺序。
3. required 缺失仅影响单候选，不影响其他候选处理。
4. canonical 映射全程可审计回放（raw -> normalized -> action -> version）。
5. D 层可基于归一候选直接进入后续 Delivery 组装，不需二次猜字段。

#### 3.6.20 error normalize 子合同（MVP 冻结）

`error normalize` 输入输出冻结为：
1. 输入：`sourceOutcomeRawLite`（承接 source 的 `no_fill` / `timeout` / `error` 原始结果）
2. 输出：`normalizedSourceOutcomeLite`

`normalizedSourceOutcomeLite` required：
1. `sourceId`
2. `opportunityKey`
3. `traceKey`
4. `requestKey`
5. `attemptKey`
6. `outcomeType`（`no_fill` / `timeout` / `error`）
7. `retryClass`（`retryable` / `non_retryable`）
8. `reasonCode`（canonical 原因码）
9. `routeAction`（`retry_same_source` / `fallback_next_source` / `terminal`）
10. `normalizeMeta`
   - `errorNormalizeVersion`
   - `mappingProfileVersion`
   - `normalizedAt`

optional：
1. `rawCode`
2. `rawMessage`
3. `httpStatus`
4. `networkPhase`
5. `elapsedMs`
6. `extensions`

#### 3.6.21 标准化状态与重试语义（MVP）

标准化语义：
1. `no_fill`：
   - `retryClass=non_retryable`（同 source 不重试）
   - 默认 `routeAction=fallback_next_source`
2. `timeout`：
   - 默认 `retryClass=retryable`
   - 若预算耗尽或达到重试上限，降级为 `retryClass=non_retryable` 且 `routeAction=fallback_next_source`
3. `error`：
   - 必须归一到 `retryable` 或 `non_retryable`
   - `retryable` 仅限瞬时故障；`non_retryable` 为请求/合同/授权等确定性故障

判定顺序（固定）：
1. 先判定 `timeout`（传输/连接/读超时）
2. 再判定 `error`（协议/鉴权/请求结构/上游异常）
3. 最后判定 `no_fill`（业务无候选）
4. 均不命中时归入 `error + non_retryable`，原因码 `d_en_unknown`

一致性约束：
1. 同请求同版本下，`outcomeType/retryClass/routeAction` 必须确定性一致。
2. 禁止用自由文本直接驱动重试动作，必须落到 canonical 字段。

#### 3.6.22 原因码体系与映射规则（MVP）

原因码前缀约定：
1. `d_nf_*`：`no_fill`
2. `d_to_*`：`timeout`
3. `d_er_*`：`error + retryable`
4. `d_en_*`：`error + non_retryable`

最小原因码集合：
1. `no_fill`：
   - `d_nf_inventory_unavailable`
   - `d_nf_targeting_unmatched`
   - `d_nf_policy_filtered`
   - `d_nf_budget_exhausted`
   - `d_nf_frequency_capped`
   - `d_nf_unknown`
2. `timeout`：
   - `d_to_connect_timeout`
   - `d_to_read_timeout`
   - `d_to_source_deadline_exceeded`
   - `d_to_route_budget_exhausted`
3. `error + retryable`：
   - `d_er_upstream_5xx`
   - `d_er_rate_limited`
   - `d_er_transient_network`
   - `d_er_dependency_unavailable`
4. `error + non_retryable`：
   - `d_en_auth_failed`
   - `d_en_invalid_request`
   - `d_en_contract_mismatch`
   - `d_en_unsupported_placement`
   - `d_en_malformed_response`
   - `d_en_policy_rejected`
   - `d_en_unknown`

映射规则：
1. 每条原始结果必须映射到唯一 `outcomeType + retryClass + reasonCode`。
2. 映射必须记录 `rawCode/rawMessage + normalized + mappingAction + ruleVersion`。
3. 若 source 返回原因与本地判定冲突，以本地判定优先并记录 `d_error_mapping_conflict_resolved`。
4. 未识别原始错误统一落 `d_en_unknown`，避免重试风暴。

#### 3.6.23 MVP 验收基线（error normalize）

1. 任一 source 异常结果可稳定归一到 `no_fill/timeout/error` 之一。
2. `error` 均可被稳定判定为 `retryable` 或 `non_retryable`，不出现未分类状态。
3. 同请求同版本下，归一结果与 `routeAction` 可复现。
4. 原始错误与 canonical 结果可审计回放（含原因码与规则版本）。
5. `error normalize` 输出可被路由层直接消费，不需再做二次猜测。

#### 3.6.24 路由执行计划（Route Plan，MVP 冻结）

`routePlanLite` 作为 D 层执行计划对象，冻结为：
1. `routePlanId`
2. `opportunityKey`
3. `traceKey`
4. `requestKey`
5. `attemptKey`
6. `routingPolicyVersion`
7. `fallbackProfileVersion`
8. `executionStrategyLite`
   - `strategyType`
   - `parallelFanout`
   - `strategyTimeoutMs`
   - `fallbackPolicy`
   - `executionStrategyVersion`
9. `routeSteps`（按执行顺序）
10. `routePlanStatus`（`planned` / `executing` / `completed` / `terminated`）
11. `plannedAt`

`routeSteps` 每项 required：
1. `stepIndex`
2. `routeTier`（`primary` / `secondary` / `fallback`）
3. `sourceId`
4. `entryCondition`
5. `timeoutBudgetMs`
6. `maxRetryCount`
7. `dispatchMode`（`sequential` / `parallel_batch`）
8. `stepStatus`（`pending` / `running` / `skipped` / `finished`）

#### 3.6.25 主/次/fallback 触发条件（按 executionStrategyLite，MVP）

触发条件按 `strategyType` 冻结如下：
1. `waterfall`：
   - `primary`：source 为 `active`，能力声明覆盖 placement，通过 `sourceConstraints` 过滤，预算可分配（`timeoutBudgetMs > 0`），按序发起首路请求。
   - `secondary`：`primary` 返回 `no_fill`，或返回 `timeout/error + retryClass=non_retryable`，或预算耗尽时切换下一优先级 source。
   - `fallback`：`primary + secondary` 均未产生可交付候选，且 fallback 池存在可用 source 时按序尝试。
2. `bidding`：
   - `primary`：同 tier source 按 `parallelFanout` 并发发起请求。
   - `secondary`：默认不启用（除非配置显式定义 secondary bidding pool）。
   - `fallback`：并发批次无可交付候选时，按 `fallbackPolicy` 决定是否触发 fallback。
3. `hybrid`：
   - `primary`：先执行 primary bidding（并发）。
   - `secondary/fallback`：primary bidding 无可交付候选后，转入顺序 fallback。

阻断条件：
1. `policy` 指示不可路由（`isRoutable=false`）时，不生成 Route Plan。
2. 无可用 source 且无 fallback 时，直接 `terminal`，原因码 `d_route_no_available_source`。

source 过滤规则（MVP 冻结）：
1. 先按 `sourceSelectionMode` 生成初始可用池：
   - `all_except_blocked`：以 `active` source 集合作为初始池。
   - `allowlist_only`：以 `allowedSourceIds` 与 `active` source 交集作为初始池。
2. 再应用 `blockedSourceIds` 扣减（优先级高于 allowlist）。
3. 过滤后为空：直接 `terminal`，原因码 `d_route_no_available_source`。
4. 过滤决策必须写入 `routeAuditSnapshotLite.sourceFilterSnapshot`，用于回放“哪些 source 被策略剔除”。
5. 过滤后的 source 池必须满足 `executionStrategyLite` 的并发与降级约束（`parallelFanout/fallbackPolicy`）。

#### 3.6.26 同级 tie-break 规则（MVP，确定性）

当同一 `routeTier` 内有多个候选 source 时，按固定规则链路裁决：
1. `sourcePriorityScore`（高优先）。
2. `historicalSuccessRate`（高优先，窗口固定）。
3. `p95LatencyMs`（低优先）。
4. `costWeight`（低优先）。
5. `sourceId` 字典序（最终稳定 tie-break）。

裁决约束：
1. 每次 tie-break 必须记录命中规则与比较值快照。
2. 同请求同版本下，同级 source 的选中结果必须一致。
3. 任何随机因子不得参与 MVP tie-break。

#### 3.6.27 短路规则（MVP）

Route Plan 仅允许三类短路动作：
1. `short_circuit_served`：一旦产出可交付候选，立即终止后续 route step。
2. `short_circuit_terminal`：命中不可恢复终态（如 `policy_block` 或全局预算耗尽），立即停止。
3. `short_circuit_exhausted`：所有 step 已执行且无可交付结果，结束为 `no_fill`。

短路判定优先级（固定）：
1. `served` 优先于一切后续路由。
2. `terminal` 优先于继续重试/切路由。
3. `exhausted` 仅在无更高优先级短路命中时触发。

短路审计最小字段：
1. `routePlanId`
2. `triggerStepIndex`
3. `shortCircuitAction`
4. `shortCircuitReasonCode`
5. `budgetSnapshotBeforeAfter`
6. `ruleVersion`

#### 3.6.28 MVP 验收基线（Route Plan）

1. 任一请求都能生成或拒绝生成确定性的 `routePlanLite`（含原因码）。
2. 主/次/fallback 触发行为在同请求同版本下可复现。
3. 同级 tie-break 决策可审计回放，不出现随机漂移。
4. 任一短路动作都可定位到触发 step、原因码与版本快照。
5. Route Plan 输出可被 E/F/G 直接消费，不需要二次推断路由过程。
6. `routePlanLite.executionStrategyLite.strategyType` 与实际执行行为一致且可回放。

#### 3.6.29 D 输出合同（D -> E，MVP 冻结）

`Module D -> Module E` 标准输出对象冻结为 `dToEOutputLite`。

`dToEOutputLite` required：
1. `opportunityKey`
2. `traceKey`
3. `requestKey`
4. `attemptKey`
5. `hasCandidate`（`true` / `false`）
6. `candidateCount`
7. `normalizedCandidates`（有序列表，允许为空）
8. `policyConstraintsLite`
   - `constraintSetVersion`
   - `categoryConstraints`（`bcat`, `badv`）
   - `personalizationConstraints`（`nonPersonalizedOnly`）
   - `renderConstraints`（`disallowRenderModes`）
   - `sourceConstraints`（`sourceSelectionMode`, `allowedSourceIds`, `blockedSourceIds`）
9. `routeConclusion`
   - `routePlanId`
   - `strategyType`
   - `routeOutcome`（`served_candidate` / `no_fill` / `error`）
   - `finalRouteTier`（`primary` / `secondary` / `fallback` / `none`）
   - `finalAction`（`deliver` / `no_fill` / `terminal_error`）
   - `finalReasonCode`
   - `fallbackUsed`（`true` / `false`）
10. `routeAuditSnapshotLite`（结构见 `3.6.32`）
11. `stateUpdate`
   - `fromState`（固定 `routed`）
   - `toState`（`served` / `no_fill` / `error`）
   - `statusReasonCode`
   - `updatedAt`
12. `versionAnchors`
   - `dOutputContractVersion`
   - `routingPolicyVersion`
   - `fallbackProfileVersion`
   - `candidateNormalizeVersion`
   - `errorNormalizeVersion`
   - `constraintSetVersion`
   - `executionStrategyVersion`

optional：
1. `winningCandidateRef`
2. `warnings`
3. `extensions`

#### 3.6.30 候选存在性、路由结论与状态更新约束（MVP）

存在性约束：
1. `hasCandidate=true` 时：`candidateCount >= 1` 且 `normalizedCandidates` 非空。
2. `hasCandidate=false` 时：`candidateCount=0` 且 `normalizedCandidates` 为空列表。
3. `normalizedCandidates` 必须沿用 D 层既定排序结果，E 不得重排。

路由结论约束：
1. `routeOutcome=served_candidate` -> `finalAction=deliver`，且 `finalRouteTier != none`。
2. `routeOutcome=no_fill` -> `finalAction=no_fill`，且允许 `finalRouteTier=none`。
3. `routeOutcome=error` -> `finalAction=terminal_error`，并携带标准化错误原因码。
4. 任一输出都必须附带唯一 `finalReasonCode`（不可空）。
5. `routeConclusion.strategyType` 必须与 `routePlanLite.executionStrategyLite.strategyType` 一致。

状态更新约束：
1. `hasCandidate=true` 必须映射为 `stateUpdate.toState=served`。
2. `hasCandidate=false` 且 `routeOutcome=no_fill` 必须映射为 `stateUpdate.toState=no_fill`。
3. `routeOutcome=error` 必须映射为 `stateUpdate.toState=error`。
4. `stateUpdate.statusReasonCode` 必须与 `routeConclusion.finalReasonCode` 一致。

#### 3.6.31 MVP 验收基线（D 输出合同）

1. E 层可仅基于 `dToEOutputLite` 完成 Delivery 组装，不依赖隐式上下文。
2. “是否有候选”与候选列表在同请求同版本下结论一致且可复现。
3. 路由结论（`routeOutcome/finalAction/finalReasonCode`）可审计回放。
4. `stateUpdate` 与路由结论不发生语义冲突（served/no_fill/error 一致）。
5. 任一 `D -> E` 输出可通过 `traceKey + requestKey + attemptKey` 分钟级定位。
6. `policyConstraintsLite` 在 C 输入、source request 与 D 输出间逐字段一致（允许仅透传，不允许重写语义）。
7. `strategyType` 在 D 输入、Route Plan、D 输出、审计快照之间一致。

#### 3.6.32 路由审计快照（`routeAuditSnapshotLite`，MVP 冻结）

`routeAuditSnapshotLite` 是 D 层唯一权威路由审计对象，用于回放“如何选路、为何切路、最终走了哪条路”。

required：
1. `traceKeys`
   - `traceKey`
   - `requestKey`
   - `attemptKey`
   - `opportunityKey`
2. `routingHitSnapshot`
   - `routePlanId`
   - `strategyType`
   - `hitRouteTier`（`primary` / `secondary` / `fallback`）
   - `hitSourceId`
   - `hitStepIndex`
3. `sourceFilterSnapshot`
   - `sourceSelectionMode`
   - `inputAllowedSourceIds`
   - `inputBlockedSourceIds`
   - `filteredOutSourceIds`
   - `effectiveSourcePoolIds`
4. `routeSwitches`
   - `switchCount`
   - `switchEvents[]`（按时间顺序）
     - `fromSourceId`
     - `toSourceId`
     - `switchReasonCode`
     - `switchAt`
5. `finalRouteDecision`
   - `finalSourceId`（允许 `none`）
   - `finalRouteTier`（`primary` / `secondary` / `fallback` / `none`）
   - `finalOutcome`（`served_candidate` / `no_fill` / `error`）
   - `finalReasonCode`
   - `selectedAt`
6. `versionSnapshot`
   - `routingPolicyVersion`
   - `fallbackProfileVersion`
   - `adapterRegistryVersion`
   - `routePlanRuleVersion`
   - `executionStrategyVersion`
7. `snapshotMeta`
   - `routeAuditSchemaVersion`
   - `generatedAt`

一致性约束：
1. `finalRouteDecision.finalReasonCode` 必须与 `routeConclusion.finalReasonCode` 一致。
2. `traceKeys` 必须与 `dToEOutputLite` 主键一致。
3. `switchEvents` 为空时，`switchCount` 必须为 `0`。
4. 任一 `switchReasonCode` 必须来自标准原因码集合（不可自由文本）。
5. `sourceFilterSnapshot.effectiveSourcePoolIds` 必须等于 Route Plan 实际参与选路 source 集。
6. `routingHitSnapshot.strategyType` 必须与 `routeConclusion.strategyType` 一致。

#### 3.6.33 MVP 验收基线（路由审计快照）

1. 每个 D 输出都包含且仅包含一份 `routeAuditSnapshotLite`。
2. 可从快照完整还原“命中路由 -> 切路原因 -> 最终选路”。
3. 快照必须携带可定位的版本快照与 trace 键。
4. 同请求同版本下快照内容可复现，不出现顺序漂移。
5. E/G 可直接消费快照，无需额外拼接路由历史。
6. 可从快照还原 `sourceConstraints` 对 source 池的过滤结果，支持“为何某需求方未被请求”的对账。
7. 可从快照还原“按哪种 strategyType 执行、何时触发 fallback”的全过程。
