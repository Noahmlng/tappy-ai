# Mediation Design Changelog

### 2026-02-21（v4.1）

1. 更新 `Module F`，冻结 `POST /events` 输入合同（批量 envelope + `events[]` 规模约束）。
2. 新增单事件输入合同（通用 required、事件类型条件必填、异常值处置）。
3. 新增逐条 ACK 合同（`accepted/rejected/duplicate`）与 `ackItemLite` 字段定义。
4. 新增 `partial_success` 判定与重试语义，明确部分成功下客户端重试范围。
5. 补充 Module F 输入合同 MVP 验收基线，并纳入当前交付包。

### 2026-02-21（v4.0）

1. 将原 `docs/mediation-module-design.md` 单文件重构为主入口 + 索引 + 子文件目录结构。
2. 新增结构化目录 `docs/mediation-design/`，并按核心域拆分为 `core/`、`modules/`、`operations/`。
3. 保留 A-H 模块设计全文，按模块文件独立管理，便于 agent 按边界编辑。
4. 新增 `README.md`、`INDEX.md`、`AGENT_GUIDE.md`，定义阅读路径与跨模块更新规则。
5. 将历史版本记录（v0.x ~ v3.x）迁移到本文件集中维护。

### 2026-02-21（v3.31）

1. 更新 `3.7.3`，将 E 层输出合同范围扩展至 `3.7.40`，并显式链接 E->App / E->F 合同。
2. 新增 `3.7.37`，冻结 E 对 App 的最终 Delivery 对象 `eDeliveryResponseLite`。
3. 新增 `3.7.38`，冻结 E -> F 事件输出对象 `eToFEventLite`。
4. 新增 `3.7.39`，冻结 `routed -> served/no_fill/error` 状态迁移一致性矩阵。
5. 新增 `3.7.40`，补充 E 输出合同与状态更新的 MVP 验收基线。
6. 更新第 4 章交付项，将 E 输出合同与状态更新纳入当前版本交付口径。

### 2026-02-21（v3.30）

1. 更新 `3.7.3`，将 E 层输出合同范围扩展至 `3.7.36`。
2. 更新 `3.7.9`，将 `eErrorDegradeDecisionSnapshotLite` 升级为 `renderPlanLite` 必填字段。
3. 新增 `3.7.32`，冻结 E 层标准错误码体系（`e_nf_*` / `e_er_*`）及阶段映射规则。
4. 新增 `3.7.33`，冻结 `no_fill vs error` 判定顺序与一致性约束。
5. 新增 `3.7.34`，冻结 fail-open / fail-closed 动作矩阵。
6. 新增 `3.7.35`，冻结错误与降级决策快照结构。
7. 新增 `3.7.36`，补充 E 层错误码与降级矩阵的 MVP 验收基线。
8. 更新第 4 章交付项，将 E 层错误码与降级矩阵纳入当前版本交付口径。

### 2026-02-21（v3.29）

1. 更新 `3.7.3`，将 E 层输出合同范围扩展至 `3.7.31`。
2. 更新 `3.7.9`，将 `eValidationSnapshotLite` 升级为 `renderPlanLite` 必填字段。
3. 新增 `3.7.26`，冻结 E 层验证与拦截总则（allow/degrade/block）。
4. 新增 `3.7.27`，冻结素材完整性校验与失败处置。
5. 新增 `3.7.28`，冻结 policy flag 拦截矩阵与敏感场景约束。
6. 新增 `3.7.29`，冻结 disclosure 要求与拦截规则。
7. 新增 `3.7.30`，冻结 UI 安全边界（尺寸/频控/敏感场景）及 `eValidationSnapshotLite` 结构。
8. 新增 `3.7.31`，补充 E 层验证与拦截规则的 MVP 验收基线。
9. 更新第 4 章交付项，将 E 层验证与拦截规则纳入当前版本交付口径。

### 2026-02-21（v3.28）

1. 更新 `3.7.3`，将 E 层输出合同范围扩展至 `3.7.25`。
2. 更新 `3.7.11`，补充追踪注入字段/时机/映射的结构引用。
3. 新增 `3.7.22`，冻结 `ad_render_started/ad_rendered/ad_render_failed` 事件字段合同与 `responseReference` 绑定。
4. 新增 `3.7.23`，冻结触发时机、时序互斥与幂等键规则。
5. 新增 `3.7.24`，冻结渲染事件与 M1 `impression/click/failure` 映射关系。
6. 新增 `3.7.25`，补充追踪注入与事件合同的 MVP 验收基线。
7. 更新 `3.8.1`，显式绑定 F 层与 `3.7.24` 的映射一致性要求。
8. 更新第 4 章交付项，将追踪注入与事件合同纳入当前版本交付口径。

### 2026-02-21（v3.27）

1. 更新 `3.7.9`，将 `renderCapabilityGateSnapshotLite` 升级为 `renderPlanLite` 必填字段。
2. 新增 `3.7.18`，冻结渲染能力门禁矩阵（`placement_spec × device_capabilities × mode_contract`）。
3. 新增 `3.7.19`，冻结格式选择规则与降级顺序（含 `mraid -> webview -> native` 链路）。
4. 新增 `3.7.20`，冻结门禁快照结构与一致性约束。
5. 新增 `3.7.21`，补充渲染能力门禁矩阵的 MVP 验收基线。
6. 更新第 4 章交付项，将渲染能力门禁矩阵纳入当前版本交付口径。

### 2026-02-21（v3.26）

1. 更新 `3.7.9`，将 `candidateConsumptionDecision` 升级为 `renderPlanLite` 必填字段。
2. 新增 `3.7.14`，冻结 E 层候选消费规则（`top1_strict/topN_fill`）。
3. 新增 `3.7.15`，冻结无候选路径与 no-fill 输出约束。
4. 新增 `3.7.16`，冻结多卡启用条件、N 计算、去重与降级规则。
5. 新增 `3.7.17`，冻结最终渲染决策矩阵与上下游一致性约束。
6. 更新第 4 章交付项，将候选消费与最终渲染决策规则纳入当前版本交付口径。

### 2026-02-21（v3.25）

1. 新增 `3.7.9`，冻结 `renderPlanLite` 输出合同（含 renderMode、容器参数、素材引用、追踪注入、UI 约束、TTL）。
2. 新增 `3.7.10`，明确 renderMode 与容器参数矩阵（native/webview/mraid/视频占位）。
3. 新增 `3.7.11`，冻结追踪注入位与 `ad_render_started/ad_rendered/ad_render_failed` 触发对齐规则。
4. 新增 `3.7.12`，冻结 UI 约束与 TTL 规则及异常处置。
5. 新增 `3.7.13`，补充 render_plan 输出合同的 MVP 验收基线。
6. 更新第 4 章交付项，将 E 层 render_plan 输出合同纳入当前版本交付口径。

### 2026-02-21（v3.24）

1. 新增 `3.7.4`，冻结 `compose(auction_result, placement_spec, device_capabilities)` 的输入合同（`eComposeInputLite`）。
2. 新增 `3.7.5`，明确 compose 输入缺失字段处置动作与原因码。
3. 新增 `3.7.6`，明确 compose 输入非法值处置与语义冲突处置。
4. 新增 `3.7.7`，冻结 compose 输入版本锚点集合与版本约束。
5. 新增 `3.7.8`，补充 compose 输入合同的 MVP 验收基线。
6. 更新第 4 章交付项，将 E 层 compose 输入合同纳入当前版本交付口径。

### 2026-02-21（v3.23）

1. 新增 `3.6.32`，冻结 `routeAuditSnapshotLite` 结构（命中路由、切路原因、最终选路、版本快照、trace 键）。
2. 新增 `3.6.33`，补充路由审计快照的 MVP 验收基线。
3. 更新 `3.6.29`，将 `routeAuditSnapshotLite` 升级为 `D -> E` 必填字段。
4. 更新第 4 章交付项，纳入路由审计快照交付口径。

### 2026-02-21（v3.22）

1. 新增 `3.6.29`，冻结 `D -> E` 输出合同 `dToEOutputLite`（最小字段 + 版本锚点）。
2. 新增 `3.6.30`，明确候选存在性、路由结论、状态更新三类一致性约束。
3. 新增 `3.6.31`，补充 D 输出合同的 MVP 验收基线。
4. 更新 `3.6.4`，将 D 输出合同指向冻结章节。
5. 更新第 4 章交付项，纳入 D 输出合同交付口径。

### 2026-02-21（v3.21）

1. 新增 `3.6.24`，冻结 D 层 `Route Plan` 执行对象（`routePlanLite`）。
2. 新增 `3.6.25`，明确主/次/fallback 三层触发条件与阻断条件。
3. 新增 `3.6.26`，冻结同级 source 的确定性 tie-break 规则链路。
4. 新增 `3.6.27`，冻结 Route Plan 短路动作、优先级与审计字段。
5. 新增 `3.6.28`，补充 Route Plan 的 MVP 验收基线。
6. 更新第 4 章交付项，纳入 Route Plan 交付口径。

### 2026-02-21（v3.20）

1. 新增 `3.6.20`，冻结 `error normalize` 子合同（`sourceOutcomeRawLite` -> `normalizedSourceOutcomeLite`）。
2. 新增 `3.6.21`，明确 `no_fill/timeout/error` 标准化与 `retryable/non_retryable` 语义。
3. 新增 `3.6.22`，冻结原因码前缀与最小原因码集合，并定义冲突映射规则。
4. 新增 `3.6.23`，补充 `error normalize` 的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 `error normalize` 交付口径。

### 2026-02-21（v3.19）

1. 新增 `3.6.16`，冻结 `candidate normalize` 子合同（`sourceCandidateRawLite` -> `normalizedCandidateLite`）。
2. 新增 `3.6.17`，冻结候选排序字段与确定性排序规则。
3. 新增 `3.6.18`，明确候选缺失处理与 canonical 映射规则。
4. 新增 `3.6.19`，补充 `candidate normalize` 的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 `candidate normalize` 子合同交付口径。

### 2026-02-21（v3.18）

1. 新增 `3.6.12`，冻结 `request adapt` 子合同（统一输入到 `sourceRequestLite` 的最小字段）。
2. 新增 `3.6.13`，明确超时预算传递规则（全局预算到 source 预算扣减）。
3. 新增 `3.6.14`，明确 `extensions` 边界与污染处置规则。
4. 新增 `3.6.15`，补充 `request adapt` 的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 `request adapt` 子合同交付口径。

### 2026-02-21（v3.17）

1. 新增 `3.6.9`，冻结 Adapter 注册与能力声明最小合同（`sourceId`、能力集、合同版本、启停状态）。
2. 新增 `3.6.10`，明确能力声明约束与 `active/paused/draining/disabled` 状态语义。
3. 新增 `3.6.11`，补充 Adapter 注册与能力声明的 MVP 验收基线。
4. 更新第 4 章交付项，纳入 Adapter 注册与能力声明交付口径。

### 2026-02-21（v3.16）

1. 新增 `3.6.5`，冻结 Module D 的 `C -> D` 输入合同（required/optional + 版本锚点）。
2. 新增 `3.6.6`，明确 D 输入缺失字段处置动作与标准原因码。
3. 新增 `3.6.7`，明确 D 输入非法值和预算异常的处置规则。
4. 新增 `3.6.8`，补充 D 输入合同的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 D 输入合同交付口径。

### 2026-02-21（v3.15）

1. 新增 `3.5.18`，冻结 Module C 的 `policyAuditSnapshotLite` 结构（命中规则、裁决动作、最终结论、版本快照、trace 键）。
2. 新增 `3.5.19`，明确 Policy 审计快照的生成规则与一致性约束。
3. 新增 `3.5.20`，补充 Policy 审计快照的 MVP 验收基线。
4. 在 `3.5.12` 明确 `policyAuditSnapshotLite` 的结构引用。
5. 更新第 4 章交付项，纳入 Policy 审计快照交付口径。

### 2026-02-21（v3.14）

1. 新增 `3.5.15`，冻结 Module C 的 Policy 原因码体系（命名规范与最小原因码集）。
2. 新增 `3.5.16`，冻结原因码到动作（allow/degrade/block/reject）的映射关系。
3. 新增 `3.5.17`，补充 Policy 原因码体系的 MVP 验收基线。
4. 更新第 4 章交付项，纳入 Policy 原因码体系交付口径。

### 2026-02-21（v3.13）

1. 新增 `3.5.12`，冻结 Module C 的 `C -> D/E` 输出合同（最小输出字段与双路径输出）。
2. 新增 `3.5.13`，明确 `isRoutable` 判定与 `stateUpdate` 状态更新规则。
3. 新增 `3.5.14`，补充 C 输出合同的 MVP 验收基线。
4. 更新第 4 章交付项，纳入 C 输出合同交付口径。

### 2026-02-21（v3.12）

1. 新增 `3.5.8`，冻结 Module C 的规则执行先验顺序（合规 -> 授权 -> 频控 -> 类目）。
2. 新增 `3.5.9`，明确短路条件与短路审计字段（block/allow）。
3. 新增 `3.5.10`，冻结多 gate 冲突时的动作优先级与 tie-break 规则。
4. 新增 `3.5.11`，补充执行顺序与短路机制的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 C 执行顺序/短路机制交付口径。

### 2026-02-21（v3.11）

1. 新增 `3.5.4`，冻结 Module C 的 `B -> C` 输入合同（required/optional + 版本锚点）。
2. 新增 `3.5.5`，明确 C 输入缺失字段的处置动作与标准原因码。
3. 新增 `3.5.6`，明确 C 输入非法值与版本锚点异常的拒绝规则。
4. 新增 `3.5.7`，补充 C 输入合同的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 C 输入合同交付口径。

### 2026-02-21（v3.10）

1. 新增 `3.4.21`，冻结六块 Schema 的最小 required 字段矩阵（Request/Placement/User/Opportunity/Policy/Trace）。
2. 新增 `3.4.22`，补充 required 矩阵的 MVP 验收基线与稳定性要求。
3. 在 `3.4.1` 与 `3.4.18` 增加 required 矩阵引用，明确其为 B 输出合格门槛。
4. 更新第 4 章交付项，纳入六块 required 矩阵交付口径。

### 2026-02-21（v3.9）

1. 新增 `3.4.18`，冻结 Module B 输出合同 `bNormalizedOpportunityLite` 的最小字段集合。
2. 新增 `3.4.19`，冻结 `mappingAuditSnapshotLite` 审计结构与必填项（含 `raw/normalized/conflictAction/ruleVersion`）。
3. 新增 `3.4.20`，补充 B 输出合同与映射审计快照的 MVP 验收基线。
4. 更新第 4 章交付项，纳入 B 输出合同与 mappingAudit 交付口径。

### 2026-02-21（v3.8）

1. 新增 `3.4.14`，冻结 Module B 字段级冲突裁决引擎（字段单元、冲突检测、字段策略）。
2. 新增 `3.4.15`，定义冲突动作 `override/merge/reject` 与最小原因码集。
3. 新增 `3.4.16`，冻结同优先级 tie-break 的确定性规则链路。
4. 新增 `3.4.17`，补充冲突裁决审计输出合同与 MVP 验收基线。
5. 更新第 4 章交付项，纳入字段级冲突裁决引擎交付口径。

### 2026-02-21（v3.7）

1. 新增 `3.4.10`，冻结 Module B 的 Canonical 枚举字典最小集合与版本线（`enumDictVersion`）。
2. 新增 `3.4.11`，定义 raw -> canonical 的固定映射流程与最小映射表示例。
3. 新增 `3.4.12`，明确 `unknown_*` 回退值策略以及 gating/non-gating 处置边界。
4. 新增 `3.4.13`，补充 Canonical 枚举字典的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 Canonical 枚举字典交付口径。

### 2026-02-21（v3.6）

1. 新增 `3.4.6`，冻结 Module B 的 `A -> B` 输入合同（required/optional + 版本锚点）。
2. 新增 `3.4.7`，明确 required/optional 缺失处理动作与标准原因码。
3. 新增 `3.4.8`，明确结构/枚举/值域三类非法值的处置规则与审计字段。
4. 新增 `3.4.9`，补充 B 输入合同的 MVP 验收基线。
5. 更新第 4 章交付项，纳入 B 输入合同交付口径。

### 2026-02-21（v3.5）

1. 按“当前只做最小可跑通实现”原则，剪枝第 4 章交付包，统一为 MVP-only 交付清单。
2. 重写第 5 章为“后置索引”结构，仅保留优化方向与专题索引，不展开字段级细节。
3. 明确文档口径：当前版本聚焦必需能力，详细设计后置到专项文档。

### 2026-02-21（v3.4）

1. 新增 Module A MVP 裁剪章节，按“先走通路径”原则划分必要模块与优化模块。
2. 为必要模块定义 MVP 最小实现边界，避免过度工程化。
3. 将完整分级鉴权、完整异常矩阵、完整上下文边界等归入后续优化项。
4. 冻结当前实施原则：本阶段只做必要模块，优化模块统一延后。
5. 更新交付包清单，新增 Module A MVP 裁剪说明条目。

### 2026-02-21（v3.3）

1. 在 `3.3` 新增 A-layer Error Code Taxonomy，统一 A 层错误码命名、分层与最小码集。
2. 固化错误码与处置动作映射规则，要求错误码可直接映射到异常处置与识别结果。
3. 新增主错误码/次错误码聚合规则，统一运维告警和对账口径。
4. 新增 `aErrorSnapshot` 输出合同及下游消费约束。
5. 增加错误码覆盖率与一致性核心指标，并更新交付包条目。

### 2026-02-21（v3.2）

1. 在 `3.3` 新增 Trace Initialization Contract，冻结 A 层追踪主键初始化规则。
2. 固化主键集合（trace/request/attempt/opportunity/lineage）及主键关系约束。
3. 新增生成优先级与 retry/reuse 继承规则，确保去重与重试链路不断链。
4. 新增 `traceInitSnapshot` 输出合同、失败兜底与下游消费约束。
5. 增加 trace 连续性核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v3.1）

1. 在 `3.3` 新增 A-layer Latency Budget，明确 A 层软/硬预算与预算档位模型。
2. 增加 A 层分阶段预算拆分（validate/context/sensing）与超限处理顺序。
3. 新增 A 层截断策略矩阵，明确超时时的放行/降级/拦截行为。
4. 新增 `aLatencyBudgetSnapshot` 输出合同及下游消费约束。
5. 增加时延治理核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v3.0）

1. 在 `3.3` 新增 Context Extraction Boundary，明确 A 层上下文抽取边界仅在 Mediation Ingress 范围生效。
2. 冻结三层抽取窗口模型（turn/session/task）与窗口升级规则。
3. 新增敏感度分层（S0-S3）、脱敏规则与最小必要抽取约束。
4. 新增上下文预算护栏（token/time/field）及超限降级流程。
5. 新增 `contextBoundarySnapshot` 输出合同、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.9）

1. 在 `3.3` 新增 A 层异常处置矩阵（Fail-open / Fail-closed Matrix in A）。
2. 固化处置模式与动作定义（continue/degrade/short-circuit/block），避免“受控降级”语义歧义。
3. 新增“异常类型 -> 默认模式/动作 -> 例外条件”的统一矩阵与执行优先级。
4. 新增 `aLayerDispositionSnapshot` 输出合同及 A->B/C/D 约束。
5. 增加处置一致性核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.8）

1. 在 `3.3` 新增 Sensing Decision Output Contract，固化 A->B/C 的结构化识别结果输出。
2. 冻结合同对象 `sensingDecision` 的 required/conditional/optional 字段集。
3. 明确命中类型、置信带、阻断原因、不成立原因与冲突裁决约束。
4. 新增 A->B/C/D 的消费边界，禁止下游改写 A 层原始识别结论。
5. 增加 `sensingDecisionContractVersion` 版本治理、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.7）

1. 在 `3.3` 新增 Opportunity Trigger Taxonomy 设计，冻结“什么算机会”的触发字典边界（Mediation 范围）。
2. 新增两级触发结构（`triggerCategory` + `triggerType`）与最小触发类型集。
3. 定义机会成立/不成立条件与标准输出结论（eligible/ineligible/blocked）。
4. 新增 `triggerSnapshot` 输出合同及 A->B/C/D 消费约束。
5. 增加 `triggerTaxonomyVersion` 版本治理规则、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.6）

1. 在 `3.3` 新增 Idempotency / De-dup 设计，明确仅覆盖 Mediation Ingress 范围。
2. 冻结幂等键优先级与平台去重指纹规则，并引入 `dedupFingerprintVersion`。
3. 新增去重窗口与状态机（`new/inflight_duplicate/reused_result/expired_retry`）。
4. 新增重复请求处理矩阵、最小原因码、`dedup store` 一致性约束与降级策略。
5. 新增 `dedupSnapshot` 输出合同、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.5）

1. 在 `3.3` 新增 Auth + Source Trust 设计，明确仅覆盖 Mediation Ingress 范围。
2. 冻结 Ingress 鉴权结果分级（strong/basic/soft/hard）与来源可信分层（T0/T1/T2/T3）。
3. 新增“鉴权结果 + 信任等级”处置矩阵，明确放行、降级、拦截边界。
4. 新增 `authTrustSnapshot` 下游输出合同，约束 A->B/C/D 消费方式。
5. 增加 Auth/Trust 的核心观测指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.4）

1. 在 `3.3` 新增 Ingress Request Envelope 设计（六块壳层 + required/optional 冻结边界）。
2. 增加 Ingress 三层校验模型（结构/语义/可信）及失败处理动作。
3. 增加 Module A 输出与错误语义分类（accepted seed vs rejected/blocked）。
4. 增加 Envelope 独立版本线 `ingressEnvelopeVersion` 与兼容规则。
5. 在交付包新增 Module A Envelope 合同说明条目。

### 2026-02-21（v2.3）

1. 将 `3.2.1` 流程图中的 `A/B/C` 合并节点拆分为独立模块：`Module A`、`Module B`、`Module C`。
2. 在主流程中明确模块级数据交接：`Opportunity Seed -> Unified Opportunity Schema -> Policy Gate`。
3. 增加策略拦截分支（`Policy blocked result -> Delivery`），避免“只看可路由路径”的误读。
4. 在“请求来回与数据职责”补充主链内部固定顺序：`A -> B -> C -> D -> E`。

### 2026-02-21（v2.2）

1. 将 “Mediation 与 Ads Network 交互流程”从后置章节上移到 `3.2.1`，作为第 3 章整体框架讲解入口。
2. 删除后部重复内容，保留单一权威版本，减少阅读跳转。
3. 保持流程图语义不变，仅调整信息架构顺序，提升团队同步效率。

### 2026-02-21（v2.1）

1. 新增 `3.14`：补充 Mediation 与 Ads Network 的职责边界定义，明确“谁负责交易，谁负责交付与闭环”。
2. 新增主流程 Mermaid 图，标注我们产品与 Ads Network 间的请求/响应来回链路。
3. 明确闭环位置：闭环完成发生在 Mediation 内部 `Delivery + terminal Event -> Archive`，而非仅以供给返回为完成。
4. 更新交付包清单，新增“Ads Network 交互边界与流程图说明”。

### 2026-02-21（v2.0）

1. 将第 3 章重排为“按 Agent Plan 可拆分结构”，统一模块表达模板（职责/输入/规则/输出/审计版本）。
2. 以 A-H 模块重建执行顺序，替代原先按能力散点展开的阅读顺序。
3. 将统一 schema、映射优先级、adapter 合同、Delivery/Event 分离、闭环、路由、审计、版本治理挂接到对应模块。
4. 新增 `3.13` 模块级 plan 拆分建议，便于下一步直接分配子模块设计任务。

### 2026-02-21（v1.9）

1. 以模块链路重构 `3.11`，补充每个核心模块的输入、关键动作与输出。
2. 新增“链路视角”说明，明确如何服务 `SDK 接入与机会识别` 与 `SSP-like bid request key information` 构建。
3. 补回并完善当前版本交付包，新增模块化链路说明条目。
4. 在 `5.4` 增加按核心模块拆分的优化重点，形成可执行的优化路线视图。

### 2026-02-21（v1.8）

1. 新增 `3.11`：补充 Media Agents 层核心模块清单与当前优先落地建议。
2. 新增 `5.4`：拆分优化项路线，明确“当前持续优化”与“未来具体优化项”。
3. 在交付包中加入 Media Agents 模块说明项。

### 2026-02-21（v1.7）

1. 按统一口径去除阶段编号概念，统一为“当前版本 + 优化项”表达。
2. 将“后续规划”重构为“优化项与 SSP 过渡”，避免多套阶段定义并行。
3. 保留原有设计内容与约束，不改变已定义的核心能力边界。

### 2026-02-21（v1.6）

1. 细化 `5.3` 向 SSP 过渡准备，新增标准化交易接口分层蓝图（请求/响应/拍卖结果/回传/结算）。
2. 增加信息采集补强清单，识别交易、供给路径、质量、结算、合规等关键缺口。
3. 增加按六块模型的 schema 增补建议，并给出演进顺序与过渡验收基线。

### 2026-02-21（v1.5）

1. 新增 `3.10` 配置与版本治理，明确其作为稳定迭代与接入兼容的基础能力。
2. 冻结三条版本线分离管理：`schema version`、`routing strategy version`、`placement config version`。
3. 新增兼容性发布规则、版本快照记录、分层回滚策略与验收基线。
4. 在交付包加入配置与版本治理说明。

### 2026-02-21（v1.4）

1. 新增 `3.9` 可观测与审计模型，明确其在排障与运营可控中的基础地位。
2. 冻结“单机会对象”为最小审计单元，并要求全生命周期可追踪。
3. 冻结四段关键决策点：映射、路由、返回、回传。
4. 新增最小审计字段集、可观测视图与验收基线，并加入交付包。

### 2026-02-21（v1.3）

1. 新增关联文档索引，链接回 AI Assistant Placement Framework。
2. 明确 Mediation 设计文档与 placement 产品规范之间的双向对齐关系。

### 2026-02-21（v1.2）

1. 新增 `3.8` 路由与降级策略模型，明确其为当前版本线上可用性核心。
2. 冻结路由引擎形态为规则 DAG，并定义主路由/次路由/fallback 固定顺序。
3. 新增超时阈值、`no_fill` 与 `error` 处理口径，以及 fail-open/fail-closed 边界。
4. 补充路由策略验收基线，并加入交付包清单。

### 2026-02-21（v1.1）

1. 重构 `3.5` 为可判定的数据闭环模型：`Request -> Delivery -> Event -> Archive`。
2. 新增机会对象可追溯约束，要求关键关联键、状态、原因码、规则版本可追踪。
3. 冻结闭环完成条件：有 Delivery 且有终态 Event，并通过同一 `responseReference` 关联。
4. 增加超时兜底终态与单请求全链路回放基线，保障闭环完整性与可排障性。

### 2026-02-21（v1.0）

1. 强化 `3.4.5`：将“回传冲突解决”升级为 Delivery/Event 职责分离设计，并补充重要性说明。
2. 新增 `3.4.6`：冻结 `responseReference` 关联规则与事件最小集（`impression`/`click`/`failure`）。
3. 增加验收基线，确保“返回链路”和“事件链路”解耦且可闭环。

### 2026-02-21（v0.9）

1. 在 `3.4` 新增 “Supply Adapter 标准合同（当前版本冻结）”，明确其作为扩展供给的核心前置条件。
2. 冻结四项必选职责：`request adapt`、`candidate normalize`、`error normalize`、`source trace`。
3. 新增 `extensions` 边界约束：私有字段可保留但不得污染主语义。
4. 新增 Adapter 最小交付检查，作为接入验收基线。

### 2026-02-21（v0.8）

1. 在 `3.3` 补充“输入映射与冲突优先级”的重要性说明，明确其与可复现性的关系。
2. 冻结来源优先级（`app 显式 > placement 配置 > 默认策略`）及冲突裁决约束。
3. 新增枚举归一规范与映射审计记录要求（原值 + 归一值 + 冲突处理 + 规则版本）。

### 2026-02-21（v0.7）

1. 在 `3.2` 明确“统一 Opportunity Schema”的重要性定位（共同语言，避免路由/回传/闭环语义发散）。
2. 冻结六块骨架在当前版本的 required/optional 边界，保持概念层定义。
3. 新增 `schemaVersion` 与 `state`（received/routed/served/no_fill/error）及状态迁移约束。

### 2026-02-21（v0.6）

1. 新增三项核心章节：统一机会建模 Schema、数据闭环、旧 SSP vs 新 AI 内容边界。
2. 将当前版本章节重排为“框架 -> Schema -> 映射 -> 适配 -> 闭环 -> 对接边界 -> 接入清单”。
3. 保留策略分析与优化项规划，避免文档仅剩执行层内容。

### 2026-02-21（v0.5）

1. 重构为“策略 + 上下文 + 当前版本设计 + 后续规划”的一体化设计文档。
