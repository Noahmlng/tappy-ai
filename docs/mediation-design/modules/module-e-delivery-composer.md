### 3.7 Module E: Delivery Composer

#### 3.7.1 Delivery Schema 职责

1. 只描述“本次返回”。
2. 不承载后续行为事件语义。
3. 输出必须对齐 placement 展示约束与 fail-open 策略。

#### 3.7.2 Delivery / Event 分离（核心冻结）

1. `Delivery Schema`：同步返回对象。
2. `Event Callback Schema`：异步行为对象。
3. 两者只通过 `responseReference` 关联，不相互复制负载。

#### 3.7.3 输出合同

1. 返回状态：`served` / `no_fill` / `error`。
2. `responseReference`（必填）。
3. 可被下游事件与审计直接关联的最小返回快照。
4. `render_plan` 详细字段合同见 `3.7.9` ~ `3.7.40`（P0 冻结）。
5. E 对 App 最终 Delivery 对象见 `3.7.37`，E 对 F 事件输出见 `3.7.38`。

#### 3.7.4 compose 输入合同（P0，MVP 冻结）

`Module E` 入口函数冻结为：
1. `compose(auction_result, placement_spec, device_capabilities) -> render_plan`
2. 对应输入对象冻结为 `eComposeInputLite`

`eComposeInputLite` required：
1. `dToEOutputLite`（来自 `Module D`）
   - `opportunityKey`
   - `traceKey`
   - `requestKey`
   - `attemptKey`
   - `auctionResultLite`（D 主语义锚点）
     - `served`
     - `winner`（`sourceId`, `candidateId`）
     - `price`（`value`, `currency`）
     - `creativeHandle`
     - `debugRef`
   - `hasCandidate`
   - `candidateCount`
   - `normalizedCandidates`
   - `policyConstraintsLite`
     - `constraintSetVersion`
     - `categoryConstraints`（`bcat`, `badv`）
     - `personalizationConstraints`（`nonPersonalizedOnly`）
     - `renderConstraints`（`disallowRenderModes`）
   - `routeConclusion`
   - `routeAuditSnapshotLite`
   - `stateUpdate`
2. `placementSpecLite`
   - `placementKey`
   - `placementType`
   - `placementSurface`
   - `allowedRenderModes`（`native_card` / `webview` / `mraid_container` / `video_vast_container`）
   - `maxRenderCount`
   - `uiConstraintProfile`
   - `disclosurePolicy`
3. `deviceCapabilitiesLite`
   - `platformType`
   - `sdkVersion`
   - `supportedRenderModes`
   - `webviewSupported`
   - `mraidSupported`
   - `videoVastSupported`
   - `maxRenderSlotCount`
4. `composeContextLite`
   - `composeRequestAt`
   - `composeMode`（`sync_delivery`）

optional：
1. `locale`
2. `timezone`
3. `sdkHints`
4. `extensions`

#### 3.7.5 缺失字段处置（compose 输入，MVP）

缺失处置动作仅允许：`continue` / `degrade` / `reject`。

1. `dToEOutputLite` required 缺失：
   - 动作：`reject`（E 不做补洞）。
   - 原因码：`e_compose_missing_auction_required`。
2. `placementSpecLite` required 缺失：
   - 动作：`reject`。
   - 原因码：`e_compose_missing_placement_required`。
3. `deviceCapabilitiesLite` required 缺失：
   - 动作：`degrade` 到 `safe-default-capabilities`（仅允许 `native_card` 路径）；若 placement 不支持则 `reject`。
   - 原因码：`e_compose_missing_device_capabilities`。
4. optional 缺失：
   - 动作：`continue`（使用默认值并记录 warning）。
   - 原因码：`e_compose_optional_default_applied`。

一致性约束：
1. 同请求同版本下，缺失处置动作必须一致。
2. E 不允许静默补齐 `dToEOutputLite/placementSpecLite` 的 required 字段。

#### 3.7.6 非法值处置（compose 输入，MVP）

1. 结构非法（关键对象非对象或空对象）：
   - 动作：`reject`。
   - 原因码：`e_compose_invalid_structure`。
2. 枚举非法（`allowedRenderModes/supportedRenderModes` 含未知值）：
   - 动作：`degrade`（过滤非法值后继续；若过滤后为空则 `reject`）。
   - 原因码：`e_compose_invalid_render_mode`。
3. 数值非法（`maxRenderCount <= 0` 或 `maxRenderSlotCount <= 0`）：
   - 动作：`degrade` 到默认值 `1`。
   - 原因码：`e_compose_invalid_numeric_corrected`。
4. 输入语义冲突（`hasCandidate=true` 但候选为空等）：
   - 动作：`reject`。
   - 原因码：`e_compose_inconsistent_auction_result`。
5. winner 绑定冲突（`auctionResultLite.served=true` 但 winner 缺失/不在 `normalizedCandidates`）：
   - 动作：`reject`。
   - 原因码：`e_compose_winner_binding_invalid`。

审计要求：
1. 必须记录 `traceKey`、字段路径、原值、处置动作、原因码、规则版本。

#### 3.7.7 版本锚点（compose 输入，MVP 冻结）

`eComposeInputLite` 必须携带可定位版本：
1. `eComposeInputContractVersion`
2. `dOutputContractVersion`（来自 D 输出）
3. `schemaVersion`
4. `placementConfigVersion`
5. `renderPolicyVersion`
6. `deviceCapabilityProfileVersion`
7. `routingPolicyVersion`（来自上游 route 结论）
8. `constraintSetVersion`（来自上游策略约束）

版本约束：
1. 任一关键版本缺失 -> `reject`，原因码 `e_compose_invalid_version_anchor`。
2. 同请求的 compose 决策必须可由上述版本集合完全复现。

#### 3.7.8 MVP 验收基线（compose 输入合同）

1. E 层对 `auction_result/placement_spec/device_capabilities` 的输入边界可判定、可复现。
2. 任一缺失或非法输入都能稳定映射到标准动作与原因码。
3. 输入版本锚点完整时，compose 前置判断结果在同请求同版本下一致。
4. 输入校验失败不会污染 `Delivery/Event` 口径。
5. 任一 compose 输入失败可通过 `traceKey + reasonCode` 分钟级定位。

#### 3.7.9 render_plan 输出合同（P0，MVP 冻结）

`compose(...)` 输出对象冻结为 `renderPlanLite`。

`renderPlanLite` required：
1. `opportunityKey`
2. `traceKey`
3. `requestKey`
4. `attemptKey`
5. `responseReference`
6. `deliveryStatus`（`served` / `no_fill` / `error`）
7. `renderMode`（`native_card` / `webview` / `mraid_container` / `video_vast_container` / `none`）
8. `renderContainer`
   - `containerType`
   - `containerParams`
9. `creativeBinding`
   - `creativeId`
   - `assetRefs`
   - `destinationRef`
10. `trackingInjection`
    - `onRenderStart`
    - `onRenderSuccess`
    - `onRenderFailure`
    - `onClick`
11. `uiConstraints`
    - `layoutConstraint`
    - `disclosureConstraint`
    - `interactionConstraint`
12. `ttl`
    - `renderTtlMs`
    - `expireAt`
13. `versionAnchors`
    - `renderPlanContractVersion`
    - `renderPolicyVersion`
    - `placementConfigVersion`
    - `trackingInjectionVersion`
    - `uiConstraintProfileVersion`
14. `candidateConsumptionDecision`
    - `selectionMode`（`top1_strict` / `topN_fill`）
    - `scannedCandidateCount`
    - `selectedCandidateRefs`（按渲染顺序）
    - `droppedCandidateRefs`（含 `dropReasonCode`）
    - `consumptionReasonCode`
15. `renderCapabilityGateSnapshotLite`（结构见 `3.7.20`）
16. `eValidationSnapshotLite`（结构见 `3.7.30`）
17. `eErrorDegradeDecisionSnapshotLite`（结构见 `3.7.35`）

optional：
1. `fallbackReasonCode`
2. `warnings`
3. `extensions`

#### 3.7.10 renderMode 与容器参数矩阵（P0）

模式与容器参数最小合同：
1. `native_card`
   - `containerType=native_card`
   - `containerParams`: `slotId`, `templateId`, `maxCardCount`
2. `webview`
   - `containerType=webview`
   - `containerParams`: `url`, `sandboxFlags`, `allowedDomains`
3. `mraid_container`
   - `containerType=mraid_container`
   - `containerParams`: `htmlSnippetRef`, `mraidVersion`, `expandPolicy`
4. `video_vast_container`（MVP 先做占位）
   - `containerType=video_vast_container`
   - `containerParams`: `vastTagUrl`, `videoSlotSpec`, `autoplayPolicy`
5. `none`
   - `containerType=none`
   - `containerParams={}`（仅用于 `no_fill/error`）

一致性约束：
1. `deliveryStatus=served` 时 `renderMode` 不得为 `none`。
2. `deliveryStatus=no_fill/error` 时 `renderMode` 必须为 `none`。
3. `renderMode` 必须同时在 `placementSpecLite.allowedRenderModes` 与 `deviceCapabilitiesLite.supportedRenderModes` 交集中；否则降级或拒绝，原因码 `e_render_mode_not_supported`。

#### 3.7.11 追踪注入位（P0）

追踪注入位冻结为四类：
1. `onRenderStart`：触发 `ad_render_started`
2. `onRenderSuccess`：触发 `ad_rendered`
3. `onRenderFailure`：触发 `ad_render_failed`
4. `onClick`：触发点击事件（并与现有 `click` 回传对齐）

注入约束：
1. 四类注入位都必须携带 `responseReference` 与 `traceKey`。
2. 注入配置缺失时：
   - `served` 路径：`reject`，原因码 `e_tracking_injection_missing`。
   - `no_fill/error` 路径：允许最小失败注入并 `continue`。
3. 追踪注入字段不得被 `extensions` 覆盖。
4. 事件字段、触发时机、幂等键与 M1 映射详见 `3.7.22` ~ `3.7.24`。

#### 3.7.12 UI 约束与 TTL 规则（P0）

`uiConstraints` 最小字段：
1. `layoutConstraint`：`maxHeightPx`, `maxWidthPx`, `safeAreaRequired`
2. `disclosureConstraint`：`disclosureLabel`, `labelPosition`, `mustBeVisible`
3. `interactionConstraint`：`clickGuardEnabled`, `closeable`, `frequencyCapHint`

`ttl` 规则：
1. `renderTtlMs` 必须 `> 0`。
2. `expireAt = composeRequestAt + renderTtlMs`（同请求同版本可复现）。
3. TTL 过期后 SDK 必须拒绝渲染并触发 `ad_render_failed`，原因码 `e_render_ttl_expired`。

约束处置：
1. UI 约束缺失或非法 -> `reject`，原因码 `e_ui_constraint_invalid`。
2. TTL 非法 -> `degrade` 到默认 TTL（`5000ms`）并记录 `e_ttl_corrected_default`。

#### 3.7.13 MVP 验收基线（render_plan 输出合同）

1. SDK 可仅依据 `renderPlanLite` 稳定完成跨端渲染，不依赖隐式字段。
2. 四类 `renderMode`（含视频占位）与容器参数映射可判定、可复现。
3. 追踪注入位完整，`ad_render_started/ad_rendered/ad_render_failed` 可按同一 `responseReference` 关联。
4. UI 约束与 TTL 在同请求同版本下执行一致，不出现端侧漂移。
5. 任一渲染失败可通过 `traceKey + responseReference + reasonCode` 分钟级定位。

#### 3.7.14 候选消费规则（P0，MVP 冻结）

E 层消费 `normalizedCandidates` 的规则冻结为：
1. 输入候选顺序以 D 层排序结果为准，E 不得重排。
2. 当 `auctionResultLite.served=true` 时，必须先绑定并校验 `auctionResultLite.winner` 指向候选（`sourceId + candidateId`）。
3. 先做可渲染性筛选（render mode 能力、素材完整性、UI 约束兼容、TTL 可用）。
4. 再按 `selectionMode` 产出最终候选集。

`selectionMode` 规则：
1. `top1_strict`（默认）：
   - 若 `auctionResultLite.served=true`：优先尝试 winner 候选；winner 可渲染则只输出 winner。
   - 若 winner 不可渲染：必须 `override_by_e`，原因码 `e_candidate_not_renderable_after_compose`，并进入 no-fill（MVP 不切换到非 winner 候选）。
   - 若 `auctionResultLite.served=false`：选择首个“可渲染候选”；无可渲染候选则 no-fill。
2. `topN_fill`：
   - 仅当 `auctionResultLite.served=false` 时启用；从前向后选择前 N 个“可渲染候选”。
   - N 计算见 `3.7.16`。

审计约束：
1. 每个被丢弃候选都必须写 `dropReasonCode`。
2. `scannedCandidateCount` 必须等于实际扫描候选数量。
3. 同请求同版本下 `selectedCandidateRefs` 必须确定性一致。

#### 3.7.15 无候选路径（P0）

无候选触发条件：
1. 输入即无候选：`hasCandidate=false` 或 `candidateCount=0`。
2. 输入有候选但全部不可渲染（筛选后为空）。

输出约束：
1. `deliveryStatus=no_fill`
2. `renderMode=none`
3. `renderContainer.containerType=none`
4. `candidateConsumptionDecision.selectedCandidateRefs=[]`
5. `candidateConsumptionDecision.consumptionReasonCode` 必须为标准原因码：
   - `e_no_candidate_input`
   - `e_candidate_all_rejected`

一致性约束：
1. no-fill 不允许返回可渲染容器参数。
2. no-fill 结论必须可由候选消费快照回放复现。

#### 3.7.16 多卡策略（P0）

多卡仅在满足全部条件时启用：
1. `selectionMode=topN_fill`
2. `renderMode=native_card`
3. `placementSpecLite.maxRenderCount > 1`
4. `deviceCapabilitiesLite.maxRenderSlotCount > 1`
5. `renderContainer.containerParams.maxCardCount > 1`

N 计算公式（固定）：
1. `N = min(placementSpecLite.maxRenderCount, deviceCapabilitiesLite.maxRenderSlotCount, renderContainer.containerParams.maxCardCount)`

多卡约束：
1. 仅允许前 N 个可渲染候选进入 `selectedCandidateRefs`。
2. 候选去重键：`creativeId + destinationRef`。
3. 非 `native_card` 模式强制退化为单卡（`top1_strict`），原因码 `e_multicard_mode_not_allowed`。
4. 去重后为空时走 no-fill。

#### 3.7.17 最终渲染决策规则（P0）

最终渲染决策矩阵：
1. `selectedCandidateRefs.size >= 1`：
   - `deliveryStatus=served`
   - `renderMode != none`
   - `consumptionReasonCode=e_render_candidate_selected`
2. `selectedCandidateRefs.size = 0` 且可解释为候选不足：
   - `deliveryStatus=no_fill`
   - `renderMode=none`
   - `consumptionReasonCode` 为 no-fill 原因码
3. compose 执行异常（非候选不足）：
   - `deliveryStatus=error`
   - `renderMode=none`
   - 原因码 `e_render_compose_error`

与上游一致性：
1. 若 D 层 `routeConclusion.routeOutcome=served_candidate` 且 winner 候选不可渲染，必须显式降级为 `no_fill` 并记录 `e_candidate_not_renderable_after_compose`。
2. E 的最终状态必须与 `candidateConsumptionDecision` 一致，不得出现 “有候选却 no_fill” 的无因结果。
3. 同请求同版本下，最终渲染决策必须可复现。

#### 3.7.18 渲染能力门禁矩阵（P0，MVP 冻结）

E 层门禁判定维度固定为：`placement_spec × device_capabilities × policy_constraints × mode_contract`。

门禁矩阵（每模式逐一判定）：
1. `mraid_container`
   - placement gate：`allowedRenderModes` 包含 `mraid_container`
   - device gate：`supportedRenderModes` 包含 `mraid_container` 且 `mraidSupported=true`
   - policy gate：`disallowRenderModes` 不包含 `mraid_container`
   - fail reason：`e_gate_mraid_not_supported`
2. `webview`
   - placement gate：`allowedRenderModes` 包含 `webview`
   - device gate：`supportedRenderModes` 包含 `webview` 且 `webviewSupported=true`
   - policy gate：`disallowRenderModes` 不包含 `webview`
   - fail reason：`e_gate_webview_not_supported`
3. `native_card`
   - placement gate：`allowedRenderModes` 包含 `native_card`
   - device gate：`supportedRenderModes` 包含 `native_card` 且 `maxRenderSlotCount>=1`
   - policy gate：`disallowRenderModes` 不包含 `native_card`
   - fail reason：`e_gate_native_not_supported`
4. `video_vast_container`（MVP 占位）
   - placement gate：`allowedRenderModes` 包含 `video_vast_container`
   - device gate：`supportedRenderModes` 包含 `video_vast_container` 且 `videoVastSupported=true`
   - policy gate：`disallowRenderModes` 不包含 `video_vast_container`
   - fail reason：`e_gate_video_not_supported`

门禁结果语义：
1. 任一模式 gate 失败必须给出标准原因码。
2. 所有模式 gate 失败 -> `deliveryStatus=no_fill`，原因码 `e_gate_all_modes_rejected`。
3. 同请求同版本下，门禁判定结果必须一致。
4. 若模式仅因 policy gate 失败，必须落标准原因码 `e_gate_policy_mode_disallowed` 并带模式名。

#### 3.7.19 格式选择规则与降级顺序（P0）

格式选择规则（固定）：
1. 先计算 `eligibleModes`：通过 `3.7.18` 门禁的模式集合。
2. 按固定优先链路选首个可用模式：
   - 默认：`mraid_container -> webview -> native_card`
   - 若 `eligibleModes` 含 `video_vast_container` 且 placement 明确允许视频位（通过 `allowedRenderModes` 显式声明），则链路为：
     `video_vast_container -> mraid_container -> webview -> native_card`
3. 若无可用模式，输出 `renderMode=none` 并走 no-fill。

降级顺序（固定）：
1. 发生模式级不支持或运行前校验失败时，严格按链路降级到下一模式。
2. 任一模式命中后停止继续降级。
3. 降级轨迹必须写入 `degradePath` 并附原因码。

约束：
1. 禁止跨链路跳级（例如 `mraid` 直接跳 `native`）。
2. 禁止无门禁判定直接选模式。
3. 禁止选择被 `policyConstraintsLite.renderConstraints.disallowRenderModes` 显式禁用的模式。

#### 3.7.20 门禁快照（`renderCapabilityGateSnapshotLite`，P0 冻结）

`renderCapabilityGateSnapshotLite` required：
1. `traceKeys`
   - `traceKey`
   - `requestKey`
   - `attemptKey`
   - `opportunityKey`
2. `placementModes`
   - `allowedRenderModes`
3. `deviceModes`
   - `supportedRenderModes`
   - `webviewSupported`
   - `mraidSupported`
   - `videoVastSupported`
4. `policyModes`
   - `disallowRenderModes`
   - `nonPersonalizedOnly`
   - `bcat`
   - `badv`
5. `modeEvaluations[]`
   - `mode`
   - `gateResult`（`pass` / `fail`）
   - `gateReasonCode`
6. `selectionDecision`
   - `eligibleModes`
   - `selectedRenderMode`
   - `degradePath`
   - `finalGateReasonCode`
7. `versionSnapshot`
   - `renderPolicyVersion`
   - `deviceCapabilityProfileVersion`
   - `placementConfigVersion`
   - `gateRuleVersion`
8. `snapshotAt`

一致性约束：
1. `selectionDecision.selectedRenderMode` 必须与 `renderPlanLite.renderMode` 一致。
2. `degradePath` 为空时表示未发生降级。
3. 任一 `fail` 必须可由 `gateReasonCode` 定位到具体 gate 条件。

#### 3.7.21 MVP 验收基线（渲染能力门禁矩阵）

1. `placement_spec × device_capabilities × policy_constraints` 的选型结果在同请求同版本下可复现。
2. 降级顺序固定且可回放（典型链路：`mraid -> webview -> native`）。
3. 不支持容器不会进入端侧渲染阶段，避免线上失败。
4. `renderCapabilityGateSnapshotLite` 可还原“候选模式 -> 门禁判定 -> 最终模式/无模式”全过程。
5. 任一门禁失败可通过 `traceKey + responseReference + gateReasonCode` 分钟级定位。

#### 3.7.22 追踪注入事件合同（P0，MVP 冻结）

E 层输出渲染事件对象冻结为 `renderTrackingEventLite`。

`renderTrackingEventLite` required：
1. `eventId`
2. `eventType`（`ad_render_started` / `ad_rendered` / `ad_render_failed`）
3. `responseReference`
4. `traceKey`
5. `requestKey`
6. `attemptKey`
7. `opportunityKey`
8. `renderAttemptId`
9. `idempotencyKey`
10. `eventAt`
11. `renderMode`
12. `containerType`
13. `creativeRef`（`creativeId`, `destinationRef`）
14. `eventContractVersion`

条件必填字段：
1. `ad_render_started`：
   - `startStage`（`container_mount_begin`）
2. `ad_rendered`：
   - `renderLatencyMs`
   - `viewReady=true`
3. `ad_render_failed`：
   - `failureStage`
   - `failureReasonCode`

绑定约束：
1. 三类渲染事件必须绑定同一 `responseReference`（与 Delivery 一致）。
2. `traceKey/requestKey/attemptKey/opportunityKey` 必须与 `renderPlanLite` 主键一致。
3. 事件不得脱离 `renderAttemptId` 独立上报。

#### 3.7.23 触发时机与幂等规则（P0）

触发时机（MVP 固定）：
1. `ad_render_started`：渲染容器开始挂载时触发（在首帧提交前）。
2. `ad_rendered`：首帧已提交且 disclosure 满足可见要求时触发。
3. `ad_render_failed`：渲染流程进入终态失败时触发（包含超时、容器错误、素材错误、策略拦截）。

时序约束：
1. 单次 `renderAttemptId` 允许序列：`started -> rendered` 或 `started -> failed`。
2. `rendered` 与 `failed` 对同一 `renderAttemptId` 互斥。
3. 若未触发 `started` 则不得触发 `rendered/failed`。

幂等规则：
1. `idempotencyKey = hash(responseReference + renderAttemptId + eventType)`。
2. 重试上报必须复用同一 `idempotencyKey`。
3. 去重窗口：`24h`。
4. 同一 `idempotencyKey` 在口径侧只能生效一次。

#### 3.7.24 与 M1 事件映射关系（P0）

渲染事件到 M1 事件映射：
1. `ad_render_started` -> 不直接映射 M1 计费事件（仅运营/审计事件）。
2. `ad_rendered` -> 映射为 `impression`（同一 `responseReference` 下一次且仅一次）。
3. `ad_render_failed` -> 映射为 `failure`（携带 `failureReasonCode`）。
4. `onClick`（非本小节三类事件）-> 映射为 `click`。

映射约束：
1. M1 `impression/click/failure` 必须继承同一 `responseReference`。
2. 同一 `renderAttemptId` 只允许产生一个终态 M1（`impression` 或 `failure`）。
3. 若 `ad_rendered` 后又收到重复 `ad_render_failed`，按幂等规则丢弃后者。
4. `ad_render_started` 缺失终态时，窗口超时补写 `failure`（原因码 `e_render_terminal_missing_timeout`）。

#### 3.7.25 MVP 验收基线（追踪注入与事件合同）

1. 三类渲染事件字段完整且可被 F 层稳定消费。
2. 触发时机固定，单 `renderAttemptId` 不出现 `rendered/failed` 双终态。
3. 幂等去重后，M1 口径不重复记账。
4. `responseReference` 绑定在 Delivery/Render/M1 事件三侧一致。
5. 任一映射冲突可通过 `traceKey + responseReference + idempotencyKey` 分钟级定位。

#### 3.7.26 E 层验证与拦截总则（P0，MVP 冻结）

E 层在生成 `renderPlanLite` 前必须执行统一验证链路：
1. `material_integrity_check`（素材完整性）
2. `policy_flag_intercept`（policy flag 拦截）
3. `disclosure_check`（披露要求）
4. `ui_safety_check`（UI 安全边界：尺寸/频控/敏感场景）

验证动作仅允许：
1. `allow`
2. `degrade`
3. `block`

动作语义：
1. `allow`：候选进入渲染决策阶段。
2. `degrade`：候选可继续，但必须附降级原因并收窄渲染能力。
3. `block`：候选不可继续，写入丢弃原因码。

全链路约束：
1. 任一 `block` 都必须有标准原因码与规则版本。
2. 验证结果必须写入 `eValidationSnapshotLite`。
3. 同请求同版本下，验证与拦截结果可复现。

#### 3.7.27 素材完整性校验（P0）

按 `renderMode` 执行最小完整性校验：
1. `native_card`
   - 必填：`creativeId`, `assetRefs`, `destinationRef`
2. `webview`
   - 必填：`creativeId`, `containerParams.url`
3. `mraid_container`
   - 必填：`creativeId`, `containerParams.htmlSnippetRef`, `containerParams.mraidVersion`
4. `video_vast_container`
   - 必填：`creativeId`, `containerParams.vastTagUrl`, `containerParams.videoSlotSpec`

校验失败处置：
1. 单候选失败 -> `block` 该候选，原因码 `e_material_missing_required`。
2. 候选格式非法 -> `block` 该候选，原因码 `e_material_invalid_format`。
3. 全部候选失败 -> 输出 `no_fill`，原因码 `e_material_all_rejected`。

#### 3.7.28 policy flag 拦截矩阵（P0）

输入信号：
1. 候选级 `policyFlags`
2. 上游 `PolicyContext`（含 `restrictedCategoryFlags` 与 gating 结论）

拦截矩阵（固定）：
1. `hard_block`
   - 动作：`block`
   - 原因码：`e_policy_hard_blocked`
2. `soft_risk`
   - 动作：`degrade`（限制为低风险模式，优先 `native_card`）
   - 原因码：`e_policy_soft_degraded`
3. `pass`
   - 动作：`allow`
   - 原因码：`e_policy_passed`

敏感场景约束：
1. 若命中敏感场景且策略要求禁投，直接 `block`，原因码 `e_policy_sensitive_scene_blocked`。
2. `soft_risk` 不得提升到更高干预模式（例如从 native 升级到 mraid/webview）。

#### 3.7.29 disclosure 要求与拦截（P0）

`deliveryStatus=served` 时 disclosure 必须可渲染且可见：
1. `disclosureLabel` 非空
2. `labelPosition` 在允许集合
3. `mustBeVisible=true`

校验时机：
1. 在 `ad_rendered` 触发前必须完成 disclosure 校验。

违规处置：
1. disclosure 缺失或不可见 -> `block` 当前候选，原因码 `e_disclosure_invalid`。
2. 所有候选都因 disclosure 失败 -> `no_fill`，原因码 `e_disclosure_all_rejected`。

#### 3.7.30 UI 安全边界（尺寸/频控/敏感场景）与验证快照（P0）

UI 安全边界规则：
1. 尺寸边界：
   - `maxHeightPx/maxWidthPx` 必须在设备与 placement 安全范围内。
   - 超界 -> `block`，原因码 `e_ui_size_out_of_bound`。
2. 频控边界：
   - 命中硬频控上限 -> `block`，原因码 `e_ui_frequency_hard_cap`。
   - 命中软频控 -> `degrade`，原因码 `e_ui_frequency_soft_cap`。
3. 敏感场景边界：
   - 命中受限敏感场景 -> `block`，原因码 `e_ui_sensitive_scene_blocked`。

`eValidationSnapshotLite` required：
1. `traceKeys`（`traceKey`, `requestKey`, `attemptKey`, `opportunityKey`）
2. `validationStages[]`
   - `stageName`
   - `stageAction`（`allow` / `degrade` / `block`）
   - `stageReasonCode`
3. `finalValidationAction`
4. `finalValidationReasonCode`
5. `degradeAdjustments`
6. `validationRuleVersion`
7. `validatedAt`

一致性约束：
1. `finalValidationAction=block` 时不得输出可渲染 `renderMode`。
2. `degradeAdjustments` 必须可解释地反映模式/参数收窄。
3. `eValidationSnapshotLite` 必须与 `candidateConsumptionDecision` 一致。

#### 3.7.31 MVP 验收基线（E 层验证与拦截规则）

1. 素材完整性、policy flag、disclosure、UI 安全边界四段验证均可独立回放。
2. 任一违规都能稳定映射到标准拦截动作和原因码。
3. 验证失败不会把非法渲染请求下发到客户端。
4. 同请求同版本下，验证结果与最终 Delivery 状态一致且可复现。
5. 任一拦截可通过 `traceKey + responseReference + finalValidationReasonCode` 分钟级定位。

#### 3.7.32 E 层标准错误码体系（P0，MVP 冻结）

E 层最终失败语义只允许两类终态：`no_fill` 与 `error`。

标准原因码前缀：
1. `e_nf_*`：`no_fill`（可预期无可交付结果）。
2. `e_er_*`：`error`（系统/合同/运行异常）。

最小原因码集合：
1. `no_fill`：
   - `e_nf_no_candidate_input`
   - `e_nf_all_candidate_rejected`
   - `e_nf_capability_gate_rejected`
   - `e_nf_policy_blocked`
   - `e_nf_disclosure_blocked`
   - `e_nf_frequency_capped`
2. `error`：
   - `e_er_invalid_compose_input`
   - `e_er_invalid_version_anchor`
   - `e_er_tracking_contract_broken`
   - `e_er_compose_runtime_failure`
   - `e_er_compose_timeout`
   - `e_er_unknown`

阶段原因码到标准原因码映射（最小）：
1. `e_no_candidate_input` -> `e_nf_no_candidate_input`
2. `e_candidate_all_rejected` / `e_material_all_rejected` -> `e_nf_all_candidate_rejected`
3. `e_gate_all_modes_rejected` / `e_gate_policy_mode_disallowed` -> `e_nf_capability_gate_rejected`
4. `e_policy_hard_blocked` / `e_policy_sensitive_scene_blocked` -> `e_nf_policy_blocked`
5. `e_disclosure_all_rejected` -> `e_nf_disclosure_blocked`
6. `e_ui_frequency_hard_cap` -> `e_nf_frequency_capped`
7. `e_compose_invalid_structure` / `e_compose_inconsistent_auction_result` -> `e_er_invalid_compose_input`
8. `e_candidate_not_renderable_after_compose` -> `e_nf_all_candidate_rejected`
9. `e_compose_winner_binding_invalid` -> `e_er_invalid_compose_input`
10. `e_compose_invalid_version_anchor` -> `e_er_invalid_version_anchor`
11. `e_tracking_injection_missing` -> `e_er_tracking_contract_broken`
12. `e_render_compose_error` -> `e_er_compose_runtime_failure`
13. `e_render_terminal_missing_timeout` -> `e_er_compose_timeout`

#### 3.7.33 no_fill vs error 判定规则（P0）

判定顺序（固定）：
1. 先判定 `error`：
   - 输入合同/版本锚点无效
   - 追踪注入合同破坏
   - compose 运行异常或超时
2. 再判定 `no_fill`：
   - 无候选输入
   - 候选被策略/素材/disclosure/能力门禁过滤完
   - 频控或敏感场景导致无可投放结果
3. 均不命中时：
   - 归入 `error`，原因码 `e_er_unknown`

一致性约束：
1. `deliveryStatus=no_fill` 时，最终原因码必须来自 `e_nf_*`。
2. `deliveryStatus=error` 时，最终原因码必须来自 `e_er_*`。
3. 同请求同版本下，`no_fill vs error` 结论必须确定性一致。

#### 3.7.34 fail-open / fail-closed 动作矩阵（P0）

默认策略：
1. 主链路默认 `fail-open`（请求不阻塞，返回可消费终态）。
2. 合规/合同完整性红线采用 `fail-closed`（禁止继续渲染）。

动作矩阵（最小）：
1. 单候选素材问题：
   - 模式：`fail-open`
   - 动作：`drop_candidate_and_continue`
   - 终态：视剩余候选决定 `served/no_fill`
2. 能力门禁不支持：
   - 模式：`fail-open`
   - 动作：`degrade_mode_chain`
   - 终态：命中可用模式则 `served`，否则 `no_fill`
3. policy/disclosure/敏感场景硬拦截：
   - 模式：`fail-closed`（对广告渲染）
   - 动作：`block_render`
   - 终态：`no_fill`
4. 输入合同/版本锚点错误：
   - 模式：`fail-closed`
   - 动作：`terminal_error`
   - 终态：`error`
5. compose 运行时异常/超时：
   - 模式：`fail-open`（对主链路）+ `fail-closed`（对当前渲染尝试）
   - 动作：`return_error_safe_payload`
   - 终态：`error`

矩阵约束：
1. `fail-open` 不得输出非法可渲染 payload。
2. `fail-closed` 必须附可审计原因码与规则版本。

#### 3.7.35 错误与降级决策快照（`eErrorDegradeDecisionSnapshotLite`，P0 冻结）

`eErrorDegradeDecisionSnapshotLite` required：
1. `traceKeys`（`traceKey`, `requestKey`, `attemptKey`, `opportunityKey`）
2. `finalDeliveryStatus`（`served` / `no_fill` / `error`）
3. `finalCanonicalReasonCode`
4. `failureClass`（`no_fill` / `error` / `none`）
5. `failStrategy`（`fail_open` / `fail_closed` / `mixed`）
6. `actionsTaken[]`
   - `stage`
   - `action`
   - `rawReasonCode`
   - `canonicalReasonCode`
7. `modeDegradePath`
8. `decisionRuleVersion`
9. `decidedAt`

一致性约束：
1. `finalDeliveryStatus` 必须与 `renderPlanLite.deliveryStatus` 一致。
2. `finalCanonicalReasonCode` 必须与 `deliveryStatus` 前缀一致（`e_nf_*` 或 `e_er_*`）。
3. `actionsTaken` 必须覆盖从失败触发到终态决策的关键动作。

#### 3.7.36 MVP 验收基线（E 层错误码与降级矩阵）

1. 任一 E 层失败都能稳定映射到标准原因码（`e_nf_*` 或 `e_er_*`）。
2. `no_fill` 与 `error` 判定在同请求同版本下可复现、可回放。
3. fail-open/fail-closed 动作符合矩阵，不出现“状态正确但动作不一致”。
4. `eErrorDegradeDecisionSnapshotLite` 可还原从原始失败到终态判定的完整过程。
5. 任一线上失败可通过 `traceKey + responseReference + finalCanonicalReasonCode` 分钟级定位。

#### 3.7.37 E 对 App 最终 Delivery 对象（P0，MVP 冻结）

E 层对 App 的最终返回对象冻结为 `eDeliveryResponseLite`。

`eDeliveryResponseLite` required：
1. `opportunityKey`
2. `traceKey`
3. `requestKey`
4. `attemptKey`
5. `responseReference`
6. `deliveryStatus`（`served` / `no_fill` / `error`）
7. `finalReasonCode`
8. `renderPlanLite`（结构见 `3.7.9`）
9. `stateTransitionLite`
   - `fromState`（固定 `routed`）
   - `toState`（`served` / `no_fill` / `error`）
   - `stateReasonCode`
   - `stateRuleVersion`
   - `transitionAt`
10. `routeDeliveryConsistencyLite`
   - `routeOutcome`（来自 D：`served_candidate` / `no_fill` / `error`）
   - `routeFinalReasonCode`
   - `consistencyAction`（`pass_through` / `override_by_e`）
   - `consistencyReasonCode`
11. `versionAnchors`
   - `eDeliveryContractVersion`
   - `renderPlanContractVersion`
   - `routingPolicyVersion`
   - `decisionRuleVersion`

optional：
1. `warnings`
2. `extensions`

一致性约束：
1. `deliveryStatus` 必须与 `renderPlanLite.deliveryStatus` 一致。
2. `stateTransitionLite.toState` 必须与 `deliveryStatus` 一致。
3. `deliveryStatus=no_fill/error` 时，`finalReasonCode` 必须与 `3.7.32` 的标准原因码口径一致。
4. `consistencyAction=override_by_e` 时，必须携带可审计 `consistencyReasonCode`（如 capability/policy/disclosure/runtime）。

#### 3.7.38 E -> F 事件输出合同（P0，MVP 冻结）

E 层输出到 F 的标准事件对象冻结为 `eToFEventLite`。

`eToFEventLite` required：
1. `eventId`
2. `eventType`（`impression` / `click` / `failure`）
3. `sourceRenderEventType`（`ad_render_started` / `ad_rendered` / `ad_render_failed` / `on_click`）
4. `responseReference`
5. `traceKey`
6. `requestKey`
7. `attemptKey`
8. `opportunityKey`
9. `renderAttemptId`
10. `idempotencyKey`
11. `deliveryStatusSnapshot`（`served` / `no_fill` / `error`）
12. `eventReasonCode`
13. `eventAt`
14. `eventContractVersion`

映射规则（冻结）：
1. `ad_rendered` -> `impression`
2. `on_click` -> `click`
3. `ad_render_failed` -> `failure`
4. `ad_render_started` 不直接进入 F 计费口径，仅保留在 E 审计侧

约束：
1. 同一 `renderAttemptId` 只允许一个终态事件（`impression` 或 `failure`）。
2. `deliveryStatusSnapshot=no_fill/error` 时不得生成 `impression`。
3. 任一发往 F 的事件必须携带有效 `responseReference`；缺失则进入隔离轨道，不计入标准口径。

#### 3.7.39 状态迁移一致性（`routed -> served/no_fill/error`，P0）

E 层是 Delivery 终态的统一落锤层；D 的状态是“路由结论输入”，E 输出“最终交付终态”。

状态一致性矩阵（最小）：
1. D `routeOutcome=served_candidate` 且 E 验证/门禁通过：
   - E 终态：`served`
   - `consistencyAction=pass_through`
2. D `routeOutcome=served_candidate` 但 winner 候选触发 capability/policy/disclosure/material 拦截：
   - E 终态：`no_fill`
   - `consistencyAction=override_by_e`
   - `consistencyReasonCode=e_candidate_not_renderable_after_compose`
3. D `routeOutcome=no_fill`：
   - E 终态：`no_fill`
   - `consistencyAction=pass_through`
4. D `routeOutcome=error`：
   - E 终态：`error`
   - `consistencyAction=pass_through`
5. D `routeOutcome=served_candidate` 但 E compose 运行异常/超时：
   - E 终态：`error`
   - `consistencyAction=override_by_e`

禁止迁移：
1. `no_fill/error -> served`（E 不允许把上游终态失败提升为成功）。
2. `deliveryStatus`、`renderPlanLite.deliveryStatus`、`stateTransitionLite.toState` 三者不一致。
3. 无 `responseReference` 的终态进入 F 标准口径。

#### 3.7.40 MVP 验收基线（E 输出合同与状态更新）

1. App 可仅依据 `eDeliveryResponseLite` 完成稳定消费，不依赖隐式上下文。
2. F 可仅依据 `eToFEventLite` 完成 `impression/click/failure` 归因处理。
3. 同请求同版本下，`routed -> served/no_fill/error` 迁移结论可复现、可回放。
4. `deliveryStatus` 与事件口径一致，不出现“Delivery 成功但事件终态失败”语义断层。
5. 任一 D -> E -> F 断链可通过 `traceKey + responseReference + eventId` 分钟级定位。
