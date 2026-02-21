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
