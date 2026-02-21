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
