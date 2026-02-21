# 历史代码迁移映射清单（FND-002）

- Version: v1.0
- Date: 2026-02-21
- 依赖任务: FND-001
- 设计依据:
  - `/Users/zeming/Documents/chat-ads-main/docs/mediation-development-plan.md`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/src/`

## 1. 分类口径

1. `Mediation`：可直接进入 A-H 主链，或经合同重构后进入主链。
2. `非 Mediation`：临时上游替代能力，不属于 A-H 核心责任边界。
3. `tooling`：开发联调/运营辅助能力，不进入生产主链。

## 2. 目录级迁移映射总表

| 目录 | 分类 | 当前角色 | 可复用资产 -> 对应模块 | 迁移动作 |
| --- | --- | --- | --- | --- |
| `src/connectors/cj/` | Mediation（重构后） | CJ 网络接入 connector | 可复用：adapter 请求构建、响应解析 -> `Module D` | 迁移到 `packages/mediation-adapters/cj`，按 D 合同改造 I/O 与原因码 |
| `src/connectors/partnerstack/` | Mediation（重构后） | PartnerStack 网络接入 connector | 可复用：adapter 请求构建、响应解析 -> `Module D` | 迁移到 `packages/mediation-adapters/partnerstack`，统一重试与审计快照 |
| `src/offers/` | Mediation（重构后） | offer 归一与网络映射 | 可复用：`unified-offer.js`、`network-mappers.js` -> `Module B` + `Module D` | 拆为 `normalization` 与 `candidate-normalization` 两层，挂接 B/D 合同测试 |
| `src/runtime/network-health-state.js` | Mediation（重构后） | 网络健康与降级状态管理 | 可复用：健康评分、熔断状态 -> `Module D` | 下沉到 D 路由策略域，纳入版本锚点与审计 |
| `src/runtime/ads-runtime.js`、`src/runtime/index.js` | Tooling/过渡实现 | 历史主流程编排（混合临时逻辑） | 有限复用：编排骨架 -> `Module D/E/F` 参考 | 不直接复用为生产主链；按 A-H 重新实现 orchestration |
| `src/devtools/simulator/simulator-gateway.js` | tooling | 本地 dashboard + 模拟网关 | 可复用：联调入口与模拟负载 -> 测试工具链 | 迁出生产主链，保留为 `devtools/simulator` |
| `src/providers/intent/` | 非 Mediation | 意图推断（LLM） | 可复用：可作为可选 provider 输入 -> `Module A` 外围 | 迁出主链，移至 `providers/intent` |
| `src/providers/intent-card/` | 非 Mediation | 向量召回与意图卡补位 | 可复用：可选召回 provider -> `Module A` 外围 | 迁出主链，移至 `providers/intent-card` |
| `src/providers/ner/` | 非 Mediation | 实体抽取（LLM NER） | 可复用：实体 signal provider -> `Module B` 前置输入源 | 迁出主链，移至 `providers/ner` |
| `src/cache/` | Mediation（重构后） | TTL 缓存与 runtime 缓存 | 可复用：查询缓存/快照缓存 -> `Module D` + `Module H` | 保留能力但统一配置键与审计标签 |
| `src/config/` | Mediation（重构后） | 运行时配置读取 | 可复用：配置装载/校验 -> `Module H` | 合并到 H 配置治理，替换历史 env 直读模式 |
| `src/infra/auth/` | Mediation | 服务间鉴权、令牌策略 | 可复用：鉴权中间件与策略基线 -> `Module H` | 作为 H 安全基线直接纳入，补全失效矩阵测试 |
| `src/infra/observability/` | Mediation | 指标、日志、trace 与告警定义 | 可复用：SLI/指标注册/结构化日志 -> `Module H`（横切 A-H） | 作为主链 observability SDK，接入全模块 |
| `src/infra/reconcile/` | Mediation | 对账引擎与回补逻辑 | 可复用：闭环对账与差异修复 -> `Module F` + `Module G` | 按 F/G 事件合同补齐幂等键与回放确定性 |
| `src/infra/redis-keyspace.js` | Mediation（重构后） | Redis keyspace 约束 | 可复用：键命名与 TTL 策略 -> `Module H` | 纳入 H 配置与发布门禁，补充回滚策略 |
| `src/infra/mq-topics.js` | Mediation（重构后） | MQ topic 命名 | 可复用：主题规范 -> `Module F` + `Module G` | 与 NATS subject 规范对齐，纳入事件合同版本管理 |

## 3. 可复用资产 -> 对应模块（重点）

1. `src/connectors/cj/*`、`src/connectors/partnerstack/*`
   - 可复用：网络 adapter I/O 骨架。
   - 对应模块：`Module D`。
2. `src/offers/unified-offer.js`、`src/offers/network-mappers.js`
   - 可复用：canonical 字段映射与归一规则。
   - 对应模块：`Module B`（信号归一）+ `Module D`（候选归一）。
3. `src/runtime/network-health-state.js`
   - 可复用：健康状态与降级控制逻辑。
   - 对应模块：`Module D`。
4. `src/cache/*`
   - 可复用：缓存机制。
   - 对应模块：`Module D`（查询/快照）+ `Module H`（配置和审计治理）。
5. `src/infra/auth/*`
   - 可复用：服务鉴权、token policy。
   - 对应模块：`Module H`。
6. `src/infra/reconcile/*`
   - 可复用：对账闭环引擎。
   - 对应模块：`Module F` + `Module G`。
7. `src/infra/observability/*`
   - 可复用：metrics/log/trace/alert 基线。
   - 对应模块：`Module H`（横切治理，作用于 A-H 全链路）。

## 4. 迁出主链清单

以下目录标记为“迁出主链”，仅作为可选 provider 或开发辅助，不纳入 Mediation 生产核心责任边界：

1. `src/providers/ner/`（迁出主链）
2. `src/providers/intent/`（迁出主链）
3. `src/providers/intent-card/`（迁出主链）
4. `src/devtools/simulator/simulator-gateway.js`（迁出生产主链，保留 tooling）

## 5. 实施约束（执行时必须遵守）

1. 与 A-H 合同冲突的历史逻辑一律替换，不做兼容债务。
2. “可复用”仅代表可参考/可迁移，不代表可原样拷贝进入主链。
3. 所有进入主链的复用代码必须补齐：原因码、版本锚点、幂等键、审计快照与对应测试。
