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

1. `etag` 生成规则：`etag = sha256(configHash + "|" + placementConfigVersion + "|" + routingStrategyVersion)`。
2. 命中规则：
   - `If-None-Match == current etag` -> `304 Not Modified`。
   - 不相等或未携带 -> 返回 `200` + 最新 `resolvedConfigSnapshot`。
3. 同一 `configHash + version snapshot` 必须生成同一 `etag`。
4. 任一版本锚点变化必须导致 `etag` 变化。

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
