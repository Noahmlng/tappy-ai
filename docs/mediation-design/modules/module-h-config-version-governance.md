### 3.10 Module H: Config & Version Governance（横切模块）

#### 3.10.1 三条版本线分离（冻结）

1. `Schema Version`
2. `Routing Strategy Version`
3. `Placement Config Version`

治理规则：
1. 三线独立发布、独立回滚、独立审计。
2. 任一线升级不得隐式修改其他两线行为。
3. 单请求必须记录三线版本快照。

#### 3.10.2 兼容与回滚

1. schema 变更优先 optional 扩展，破坏兼容才升主版本。
2. 路由策略先灰度再放量，监控 `served/no_fill/error` 与延迟。
3. 回滚顺序按最小影响面：placement -> routing -> schema。

#### 3.10.3 配置解析合同（Config Resolution Contract，P0，MVP 冻结）

配置解析接口语义：`resolve(global, app, placement, context) -> resolvedConfigSnapshot`。

输入对象：`configResolveRequestLite`

required：
1. `requestKey`
2. `traceKey`
3. `appId`
4. `placementId`
5. `environment`（`prod` / `staging`）
6. `schemaVersion`
7. `resolveAt`
8. `configResolutionContractVersion`

optional：
1. `sdkVersionOrNA`
2. `adapterVersionMapOrNA`
3. `expectedConfigVersionOrNA`
4. `extensions`

输出对象：
1. `resolvedConfigSnapshot`（定义见 `3.10.7`）。

#### 3.10.4 合并顺序（global/app/placement，P0，MVP 冻结）

合并链路（固定）：
1. `global` 作为基线。
2. `app` 在 `global` 基线上覆盖。
3. `placement` 在 `app` 结果上覆盖。

一致性约束：
1. 同请求内必须只执行一次固定顺序，不允许按模块二次解析。
2. A/B/C/D/E 必须消费同一份 `resolvedConfigSnapshot`，禁止各模块自行重算。
3. 任一层缺失时只跳过该层，不改变既定顺序。

#### 3.10.5 字段覆盖规则（P0，MVP 冻结）

按字段类型的覆盖规则：
1. 标量字段（bool/number/string）：高优先级层（placement > app > global）覆盖低优先级层。
2. 对象字段（map/object）：按 key 合并；冲突 key 采用高优先级层值。
3. 数组字段（list）：整字段替换，不做元素级 merge。
4. 显式 `null`：表示“清空继承值”；清空后若该字段为 required，进入缺失校验。

字段来源追踪（必做）：
1. 每个生效字段都必须记录 `winnerScope`（`global/app/placement`）。
2. 每个生效字段都必须记录 `winnerVersion`（对应配置版本号）。

#### 3.10.6 缺失/非法值处置（P0，MVP 冻结）

字段级处置流程（固定）：
1. 先识别 unknown 字段：丢弃并记录 `h_cfg_unknown_field_dropped`。
2. 对已知字段做类型/范围校验。
3. 单字段非法：忽略该层该字段并回退到低优先级继承值，记录原因码。
4. 合并完成后执行 required 校验；缺失 required 则解析失败。

标准原因码（最小集）：
1. `h_cfg_missing_required_after_merge`
2. `h_cfg_invalid_type`
3. `h_cfg_invalid_range`
4. `h_cfg_unknown_field_dropped`
5. `h_cfg_scope_unavailable`
6. `h_cfg_global_unavailable_fail_closed`
7. `h_cfg_version_incompatible`

源不可用处置：
1. `global` 不可用 -> `resolutionStatus=rejected`（fail-closed）。
2. `app/placement` 不可用 -> 可降级继续解析，`resolutionStatus=degraded`。

#### 3.10.7 解析结果结构（resolvedConfigSnapshot，P0，MVP 冻结）

`resolvedConfigSnapshot` required：
1. `resolveId`
2. `requestKey`
3. `traceKey`
4. `resolutionStatus`（`resolved` / `degraded` / `rejected`）
5. `appliedVersions`
   - `schemaVersion`
   - `routingStrategyVersion`
   - `placementConfigVersion`
   - `globalConfigVersion`
   - `appConfigVersionOrNA`
   - `placementSourceVersionOrNA`
6. `effectiveConfig`
   - `policyThresholdsRef`
   - `routePolicyRef`
   - `templateWhitelistRef`
   - `blackWhiteListRef`
   - `sdkMinVersion`
   - `adapterMinVersionMap`
   - `ttlSec`
7. `fieldProvenance[]`
   - `fieldPath`
   - `winnerScope`
   - `winnerVersion`
   - `fallbackFromScopeOrNA`
8. `reasonCodes[]`
9. `etag`
10. `configHash`
11. `resolvedAt`
12. `configResolutionContractVersion`

optional：
1. `extensions`

#### 3.10.8 MVP 验收基线（配置解析合同）

1. 同一输入（三层配置 + 上下文 + 版本）必须产出相同 `resolvedConfigSnapshot`。
2. A/B/C/D/E 消费同一 `resolveId` 时，关键配置字段与版本锚点完全一致。
3. 高层非法值不会污染结果：要么字段级回退，要么按 required 规则明确拒绝。
4. 任一解析结果都可通过 `resolveId + configHash + reasonCodes` 分钟级定位。

#### 3.10.9 GET /config 合同（含缓存语义，P0，MVP 冻结）

接口：`GET /config`

请求对象：`hGetConfigRequestLite`

required：
1. `appId`
2. `placementId`
3. `environment`（`prod` / `staging`）
4. `schemaVersion`
5. `sdkVersion`
6. `requestAt`

optional：
1. Header `If-None-Match`
2. `adapterVersionMapOrNA`
3. `expectedConfigVersionOrNA`
4. `traceKeyOrNA`
5. `extensions`

请求约束：
1. `appId + placementId + environment + schemaVersion` 组成最小配置定位键。
2. `If-None-Match` 仅接受强 ETag；非法格式视为未携带。

#### 3.10.10 响应最小字段与状态语义（P0，MVP 冻结）

`200 OK` 响应对象：`hGetConfigResponseLite`

required：
1. `status`（固定 `ok`）
2. `configKey`（`appId|placementId|environment|schemaVersion`）
3. `etag`
4. `ttlSec`
5. `expireAt`
6. `resolvedConfigSnapshot`（引用 `3.10.7`）
7. `configVersionSnapshot`
   - `globalConfigVersion`
   - `appConfigVersionOrNA`
   - `placementSourceVersionOrNA`
   - `routingStrategyVersion`
   - `placementConfigVersion`
8. `cacheDecision`（`miss` / `revalidated_changed` / `revalidated_not_modified`）
9. `responseAt`
10. `getConfigContractVersion`

`304 Not Modified` 语义（无业务 body）：
1. 必须返回 Header：`ETag`（与请求命中值一致）和 `Cache-Control: max-age=<ttlSec>`。
2. `304` 不改变 `resolvedConfigSnapshot` 内容，仅刷新客户端本地过期时间。
3. 若 `If-None-Match` 缺失则不得返回 `304`。

#### 3.10.11 ETag / If-None-Match 规则（P0，MVP 冻结）

1. `etagV2` 生成规则（冻结）：
   - `versionSnapshotForEtag = schemaVersion + "|" + globalConfigVersion + "|" + appConfigVersionOrNA + "|" + placementSourceVersionOrNA + "|" + placementConfigVersion + "|" + routingStrategyVersion`
   - `etagV2 = sha256(configHash + "|" + versionSnapshotForEtag)`
   - `etag = etagV2`（MVP 统一以 v2 作为唯一实现口径）
2. 命中规则：
   - `If-None-Match == current etag` -> `304 Not Modified`。
   - 不相等或未携带 -> 返回 `200` + 最新 `resolvedConfigSnapshot`。
3. 同一 `configHash + versionSnapshotForEtag` 必须生成同一 `etag`（canonical 串接顺序固定，不可重排）。
4. 任一参与 `versionSnapshotForEtag` 的版本锚点变化必须导致 `etag` 变化。

#### 3.10.12 TTL 与缓存过期动作（P0，MVP 冻结）

本地缓存状态：
1. `fresh`：当前时间 `< expireAt`。
2. `expired`：当前时间 `>= expireAt`。
3. `stale_grace`：`expired` 且处于 `staleGraceWindowSec=60` 内。

动作规则：
1. `fresh`：直接使用本地配置，不发网络请求。
2. `expired`：必须发起 `GET /config`，并携带 `If-None-Match`。
3. `expired + 304`：刷新 `expireAt = now + ttlSec`，继续使用本地配置。
4. `expired + 200`：替换本地配置为新快照并重置 TTL。
5. `expired + 网络失败`：
   - 若在 `stale_grace` 内 -> 允许降级使用过期配置，标记 `cacheDecision=stale_served`，原因码 `h_cfg_cache_stale_grace_served`。
   - 超出 `stale_grace` -> fail-closed，返回 `h_cfg_cache_expired_revalidate_failed`。

#### 3.10.13 缓存原因码（P0，MVP 冻结）

1. `h_cfg_cache_hit_fresh`
2. `h_cfg_cache_miss`
3. `h_cfg_cache_revalidated_not_modified`
4. `h_cfg_cache_revalidated_changed`
5. `h_cfg_cache_stale_grace_served`
6. `h_cfg_cache_expired_revalidate_failed`
7. `h_cfg_cache_invalid_etag_format`

#### 3.10.14 MVP 验收基线（GET /config）

1. SDK 在 `fresh/expired/stale_grace` 三种状态下行为确定性一致。
2. `If-None-Match` 命中时稳定返回 `304`，且不会触发配置内容漂移。
3. `ttlSec + expireAt` 可直接驱动 SDK 缓存更新，不依赖隐式时钟逻辑。
4. 过期重验证失败时，`stale_grace` 与 fail-closed 行为可通过原因码稳定区分。

#### 3.10.15 POST /config/publish 合同（P0，MVP 冻结）

接口：`POST /config/publish`

请求对象：`hConfigPublishRequestLite`

required：
1. `requestId`
2. `operatorId`
3. `environment`（`prod` / `staging`）
4. `actionType`（`publish` / `rollback`）
5. `targetScope`（`global` / `app` / `placement`）
6. `targetKey`
   - `global`：`environment`
   - `app`：`appId + environment`
   - `placement`：`appId + placementId + environment`
7. `changeSetId`
8. `baseVersionSnapshot`
   - `schemaVersion`
   - `routingStrategyVersion`
   - `placementConfigVersion`
9. `publishAt`
10. `publishContractVersion`

conditional required：
1. `actionType=publish` 时：`targetVersionSnapshot`（本次要发布的版本快照）
2. `actionType=rollback` 时：`rollbackToVersionSnapshot`（回滚目标版本快照）

optional：
1. `dryRun`（默认 `false`）
2. `reason`
3. `extensions`

响应对象：`hConfigPublishResponseLite`

required：
1. `requestId`
2. `changeSetId`
3. `actionType`
4. `publishState`
5. `ackReasonCode`
6. `retryable`
7. `publishOperationId`
8. `responseAt`
9. `publishContractVersion`

#### 3.10.16 发布状态机（draft/validated/published/rollback，P0，MVP 冻结）

状态集合（最小）：
1. `draft`
2. `validated`
3. `published`
4. `rollback`
5. `rolled_back`
6. `failed`

迁移规则：
1. `draft -> validated`：完成 schema/兼容/冲突校验。
2. `validated -> published`：原子提交成功。
3. `validated -> failed`：提交前校验失败。
4. `published -> rollback`：触发回滚动作。
5. `rollback -> rolled_back`：回滚提交成功。
6. `rollback -> failed`：回滚提交失败（需补偿或人工介入）。

约束：
1. 禁止 `draft -> published` 直跳。
2. `published` 之后不得再次 `publish` 同一 `changeSetId`。
3. 任一 `failed` 必须带 `ackReasonCode` 与 `retryable`。

#### 3.10.17 原子性边界（P0，MVP 冻结）

原子发布单元：`releaseUnit = environment + targetScope + targetKey`。

原子性规则：
1. 同一 `releaseUnit` 内，`targetVersionSnapshot` 三条线（schema/routing/placement）必须一次性提交成功或全部不生效。
2. 对外可见状态只允许 `old snapshot` 或 `new snapshot`，不允许中间态被读取。
3. `dryRun=true` 只执行校验，不写入任何可见版本。
4. 并发发布冲突以 `baseVersionSnapshot` 比对判定；不匹配直接拒绝（防止覆盖写）。

#### 3.10.18 回滚粒度（P0，MVP 冻结）

支持粒度（最小）：
1. `placement` 粒度回滚（默认，最小影响面）
2. `app` 粒度回滚
3. `global` 粒度回滚

回滚对象：
1. 允许整快照回滚（`schema + routing + placement` 一起回退）。
2. 允许单线回滚（仅 `routing` 或仅 `placement`），但必须生成新的完整快照并重新发布。

粒度约束：
1. 同一回滚请求只能选择一种 `targetScope`。
2. 回滚优先级建议：`placement -> app -> global`。

#### 3.10.19 失败补偿（P0，MVP 冻结）

补偿目标：避免“部分发布成功”的语义断层。

补偿规则：
1. 若原子提交中任一步骤失败，系统必须自动触发补偿事务，将 `releaseUnit` 恢复到 `baseVersionSnapshot`。
2. 自动补偿失败时，状态保持 `failed`，并标记 `h_publish_compensation_failed`，进入人工介入队列。
3. 可重试失败使用同一 `publishOperationId` 重试，不得创建新操作语义。
4. 补偿过程不对外暴露中间态；对外仍仅可见稳定快照。

最小原因码：
1. `h_publish_validation_failed`
2. `h_publish_base_version_conflict`
3. `h_publish_atomic_commit_failed`
4. `h_publish_compensation_triggered`
5. `h_publish_compensation_failed`
6. `h_publish_rollback_target_not_found`

#### 3.10.20 MVP 验收基线（POST /config/publish）

1. 任一发布请求都遵循 `draft -> validated -> published/failed` 的确定性状态迁移。
2. 任一回滚请求都遵循 `published -> rollback -> rolled_back/failed` 的确定性状态迁移。
3. 同一 `releaseUnit` 不会出现“部分线已生效、部分线未生效”的外部可见状态。
4. 任一失败都可通过 `publishOperationId + changeSetId + ackReasonCode` 分钟级定位。

#### 3.10.21 版本兼容门禁合同（sdk/adapter/schema，P0，MVP 冻结）

门禁接口语义：`evaluateVersionGate(gateInput, resolvedConfigSnapshot) -> versionGateDecision`。

输入对象：`hVersionGateInputLite`

required：
1. `requestKey`
2. `traceKey`
3. `schemaVersion`（请求声明）
4. `sdkVersion`（SDK 实际版本）
5. `adapterVersionMap`（`adapterId -> adapterVersion`）
6. `sdkMinVersion`（来自 `effectiveConfig`）
7. `adapterMinVersionMap`（来自 `effectiveConfig`）
8. `schemaCompatibilityPolicyRef`（包含支持矩阵）
9. `gateAt`
10. `versionGateContractVersion`

optional：
1. `gracePolicyRef`
2. `extensions`

输出对象：`hVersionGateDecisionLite`

required：
1. `requestKey`
2. `traceKey`
3. `gateAction`（`allow` / `degrade` / `reject`）
4. `gateStageResult`
   - `schemaGate`（`pass` / `degrade` / `reject`）
   - `sdkGate`（`pass` / `degrade` / `reject`）
   - `adapterGate`（`pass` / `degrade` / `reject`）
5. `compatibleAdapters[]`
6. `blockedAdapters[]`
7. `reasonCodes[]`
8. `gateAt`
9. `versionGateContractVersion`

#### 3.10.22 校验顺序（P0，MVP 冻结）

固定校验顺序（不得调整）：
1. `schema gate`
2. `sdk gate`
3. `adapter gate`

顺序约束：
1. 前一门禁 `reject` 时立即短路，后续门禁不再执行。
2. 前一门禁 `degrade` 时继续执行后续门禁，并累计降级信息。
3. 最终动作按优先级聚合：`reject > degrade > allow`。

#### 3.10.23 动作判定规则（allow/degrade/reject，P0，MVP 冻结）

`schema gate`：
1. `schemaVersion` 在兼容矩阵中“完全支持” -> `pass`。
2. `schemaVersion` 在兼容矩阵中“可兼容但需降级映射” -> `degrade`，原因码 `h_gate_schema_compatible_degrade`。
3. 不在兼容矩阵/主版本不兼容 -> `reject`，原因码 `h_gate_schema_incompatible_reject`。

`sdk gate`：
1. `sdkVersion >= sdkMinVersion` -> `pass`。
2. `sdkVersion < sdkMinVersion` 且命中灰度宽限策略 -> `degrade`，原因码 `h_gate_sdk_below_min_degrade`。
3. `sdkVersion < sdkMinVersion` 且不在宽限策略 -> `reject`，原因码 `h_gate_sdk_below_min_reject`。

`adapter gate`：
1. 对每个 `adapterId` 执行 `adapterVersion >= adapterMinVersionMap[adapterId]`。
2. 全部适配器通过 -> `pass`。
3. 部分适配器不通过，但存在至少一个可用适配器 -> `degrade`（剔除不兼容适配器），原因码 `h_gate_adapter_partial_degrade`。
4. 所有适配器不通过 -> `reject`，原因码 `h_gate_adapter_all_blocked_reject`。

#### 3.10.24 版本比较与聚合规则（P0，MVP 冻结）

版本比较规则：
1. 使用 SemVer 比较：`major.minor.patch`。
2. 仅允许数字三段；非法版本串 -> `reject`，原因码 `h_gate_invalid_version_format`。
3. 预发布标记（如 `-beta`）在 MVP 视为低于同号正式版。

聚合规则：
1. `gateAction=reject` 时，必须返回首个触发 `reject` 的阶段与原因码。
2. `gateAction=degrade` 时，必须返回所有降级来源（schema/sdk/adapter）与被剔除 adapter 列表。
3. `gateAction=allow` 时，`reasonCodes` 允许为空或仅记录 `h_gate_all_pass`。

#### 3.10.25 版本门禁原因码（P0，MVP 冻结）

1. `h_gate_all_pass`
2. `h_gate_schema_compatible_degrade`
3. `h_gate_schema_incompatible_reject`
4. `h_gate_sdk_below_min_degrade`
5. `h_gate_sdk_below_min_reject`
6. `h_gate_adapter_partial_degrade`
7. `h_gate_adapter_all_blocked_reject`
8. `h_gate_invalid_version_format`
9. `h_gate_missing_required_version`
10. `h_gate_policy_not_found`

#### 3.10.26 门禁结果下游动作约束（P0，MVP 冻结）

1. `allow`：请求进入标准主链路（A -> B -> C -> D -> E）。
2. `degrade`：请求进入降级主链路，必须带 `versionGateDecision`；D 仅使用 `compatibleAdapters[]`。
3. `reject`：请求不得进入 D/E，直接生成可审计失败结果（不触发竞价）。
4. 任一动作都必须写入审计快照，保证 F/G 可回放。

#### 3.10.27 MVP 验收基线（版本兼容门禁）

1. 同一输入版本集在同策略版本下产出确定性一致的 `gateAction`。
2. `schema/sdk/adapter` 顺序校验稳定，不会出现跨环境判定顺序漂移。
3. `degrade` 场景下被剔除 adapter 在 D 层不会被再次启用。
4. `reject` 场景不会进入竞价与渲染主链路，可通过 `requestKey + reasonCodes` 分钟级定位。

#### 3.10.28 版本锚点注入合同（P0，MVP 冻结）

注入接口语义：`injectVersionAnchors(gateDecision, resolvedConfigSnapshot, moduleVersions) -> versionAnchorSnapshot`。

输入对象：`hVersionAnchorInjectInputLite`

required：
1. `requestKey`
2. `traceKey`
3. `resolvedConfigSnapshot`
4. `versionGateDecision`
5. `moduleVersionRefs`
   - `enumDictVersion`
   - `mappingRuleVersion`
   - `policyRuleVersion`
   - `routingPolicyVersion`
   - `deliveryRuleVersion`
   - `eventContractVersion`
   - `dedupFingerprintVersion`
   - `closureRuleVersion`
   - `billingRuleVersion`
   - `archiveContractVersion`
6. `injectAt`
7. `versionAnchorContractVersion`

输出对象：`versionAnchorSnapshot`

required：
1. `requestKey`
2. `traceKey`
3. `anchorSet`
   - `schemaVersion`
   - `routingStrategyVersion`
   - `placementConfigVersion`
   - `globalConfigVersion`
   - `appConfigVersionOrNA`
   - `placementSourceVersionOrNA`
   - `configResolutionContractVersion`
   - `versionGateContractVersion`
   - `enumDictVersion`
   - `mappingRuleVersion`
   - `policyRuleVersion`
   - `routingPolicyVersion`
   - `deliveryRuleVersion`
   - `eventContractVersion`
   - `dedupFingerprintVersion`
   - `closureRuleVersion`
   - `billingRuleVersion`
   - `archiveContractVersion`
4. `anchorHash`
5. `freezeState`
6. `injectedAt`
7. `versionAnchorContractVersion`

#### 3.10.29 注入责任层与传播规则（P0，MVP 冻结）

责任层（唯一写入者）：
1. H 在 A 入口完成 `resolvedConfigSnapshot + versionGateDecision` 后，写入首版 `versionAnchorSnapshot`。
2. B/C/D/E/F 只可读取与透传锚点，不得覆盖既有锚点值。
3. B/C/D/E/F 若补充本模块锚点，仅允许“追加缺失字段”，不得改写已有字段。

传播规则：
1. `versionAnchorSnapshot` 必须挂载到 `TraceContext` 并沿 `A -> B -> C -> D -> E -> F -> G` 全链路透传。
2. 任一模块输出若缺失 `versionAnchorSnapshot`，视为合同错误并拒绝下游消费。

#### 3.10.30 冻结点定义（P0，MVP 冻结）

冻结点（固定）：
1. `freeze_point_ingress`：A 完成入口校验并准备进入 B 时，冻结 `schema/config/gate` 锚点。
2. `freeze_point_routing`：D 产出 Route Plan 时，冻结路由相关锚点（如 `routingPolicyVersion`）。
3. `freeze_point_delivery`：E 产出 Delivery 时，冻结渲染相关锚点（如 `deliveryRuleVersion`）。
4. `freeze_point_event`：F 产出归因计费事实时，冻结事件/闭环/归档锚点（`event/closure/billing/archive`）。

冻结约束：
1. 进入某冻结点后，该冻结点已覆盖的锚点值不可再变更。
2. 允许后续冻结点追加新锚点字段，但不得改写前置冻结点字段。
3. `anchorHash` 在每个冻结点重算并写入审计快照。

#### 3.10.31 中途切换策略（是否允许中途切换，P0，MVP 冻结）

禁止中途切换的锚点（全链路硬约束）：
1. `schemaVersion`
2. `routingStrategyVersion`
3. `placementConfigVersion`
4. `configResolutionContractVersion`
5. `versionGateContractVersion`

处置规则：
1. 在 `freeze_point_routing` 前检测到变更 -> `reject`，原因码 `h_anchor_switch_detected_pre_route`。
2. 在 `freeze_point_routing` 后检测到变更 -> 保持原锚点继续收敛并标记冲突，原因码 `h_anchor_switch_detected_post_route`。
3. 任一锚点缺失或空值 -> `reject`，原因码 `h_anchor_missing_required`。
4. 非法覆盖行为（非追加）-> `reject`，原因码 `h_anchor_mutation_forbidden`。

#### 3.10.32 回放与争议对账约束（P0，MVP 冻结）

1. F 输出到 G/Archive 的记录必须携带最终 `versionAnchorSnapshot` 或其可还原引用。
2. G replay 默认使用归档锚点快照，不允许按“当前版本”替换历史锚点。
3. dispute 场景下若传入锚点与归档锚点不一致，必须返回 `g_replay_diff_version_mismatch`。
4. 任一 case 必须可通过 `traceKey + anchorHash` 唯一定位到当时执行版本集合。

#### 3.10.33 版本锚点原因码（P0，MVP 冻结）

1. `h_anchor_all_pass`
2. `h_anchor_missing_required`
3. `h_anchor_injection_failed`
4. `h_anchor_mutation_forbidden`
5. `h_anchor_switch_detected_pre_route`
6. `h_anchor_switch_detected_post_route`
7. `h_anchor_snapshot_hash_mismatch`

#### 3.10.34 MVP 验收基线（版本锚点注入与冻结点）

1. 同一请求在 `A -> G` 全链路可读取同一组核心锚点值，不出现断链。
2. 锚点仅允许按冻结点追加，不允许中途覆盖，违反时可稳定拒绝并给出原因码。
3. F/G 回放可基于 `anchorHash` 复原当时版本集合，dispute 不依赖当前线上版本。
4. 任一锚点异常可通过 `requestKey + traceKey + anchorHash + reasonCodes` 分钟级定位。

#### 3.10.35 灰度规则合同（P0，MVP 冻结）

灰度接口语义：`evaluateRolloutSelector(requestContext, rolloutPolicy) -> rolloutDecision`。

输入对象：`hRolloutGateInputLite`

required：
1. `requestKey`
2. `traceKey`
3. `appId`
4. `placementId`
5. `sdkVersion`
6. `adapterIds[]`
7. `environment`
8. `rolloutPolicyVersion`
9. `rolloutAt`
10. `rolloutContractVersion`

optional：
1. `userBucketHintOrNA`
2. `extensions`

输出对象：`hRolloutDecisionLite`

required：
1. `requestKey`
2. `traceKey`
3. `rolloutAction`（`in_experiment` / `out_of_experiment` / `force_fallback`）
4. `selectedPolicyId`
5. `splitKey`
6. `bucketValue`（`0-99.99`）
7. `rolloutPercent`
8. `allowedAdapters[]`
9. `blockedAdapters[]`
10. `reasonCodes[]`
11. `rolloutAt`
12. `rolloutContractVersion`

#### 3.10.36 灰度选择器（app/placement/sdk/adapter，P0，MVP 冻结）

选择器维度（全部支持）：
1. `appSelector`：`includeAppIds[]` / `excludeAppIds[]`
2. `placementSelector`：`includePlacementIds[]` / `excludePlacementIds[]`
3. `sdkSelector`：`minSdkVersion` / `maxSdkVersionOrNA`
4. `adapterSelector`：`includeAdapterIds[]` / `excludeAdapterIds[]`

匹配规则（固定）：
1. 先 `exclude` 后 `include`；命中 `exclude` 立即 `out_of_experiment`。
2. 四类选择器均通过才可进入分流。
3. 任一选择器配置缺失视为“不过滤该维度”，不是失败。

#### 3.10.37 分流键与桶算法（P0，MVP 冻结）

`splitKey` 生成规则（固定）：
1. `splitKey = sha256(appId + "|" + placementId + "|" + sdkVersion + "|" + stableUserKeyOrDeviceKey + "|" + rolloutPolicyVersion)`。
2. `stableUserKeyOrDeviceKey` 缺失时回退 `traceKey`（仅当前会话稳定）。

桶算法：
1. `bucketValue = (uint64(splitKey[0:16]) mod 10000) / 100`，范围 `0.00 ~ 99.99`。
2. 相同 `splitKey` 必须得到相同 `bucketValue`。

#### 3.10.38 百分比分流策略（P0，MVP 冻结）

策略字段：
1. `rolloutPercent`（`0.00 ~ 100.00`）
2. `controlPercent`（默认 `100 - rolloutPercent`）
3. `adapterRolloutPercentMap`（可选，adapter 级灰度）

判定规则：
1. `bucketValue < rolloutPercent` -> `in_experiment`。
2. `bucketValue >= rolloutPercent` -> `out_of_experiment`。
3. `adapterRolloutPercentMap` 存在时，对每个 adapter 额外执行一次同算法分流。
4. `rolloutPercent` 非法（<0 或 >100）-> `force_fallback`，原因码 `h_rollout_invalid_percent`.

#### 3.10.39 熔断与回退条件（P0，MVP 冻结）

熔断观察窗口：`5m` 滑动窗口（按 `appId + placementId + rolloutPolicyVersion` 聚合）。

触发条件（任一满足即熔断）：
1. `error_rate >= errorRateThreshold`
2. `no_fill_rate >= noFillRateThreshold`
3. `p95_latency_ms >= latencyP95ThresholdMs`
4. `critical_reason_code_count >= criticalReasonThreshold`

回退动作：
1. 熔断后 `rolloutAction=force_fallback`，立即切回上一稳定策略（`lastStablePolicyId`）。
2. 熔断期间停止扩大灰度比例；仅允许手动恢复或冷却后自动半开。
3. 半开策略：冷却 `10m` 后以 `rolloutPercent=1%` 重新探测。

#### 3.10.40 灰度原因码（P0，MVP 冻结）

1. `h_rollout_selector_excluded`
2. `h_rollout_selector_not_matched`
3. `h_rollout_in_experiment`
4. `h_rollout_out_of_experiment`
5. `h_rollout_invalid_percent`
6. `h_rollout_split_key_missing_fallback_trace`
7. `h_rollout_circuit_breaker_triggered`
8. `h_rollout_force_fallback_applied`
9. `h_rollout_policy_not_found`

#### 3.10.41 MVP 验收基线（灰度规则合同）

1. 相同请求上下文在同一策略版本下始终命中相同桶位与灰度结论。
2. app/placement/sdk/adapter 四维选择器行为确定性一致，无隐式优先级漂移。
3. 熔断触发后能在分钟级切回 `lastStablePolicyId`，且不进入“部分生效”状态。
4. 任一灰度决策可通过 `splitKey + bucketValue + rolloutPolicyVersion + reasonCodes` 分钟级定位。

#### 3.10.42 配置决策原因码体系（P0，MVP 冻结）

配置决策动作（统一）：
1. `hit`（命中可用配置）
2. `degrade`（命中降级配置）
3. `reject`（拒绝进入主链路）

标准原因码（最小集）：
1. `h_cfg_decision_hit_exact_match`
2. `h_cfg_decision_hit_override_applied`
3. `h_cfg_decision_hit_cache_revalidated_304`
4. `h_cfg_decision_degrade_scope_unavailable`
5. `h_cfg_decision_degrade_stale_grace_served`
6. `h_cfg_decision_degrade_partial_adapter_compatible`
7. `h_cfg_decision_degrade_rollout_force_fallback`
8. `h_cfg_decision_reject_missing_required`
9. `h_cfg_decision_reject_schema_incompatible`
10. `h_cfg_decision_reject_version_gate_failed`
11. `h_cfg_decision_reject_anchor_invalid`
12. `h_cfg_decision_reject_policy_not_found`
13. `h_cfg_decision_reject_contract_invalid`

动作映射约束：
1. `hit` 仅允许使用 `h_cfg_decision_hit_*`。
2. `degrade` 仅允许使用 `h_cfg_decision_degrade_*`。
3. `reject` 仅允许使用 `h_cfg_decision_reject_*`。
4. 每次决策必须有一个 `primaryReasonCode`，可选多个 `secondaryReasonCodes[]`。

#### 3.10.43 配置决策审计快照合同（P0，MVP 冻结）

审计对象：`hConfigDecisionAuditSnapshotLite`

required：
1. `snapshotId`
2. `requestKey`
3. `traceKey`
4. `resolveId`
5. `configKey`
6. `decisionAction`（`hit` / `degrade` / `reject`）
7. `primaryReasonCode`
8. `secondaryReasonCodes[]`
9. `decisionPath[]`
   - `stageName`（`resolve` / `version_gate` / `rollout` / `cache` / `finalize`）
   - `stageResult`（`pass` / `degrade` / `reject`）
   - `stageReasonCodeOrNA`
10. `selectedVersionSnapshot`
    - `schemaVersion`
    - `routingStrategyVersion`
    - `placementConfigVersion`
    - `globalConfigVersion`
    - `appConfigVersionOrNA`
    - `placementSourceVersionOrNA`
    - `rolloutPolicyVersionOrNA`
11. `selectorDigest`
    - `appSelectorMatched`
    - `placementSelectorMatched`
    - `sdkSelectorMatched`
    - `adapterSelectorMatched`
    - `splitKeyOrNA`
    - `bucketValueOrNA`
12. `gateDigest`
    - `gateAction`
    - `blockedAdapters[]`
13. `cacheDigest`
    - `cacheDecision`
    - `etagOrNA`
    - `ttlSecOrNA`
    - `expireAtOrNA`
14. `anchorDigest`
    - `anchorHash`
    - `freezeState`
    - `versionAnchorContractVersion`
15. `generatedAt`
16. `auditSnapshotContractVersion`

optional：
1. `operatorIdOrNA`
2. `changeSetIdOrNA`
3. `extensions`

#### 3.10.44 主原因码裁决与一致性规则（P0，MVP 冻结）

主原因码裁决顺序（固定）：
1. `resolve`
2. `version_gate`
3. `rollout`
4. `cache`
5. `finalize`

裁决规则：
1. 若存在任一 `reject`，`primaryReasonCode` 取第一个触发 `reject` 的 stage 原因码。
2. 否则若存在任一 `degrade`，`primaryReasonCode` 取第一个触发 `degrade` 的 stage 原因码。
3. 否则取 `h_cfg_decision_hit_exact_match` 或 `h_cfg_decision_hit_cache_revalidated_304`。
4. 同请求同版本下，`primaryReasonCode` 必须确定性一致。

一致性约束：
1. `decisionAction=reject` 时不得出现 `h_cfg_decision_hit_*` 原因码。
2. `decisionAction=hit` 时 `decisionPath` 不得包含 `stageResult=reject`。
3. `secondaryReasonCodes[]` 不得与 `primaryReasonCode` 冲突（动作前缀必须一致或为辅助信息）。

#### 3.10.45 审计写入与关联规则（P0，MVP 冻结）

1. H 在生成最终配置决策后、进入 B 之前，必须写出 `hConfigDecisionAuditSnapshotLite`。
2. 快照必须挂载到 `TraceContext.configDecisionAuditSnapshotRef` 并沿 `A -> G` 透传。
3. F 输出到 G/Archive 时必须携带 `primaryReasonCode + configDecisionAuditSnapshotRef`（或可还原引用）。
4. 重试请求必须复用同一 `snapshotId`（若输入和版本锚点未变化）。
5. 快照写入失败默认 `reject`，原因码 `h_cfg_decision_reject_contract_invalid`（避免无审计决策进入主链路）。

#### 3.10.46 MVP 验收基线（配置决策原因码 + 审计快照）

1. 每个配置决策都可稳定映射到 `hit/degrade/reject + primaryReasonCode`。
2. 任一请求都能回放出完整 `decisionPath + selectedVersionSnapshot + anchorDigest`。
3. F/G 对账可通过 `snapshotId + primaryReasonCode + anchorHash` 对齐“为什么用了这份配置”。
4. 任一解释争议可通过 `requestKey + traceKey + configDecisionAuditSnapshotRef` 分钟级定位。

#### 3.10.47 配置失效场景分类（P0，MVP 冻结）

标准失效场景（最小集）：
1. `config_timeout`：配置服务超时，未在 `configFetchTimeoutMs` 内返回。
2. `config_unavailable`：配置服务不可用（5xx、网络不可达、依赖故障）。
3. `config_version_invalid`：配置返回成功但版本非法/不兼容（含 schema/version anchor 不合法）。

统一故障上下文字段：
1. `configFailureScenario`
2. `failureDetectedAt`
3. `detectedByModule`
4. `failureMode`（`fail_open` / `fail_closed`）

#### 3.10.48 失效处置总则（P0，MVP 冻结）

总则：
1. 安全与合规优先于可用性；遇到版本非法一律优先 `fail_closed`。
2. 仅当存在“可验证的稳定快照”（fresh 或 `stale_grace`）时允许 `fail_open`。
3. `fail_open` 必须显式标记降级并写审计，不允许静默放行。
4. `fail_closed` 必须返回标准原因码并阻断后续竞价/渲染链路。

优先级：
1. `config_version_invalid` -> 强制 `fail_closed`
2. `config_unavailable/config_timeout` -> 先尝试 `fail_open`（若有稳定快照），否则 `fail_closed`

#### 3.10.49 A-H 模块级 fail-open / fail-closed 矩阵（P0，MVP 冻结）

场景一：`config_timeout`
1. `Module A`：有稳定快照 -> `fail_open`（`degrade`）；无快照 -> `fail_closed`（`reject`）。
2. `Module B`：仅在携带 `resolvedConfigSnapshot` 时放行；缺失则 `fail_closed`。
3. `Module C`：可基于快照执行最小策略集；策略快照缺失则 `fail_closed`。
4. `Module D`：`fail_open` 时仅使用 `lastStablePolicyId` 与兼容 adapter 集；否则 `fail_closed`。
5. `Module E`：仅当 D 有有效候选且 C 未拒绝时放行；否则返回 `no_fill/error`。
6. `Module F`：始终放行审计写入，记录 `failureMode + reasonCodes`。
7. `Module G`：始终放行审计归档与回放索引，不参与拦截。
8. `Module H`：负责输出最终 `failureMode` 与模块动作快照。

场景二：`config_unavailable`
1. `Module A`：同 `config_timeout` 规则。
2. `Module B`：同 `config_timeout` 规则。
3. `Module C`：同 `config_timeout` 规则，且必须启用最严格默认 policy（若快照可用）。
4. `Module D`：降级为最小路由（主 source + fallback source），并收紧超时。
5. `Module E`：不允许启用新模板/新容器，仅允许稳定模板白名单。
6. `Module F`：放行事实流与失败事实写入。
7. `Module G`：放行审计归档与 replay。
8. `Module H`：触发配置服务不可用告警与熔断评估。

场景三：`config_version_invalid`
1. `Module A`：强制 `fail_closed`，拒绝进入 B。
2. `Module B`：若收到该场景请求必须 `reject`，不得做映射推断。
3. `Module C`：强制 `reject`，原因码必须保留。
4. `Module D`：不得发起 supply 请求。
5. `Module E`：不得执行渲染计划生成。
6. `Module F`：必须写入 `reject` 终态审计事件。
7. `Module G`：必须归档完整失败快照用于 dispute。
8. `Module H`：标记配置版本异常并禁止该版本继续灰度/发布。

#### 3.10.50 故障原因码与动作映射（P0，MVP 冻结）

标准原因码（最小集）：
1. `h_cfg_fail_open_timeout_stale_grace`
2. `h_cfg_fail_open_unavailable_stable_snapshot`
3. `h_cfg_fail_closed_no_stable_snapshot`
4. `h_cfg_fail_closed_version_invalid`
5. `h_cfg_fail_closed_anchor_invalid`
6. `h_cfg_fail_closed_policy_missing`
7. `h_cfg_fail_open_restricted_route_mode`
8. `h_cfg_fail_open_restricted_template_mode`
9. `h_cfg_fail_closed_contract_violation`

动作映射：
1. `fail_open` 仅允许 `h_cfg_fail_open_*`。
2. `fail_closed` 仅允许 `h_cfg_fail_closed_*`。
3. 任一故障决策必须携带 `primaryReasonCode` 与 `configFailureScenario`。

#### 3.10.51 失效决策审计快照（P0，MVP 冻结）

审计对象：`hConfigFailureDecisionSnapshotLite`

required：
1. `snapshotId`
2. `requestKey`
3. `traceKey`
4. `configFailureScenario`
5. `failureMode`
6. `primaryReasonCode`
7. `moduleActions`
   - `moduleAAction`
   - `moduleBAction`
   - `moduleCAction`
   - `moduleDAction`
   - `moduleEAction`
   - `moduleFAction`
   - `moduleGAction`
   - `moduleHAction`
8. `stableSnapshotRefOrNA`
9. `lastStablePolicyIdOrNA`
10. `anchorHashOrNA`
11. `generatedAt`
12. `failureAuditContractVersion`

#### 3.10.52 执行与回放约束（P0，MVP 冻结）

1. 进入 `fail_open` 时，必须携带 `stableSnapshotRefOrNA` 与受限动作标记（restricted route/template）。
2. 进入 `fail_closed` 时，必须在 A 或 C 截断主链路，D/E 不得被调用（`config_version_invalid` 场景）。
3. F/G 必须归档 `hConfigFailureDecisionSnapshotLite`，保证 replay 可还原模块动作矩阵。
4. 任一故障请求都必须可由 `requestKey + configFailureScenario + primaryReasonCode` 唯一定位。

#### 3.10.53 MVP 验收基线（配置失效 fail-open / fail-closed 矩阵）

1. 三类失效场景在 A-H 上的动作一致且可预测，不出现同场景多行为。
2. `config_version_invalid` 始终 `fail_closed`，不会进入 supply/渲染链路。
3. `timeout/unavailable` 仅在稳定快照存在时允许 `fail_open`，否则稳定 `fail_closed`。
4. 所有故障决策都可通过 `hConfigFailureDecisionSnapshotLite` 在 replay/dispute 中完整复原。
