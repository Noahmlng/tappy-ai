# Mediation 原子任务包（Self-Contained Agent Tasks）

- 版本：v1.0
- 日期：2026-02-21
- 关联总计划：`/Users/zeming/Documents/chat-ads-main/docs/mediation-development-plan.md`
- 目标：把 Mediation 落地任务拆为可独立执行的原子任务，确保单次 agent context 可控且任务可闭环验收。

## 0. 使用规则（所有任务通用）

1. 每次只执行一个任务卡（单任务单 PR/单 commit）。
2. 必须先读该任务卡列出的“必读 context”，不额外扩散阅读。
3. 只改该任务卡允许的文件范围。
4. 任务结束必须满足：
   - 代码/文档变更完成
   - 对应测试命令通过
   - 输出物完整
5. 若依赖任务未完成，当前任务不可开始。
6. 若测试失败，不进入后续任务。

---

## 0.4 当前执行状态（2026-02-21）

1. Batch-0（INFRA-001~INFRA-010）状态：`已完成`。
2. 前置外部依赖连通状态：
   - `npm --prefix ./projects/ad-aggregation-platform run check:managed-services` 通过。
   - Doppler/Grafana/Synadia 均已通过授权与连通校验。
3. 基础质量门禁状态：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration` 通过（13/13）。
4. 数据库基线状态：
   - Supabase 项目 `bkqjenmznafkqqwvwrad` 已完成 `0001_mediation_core_baseline.sql` 执行并记录 `schema_migrations`。
5. 允许进入正式开发：
   - 下一批次从 Batch-A 的 `FND-001` 开始按序执行。

---

## 0.5 Infrastructure（INFRA）

### INFRA-001：产出生产拓扑与容量基线文档

1. 目标：
   - 冻结 MVP 生产拓扑与容量估算口径。
2. 前置依赖：
   - 无
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/operations/06-production-readiness-and-infra.md`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/implementation/infra-topology-and-capacity.md`
5. 执行步骤：
   - 定义服务拓扑、数据流、峰值 QPS、事件 TPS、存储增长模型。
6. 验收标准：
   - 明确给出单日容量与扩容阈值。
7. 验证命令：
   - `rg -n "QPS|TPS|容量|扩容|拓扑" docs/implementation/infra-topology-and-capacity.md`
8. 输出物：
   - infra topology & capacity doc

### INFRA-002：落地本地/集成环境基础服务编排

1. 目标：
   - 提供可重复启动的 PostgreSQL/Redis/MQ 环境。
2. 前置依赖：
   - INFRA-001
3. 必读 context：
   - 根目录现有运行脚本与 workspace 结构
4. 允许改动：
   - 新增 `infra/docker-compose.mediation.yml`
   - 新增 `scripts/dev-mediation-infra.sh`（或等价脚本）
5. 执行步骤：
   - 启动并校验三类服务连通性。
6. 验收标准：
   - 一条命令可启动基础依赖并健康检查通过。
7. 验证命令：
   - `docker compose -f infra/docker-compose.mediation.yml up -d`
   - `docker compose -f infra/docker-compose.mediation.yml ps`
8. 输出物：
   - infra compose baseline

### INFRA-003：建立数据库 migration 基线

1. 目标：
   - 落地最小核心表 migration（配置/事件/归档/审计/幂等）。
2. 前置依赖：
   - INFRA-002
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/operations/06-production-readiness-and-infra.md`
4. 允许改动：
   - 新增 `projects/ad-aggregation-platform/migrations/*`
   - 新增 migration runner 脚本
5. 执行步骤：
   - 创建核心表与索引。
   - 提供 up/down 与版本记录。
6. 验收标准：
   - 新库可一键迁移到最新版本。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run db:migrate`
8. 输出物：
   - migration baseline

### INFRA-004：定义 Redis 键空间与 TTL 策略

1. 目标：
   - 固化幂等、去重、缓存、熔断键模型。
2. 前置依赖：
   - INFRA-002
3. 必读 context：
   - A/B/F/G/H 幂等与缓存合同小节
4. 允许改动：
   - 新增 `docs/implementation/redis-keyspace-policy.md`
   - 新增 `src/infra/redis-keyspace.*`（常量与 helper）
5. 执行步骤：
   - 统一 key 命名、TTL、淘汰策略、冲突策略。
6. 验收标准：
   - 不同模块不会产生键冲突。
7. 验证命令：
   - `rg -n "idempotency|dedup|cache|circuit" docs/implementation/redis-keyspace-policy.md`
8. 输出物：
   - redis keyspace policy

### INFRA-005：定义 MQ topic 与重试/死信策略

1. 目标：
   - 固化 E->F、F->G、发布补偿链路 topic 与消费语义。
2. 前置依赖：
   - INFRA-002
3. 必读 context：
   - F/G/H 异步语义与 ACK/重试合同小节
4. 允许改动：
   - 新增 `docs/implementation/mq-topology-and-retry-policy.md`
   - 新增 `src/infra/mq-topics.*`
5. 执行步骤：
   - 定义 topic、consumer group、retry backoff、DLQ。
6. 验收标准：
   - 任一消息链路均可追踪重试与最终落点。
7. 验证命令：
   - `rg -n "DLQ|retry|backoff|consumer group|topic" docs/implementation/mq-topology-and-retry-policy.md`
8. 输出物：
   - MQ policy baseline

### INFRA-006：建立 Secrets 与鉴权基线

1. 目标：
   - 落地最小安全基线（密钥托管 + 接口鉴权 + 服务间鉴权）。
2. 前置依赖：
   - INFRA-001
3. 必读 context：
   - module-h 发布鉴权相关小节
   - operations/06 安全章节
4. 允许改动：
   - 新增 `docs/implementation/security-baseline.md`
   - 新增 `src/infra/auth/*`（如已有目录按现状调整）
5. 执行步骤：
   - 定义 token 生命周期、密钥轮转、最小权限模型。
6. 验收标准：
   - 未授权请求可稳定拒绝并审计。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- auth`
8. 输出物：
   - security baseline

### INFRA-007：建立可观测与告警基线

1. 目标：
   - 定义并落地 SLI/SLO/告警。
2. 前置依赖：
   - INFRA-001
3. 必读 context：
   - operations/06 的 SLO 章节
4. 允许改动：
   - 新增 `docs/implementation/observability-slo.md`
   - 新增 `src/infra/observability/*`
5. 执行步骤：
   - 接入结构化日志、metrics、trace。
   - 定义告警分级与阈值。
6. 验收标准：
   - 核心链路指标可被查询且有告警策略。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- observability`
8. 输出物：
   - observability baseline

### INFRA-008：建立发布流水线与回滚基线

1. 目标：
   - 落地 dev/staging/preprod/prod 流水线与回滚策略。
2. 前置依赖：
   - INFRA-003
   - INFRA-007
3. 必读 context：
   - operations/06 发布章节
4. 允许改动：
   - CI/CD 配置文件
   - 新增 `docs/implementation/release-and-rollback-playbook.md`
5. 执行步骤：
   - 增加灰度门禁、冻结窗口、回滚流程。
6. 验收标准：
   - 有可执行回滚演练记录模板。
7. 验证命令：
   - CI dry-run / release checklist 演练
8. 输出物：
   - release/rollback baseline

### INFRA-009：建立对账与争议回放基线

1. 目标：
   - 补齐财务对账与争议处理流程。
2. 前置依赖：
   - INFRA-003
   - G-002
3. 必读 context：
   - F/G 合同 + operations/06 对账章节
4. 允许改动：
   - 新增 `docs/implementation/reconciliation-and-dispute.md`
   - 新增对账导出脚本（如 `scripts/reconcile-*`）
5. 执行步骤：
   - 定义日级对账、差异检测、差异重跑流程。
6. 验收标准：
   - 差异可定位到 `recordKey` 与版本锚点。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- reconcile`
8. 输出物：
   - reconciliation baseline

### INFRA-010：产出上线 Go/No-Go 清单

1. 目标：
   - 给出上线审批的一页式阻断清单。
2. 前置依赖：
   - INFRA-001~INFRA-009
3. 必读 context：
   - operations/06 的 `6.11`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/implementation/go-no-go-checklist.md`
5. 执行步骤：
   - 把服务、测试、安全、运维、业务就绪项转为可勾选清单。
6. 验收标准：
   - 任一阻断项失败即 No-Go。
7. 验证命令：
   - `rg -n "Go|No-Go|阻断|必须全部满足" docs/implementation/go-no-go-checklist.md`
8. 输出物：
   - go/no-go checklist

---

## 1. Foundation（FND）

### FND-001：建立 Mediation 合同目录索引

1. 目标：
   - 产出 A-H 合同索引（输入/输出/事件/原因码/锚点）。
2. 前置依赖：
   - 无
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/INDEX.md`
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/implementation/contract-catalog.md`
5. 执行步骤：
   - 为 A-H 每个模块建立小节。
   - 每模块至少列出：核心接口、输入合同、输出合同、关键事件、原因码段、版本锚点字段。
6. 验收标准：
   - A-H 全覆盖，无空节。
   - 可被后续任务直接引用。
7. 验证命令：
   - `rg -n "Module A|Module H|输入合同|输出合同|原因码|版本锚点" docs/implementation/contract-catalog.md`
8. 输出物：
   - `contract-catalog.md`

### FND-002：建立历史代码迁移映射清单

1. 目标：
   - 把历史实现映射到 Mediation/非 Mediation/Tooling 三类。
2. 前置依赖：
   - FND-001
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/src/`
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-development-plan.md`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/implementation/legacy-to-mediation-mapping.md`
5. 执行步骤：
   - 按目录级别列出归属分类。
   - 标注“可复用资产 -> 对应模块（B/D/H等）”。
   - 标注“迁出主链”的目录。
6. 验收标准：
   - 至少覆盖 `src/connectors`、`src/offers`、`src/runtime`、`src/server`、`src/intent*`、`src/ner`。
7. 验证命令：
   - `rg -n "可复用|迁出主链|tooling|Module D|Module B" docs/implementation/legacy-to-mediation-mapping.md`
8. 输出物：
   - `legacy-to-mediation-mapping.md`

### FND-003：创建任务追踪基线（CSV）

1. 目标：
   - 生成可导入看板的任务基线。
2. 前置依赖：
   - FND-001
   - FND-002
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-atomic-task-pack.md`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/implementation/task-board-seed.csv`
5. 执行步骤：
   - 列：`task_id,module,owner,status,depends_on,dod,test_command,artifact_path`
   - 把本文件任务卡同步入表。
6. 验收标准：
   - 每个任务一行，依赖关系可追踪。
7. 验证命令：
   - `head -n 5 docs/implementation/task-board-seed.csv`
   - `wc -l docs/implementation/task-board-seed.csv`
8. 输出物：
   - `task-board-seed.csv`

### FND-004：搭建测试目录骨架与命令入口

1. 目标：
   - 创建统一测试目录与 npm script。
2. 前置依赖：
   - FND-001
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/package.json`
   - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/package.json`
4. 允许改动：
   - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/package.json`
   - 新增 `tests/contracts/`, `tests/integration/`, `tests/e2e/`（在 ad-aggregation-platform 内）
5. 执行步骤：
   - 增加脚本：`test:contracts`, `test:integration`, `test:e2e`, `test:functional:p0`。
   - 每个目录放置占位测试，先可执行通过。
6. 验收标准：
   - `npm --prefix ./projects/ad-aggregation-platform run test:functional:p0` 可运行。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:functional:p0`
8. 输出物：
   - 测试命令基线

### FND-005：建立合同测试 runner（schema + snapshot）

1. 目标：
   - 提供可复用合同测试工具层。
2. 前置依赖：
   - FND-004
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/schemas/`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/tests/utils/contract-runner.*`
   - 新增 `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/tests/contracts/base-contract.spec.*`
5. 执行步骤：
   - 支持 JSON schema 校验、required 字段断言、错误码断言。
6. 验收标准：
   - 基础合同测试可复用到 A-H。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:contracts`
8. 输出物：
   - contract-runner

### FND-006：建立 E2E 基线（最小链路）

1. 目标：
   - 先打通最小黑盒链路测试框架。
2. 前置依赖：
   - FND-004
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/operations/01-closed-loop-model.md`
   - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/scripts/e2e-next-step-scenarios.js`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/tests/e2e/minimal-closed-loop.spec.*`
5. 执行步骤：
   - 构建 `request -> delivery -> event -> archive` 最小场景。
6. 验收标准：
   - E2E 套件可运行并有明确 fail 条件。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:e2e`
8. 输出物：
   - minimal e2e baseline

---

## 2. Module H（配置与版本治理）优先任务

### H-001：实现配置解析合同（global/app/placement）

1. 目标：
   - 落地 `3.10.3~3.10.8`。
2. 前置依赖：
   - FND-005
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/module-h-config-version-governance.md`
   - 小节：`3.10.3` 到 `3.10.8`
4. 允许改动：
   - 新增 `src/mediation/h/config-resolution.*`
   - 新增对应单测
5. 执行步骤：
   - 实现合并顺序与字段覆盖规则。
   - 输出 `resolvedConfigSnapshot`。
6. 验收标准：
   - 缺失/非法值有稳定动作与原因码。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- h-config-resolution`
8. 输出物：
   - 配置解析模块

### H-002：实现 GET /config（缓存语义）

1. 目标：
   - 落地 `3.10.9~3.10.14`。
2. 前置依赖：
   - H-001
3. 必读 context：
   - module-h 小节：`3.10.9` 到 `3.10.14`
4. 允许改动：
   - `src/mediation/api/config-controller.*`
   - `src/mediation/h/config-cache.*`
   - 对应 integration tests
5. 执行步骤：
   - 支持 `ETag/If-None-Match`。
   - TTL/304/过期重验证行为完整。
6. 验收标准：
   - 304 命中和过期失败路径均可测试。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- h-get-config`
8. 输出物：
   - GET /config API

### H-003：实现 POST /config/publish 状态机与幂等

1. 目标：
   - 落地 `3.10.15~3.10.20`。
2. 前置依赖：
   - H-001
3. 必读 context：
   - module-h 小节：`3.10.15` 到 `3.10.20`
4. 允许改动：
   - `src/mediation/h/config-publish.*`
   - `src/mediation/api/config-publish-controller.*`
   - 对应 tests
5. 执行步骤：
   - 实现 draft/validated/published/rollback。
   - 加入 publish 幂等键窗口。
6. 验收标准：
   - duplicate 与 payload conflict 可区分。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- h-publish`
8. 输出物：
   - publish API + 状态机

### H-004：实现版本门禁与锚点注入

1. 目标：
   - 落地 `3.10.21~3.10.34`。
2. 前置依赖：
   - H-002
   - H-003
3. 必读 context：
   - module-h 小节：`3.10.21` 到 `3.10.34`
4. 允许改动：
   - `src/mediation/h/version-gate.*`
   - `src/mediation/h/anchor-injector.*`
   - tests
5. 执行步骤：
   - 实现 `allow/degrade/reject`。
   - 维护 A-H 冻结点注入规则。
6. 验收标准：
   - 同请求同版本下门禁动作确定性一致。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- h-version-gate`
8. 输出物：
   - version gate + anchor injector

### H-005：实现灰度与失效矩阵

1. 目标：
   - 落地 `3.10.35~3.10.53`。
2. 前置依赖：
   - H-004
3. 必读 context：
   - module-h 小节：`3.10.35` 到 `3.10.53`
4. 允许改动：
   - `src/mediation/h/rollout.*`
   - `src/mediation/h/failure-matrix.*`
   - tests
5. 执行步骤：
   - 实现百分比分流/熔断回退。
   - 实现 A-H fail-open/fail-closed 统一动作输出。
6. 验收标准：
   - `force_fallback` 语义、原因码、审计快照齐全。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- h-rollout`
8. 输出物：
   - 灰度与失效治理模块

---

## 3. Module A 原子任务

### A-001：实现 trigger 输入/返回合同

1. 目标：
   - 落地 `3.3.10~3.3.13`。
2. 前置依赖：
   - H-004
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/module-a-sdk-ingress-opportunity-sensing.md`
   - 小节：`3.3.10` 到 `3.3.13`
4. 允许改动：
   - `src/mediation/a/trigger-handler.*`
   - tests
5. 执行步骤：
   - 校验 required/optional。
   - 映射 trigger 错误码与动作。
6. 验收标准：
   - 合同校验失败返回稳定 reason code。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:contracts -- a-trigger`
8. 输出物：
   - trigger handler

### A-002：实现 createOpportunity + trace 规则

1. 目标：
   - 落地 `3.3.14~3.3.17`、`3.3.29`。
2. 前置依赖：
   - A-001
3. 必读 context：
   - module-a 小节：`3.3.14` 到 `3.3.17`，`3.3.29`
4. 允许改动：
   - `src/mediation/a/create-opportunity.*`
   - tests
5. 执行步骤：
   - 生成 `requestKey/opportunityKey/attemptKey/traceKey`。
   - 输出 A->B 最小合同对象。
6. 验收标准：
   - trace 初始化与继承一致。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- a-create-opportunity`
8. 输出物：
   - createOpportunity service

### A-003：实现 opportunity_created 事件与幂等重发

1. 目标：
   - 落地 `3.3.18~3.3.23`、`3.3.28`。
2. 前置依赖：
   - A-002
3. 必读 context：
   - module-a 小节：`3.3.18` 到 `3.3.23`，`3.3.28`
4. 允许改动：
   - `src/mediation/a/opportunity-event-emitter.*`
   - tests
5. 执行步骤：
   - eventKey + idempotencyKey 规则。
   - ACK/重发窗口与退避策略。
6. 验收标准：
   - duplicate 不重复发送；重发复用同键。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- a-opportunity-event`
8. 输出物：
   - A event emitter

---

## 4. Module B 原子任务

### B-001：实现 B 输入合同与 canonical 映射

1. 目标：
   - 落地 `3.4.6~3.4.13`。
2. 前置依赖：
   - A-003
3. 必读 context：
   - module-b 小节：`3.4.6` 到 `3.4.13`
4. 允许改动：
   - `src/mediation/b/input-normalizer.*`
   - `src/mediation/b/canonical-dict.*`
   - tests
5. 执行步骤：
   - required 矩阵校验。
   - raw->canonical + unknown fallback。
6. 验收标准：
   - 字段缺失/非法有稳定动作与原因码。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:contracts -- b-input`
8. 输出物：
   - B input normalizer

### B-002：实现冲突裁决引擎与 mapping 审计

1. 目标：
   - 落地 `3.4.14~3.4.20`。
2. 前置依赖：
   - B-001
3. 必读 context：
   - module-b 小节：`3.4.14` 到 `3.4.20`
4. 允许改动：
   - `src/mediation/b/conflict-resolver.*`
   - `src/mediation/b/mapping-audit.*`
   - tests
5. 执行步骤：
   - 优先级裁决 + tie-break。
   - 输出 `mappingAuditSnapshotLite`。
6. 验收标准：
   - 同输入多次运行结果一致。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- b-conflict`
8. 输出物：
   - conflict resolver

### B-003：实现 OpenRTB 投影 + 脱敏 + 分桶

1. 目标：
   - 落地 `3.4.23~3.4.36`。
2. 前置依赖：
   - B-002
3. 必读 context：
   - module-b 小节：`3.4.23` 到 `3.4.36`
4. 允许改动：
   - `src/mediation/b/openrtb-projection.*`
   - `src/mediation/b/redaction.*`
   - `src/mediation/b/bucketizer.*`
   - tests
5. 执行步骤：
   - 实现 mapped/partial/unmapped。
   - 先脱敏后审计；实现 outlier/unknown 分桶策略。
6. 验收标准：
   - 三个快照：projection/redaction/bucket 均可输出。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- b-projection`
8. 输出物：
   - B advanced pipeline

### B-004：实现 signal_normalized 事件链路

1. 目标：
   - 落地 `3.4.40~3.4.45`。
2. 前置依赖：
   - B-003
3. 必读 context：
   - module-b 小节：`3.4.40` 到 `3.4.45`
4. 允许改动：
   - `src/mediation/b/signal-event-emitter.*`
   - tests
5. 执行步骤：
   - 稳定哈希采样。
   - ACK/重发/幂等规则。
6. 验收标准：
   - sampled_out 不发送；sampled_in 可追踪 ACK。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- b-signal-event`
8. 输出物：
   - B signal event emitter

---

## 5. Module C 原子任务

### C-001：实现策略执行顺序与短路机制

1. 目标：
   - 落地 `3.5.4~3.5.11`。
2. 前置依赖：
   - B-004
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/module-c-policy-safety-governor.md`
   - 小节：`3.5.4` 到 `3.5.11`
4. 允许改动：
   - `src/mediation/c/policy-engine.*`
   - tests
5. 执行步骤：
   - 固定 gate 顺序，命中 block 立即短路。
6. 验收标准：
   - `short_circuit_block/allow` 行为稳定。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- c-short-circuit`
8. 输出物：
   - policy engine core

### C-002：实现 C 输出合同、原因码与审计快照

1. 目标：
   - 落地 `3.5.12~3.5.20`。
2. 前置依赖：
   - C-001
3. 必读 context：
   - module-c 小节：`3.5.12` 到 `3.5.20`
4. 允许改动：
   - `src/mediation/c/output-builder.*`
   - `src/mediation/c/policy-audit.*`
   - tests
5. 执行步骤：
   - 输出 `constraintsLite`。
   - 固化 policy 原因码体系和审计快照结构。
6. 验收标准：
   - C->D/E 出口字段完整可消费。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:contracts -- c-output`
8. 输出物：
   - C output + audit module

---

## 6. Module D 原子任务

### D-001：重构 adapter 注册与能力声明

1. 目标：
   - 落地 `3.6.9~3.6.15`。
2. 前置依赖：
   - C-002
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/module-d-supply-orchestrator-adapter-layer.md`
   - 小节：`3.6.9` 到 `3.6.15`
   - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/src/connectors/`
4. 允许改动：
   - `src/mediation/d/adapter-registry.*`
   - `src/adapters/*`（对接 cj/partnerstack）
   - tests
5. 执行步骤：
   - 统一 adapter contract。
   - 将现有 connector 包装为 D adapter。
6. 验收标准：
   - adapter 启停与能力声明可测试。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- d-adapter-registry`
8. 输出物：
   - adapter registry

### D-002：实现路由执行计划与 fallback 策略

1. 目标：
   - 落地 `3.6.24~3.6.28`。
2. 前置依赖：
   - D-001
3. 必读 context：
   - module-d 小节：`3.6.24` 到 `3.6.28`
4. 允许改动：
   - `src/mediation/d/route-planner.*`
   - tests
5. 执行步骤：
   - 实现 waterfall/bidding/hybrid。
   - 实现主次/fallback 触发与短路优先级。
6. 验收标准：
   - `routePlan` 可确定性复现。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- d-route-plan`
8. 输出物：
   - route planner

### D-003：实现 D 输出合同与路由审计快照

1. 目标：
   - 落地 `3.6.29~3.6.33`。
2. 前置依赖：
   - D-002
3. 必读 context：
   - module-d 小节：`3.6.29` 到 `3.6.33`
4. 允许改动：
   - `src/mediation/d/output-builder.*`
   - `src/mediation/d/route-audit.*`
   - tests
5. 执行步骤：
   - 输出 D->E 合同对象。
   - 记录 `routeAuditSnapshotLite`。
6. 验收标准：
   - E 可以无推断消费 D 输出。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:contracts -- d-output`
8. 输出物：
   - D output + route audit

---

## 7. Module E 原子任务

### E-001：实现 compose 输入合同与 render_plan 输出

1. 目标：
   - 落地 `3.7.4~3.7.13`。
2. 前置依赖：
   - D-003
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/module-e-delivery-composer.md`
   - 小节：`3.7.4` 到 `3.7.13`
4. 允许改动：
   - `src/mediation/e/compose.*`
   - tests
5. 执行步骤：
   - 校验 compose 输入与版本锚点。
   - 输出 `render_plan`。
6. 验收标准：
   - 合同错误返回稳定 reason code。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:contracts -- e-compose`
8. 输出物：
   - compose module

### E-002：实现渲染门禁与降级矩阵

1. 目标：
   - 落地 `3.7.18~3.7.36`。
2. 前置依赖：
   - E-001
3. 必读 context：
   - module-e 小节：`3.7.18` 到 `3.7.36`
4. 允许改动：
   - `src/mediation/e/render-gate.*`
   - `src/mediation/e/error-degrade.*`
   - tests
5. 执行步骤：
   - 实现 capability gate。
   - 实现 fail-open/fail-closed 动作矩阵。
6. 验收标准：
   - no_fill/error 判定一致且可审计。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- e-gate`
8. 输出物：
   - render gate + degrade engine

### E-003：实现 E 输出合同与 E->F 事件输出

1. 目标：
   - 落地 `3.7.37~3.7.40`。
2. 前置依赖：
   - E-002
3. 必读 context：
   - module-e 小节：`3.7.37` 到 `3.7.40`
4. 允许改动：
   - `src/mediation/e/delivery-output.*`
   - `src/mediation/e/event-output.*`
   - tests
5. 执行步骤：
   - 输出最终 Delivery。
   - 输出 F 可消费事件并保持状态迁移一致。
6. 验收标准：
   - `routed -> served/no_fill/error` 一致。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- e-output`
8. 输出物：
   - final delivery/output module

---

## 8. Module F 原子任务

### F-001：实现 POST /events 输入与逐条 ACK

1. 目标：
   - 落地 `3.8.4~3.8.11`。
2. 前置依赖：
   - E-003
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/module-f-event-attribution-processor.md`
   - 小节：`3.8.4` 到 `3.8.11`
4. 允许改动：
   - `src/mediation/f/events-controller.*`
   - tests
5. 执行步骤：
   - envelope + single event 校验。
   - partial success 语义与逐条 ACK。
6. 验收标准：
   - 错误事件不影响合法事件 ACK 返回。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- f-events-api`
8. 输出物：
   - events API

### F-002：实现幂等去重与终态闭环

1. 目标：
   - 落地 `3.8.12~3.8.20`。
2. 前置依赖：
   - F-001
3. 必读 context：
   - module-f 小节：`3.8.12` 到 `3.8.20`
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/operations/01-closed-loop-model.md`
4. 允许改动：
   - `src/mediation/f/idempotency.*`
   - `src/mediation/f/terminal-closure.*`
   - tests
5. 执行步骤：
   - client key 与 computed key 优先级。
   - 120s 超时补写、impression/failure 互斥。
6. 验收标准：
   - 闭环状态可重放验证。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- f-closure`
8. 输出物：
   - dedup + closure engine

### F-003：实现归因计费与 F->G 输出合同

1. 目标：
   - 落地 `3.8.21~3.8.30`。
2. 前置依赖：
   - F-002
3. 必读 context：
   - module-f 小节：`3.8.21` 到 `3.8.30`
4. 允许改动：
   - `src/mediation/f/facts-mapper.*`
   - `src/mediation/f/archive-record-builder.*`
   - tests
5. 执行步骤：
   - 映射 `billableFacts/attributionFacts`。
   - 产出 `fToGArchiveRecordLite`。
6. 验收标准：
   - 单尝试唯一计费、recordKey 幂等语义成立。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- f-output`
8. 输出物：
   - F output contract module

---

## 9. Module G 原子任务

### G-001：实现 append(AuditRecord) 接口

1. 目标：
   - 落地 `3.9.7~3.9.13`。
2. 前置依赖：
   - F-003
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/modules/module-g-audit-replay-controller.md`
   - 小节：`3.9.7` 到 `3.9.13`
4. 允许改动：
   - `src/mediation/g/append-controller.*`
   - `src/mediation/g/audit-store.*`
   - tests
5. 执行步骤：
   - append 幂等键优先级。
   - 异步 ACK 语义（accepted/queued/rejected）。
6. 验收标准：
   - duplicate no-op 与 payload conflict 可区分。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:integration -- g-append`
8. 输出物：
   - append API

### G-002：实现 replay 接口与确定性回放

1. 目标：
   - 落地 `3.9.14~3.9.24`。
2. 前置依赖：
   - G-001
3. 必读 context：
   - module-g 小节：`3.9.14` 到 `3.9.24`
4. 允许改动：
   - `src/mediation/g/replay-controller.*`
   - `src/mediation/g/replay-engine.*`
   - tests
5. 执行步骤：
   - summary/full 模式、分页排序、空结果语义。
   - `snapshot_replay` 与 `rule_recompute` 确定性输出。
6. 验收标准：
   - 同锚点回放 diff 为 0。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:e2e -- g-replay-determinism`
8. 输出物：
   - replay API + engine

---

## 10. 全链路与质量门禁任务

### QA-001：构建模块级 P0 功能矩阵测试

1. 目标：
   - 建立 A-H 的 P0 测试矩阵。
2. 前置依赖：
   - H-005, A-003, B-004, C-002, D-003, E-003, F-003, G-002
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-development-plan.md` 第 6 章
4. 允许改动：
   - `tests/contracts/*`
   - `tests/integration/*`
5. 执行步骤：
   - 按模块覆盖合同/状态/错误码/幂等/审计。
6. 验收标准：
   - 所有矩阵 case 明确 PASS/FAIL。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:functional:p0`
8. 输出物：
   - `tests/p0-matrix-report.json`

### QA-002：构建全链路 E2E 套件（8 大场景）

1. 目标：
   - 落地 8 个闭环场景。
2. 前置依赖：
   - QA-001
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-development-plan.md` 第 6.3 节
4. 允许改动：
   - `tests/e2e/*`
5. 执行步骤：
   - 增加 happy/policy_block/no_fill/error/duplicate/timeout/version/replay 场景。
6. 验收标准：
   - 8 场景全部可复现执行。
7. 验证命令：
   - `npm --prefix ./projects/ad-aggregation-platform run test:e2e`
8. 输出物：
   - `tests/e2e-report.json`

### QA-003：CI 门禁落地（失败即阻断）

1. 目标：
   - 把功能测试绑定到 CI。
2. 前置依赖：
   - QA-001
   - QA-002
3. 必读 context：
   - 现有 CI 配置文件（若有）
4. 允许改动：
   - `.github/workflows/*` 或对应 CI 配置
5. 执行步骤：
   - 强制执行 `test:functional:p0` + `test:e2e`。
6. 验收标准：
   - 任一任务失败即 CI fail。
7. 验证命令：
   - 本地 dry-run 或 CI 试跑记录
8. 输出物：
   - CI gate pipeline

### QA-004：发布前 100% 通过率报告

1. 目标：
   - 生成可审计测试通过报告。
2. 前置依赖：
   - QA-003
3. 必读 context：
   - QA-001/QA-002 测试输出
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/implementation/test-readiness-report.md`
5. 执行步骤：
   - 汇总模块通过率、场景通过率、失败清零证明。
6. 验收标准：
   - 明确写出 `P0 matrix = 100%`、`E2E = 100%`。
7. 验证命令：
   - `rg -n "100%" docs/implementation/test-readiness-report.md`
8. 输出物：
   - test readiness report

---

## 11. SDK 文档后置任务（仅在 QA-004 后）

### SDK-001：产出最小接入 Quickstart

1. 目标：
   - 产出可运行最小接入文档。
2. 前置依赖：
   - QA-004
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-design/operations/02-sdk-integration-guide-and-minimal-checklist.md`
   - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/docs/sdk-integration-document-spec.md`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/integration/quickstart.md`
5. 执行步骤：
   - 包含 init/evaluate/events/验证步骤。
6. 验收标准：
   - 按文档可完成首条链路验证。
7. 验证命令：
   - 按文档执行 smoke 命令
8. 输出物：
   - quickstart 文档

### SDK-002：产出 API Reference（A/E/F/G/H 对外接口）

1. 目标：
   - 输出生产级接口参考文档。
2. 前置依赖：
   - SDK-001
3. 必读 context：
   - A/E/F/G/H 模块合同文档
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/integration/api-reference.md`
5. 执行步骤：
   - 每接口列：请求、响应、错误码、重试语义、幂等约束。
6. 验收标准：
   - 字段与实现一致，无占位描述。
7. 验证命令：
   - 抽样调用接口对照文档
8. 输出物：
   - API Reference

### SDK-003：产出 Runbook 与排障手册

1. 目标：
   - 覆盖接入方常见故障排查。
2. 前置依赖：
   - SDK-002
3. 必读 context：
   - `/Users/zeming/Documents/chat-ads-main/docs/mediation-development-plan.md`
   - `/Users/zeming/Documents/chat-ads-main/docs/integration/api-reference.md`
4. 允许改动：
   - 新增 `/Users/zeming/Documents/chat-ads-main/docs/integration/runbook.md`
5. 执行步骤：
   - 覆盖 no_fill、高 blocked、回放不一致、配置发布失败等问题。
6. 验收标准：
   - 每问题有“现象-原因-检查-修复-验证”闭环。
7. 验证命令：
   - `rg -n "现象|可能原因|检查步骤|修复动作|验证方式" docs/integration/runbook.md`
8. 输出物：
   - runbook 文档

---

## 12. 推荐执行批次（降低上下文负载）

1. Batch-0（基础设施）：
   - INFRA-001~INFRA-010
   - 状态：`已完成（2026-02-21）`
2. Batch-A（基础）：
   - FND-001~FND-006
   - 状态：`下一批次（待开始）`
3. Batch-B（横切 H）：
   - H-001~H-005
4. Batch-C（主链上半）：
   - A-001~A-003, B-001~B-004, C-001~C-002
5. Batch-D（主链下半）：
   - D-001~D-003, E-001~E-003
6. Batch-E（闭环）：
   - F-001~F-003, G-001~G-002
7. Batch-F（质量门禁）：
   - QA-001~QA-004
8. Batch-G（文档交付）：
   - SDK-001~SDK-003

只允许按批次前后顺序推进，不跳批次。
