# Developer Dashboard Plan (v1 Minimal, External Developer First)

- Version: v1.1
- Last Updated: 2026-02-22
- Goal: 第一版聚焦“极简接入”，让外部开发者用最少步骤跑通生产链路；复杂逻辑尽量由平台内部承担。

## 0. Alignment Summary (this revision)

1. Dashboard 走极简风格（参考 Exa：少页面、少配置、关键信息优先）。
2. Agent-first 接入不在指令中暴露长期 API Key。
3. 自动提交 PR 默认关闭。
4. `managed_mediation` 作为默认路由，但不要求开发者理解或配置供应商细节。
5. `sandbox/staging/prod` 凭证强制分离。
6. Reset 功能仅供内部 mediation 调试，不对外部开发者展示。
7. ZeroClick / TryGravity 兼容是“迁移加速能力”，不是 v1 外部接入硬门槛。

## 1. Product Principles (v1)

1. External developer first: 先让外部用户 15 分钟跑通，不追求后台完备度。
2. Platform owns complexity: 策略、路由、供应商差异由我们处理。
3. One happy path: 默认只给一条最短路径，不让用户在 v1 里做大量选择。
4. Production network only: 外部链路只走公网正式 API。
5. Fail-open by default: 广告失败不阻塞主流程。

## 2. v1 Scope (Must / Should / Later)

## 2.1 Must (v1 必做)

1. 外部开发者账号开通 + 创建 App。
2. API Key 管理（创建、显示一次、轮换、吊销）。
3. 最小 placement 配置（先支持标准模板，不开放复杂策略参数）。
4. Quick Start 页面：`config -> evaluate -> events` 一键验证。
5. 简化观测：最近请求、错误率、基础 usage/billing 概览。
6. Agent 指令生成（Codex/CloudCode/Cursor）。

## 2.2 Should (v1.5)

1. 更细粒度角色权限。
2. 更完整计费与对账详情页。
3. 自定义 placement 高阶参数。

## 2.3 Later (v2+)

1. 大规模 A/B 配置和实验编排。
2. 完整多供应商可视化调度。
3. 高级告警与自动优化。

## 3. Minimal Dashboard IA (Exa-style)

v1 仅保留 5 个页面：

1. `Home`
   - 当前环境状态、接入是否完成、最近 24h 核心指标。
2. `Quick Start`
   - 两步接入：拿 Key -> 跑首条请求。
   - 提供 JS/Python/cURL 最小示例。
3. `API Keys`
   - 创建、复制、轮换、吊销。
4. `Integrations`
   - 最小 placement 模板与环境开关。
5. `Usage`
   - 请求量、成功率、基础计费摘要。

不在 v1 对外暴露：

1. Reset/Snapshot。
2. 复杂 provider 路由配置。
3. 大量策略参数编辑页。

## 4. External Integration Flow (v1 Happy Path)

1. 注册账号并创建 App。
2. 复制 `API_BASE_URL` + `API_KEY` + 默认 `PLACEMENT_ID`。
3. 运行 Quick Start 示例（或复制 Agent 指令）。
4. 收到首个 `requestId`，并在 Usage 页面看到请求记录。
5. 上线前只做最小检查：成功率、延迟、events ack。

## 5. Agent-first Integration Without Exposed Long-lived Key

## 5.1 Core Rule

Agent 指令中不放长期 API Key，不要求用户把长期 key 贴进 prompt。

## 5.2 Two Onboarding Modes

1. Manual mode（简单直连）：
   - 开发者在自己环境变量中配置 `API_KEY`。
   - 适合传统 API 接入。
2. Connected-agent mode（推荐）：
   - Dashboard 生成短期一次性 `integration token`（例如 10-15 分钟有效）。
   - Agent 用短期 token 拉取最小配置并完成改造。
   - 长期 key 由平台安全交换，不出现在 prompt 文本里。

## 5.3 Agent Output Contract (v1)

1. 输出变更文件清单。
2. 输出可执行 smoke test 命令。
3. 输出验证证据（requestId / status）。
4. 不自动提交 PR（默认）。

## 6. Why Default `managed_mediation` (and why users do not need provider keys)

`managed_mediation` 设为默认的原因：

1. 开发者只接一个统一 API，不需要理解 ZeroClick/TryGravity 字段差异。
2. 我们可在服务端统一做 failover、限流、重试和策略控制。
3. 后续迁移外部客户时，可在不改客户代码的前提下切换底层 provider。
4. 可避免让开发者额外输入 provider 级 API Key。

实现约束：

1. 外部开发者只持有“我们平台”的 API Key。
2. provider 侧凭证由我们内部管理，不进入外部 Dashboard v1。

## 7. Environment and Key Policy

1. 强制分离 `sandbox/staging/prod` keys（确认采用）。
2. key 权限最小化：按 app + env 绑定。
3. 默认开启 key 轮换入口。
4. 任何密钥展示只显示一次明文。

## 8. Reset Strategy (Internal Only)

定位修正：

1. Reset 是 mediation 联调能力，不是外部开发者能力。
2. Reset 入口仅内部可见（feature flag + internal role）。
3. 生产外部门户不显示 Reset UI。

内部 Reset 能力（供研发调试）：

1. Soft reset：清理测试配置，保留账号组织。
2. Snapshot restore：回到某次联调前状态。
3. Validation run：每次重配生成新的 run id，避免数据串扰。

## 9. ZeroClick / TryGravity Strategy (Priority Adjustment)

定位修正：

1. 不是“竞品对抗模块”，是“客户迁移加速模块”。
2. 不是 v1 外部接入 Must，作为 P2 能力推进。

v1 仅保留：

1. 兼容性映射文档（字段对照、差异点）。
2. 迁移 intake checklist（用于接手已有客户时快速评估）。

## 10. Development Plan (Re-aligned)

## 10.1 Milestone A: Minimal Portal (4-6 days)

1. Home / Quick Start / API Keys / Integrations / Usage 五页落地。
2. 对接公开生产 API（非内部 dashboard API）。
3. Quick Start 首条链路验证完成。

Exit:

1. 新用户 15 分钟内跑通首个 requestId。

## 10.2 Milestone B: Agent-connected Onboarding (4-6 days)

1. 生成 Codex/CloudCode/Cursor 指令模板。
2. 短期 integration token 流程。
3. 产出 smoke test 与验证证据。

Exit:

1. 不暴露长期 API Key 的前提下，完成自动接入演示。

## 10.3 Milestone C: Managed Mediation Default (4-6 days)

1. 默认走统一路由，不让开发者配置 provider 细节。
2. 服务端处理 fallback 与基础策略。
3. key 按环境强制分离。

Exit:

1. 新项目在零 provider 配置前提下可稳定跑通。

## 10.4 Milestone D: Internal Mediation Reset (3-4 days)

1. Reset/Snapshot/Validation-run 仅内部开关启用。
2. 外部门户隐藏全部 reset 功能。

Exit:

1. 内部可连续重置调试，外部不可见。

## 10.5 Milestone E: Migration Compatibility Kit (P2, 3-5 days)

1. ZeroClick/TryGravity 映射模板与导入脚本。
2. 客户迁移评估清单。

Exit:

1. 新迁移客户在 1-2 天内完成映射评估。

## 11. Confirmed Decisions

1. 自动提交 PR：`NO`（默认关闭）。
2. 新项目默认路由：`managed_mediation`（对开发者无额外负担）。
3. 环境 key 强制分离：`YES`。
4. Reset 能力：`Internal mediation only`。
5. ZeroClick/TryGravity：`P2 migration accelerator`，非 v1 硬门槛。
