### 3.5 Module C: Policy & Safety Governor

#### 3.5.1 职责边界

1. 对统一机会对象做合规、频控、敏感类目与授权范围审查。
2. 给出“可路由”或“受控拦截”结论。
3. 作为路由前置门禁，防止不合规请求进入供给层。
4. 策略评估必须基于下发快照本地执行，避免在主路径引入额外网络依赖。

#### 3.5.2 处理规则

1. 强约束命中时允许 fail-closed。
2. 弱约束命中时标记风险并进入受控降级。
3. 所有拦截与放行动作必须输出标准原因码。
4. 固定执行顺序、短路条件与冲突优先级见 `3.5.8` ~ `3.5.10`。

#### 3.5.3 输出合同

1. `routable opportunity` 或 `policy-blocked result`。
2. 策略命中轨迹（用于审计与回放）。
3. 接口语义对齐：`evaluate(opportunity_v1, policy_snapshot) -> governor_decision`。

#### 3.5.4 C 输入合同（B -> C，MVP 冻结）

`Module B -> Module C` 标准输入对象冻结为 `cPolicyInputLite`（承接 `bNormalizedOpportunityLite`）。

required：
1. `opportunityKey`
2. `schemaVersion`
3. `state=received`（仅 `received` 进入正常策略评估）
4. 六块对象且满足 `3.4.21` required 矩阵：
   - `RequestMeta`
   - `PlacementMeta`
   - `UserContext`
   - `OpportunityContext`
   - `PolicyContext`
   - `TraceContext`
5. `normalizationSummary`
   - `mappingProfileVersion`
   - `enumDictVersion`
   - `conflictPolicyVersion`
6. `mappingAuditSnapshotLite`
7. `policySnapshotLite`
   - `policySnapshotId`
   - `policySnapshotVersion`
   - `policyPackVersion`
   - `policyRuleVersion`
   - `snapshotSource`（固定 `resolvedConfigSnapshot`）
   - `resolvedConfigRef`（`resolveId`）
   - `configHash`
   - `effectiveAt`
   - `expireAtOrNA`
   - `failureMode`（`fail_open` / `fail_closed`）
   - `policyConstraintsLite`（本次评估使用的门禁规则子集）

optional：
1. `mappingWarnings`
2. `extensions`

版本锚点（输入必须可定位版本）：
1. `cInputContractVersion`
2. `schemaVersion`
3. `mappingProfileVersion`
4. `enumDictVersion`
5. `conflictPolicyVersion`
6. `policySnapshotVersion`
7. `policySnapshotId`
8. `resolvedConfigRef`
9. `configHash`

执行约束（本地快照）：
1. C 评估仅允许消费 `policySnapshotLite`，禁止在评估流程内访问远端策略服务。
2. `policySnapshotLite` 缺失、过期或不可解析时，必须按 `failureMode` 输出确定性动作与原因码。

#### 3.5.5 缺失字段处置（MVP）

缺失处置动作只允许：`continue` / `degrade` / `reject`。

1. required 缺失：
   - 动作：`reject`。
   - 原因码：`c_missing_required_field`。
2. optional 缺失：
   - 动作：`continue`（必要时记录 warning）。
   - 原因码：`c_optional_missing_ignored`。
3. `state != received` 进入 C：
   - 动作：`reject`（视为非法输入状态）。
   - 原因码：`c_invalid_input_state`。
4. `policySnapshotLite` 缺失：
   - 动作：`reject`。
   - 原因码：`c_policy_snapshot_missing`。
5. `policySnapshotLite` 超时（`now > expireAtOrNA` 且无本地稳定快照）：
   - 动作：按 `failureMode` 执行（默认 `reject`）。
   - 原因码：`c_policy_snapshot_expired`。

一致性约束：
1. 同请求同版本下，缺失处置动作必须一致。
2. C 不得静默补齐 required 字段。

#### 3.5.6 非法值处置（MVP）

1. 结构非法（对象类型错误、关键对象非对象）：
   - 动作：`reject`。
   - 原因码：`c_invalid_structure`。
2. 枚举非法（`channelType/placementType/actorType/triggerDecision/decisionOutcome/hitType` 非 canonical）：
   - 动作：`reject`。
   - 原因码：`c_invalid_required_enum`。
3. 版本锚点缺失或格式非法（`schemaVersion/enumDictVersion/...`）：
   - 动作：`reject`。
   - 原因码：`c_invalid_version_anchor`。
4. `policySnapshotLite` 非法（版本不匹配、缺失关键字段、`configHash` 无效）：
   - 动作：`reject`。
   - 原因码：`c_policy_snapshot_invalid`。

审计要求：
1. 记录 `traceKey`、字段路径、原值、处置动作、原因码、规则版本。
2. 必须记录 `policySnapshotId + policySnapshotVersion + resolvedConfigRef + configHash`。

#### 3.5.7 MVP 验收基线（C 输入合同）

1. C 层对输入 required/optional 判定无歧义，不依赖隐式补齐。
2. required 缺失或非法值不会进入 D 正常路由。
3. 版本锚点完整，可在审计中定位“按哪套规则评估”。
4. 同请求在同版本下输入判定结果可复现。
5. 任一输入拒绝可通过 `traceKey + reasonCode` 分钟级定位。
6. C 评估可被证明为“本地快照执行”（不依赖运行时外部策略请求）。

#### 3.5.8 规则执行先验顺序（MVP 冻结）

`Module C` 对单请求固定执行四段策略链路（禁止重排）：
1. `compliance gate`（合规硬约束）
2. `consent/auth gate`（授权范围与可用性）
3. `frequency cap gate`（频控）
4. `category gate`（敏感类目/限制类目）

顺序约束：
1. 前一段给出 `block` 时，后续段不再执行（短路）。
2. 前一段给出 `degrade` 时，后续段仍执行，但降级标记必须继承。
3. 同请求同版本下，执行顺序不可因输入来源而变化。

#### 3.5.9 短路条件（MVP 冻结）

短路动作仅两类：`short_circuit_block` / `short_circuit_allow`。

`short_circuit_block` 条件（任一命中即终止）：
1. 合规硬违规（例如禁投场景、强约束不满足）。
2. 授权硬拒绝（`consentScope` 不允许）。
3. 高频硬超限（超过硬阈值且策略定义为阻断）。
4. 限制类目硬阻断（命中不可放行类目）。

`short_circuit_allow` 条件（当前版本最小）：
1. 无命中任何强约束，且所有 gate 至少返回 `allow` 或 `degrade`。
2. 进入 allow 后直接输出 `routable opportunity`，不再做额外策略扫描。

短路审计要求：
1. 必填 `shortCircuitGate`、`shortCircuitAction`、`shortCircuitReasonCode`。
2. 必填 `policyPackVersion` 与 `policyRuleVersion`。

#### 3.5.10 冲突优先级（MVP 冻结）

当多个 gate 给出不同动作时，按固定优先级裁决最终动作：
1. `block`（最高）
2. `degrade`
3. `allow`（最低）

同级冲突（tie-break）规则：
1. 同为 `block`：优先前序 gate（执行顺序更靠前者胜出）。
2. 同为 `degrade`：按风险等级高者胜出（`high > medium > low`）。
3. 同级且风险等级一致：按规则 ID 字典序最小值胜出，保证确定性。

冲突输出最小字段：
1. `finalPolicyAction`（allow/degrade/block）
2. `winningGate`
3. `winningRuleId`
4. `policyConflictReasonCode`

#### 3.5.11 MVP 验收基线（执行顺序与短路机制）

1. 同请求在同版本下策略执行轨迹顺序一致、结果一致。
2. 命中短路后不会继续执行后续 gate（可在审计中验证）。
3. 多 gate 冲突时最终动作可按优先级规则完全解释。
4. `block` 结论不会进入 D 正常路由。
5. 任一最终动作都可通过 `traceKey + winningGate + reasonCode` 快速回放。

#### 3.5.12 C 输出合同（C -> D/E，MVP 冻结）

`Module C` 输出统一对象 `cPolicyDecisionLite`，并按 `isRoutable` 分流到 D 或 E。

统一 required 字段：
1. `opportunityKey`
2. `traceKey`
3. `requestKey`
4. `attemptKey`
5. `finalPolicyAction`（`allow` / `degrade` / `block`）
6. `isRoutable`（bool）
7. `policyDecisionReasonCode`
8. `winningGate`
9. `winningRuleId`
10. `decisionTimestamp`
11. `policyPackVersion`
12. `policyRuleVersion`
13. `policySnapshotId`
14. `policySnapshotVersion`
15. `stateUpdate`（`fromState`, `toState`, `stateReasonCode`）
16. `policyAuditSnapshotLite`（结构见 `3.5.18`）

输出路径：
1. `isRoutable=true`：
   - 输出 `routableOpportunityLite` 给 D（包含可路由机会对象与策略降级标记）。
2. `isRoutable=false`：
   - 输出 `policyBlockedResultLite` 给 E（包含阻断摘要与返回原因）。

optional：
1. `policyWarnings`
2. `extensions`

#### 3.5.13 状态更新与可路由标记规则（MVP）

`isRoutable` 冻结规则：
1. `finalPolicyAction=allow/degrade` 且未命中硬阻断时，`isRoutable=true`。
2. `finalPolicyAction=block` 或命中 `short_circuit_block` 时，`isRoutable=false`。

`stateUpdate` 冻结规则：
1. 路由路径（`isRoutable=true`）：
   - `fromState=received`，`toState=routed`，`stateReasonCode=policy_passed` 或 `policy_degraded_pass`。
2. 阻断路径（`isRoutable=false`）：
   - `fromState=received`，`toState=error`，`stateReasonCode=policy_blocked`。

消费约束：
1. D 仅消费 `isRoutable=true` 输出，禁止接收阻断对象。
2. E 必须可消费 `isRoutable=false` 输出并返回标准错误语义。
3. C 输出必须显式给出 `isRoutable`，禁止下游二次推断。

#### 3.5.14 MVP 验收基线（C 输出合同）

1. C 到 D/E 的分流由 `isRoutable` 唯一决定，不存在双路或空路输出。
2. 每个 C 输出都带完整 `stateUpdate`，状态迁移可审计回放。
3. `block` 结论一定走 E，且状态更新为 `error`。
4. `allow/degrade` 结论一定走 D，且状态更新为 `routed`。
5. 同请求在同版本下输出字段、分流结果、状态更新均可复现。
6. `policySnapshotId + policySnapshotVersion` 在 C 输出与审计快照中一致并可回放。

#### 3.5.15 Policy 原因码体系（MVP 冻结）

当前版本冻结 `policyReasonCodeLite`，用于统一策略结论解释、运维排障与回放检索。

命名规范：
1. 格式：`c_<domain>_<action_or_reason>`。
2. `domain` 仅允许：`compliance` / `consent` / `frequency` / `category` / `input` / `conflict` / `system`。
3. `action_or_reason` 必须直接表达裁决语义，禁止模糊词。

最小原因码集（MVP）：
1. `c_compliance_hard_block`
2. `c_consent_scope_blocked`
3. `c_frequency_hard_cap_block`
4. `c_category_restricted_block`
5. `c_frequency_soft_cap_degrade`
6. `c_category_soft_risk_degrade`
7. `c_policy_pass`
8. `c_policy_degraded_pass`
9. `c_invalid_input_state`
10. `c_missing_required_field`
11. `c_invalid_required_enum`
12. `c_invalid_version_anchor`
13. `c_policy_snapshot_missing`
14. `c_policy_snapshot_expired`
15. `c_policy_snapshot_invalid`
16. `c_policy_conflict_resolved`
17. `c_policy_engine_error`

#### 3.5.16 原因码与动作映射（MVP 冻结）

动作集合固定为：`allow` / `degrade` / `block` / `reject`。

映射规则（主映射）：
1. `c_compliance_hard_block` -> `block`
2. `c_consent_scope_blocked` -> `block`
3. `c_frequency_hard_cap_block` -> `block`
4. `c_category_restricted_block` -> `block`
5. `c_frequency_soft_cap_degrade` -> `degrade`
6. `c_category_soft_risk_degrade` -> `degrade`
7. `c_policy_pass` -> `allow`
8. `c_policy_degraded_pass` -> `degrade`
9. `c_invalid_input_state` -> `reject`
10. `c_missing_required_field` -> `reject`
11. `c_invalid_required_enum` -> `reject`
12. `c_invalid_version_anchor` -> `reject`
13. `c_policy_snapshot_missing` -> `reject`
14. `c_policy_snapshot_expired` -> 默认 `reject`（可按 `failureMode=fail_open` 降级为 `degrade`，需版本化）
15. `c_policy_snapshot_invalid` -> `reject`
16. `c_policy_conflict_resolved` -> 以 `finalPolicyAction` 为准（不得独立决定动作）
17. `c_policy_engine_error` -> 默认 `reject`（可配置降级为 `degrade`，需显式版本化）

一致性约束：
1. 一个请求只能有一个 `primaryPolicyReasonCode`。
2. 可选多个 `secondaryPolicyReasonCodes`，但不得与主动作冲突。
3. 同请求同版本下，`primaryPolicyReasonCode -> finalPolicyAction` 必须确定性一致。
4. D/E 与审计层必须以 `primaryPolicyReasonCode` 作为主诊断码。

#### 3.5.17 MVP 验收基线（Policy 原因码体系）

1. 所有 C 结论都能落到 `primaryPolicyReasonCode`，无裸文本主诊断。
2. 任一 `primaryPolicyReasonCode` 都能唯一映射到动作或映射规则。
3. 相同输入与版本下，原因码和动作结果稳定一致。
4. 分钟级检索可通过 `traceKey + primaryPolicyReasonCode` 定位请求。
5. 变更原因码映射时必须携带 `policyRuleVersion` 并可回滚。

#### 3.5.18 Policy 审计快照（`policyAuditSnapshotLite`，MVP 冻结）

`policyAuditSnapshotLite` 是 C 层唯一权威策略审计对象，用于回放“如何得到最终结论”。

快照 required 字段：
1. `traceKey`
2. `requestKey`
3. `attemptKey`
4. `opportunityKey`
5. `policyEvaluationStartAt`
6. `policyEvaluationEndAt`
7. `hitRules`（命中规则列表，最小元素：`gate`, `ruleId`, `ruleAction`, `reasonCode`）
8. `decisionActions`（裁决动作序列，最小元素：`step`, `action`, `sourceGate`, `reasonCode`）
9. `finalConclusion`
   - `finalPolicyAction`
   - `isRoutable`
   - `primaryPolicyReasonCode`
   - `winningGate`
   - `winningRuleId`
10. `versionSnapshot`
   - `policyPackVersion`
   - `policyRuleVersion`
   - `policySnapshotId`
   - `policySnapshotVersion`
   - `resolvedConfigRef`
   - `configHash`
   - `cInputContractVersion`
   - `schemaVersion`
   - `enumDictVersion`
11. `stateUpdate`
   - `fromState`
   - `toState`
   - `stateReasonCode`

optional：
1. `secondaryPolicyReasonCodes`
2. `shortCircuitSnapshot`
3. `policyWarnings`

#### 3.5.19 审计快照生成规则（MVP）

1. 每次 gate 评估都必须落一条 `decisionActions`，禁止仅记录最终结论。
2. 命中短路时必须写入 `shortCircuitSnapshot`，并停止后续 gate 评估记录。
3. `hitRules` 至少包含所有改变 `finalPolicyAction` 的规则。
4. `finalConclusion` 必须与 `cPolicyDecisionLite` 完全一致（字段值不可偏离）。
5. `versionSnapshot` 必须在单请求内保持固定，不得中途切换。

#### 3.5.20 MVP 验收基线（Policy 审计快照）

1. 单请求可通过 `policyAuditSnapshotLite` 回放“命中规则 -> 裁决动作 -> 最终结论”完整链路。
2. 任一 `finalPolicyAction` 都能追溯到至少一条 `hitRules` 或显式 pass 记录。
3. `traceKey/requestKey/attemptKey` 在 C 输出与审计快照中一致。
4. 审计快照缺失 required 字段时，视为不合格输出，不得进入 D/E 主链路。
5. 同请求在同版本下审计快照结构与结论可复现。
