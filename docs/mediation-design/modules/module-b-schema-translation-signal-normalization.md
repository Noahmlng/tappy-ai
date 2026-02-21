### 3.4 Module B: Schema Translation & Signal Normalization

#### 3.4.1 统一 Opportunity Schema（共同语言）

当前版本冻结六块骨架：
1. `RequestMeta`
2. `PlacementMeta`
3. `UserContext`
4. `OpportunityContext`
5. `PolicyContext`
6. `TraceContext`

冻结方式：
1. 每块区分 required / optional。
2. 新能力优先放 optional，不破坏主语义。
3. 顶层冻结 `schemaVersion` 与 `state`。
4. 六块最小必填字段矩阵见 `3.4.21`，作为 B 输出合格性门槛。

#### 3.4.2 状态机（冻结）

`state` 固定枚举：
1. `received`
2. `routed`
3. `served`
4. `no_fill`
5. `error`

迁移约束：
1. 起始必须 `received`。
2. 终态必须为 `served/no_fill/error` 之一。
3. 任一迁移必须记录时间戳、原因码、规则版本。

#### 3.4.3 外部输入映射与冲突优先级

映射原则：
1. 先映射后决策。
2. 枚举必须归一后才可进入内部模型。
3. 同请求同规则版本下结果必须确定性一致。

冲突优先级（高 -> 低）：
1. `App Explicit`
2. `Placement Config`
3. `Default Policy`

冲突记录要求（每个语义位点）：
1. 原值（raw value）。
2. 归一值（normalized value）。
3. 冲突动作与原因码。
4. 生效规则版本。

#### 3.4.4 旧 SSP 与新增 AI 信号对齐

1. 必兼容旧 SSP 基础语义：请求、placement、环境、响应/回传基础口径。
2. 当前增量 AI 信号：workflow 阶段、human/agent 主体、意图快照、任务上下文。
3. 对外不支持的新信号先内部沉淀，不破坏现有兼容性。

#### 3.4.5 输出合同

1. 可交易的统一机会对象（SSP-like request profile 基底）。
2. 映射审计记录（支持回放）。
3. 下游可直接消费的标准枚举与状态。

#### 3.4.6 B 输入合同（A -> B，MVP 冻结）

当前版本冻结 `A -> B` 最小输入包 `bIngressPacketLite`，B 不再猜字段。

required（缺失即不可继续映射）：
1. `opportunitySeed`
   - 最小语义：`opportunityKey`、`state=received`、基础请求上下文引用。
2. `traceInitLite`
   - `traceKey`、`requestKey`、`attemptKey`。
3. `triggerSnapshotLite`
   - `triggerType`、`triggerDecision`。
4. `sensingDecisionLite`
   - `decisionOutcome`、`hitType`、`confidenceBand`。
5. `sourceInputBundleLite`
   - 三路输入快照：`appExplicit`、`placementConfig`、`defaultPolicy`（可为空对象，但槽位必须存在）。

optional（缺失可降级）：
1. `aErrorLite`
   - A 层异常快照（供 B 审计承载与原因串联）。
2. `aLatencyBudgetLite`
   - A 层预算结论（供 B 做超时保护决策）。
3. `debugHints`
   - 联调辅助字段，不进入主语义。

版本锚点：
1. `bInputContractVersion`（A 与 B 共同冻结，默认随主文档版本发布）。

#### 3.4.7 缺失处理规则（MVP）

缺失处理动作只允许三类：`continue` / `degrade` / `reject`。

1. required 缺失：
   - 动作：`reject`。
   - 结果：B 产出标准错误结果并将机会状态置为 `error`，不进入正常路由。
   - 原因码：`b_missing_required_field`。
2. optional 缺失：
   - 动作：`degrade`。
   - 结果：写默认值或 `unknown_*`，并记录 `mappingWarning`。
   - 原因码：`b_optional_default_applied`。
3. required 槽位存在但为空对象（仅 `sourceInputBundleLite` 允许）：
   - 动作：`degrade`。
   - 结果：仅用已存在来源参与映射与冲突裁决，缺失来源按“无输入”处理并记录告警。
   - 原因码：`b_source_slot_empty`。

一致性约束：
1. 同请求、同 `bInputContractVersion`、同规则版本下，缺失处理动作必须一致。
2. B 不得静默补齐 required 字段。

#### 3.4.8 非法值处理规则（MVP）

非法值分三类并固定处置：

1. 结构非法（类型错误、trace 主键格式错误、必需对象非对象）：
   - 动作：`reject`。
   - 原因码：`b_invalid_structure` / `b_invalid_trace_context`。
2. 枚举非法（不在归一字典）：
   - required 语义位点：`reject`，原因码 `b_invalid_required_enum`。
   - optional 语义位点：`degrade` 到 `unknown_*`，原因码 `b_invalid_optional_enum`。
3. 值域非法（超界、时间戳异常、互斥组合冲突）：
   - 可修正：`degrade`（按默认策略修正并记审计），原因码 `b_value_corrected`。
   - 不可修正：`reject`，原因码 `b_invalid_value_range`。

审计要求（每次非法值都必须记录）：
1. `rawValue`
2. `normalizedValue`（若存在）
3. `disposition`（reject/degrade）
4. `reasonCode`
5. `ruleVersion`

#### 3.4.9 MVP 验收基线（B 输入合同）

1. A->B 输入在字段级可判定（required/optional 无歧义）。
2. required 缺失或 required 非法值不会进入 C/D 正常主链路。
3. optional 缺失/非法值可受控降级且不破坏可回放性。
4. 同请求在同版本下映射结果与处置动作可复现。
5. B 错误结果可通过 `traceKey + reasonCode` 分钟级定位。

#### 3.4.10 Canonical 枚举字典（MVP 冻结）

当前版本冻结 `enumDictionaryLite`，用于消除跨来源枚举歧义。

最小语义槽位（MVP）：
1. `triggerDecision`
   - `opportunity_eligible` / `opportunity_ineligible` / `opportunity_blocked_by_policy` / `unknown_trigger_decision`
2. `decisionOutcome`
   - `opportunity_eligible` / `opportunity_ineligible` / `opportunity_blocked_by_policy` / `unknown_decision_outcome`
3. `hitType`
   - `explicit_hit` / `workflow_hit` / `contextual_hit` / `scheduled_hit` / `policy_forced_hit` / `no_hit` / `unknown_hit_type`
4. `placementType`
   - `chat_inline` / `tool_result` / `workflow_checkpoint` / `agent_handoff` / `unknown_placement_type`
5. `actorType`
   - `human` / `agent` / `agent_chain` / `system` / `unknown_actor_type`
6. `channelType`
   - `sdk_server` / `sdk_client` / `webhook` / `batch` / `unknown_channel_type`

字典治理（最小）：
1. 独立版本：`enumDictVersion`。
2. 每个语义槽位都必须声明 canonical 集合和 alias 映射规则。
3. 映射结果必须带 `enumDictVersion` 写入审计快照。

#### 3.4.11 raw -> canonical 映射规则（MVP）

固定映射流程：
1. 预处理：去首尾空格、统一小写、下划线归一。
2. 按语义槽位查 alias 表，命中则映射到 canonical。
3. 未命中按 `unknown` 回退策略执行（见 `3.4.12`）。
4. 记录映射动作（`exact_match` / `alias_map` / `unknown_fallback` / `reject`）。

最小映射表示例：

| semanticSlot | raw value (example) | canonical | action |
|---|---|---|---|
| `placementType` | `chat-inline`, `in_message` | `chat_inline` | `alias_map` |
| `placementType` | `tool-output`, `function_result` | `tool_result` | `alias_map` |
| `actorType` | `end_user`, `human_user` | `human` | `alias_map` |
| `actorType` | `assistant_agent`, `auto_agent` | `agent` | `alias_map` |
| `channelType` | `sdk_http`, `rest` | `sdk_server` | `alias_map` |
| `hitType` | `explicit_intent`, `intent_hit` | `explicit_hit` | `alias_map` |
| `placementType` | `unknown_widget_x` | `unknown_placement_type` | `unknown_fallback` |

#### 3.4.12 `unknown` 回退值策略（MVP）

回退原则：
1. 每个枚举槽位必须有唯一 `unknown_*` 值，禁止空值落地。
2. 同 raw 值在同 `enumDictVersion` 下必须稳定映射到同 `unknown_*`。
3. `unknown_*` 必须记录原始值和来源，供字典迭代。

与非法值处置的边界（与 `3.4.8` 对齐）：
1. 主链路 gating 槽位（`decisionOutcome`、`hitType`、`triggerDecision`）命中 `unknown_*` 时按 `reject` 处理。
2. 非 gating 槽位（`placementType`、`actorType`、`channelType`）允许 `unknown_*` 并按 `degrade` 处理。
3. B 不得将 `unknown_*` 直接解释为积极路由信号；下游按保守策略消费。

#### 3.4.13 MVP 验收基线（Canonical 枚举字典）

1. 同语义 raw 值跨来源能稳定归一到同 canonical 值。
2. `unknown_*` 回退不会导致同请求在 C/D 侧出现策略分叉。
3. 任一映射都可追溯到 `enumDictVersion + mappingAction + rawValue`。
4. gating 槽位的 `unknown_*` 会被稳定拦截，不进入正常路由。
5. 非 gating 槽位命中 `unknown_*` 时请求仍可受控跑通主链路。

#### 3.4.14 字段级冲突裁决引擎（MVP 冻结）

当前版本冻结 `fieldConflictResolverLite`，按“字段级”而非“请求级”裁决冲突。

冲突检测单元：
1. 语义位点（`semanticSlot`）是最小裁决单元。
2. 同一 `semanticSlot` 出现 2 个及以上不同 canonical 值即视为冲突。
3. 冲突输入只接收已归一的候选值（先 canonical，后裁决）。

字段策略（最小）：
1. `scalar`（默认）：只允许 `override` 或 `reject`。
2. `set_like`（白名单字段）：允许 `merge`（并集去重）或 `override` 或 `reject`。
3. 未声明字段默认按 `scalar` 处理，避免隐式 merge。

#### 3.4.15 冲突动作与原因码（MVP）

冲突动作冻结为三类：
1. `override`
   - 语义：选择单一胜出值覆盖其余候选。
   - 主要触发：来源优先级可判定或 tie-break 可判定。
2. `merge`
   - 语义：仅对白名单 `set_like` 字段做稳定并集（去重 + 排序）。
   - 主要触发：多来源标签类值可兼容。
3. `reject`
   - 语义：冲突不可安全裁决，直接拒绝该请求进入正常主链。
   - 主要触发：gating 槽位硬冲突或字段不允许 merge/override。

最小原因码集：
1. `b_conflict_override_by_priority`
2. `b_conflict_override_by_tie_break`
3. `b_conflict_merge_union`
4. `b_conflict_reject_gating_hard`
5. `b_conflict_reject_unmergeable`

#### 3.4.16 同优先级 tie-break（MVP，确定性）

当冲突候选来源优先级相同，按固定链路裁决，禁止随机行为：
1. 优先非 `unknown_*` 值。
2. 优先 `inputUpdatedAt` 更新更晚的候选。
3. 若仍相同，优先 `sourceSequence` 更大的候选（同源输入顺序）。
4. 若仍相同，按 `normalizedValue` 字典序最小值胜出（最终确定性兜底）。

tie-break 约束：
1. 每次同优先级裁决必须记录命中的 tie-break 规则。
2. 同请求、同版本下必须得到相同胜出值。
3. 任一字段命中 tie-break 都必须产出原因码 `b_conflict_override_by_tie_break`。

#### 3.4.17 裁决审计输出与 MVP 验收基线

`conflictResolutionSnapshotLite` 最小输出：
1. `semanticSlot`
2. `candidates`（source, rawValue, normalizedValue, sourcePriority）
3. `conflictAction`（override/merge/reject）
4. `selectedValue`（reject 时为空）
5. `reasonCode`
6. `tieBreakRule`（未命中可空）
7. `conflictPolicyVersion`

MVP 验收基线：
1. 同请求在同 `conflictPolicyVersion` 下不会出现多结果。
2. 非白名单字段不会发生隐式 `merge`。
3. 同优先级冲突可稳定复现并可回放解释。
4. `reject` 冲突不会进入 C/D 正常主链路。
5. 每次冲突都可通过 `traceKey + semanticSlot + reasonCode` 快速定位。

#### 3.4.18 B 输出合同（MVP 冻结）

`Module B -> Module C` 标准输出对象冻结为 `bNormalizedOpportunityLite`。

required：
1. `opportunityKey`
2. `schemaVersion`
3. `state`（保持 `received`，不在 B 层推进状态机终态）
4. 六块骨架最小对象：
   - `RequestMeta`
   - `PlacementMeta`
   - `UserContext`
   - `OpportunityContext`
   - `PolicyContext`
   - `TraceContext`
5. `normalizationSummary`
   - `normalizedAt`
   - `mappingProfileVersion`
   - `enumDictVersion`
   - `conflictPolicyVersion`
   - `openrtbProjectionVersion`
   - `redactionPolicyVersion`
6. `mappingAuditSnapshotLite`
7. 六块对象均满足 `3.4.21` 的 required 矩阵
8. `openrtbProjectionLite`
9. `openrtbProjectionVersion`
10. `projectionAuditSnapshotLite`
11. `redactionPolicyLite`
12. `redactionSnapshotLite`

optional：
1. `mappingWarnings`（仅告警，不改变主语义）
2. `extensions`（非核心语义扩展，禁止影响策略门禁主判断）

输出约束：
1. B 输出只能包含 canonical 值，不允许 raw 值直通到 C/D。
2. 若 required 语义位点无法产出 canonical 值，B 必须走 `reject`，不得输出残缺对象。
3. `openrtbProjectionLite` 只允许输出 `imp/app/device/user/regs/ext` 六类对象，不得引入非标准主路径字段。
4. exchange-specific 私有字段必须进入对应对象 `ext`，不得污染 canonical 主语义字段。
5. 任意审计对象写入前必须先完成脱敏（`redaction first, audit second`），违反即 `reject`。

#### 3.4.19 映射审计快照（`mappingAuditSnapshotLite`，MVP）

审计单元：
1. 以 `semanticSlot` 为最小粒度，每个被处理位点输出一条审计记录。

每条审计记录必填项（冻结）：
1. `semanticSlot`
2. `raw`（脱敏后原值视图，若多来源冲突可为数组）
3. `normalized`（归一值）
4. `conflictAction`（`override` / `merge` / `reject` / `none`）
5. `ruleVersion`（映射或冲突裁决生效规则版本）

建议必填项（当前版本默认开启）：
1. `reasonCode`
2. `source`（appExplicit/placementConfig/defaultPolicy）
3. `mappingAction`（exact_match/alias_map/unknown_fallback/value_corrected）
4. `auditTimestamp`

快照级必填元信息：
1. `traceKey`
2. `requestKey`
3. `bInputContractVersion`
4. `mappingProfileVersion`
5. `enumDictVersion`
6. `conflictPolicyVersion`
7. `redactionPolicyVersion`

执行顺序约束（P0）：
1. `mappingAuditSnapshotLite` 只允许记录脱敏后值，禁止写明文敏感原值。
2. 脱敏失败或顺序违规（先审计后脱敏）必须 `reject`，原因码 `b_redaction_before_audit_violation`。

#### 3.4.20 MVP 验收基线（B 输出合同 + mappingAudit）

1. C 层消费 B 输出时无需补字段或猜字段。
2. 每个处理过的 `semanticSlot` 都有审计记录，且包含 `raw(已脱敏)/normalized/conflictAction/ruleVersion`。
3. 同请求在同版本下 `bNormalizedOpportunityLite` 与 `mappingAuditSnapshotLite` 均可复现。
4. 任一策略或路由结果都可回溯到具体审计记录和规则版本。
5. B 输出缺失 `mappingAuditSnapshotLite` 时视为不合格输出，不得进入主链路。

#### 3.4.21 六块 Schema 最小 required 矩阵（MVP 冻结）

该矩阵是 `Module B` 到 `Module C/D` 的最小消费合同；缺失任一 required 字段即视为“残缺对象”。

| Block | required fields (MVP) | 缺失处置 |
|---|---|---|
| `RequestMeta` | `requestKey`, `requestTimestamp`, `channelType` | `reject`（`b_required_matrix_violation`） |
| `PlacementMeta` | `placementKey`, `placementType`, `placementSurface` | `reject`（`b_required_matrix_violation`） |
| `UserContext` | `sessionKey`, `actorType` | `reject`（`b_required_matrix_violation`） |
| `OpportunityContext` | `triggerDecision`, `decisionOutcome`, `hitType` | `reject`（`b_required_matrix_violation`） |
| `PolicyContext` | `consentScope`, `policyGateHint`, `restrictedCategoryFlags` | `reject`（`b_required_matrix_violation`） |
| `TraceContext` | `traceKey`, `requestKey`, `attemptKey` | `reject`（`b_required_matrix_violation`） |

矩阵约束：
1. required 字段只接受 canonical 值，不允许 raw 值落地。
2. `restrictedCategoryFlags` 可为空数组，但字段必须存在。
3. `requestKey` 在 `RequestMeta` 与 `TraceContext` 必须一致；不一致按 `reject`。
4. `channelType`、`placementType`、`actorType`、`triggerDecision`、`decisionOutcome`、`hitType` 必须来自 `enumDictVersion`。

#### 3.4.22 MVP 验收基线（六块 required 矩阵）

1. C/D 不需要对六块对象做字段补齐或兜底推断。
2. 任一 required 字段缺失都能被 B 层稳定拦截并产出标准原因码。
3. 同请求在同版本下 required 字段集稳定一致，不出现“有时有、有时无”。
4. 任一策略/路由结果都能反查到六块 required 字段快照。
5. 六块矩阵变更必须伴随版本发布（`schemaVersion` 或对应策略版本）并可回滚。

#### 3.4.23 OpenRTB 投影合同（P0，MVP 冻结）

当前版本新增 `openrtbProjectionLite`，作为 `bNormalizedOpportunityLite` 的可交易投影对象。

投影目标对象（最小集）：
1. `imp[]`
2. `app`
3. `device`
4. `user`
5. `regs`
6. `ext`

版本锚点：
1. `openrtbProjectionVersion`（独立版本线，不与 `schemaVersion` 绑死）。
2. `openrtbProjectionVersion` 必须同时写入 `normalizationSummary` 与 `projectionAuditSnapshotLite`。

合同约束：
1. 投影只做字段映射与语义承载，不在 B 层做竞价/收益决策。
2. 标准字段优先进入 OpenRTB 标准路径；非标准字段必须进入对应对象的 `ext`。
3. 投影结果必须可由 `traceKey + openrtbProjectionVersion` 唯一回放。

#### 3.4.24 六块 Schema -> OpenRTB 最小映射矩阵（P0，MVP 冻结）

| 六块字段（canonical） | OpenRTB 目标路径 | 处置 |
|---|---|---|
| `RequestMeta.requestKey` | `BidRequest.id` | `required`，缺失 -> `unmapped` |
| `RequestMeta.requestTimestamp` | `BidRequest.ext.mediation.request_ts` | `optional`，缺失 -> `partial` |
| `RequestMeta.channelType` | `BidRequest.app.ext.channel_type` | `optional`，缺失 -> `partial` |
| `PlacementMeta.placementKey` | `BidRequest.imp[0].id` | `required`，缺失 -> `unmapped` |
| `PlacementMeta.placementSurface` | `BidRequest.imp[0].tagid` | `required`，缺失 -> `unmapped` |
| `PlacementMeta.placementType` | `BidRequest.imp[0].ext.placement_type` | `required`，缺失 -> `unmapped` |
| `UserContext.sessionKey` | `BidRequest.user.id`（经 `redaction action=hash`） | `required`，缺失且无 `device.id` -> `unmapped` |
| `UserContext.actorType` | `BidRequest.user.ext.actor_type` | `optional`，缺失 -> `partial` |
| `OpportunityContext.triggerDecision` | `BidRequest.imp[0].ext.trigger_decision` | `required`，缺失 -> `unmapped` |
| `OpportunityContext.decisionOutcome` | `BidRequest.imp[0].ext.decision_outcome` | `required`，缺失 -> `unmapped` |
| `OpportunityContext.hitType` | `BidRequest.imp[0].ext.hit_type` | `required`，缺失 -> `unmapped` |
| `PolicyContext.consentScope` | `BidRequest.regs.ext.consent_scope` | `required`，缺失 -> `unmapped` |
| `PolicyContext.policyGateHint` | `BidRequest.regs.ext.policy_gate_hint` | `optional`，缺失 -> `partial` |
| `PolicyContext.restrictedCategoryFlags` | `BidRequest.regs.ext.restricted_category_flags` | `required`（可空数组） |
| `TraceContext.traceKey` | `BidRequest.ext.trace.trace_key` | `required`，缺失 -> `unmapped` |
| `TraceContext.requestKey` | `BidRequest.ext.trace.request_key` | `required`，缺失 -> `unmapped` |
| `TraceContext.attemptKey` | `BidRequest.ext.trace.attempt_key` | `required`，缺失 -> `unmapped` |

补充映射（非六块直出，允许 from sourceInput）：
1. `app.id`：优先 `appExplicit.appId`，回退 `placementConfig.appId`，再回退 `defaultPolicy.appId`；仍缺失 -> `unmapped`。
2. `device.id`：优先设备稳定键（脱敏后）；若缺失且 `user.id` 存在，则允许 `partial`。
3. `device.ext.performance_tier`：来自端上性能信号；缺失 -> `partial`。

#### 3.4.25 `mapped/partial/unmapped` 处置规则（P0，MVP 冻结）

投影结论字段：
1. `projectionDisposition`（`mapped` / `partial` / `unmapped`）
2. `projectionReasonCode`

判定规则：
1. `mapped`：最小必需目标全部可映射（`id + imp + app.id + regs + trace`），且关键值合法。
2. `partial`：必需目标已映射，但 optional 目标缺失/降级（如 `device.ext`、`user.ext.actor_type`）。
3. `unmapped`：任一必需目标缺失或非法，无法形成可交易投影。

动作规则：
1. `mapped` -> `continue`，进入 C。
2. `partial` -> `degrade`，进入 C，并强制写 `mappingWarnings`。
3. `unmapped` -> `reject`，状态置 `error`，不进入 C 正常主链路。

最小原因码：
1. `b_proj_mapped_complete`
2. `b_proj_partial_optional_missing`
3. `b_proj_unmapped_required_missing`
4. `b_proj_unmapped_invalid_value`

#### 3.4.26 投影审计快照（`projectionAuditSnapshotLite`，P0，MVP 冻结）

required：
1. `traceKey`
2. `requestKey`
3. `attemptKey`
4. `openrtbProjectionVersion`
5. `redactionPolicyVersion`
6. `projectionDisposition`
7. `projectionReasonCode`
8. `targetCoverage[]`
   - `openrtbPath`
   - `mappedFrom`
   - `coverageStatus`（`mapped` / `partial` / `unmapped`）
   - `reasonCode`
9. `generatedAt`

约束：
1. 任一 `required` 目标路径都必须在 `targetCoverage[]` 出现，禁止隐式缺省。
2. `projectionDisposition=unmapped` 时，必须至少有一条 `coverageStatus=unmapped` 且指向 required 目标路径。
3. 快照不得写入明文敏感 raw 值，只记录字段路径与处置结果（必须遵循 `redactionPolicyLite`）。

#### 3.4.27 MVP 验收基线（OpenRTB 投影合同）

1. 每个 `bNormalizedOpportunityLite` 都可生成且仅生成一份 `openrtbProjectionLite`。
2. 六块 required 字段可稳定投影到 `imp/app/device/user/regs/ext` 最小目标路径。
3. 同请求在同 `openrtbProjectionVersion` 下，`projectionDisposition` 与 `projectionReasonCode` 可复现。
4. `unmapped` 请求不会进入 C/D 正常主链路。
5. 任一交易争议可通过 `traceKey + openrtbProjectionVersion + projectionAuditSnapshotLite` 分钟级定位。

#### 3.4.28 敏感字段脱敏策略合同（`redactionPolicyLite`，P0，MVP 冻结）

目标：在 B 层冻结“字段分级 + 脱敏动作”，确保审计和投影不会泄露明文敏感数据。

版本锚点：
1. `redactionPolicyVersion`（独立版本线）。
2. `redactionPolicyVersion` 必须写入 `normalizationSummary`、`mappingAuditSnapshotLite`、`projectionAuditSnapshotLite`。

字段分级（最小）：
1. `S0_public`：公开或低风险字段（默认动作 `pass`）。
2. `S1_quasi_identifier`：准标识字段（默认动作 `coarsen`）。
3. `S2_identifier`：直接标识字段（默认动作 `hash`）。
4. `S3_sensitive_content`：高敏内容字段（默认动作 `drop`）。

动作集合（冻结）：
1. `pass`：原值通过（仅允许 `S0_public`）。
2. `hash`：不可逆哈希（用于 `S2_identifier`）。
3. `coarsen`：降精度/分桶（用于 `S1_quasi_identifier`）。
4. `drop`：不落地该字段值（用于 `S3_sensitive_content` 或高风险场景）。

策略对象 required：
1. `redactionPolicyVersion`
2. `fieldClassRules[]`
   - `fieldPath`
   - `sensitivityClass`
   - `defaultAction`
3. `hashRule`
   - `algorithm`（固定 `sha256`）
   - `saltKeyRef`
4. `coarsenRules[]`
   - `fieldPath`
   - `coarsenMethod`（如 `time_bucket`, `range_bucket`, `prefix_mask`）
5. `redactionFailureMode`（MVP 固定 `reject`）

#### 3.4.29 脱敏快照合同（`redactionSnapshotLite`，P0，MVP 冻结）

required：
1. `traceKey`
2. `requestKey`
3. `attemptKey`
4. `redactionPolicyVersion`
5. `beforeAuditEnforced`（固定 `true`）
6. `fieldDecisions[]`
   - `fieldPath`
   - `sensitivityClass`
   - `action`（`pass/hash/coarsen/drop`）
   - `inputDigest`
   - `outputPreviewOrNA`
   - `reasonCode`
7. `actionSummary`
   - `passCount`
   - `hashCount`
   - `coarsenCount`
   - `dropCount`
8. `generatedAt`

约束：
1. `fieldDecisions[]` 至少覆盖所有进入 `mappingAuditSnapshotLite/projectionAuditSnapshotLite` 的 raw 字段路径。
2. `drop` 动作下 `outputPreviewOrNA` 必须为空。
3. 任一 `S2/S3` 字段不得出现 `pass` 动作；命中即 `reject`。

#### 3.4.30 脱敏执行顺序与失败处置（P0，MVP 冻结）

固定执行顺序：
1. 收集待审计原始值（仅内存态）。
2. 应用 `redactionPolicyLite` 生成 `redactionSnapshotLite`。
3. 仅使用脱敏后的值写入 `mappingAuditSnapshotLite` 与 `projectionAuditSnapshotLite`。
4. 输出 `bNormalizedOpportunityLite`。

失败处置：
1. 脱敏策略缺失或版本非法 -> `reject`，原因码 `b_redaction_policy_missing_or_invalid`。
2. 脱敏动作违规（如 `S2/S3 -> pass`）-> `reject`，原因码 `b_redaction_action_violation`。
3. 脱敏执行失败（哈希/降精度异常）-> `reject`，原因码 `b_redaction_execution_failed`。
4. 审计写入检测到明文敏感值 -> `reject`，原因码 `b_redaction_before_audit_violation`。

#### 3.4.31 MVP 验收基线（敏感字段脱敏合同）

1. 任一进入审计的 raw 字段都可在 `redactionSnapshotLite` 找到对应脱敏决策。
2. `mappingAuditSnapshotLite/projectionAuditSnapshotLite` 不出现明文 `S2/S3` 字段值。
3. 同请求在同 `redactionPolicyVersion` 下，脱敏动作与结果可复现。
4. 脱敏失败请求不会进入 C/D 正常主链路。
5. 任一隐私争议可通过 `traceKey + redactionPolicyVersion + redactionSnapshotLite` 分钟级定位。
