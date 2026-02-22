# Mediation 开发总计划（可拆分任务版）

- 版本：v1.0
- 日期：2026-02-21
- 适用范围：`/Users/zeming/Documents/chat-ads-main`
- 目标：按 `docs/design/mediation/` 的 A-H 冻结合同落地可运行 Mediation 产品，并保证功能测试链路 100% 通过后再产出 SDK 接入文档。

## 1. 结论先行（执行策略）

1. 以 `docs/design/mediation/` 为唯一设计真相源，历史 `ad-aggregation-platform` 仅做“资产复用池”。
2. 先建测试骨架与验收门禁，再按 A->B->C->D->E->F->G 主链 + H 横切落地。
3. 对历史代码进行三类拆分：
   - Mediation 可复用核心（保留并重构）
   - 非 Mediation 临时替代层（迁出主链，降级为可插拔上游）
   - 本地模拟/运营工具层（保留为 dev tooling，不进生产主链）
4. SDK 文档、集成说明、运营文档全部后置到“功能测试 100% 通过”之后。

## 2. 全局复杂度评估

### 2.1 文档复杂度（A-H）

从 `docs/design/mediation/modules/*.md` 统计：

1. Module H：972 行，53 个小节，版本治理与失效矩阵最复杂（最高风险）。
2. Module E：875 行，40 个小节，交付对象 + 门禁矩阵 + fail-open/fail-closed（高风险）。
3. Module B：804 行，45 个小节，映射/裁决/脱敏/分桶/OpenRTB（高风险）。
4. Module D：750 行，33 个小节，路由策略 + adapter 合同 + 审计快照（高风险）。
5. Module F：632 行，30 个小节，事件幂等/闭环/归因/计费（高风险）。
6. Module A/C/G：中高复杂度，主要风险在合同稳定性、短路语义、回放确定性。

### 2.2 工程复杂度来源

1. 多合同联动：输入/输出合同、原因码、状态机、版本锚点、审计键必须同步演进。
2. 主链与侧链耦合：`Request->Delivery` 与 `Event->Archive` 通过 `responseReference` 严格对齐。
3. 确定性要求高：幂等、重试、短路、回放均要求“同请求同版本可复现”。
4. 配置治理横切：H 模块影响 A-H 全部行为（尤其失效矩阵与门禁动作）。
5. 当前历史代码是“可跑 demo + 临时供给替代”，与完整 Mediation 合同存在系统性差距。

## 3. 历史版本审计：哪些不是 Mediation 层

分析对象：`/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform`

### 3.1 明确属于“非 Mediation 临时替代层”

1. `src/providers/ner/*`
   - 角色：LLM NER 召回实体。
   - 结论：属于上游 signal provider，不是 Mediation 核心合同内必需能力。
2. `src/providers/intent/*`
   - 角色：Next-Step 意图推理。
   - 结论：属于业务侧推断层，不是 A-H Mediation 核心模块。
3. `src/providers/intent-card/*`
   - 角色：向量检索与意图卡召回。
   - 结论：属于临时“供给不足补位”机制，不是标准 Mediation 主链。
4. `schemas/web-search-*.json`、`schemas/follow-up-*.json`
   - 角色：特定业务链路事件/配置协议。
   - 结论：业务链路协议，不是 Mediation 通用合同。

### 3.2 属于“本地模拟/运营工具层（非生产 Mediation 主链）”

1. `src/devtools/simulator/simulator-gateway.js`
   - 包含 dashboard 配置管理、统计聚合、日志查询、本地状态持久化等。
   - 结论：可作为开发联调壳保留，但要拆出生产 Mediation API 主服务。
2. `docs/local-simulator-gateway.md` 与 dashboard 相关 API。
   - 结论：dev tooling 文档，保留但与产品化 SDK/API 文档分离。

### 3.3 可复用的 Mediation 重合资产

1. `src/connectors/cj/*`、`src/connectors/partnerstack/*`
   - 复用目标：Module D adapter 实现基础（重构为 D 合同接口）。
2. `src/offers/unified-offer.js`、`src/offers/network-mappers.js`
   - 复用目标：Module B/D 的 canonical 映射和候选归一基础。
3. `src/runtime/network-health-state.js`
   - 复用目标：D 模块降级/熔断控制基础。
4. `src/cache/*`
   - 复用目标：查询缓存与快照缓存机制（需纳入 H 配置和审计体系）。
5. `scripts/e2e-next-step-scenarios.js`、`scripts/smoke-ads-runtime.js`
   - 复用目标：迁移为回归测试样例与工具脚本，不作为最终测试体系。

### 3.4 处理原则（必须执行）

1. 所有“临时替代层”迁到 `providers/` 或 `experimental/`，不参与核心 Mediation 责任边界。
2. 所有“可复用资产”必须先对齐 A-H 合同，再允许进入主链。
3. 任何与新设计冲突的历史逻辑，以新设计为准直接替换，不做兼容保留债务。

## 4. 目标架构与代码拆分建议

建议将现有 `ad-aggregation-platform` 重组为：

1. `packages/mediation-core`
   - 领域模型、状态机、原因码、版本锚点、幂等键、审计键。
2. `services/mediation-api`
   - A/E/F/G/H 对外 API（SDK ingress、events、config、replay）。
3. `services/mediation-runtime`
   - B/C/D/E/F 主处理流水线实现。
4. `packages/adapters`
   - D 模块 supply adapter（cj/partnerstack/mock 等）。
5. `packages/providers-external`（可选）
   - 非 Mediation 核心：NER/intent/intent-card 等临时上游能力。
6. `apps/simulator-gateway`（dev only）
   - 仅本地联调和 dashboard 演示。

## 5. 分阶段实施计划（可拆分子任务）

## Phase -1 - 生产基础设施与平台基线（上线阻断）

1. T-1-1：基础服务落地
   - PostgreSQL（主从或托管 HA）
   - Redis（高可用部署）
   - MQ（Kafka/NATS/Redis Streams 至少一种）
2. T-1-2：数据与消息模型初始化
   - 配置、归档、审计、幂等、回放最小表结构
   - Topic/Consumer Group/Retry/DLQ 设计与落地
3. T-1-3：安全基线
   - API 鉴权、服务间鉴权、密钥托管、TLS、审计日志
4. T-1-4：可观测与 SLO 基线
   - 指标、日志、追踪、告警与 oncall
5. T-1-5：发布与回滚基线
   - 环境分层（dev/staging/preprod/prod）
   - 灰度、回滚、故障演练

交付：
1. 基础服务可用性证明（连通性 + HA 说明）
2. migration 与 topic 初始化脚本
3. 安全与发布门禁清单

## Phase 0 - 基线冻结与任务初始化（P0）

1. T0-1：冻结版本与接口边界
   - 锁定 `docs/design/mediation/` 当前版本为开发基线。
   - 产出 `contract catalog`（A-H 输入/输出/事件/原因码/锚点索引表）。
2. T0-2：完成历史代码分类清单
   - 标注每个目录归属：核心/临时/工具。
   - 形成迁移映射（旧模块 -> 新模块任务）。
3. T0-3：建立统一任务看板
   - 按 A-H + TEST + SDK_DOC 拆 Epic 与 Story。
   - 定义每个 Story 的 DoD 与依赖。

交付：
1. `contract-catalog.md`
2. `legacy-to-mediation-mapping.md`
3. `task-board-seed.csv`（或项目管理工具导入文件）

## Phase 1 - 测试先行骨架（必须先于核心实现）

1. T1-1：搭建测试框架
   - 单元：Vitest/Jest
   - 合同：JSON Schema + Contract runner
   - 集成：HTTP + adapter mock + queue mock
   - E2E：全链路黑盒测试（Request->Delivery->Event->Archive->Replay）
2. T1-2：建立“P0 功能矩阵”
   - 每个模块最少覆盖：合同校验、错误码、状态迁移、幂等/重试、审计快照。
3. T1-3：建立 CI 强制门禁
   - `test:functional:p0` 必须 100% 通过才允许 merge。
   - 任一测试失败立即 fail。

交付：
1. `tests/contracts/*`
2. `tests/integration/*`
3. `tests/e2e/*`
4. CI pipeline（含失败阻断）

## Phase 2 - H 横切先落地（配置与版本治理）

1. T2-1：实现 `Config Resolution Contract`
   - global/app/placement 合并顺序、覆盖规则、缺失非法处置。
2. T2-2：实现 `GET /config` 缓存语义
   - ETag/If-None-Match、TTL、304、过期重验证。
3. T2-3：实现 `POST /config/publish`
   - draft->validated->published->rollback 状态机、幂等键、补偿。
4. T2-4：实现版本门禁与锚点注入
   - sdk/adapter/schema 兼容校验、allow/degrade/reject。
5. T2-5：实现灰度与失效矩阵
   - rollout 规则、熔断回退、A-H fail-open/fail-closed 动作输出。

依赖：Phase 1 测试骨架已完成。

## Phase 3 - A/B/C 主链前半段

1. T3-A1：A 模块入口合同
   - `trigger`、`createOpportunity`、`opportunity_created` 事件合同。
2. T3-A2：A 幂等与去重
   - `dedupWindowSec=120`、trace 初始化与继承规则。
3. T3-B1：B 输入合同 + canonical 字典
   - required 矩阵、raw->canonical 映射、unknown 回退。
4. T3-B2：B 裁决/审计/投影
   - 冲突裁决引擎、`mappingAuditSnapshotLite`、OpenRTB 投影合同。
5. T3-B3：B 脱敏与分桶
   - redaction、bucket、`signal_normalized` 事件 + ACK/重发。
6. T3-C1：C 策略评估与短路机制
   - 固定执行顺序、短路、冲突优先级。
7. T3-C2：C 输出与审计
   - `constraintsLite`、policy 原因码、审计快照。

## Phase 4 - D/E 主链后半段

1. T4-D1：D Adapter 标准接口与注册中心
   - request adapt / candidate normalize / error normalize。
2. T4-D2：D 路由策略引擎
   - waterfall/bidding/hybrid，主次/fallback 触发与短路规则。
3. T4-D3：D 审计快照
   - `routeAuditSnapshotLite`，路由可复现性。
4. T4-E1：E compose 输入与 render_plan 输出
   - Delivery/Event 分离、版本锚点对齐。
5. T4-E2：E 门禁与降级矩阵
   - render capability gate、error code、fail-open/fail-closed。
6. T4-E3：E 输出合同
   - App Delivery 对象与 E->F 事件合同，状态迁移一致性。

## Phase 5 - F/G 闭环与回放

1. T5-F1：`POST /events` 批量合同
   - 逐条 ACK、partial success 语义。
2. T5-F2：F 幂等去重与终态闭环
   - 幂等键优先级、去重状态机、120s 超时补写。
3. T5-F3：归因计费输出
   - facts 映射、单尝试唯一计费、冲突裁决。
4. T5-G1：append/replay API
   - append 幂等与异步 ACK；replay summary/full。
5. T5-G2：回放确定性
   - 快照重放/规则重算、版本钉住、diff 原因码。

## Phase 6 - SDK 接入与发布准备（仅在测试 100% 后）

1. T6-1：SDK 最小接入路径
   - config 拉取、evaluate 触发、events 上报。
2. T6-2：接入样例
   - JS/TS SDK demo + server-side demo + simulator 对接。
3. T6-3：SDK 文档包
   - Quickstart / Integration / API Reference / Runbook。
4. T6-4：发布与回滚演练
   - 灰度发布、故障注入、回滚演练脚本。

## 6. 功能测试计划（目标：通过率 100%）

## 6.1 通过标准（硬门禁）

1. P0 功能矩阵全部通过（通过率=100%）。
2. 全链路 E2E 场景全部通过（通过率=100%）。
3. 任一 critical case 失败即判定版本不可发布。
4. SDK 文档与外部接入物料在通过前不得开始发布。

## 6.2 模块级测试包

1. A 模块（入口与机会创建）
   - 合同必填/非法值/错误码映射
   - 去重窗口与 trace 规则
   - `opportunity_created` 幂等与 ACK/重发
2. B 模块（归一与映射）
   - canonical 映射、unknown 回退
   - 字段冲突裁决与 tie-break 确定性
   - OpenRTB 投影 mapped/partial/unmapped
   - 脱敏顺序、分桶边界、采样事件语义
3. C 模块（策略门禁）
   - 执行顺序、短路条件、冲突优先级
   - 输出 `constraintsLite` 与审计快照完整性
4. D 模块（供给编排）
   - adapter 能力声明与启停
   - 路由策略（waterfall/bidding/hybrid）
   - fallback 触发与短路优先级
   - route 审计快照可回放
5. E 模块（交付组合）
   - compose 输入校验、render_plan 输出
   - 门禁矩阵、降级矩阵、错误码一致性
   - E->F 事件映射与状态迁移
6. F 模块（事件归因）
   - `POST /events` 批量 ACK/partial success
   - 幂等优先级、去重状态机、终态互斥
   - 超时补写 + 单尝试唯一计费
7. G 模块（审计回放）
   - append 幂等冲突语义
   - replay 查询、分页、summary/full 输出
   - 回放确定性与 diff 原因码
8. H 模块（配置治理）
   - resolve 合并顺序与快照一致性
   - GET config 缓存语义
   - publish 状态机 + 幂等 + 回滚
   - 兼容门禁 + 灰度 + 失效矩阵

## 6.3 全链路 E2E 套件

1. Happy path：served + impression 终态归档 + replay 一致。
2. Policy block path：C 拦截到 E no_fill，事件与审计链完整。
3. Routing no_fill path：D 无候选，E 输出 no_fill，F 终态成功。
4. Runtime error degrade path：按 H 失效矩阵执行 fail-open/fail-closed。
5. Duplicate event path：F/G 幂等 no-op，计费不重复。
6. Timeout supplement path：120s 补写 failure 并闭环。
7. Version mismatch path：H degrade/reject 可审计可回放。
8. Replay determinism path：同请求同锚点回放 diff=0。

## 7. 资源与依赖清单（实际运行必需）

## 7.1 基础技术依赖

1. Node.js 20+
2. TypeScript 5.x
3. JSON Schema 验证器（Ajv）
4. HTTP 框架（Fastify/Express 任一，建议 Fastify）
5. 日志与追踪（OpenTelemetry + structured logging）

## 7.2 数据与中间件

1. PostgreSQL
   - 配置版本、发布历史、审计记录、归档索引
2. Redis
   - 幂等窗口、短时去重、缓存
3. 消息队列（Kafka/NATS/Redis Streams 三选一）
   - E->F、F->G 异步事件流与重试队列

## 7.3 外部资源

1. Ads Network adapter 凭据
   - `CJ_TOKEN`
   - `PARTNERSTACK_API_KEY`
2. 上游可选信号（若继续使用）
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL`
3. Mock 网络与故障注入资源
   - 用于 CI 和本地 deterministic 测试

## 7.4 工程流程依赖

1. CI/CD（强制测试门禁）
2. 配置发布权限模型（发布者/审批者）
3. 监控告警（错误率、超时率、闭环完整率、回放失败率）
4. 数据备份与回滚策略（尤其 G/H）

## 7.5 目前仍缺失但上线必需的能力（必须补齐）

1. 基础设施拓扑设计文档与容量估算（QPS、峰值事件量、存储增长率）。
2. DB migration 体系（版本化、回滚、兼容策略）。
3. MQ 重试/死信治理（重试预算、补偿策略、堆积告警）。
4. 租户级鉴权与权限模型（SDK key、发布权限、审计追责）。
5. Secrets 全生命周期管理（轮转、最小权限、泄露应急）。
6. 生产 SLO 与告警阈值（请求、事件、闭环、回放、发布）。
7. 运行手册与故障演练（DB/MQ/缓存/外部网络故障）。
8. 对账与争议处理链路（导出、比对、差异回放）。
9. 成本与容量治理（缓存策略、冷热分层、归档策略）。
10. 多环境发布流程（灰度、冻结窗口、回滚演练记录）。

设计锚点：
1. 统一以 `docs/design/mediation/operations/06-production-readiness-and-infra.md` 作为生产基线设计文档。

## 8. 推荐并行分工

1. Track-A（Contracts & H）
   - 合同注册、配置治理、版本锚点与灰度
2. Track-B（Runtime A-E）
   - 主链处理、adapter、delivery
3. Track-C（Event & Audit F-G + TEST）
   - 事件闭环、归档回放、全链路测试体系

并行原则：
1. H 与 TEST 先启动并持续前置。
2. A/B/C 与 D/E 可阶段并行，但每次合并必须跑全量 P0。
3. F/G 必须在 E 合同稳定后再进入收敛阶段。

## 9. 风险与缓解

1. 风险：历史逻辑与新合同冲突导致反复返工。
   - 缓解：合同优先，旧逻辑仅作为实现参考，不作为行为基准。
2. 风险：模块交界字段频繁变化。
   - 缓解：契约目录 + 变更审查模板 + 自动 contract test。
3. 风险：幂等/回放在高并发下不确定。
   - 缓解：幂等键唯一约束 + 写入顺序约束 + chaos 测试。
4. 风险：先写 SDK 文档导致后续失真。
   - 缓解：把文档产出硬绑定到测试门禁通过后。

## 10. 开发顺序（执行清单）

1. 先完成 Phase -1（基础设施与生产基线）。
2. 完成 Phase 0/1（冻结 + 测试骨架）。
3. 完成 H（Phase 2）并让 A-H 都可消费版本锚点。
4. 完成 A/B/C（Phase 3）并通过模块 P0 测试。
5. 完成 D/E（Phase 4）并打通同步主链。
6. 完成 F/G（Phase 5）并打通异步闭环与回放。
7. 跑通全量功能矩阵，达到 100% 通过。
8. 再进入 SDK 集成文档与发布演练（Phase 6）。

---

## 附录 A：历史代码迁移清单（第一批）

1. 迁移为 D adapter 基础：
   - `src/connectors/cj/*`
   - `src/connectors/partnerstack/*`
2. 迁移为 B/D normalization 基础：
   - `src/offers/unified-offer.js`
   - `src/offers/network-mappers.js`
3. 迁移为 D 健康与降级基础：
   - `src/runtime/network-health-state.js`
4. 保留为 dev tooling：
   - `src/devtools/simulator/simulator-gateway.js`（拆分 dashboard 接口与 mediation API）
5. 迁出主链为可选 provider：
   - `src/providers/ner/*`
   - `src/providers/intent/*`
   - `src/providers/intent-card/*`

## 附录 B：完成定义（Definition of Done）

1. 代码实现符合 A-H 冻结合同。
2. 模块测试 + 集成测试 + E2E 测试全部通过。
3. P0 功能矩阵通过率 100%。
4. 回放确定性测试通过。
5. 无未归档的高优先级缺陷（P0/P1）。
6. 才允许进入 SDK 文档与外部接入阶段。
