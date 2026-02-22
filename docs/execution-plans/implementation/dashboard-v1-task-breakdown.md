# Dashboard v1 Task Breakdown (Minimal / External Developer First)

- Version: v1.0
- Last Updated: 2026-02-22
- Source Plan: `docs/execution-plans/developer-dashboard-project-plan.md`

## 1. Confirmed Scope

1. v1 目标是极简接入，不做重后台。
2. 外部链路只走 production-ready 公网 API。
3. Agent 接入不暴露长期 API Key。
4. 默认 `managed_mediation`，开发者不需要 provider 细节。
5. `sandbox/staging/prod` key 强制分离。
6. Reset 仅内部 simulator 可见。
7. ZeroClick/TryGravity 作为 P2 迁移加速能力。

## 2. Workstreams

1. `WS-UX`: 极简信息架构与页面实现（Exa-style）。
2. `WS-API`: 外部控制平面 API 与 key 生命周期。
3. `WS-AGENT`: Agent 指令接入与短期 token。
4. `WS-ROUTING`: managed mediation 默认路由与稳定性。
5. `WS-RESET`: 内部 reset/snapshot/validation-run。
6. `WS-MIGRATION`: P2 兼容映射和迁移工具。
7. `WS-QA`: 冒烟、E2E、门禁与发布验收。

## 3. Milestone Plan

## 3.1 Milestone A: Minimal Portal (Must)

目标：外部开发者 15 分钟跑通首个 requestId。

任务：

1. `DASH-A-001` 项目骨架与 feature flag 基线。
2. `DASH-A-002` Home 页面（接入状态 + 24h 关键指标）。
3. `DASH-A-003` Quick Start 页面（JS/Python/cURL 最小示例）。
4. `DASH-A-004` API Keys 页面（创建/轮换/吊销）。
5. `DASH-A-005` Integrations 页面（最小 placement 模板）。
6. `DASH-A-006` Usage 页面（请求量/成功率/基础计费摘要）。
7. `DASH-A-007` 外部控制平面 API 客户端封装。
8. `DASH-A-008` 后端最小 app/env/key 数据模型。
9. `DASH-A-009` Key API：create/list/rotate/revoke。
10. `DASH-A-010` Quick Start 验证 API（config->evaluate->events）。
11. `DASH-A-011` 审计日志（key 操作与配置发布）。
12. `DASH-A-012` v1 外部接入 E2E（happy path + fail-open）。

Exit Criteria:

1. 新用户可完成注册、拿 key、跑通首条 requestId。
2. Quick Start 验证可在 UI 中返回 evidence（requestId/status）。

## 3.2 Milestone B: Agent Connected Onboarding (Must)

目标：不暴露长期 key 的前提下完成自动接入演示。

任务：

1. `DASH-B-001` Agent Onboarding 页面（Codex/CloudCode/Cursor）。
2. `DASH-B-002` 一次性 integration token（短期 TTL）。
3. `DASH-B-003` token exchange 接口（最小作用域）。
4. `DASH-B-004` 三类 Agent 指令模板生成器。
5. `DASH-B-005` Agent 输出合同校验（文件清单 + smoke + evidence）。
6. `DASH-B-006` 自动提交 PR 关闭策略与提示。
7. `DASH-B-007` 安全审计（token TTL、重放、越权）。

Exit Criteria:

1. Agent 指令不包含长期 API Key。
2. 可演示从“复制指令”到“返回 requestId 证据”的闭环。

## 3.3 Milestone C: Managed Mediation Default (Must)

目标：默认统一路由，开发者零 provider 配置可跑通。

任务：

1. `DASH-C-001` 默认路由策略：managed mediation。
2. `DASH-C-002` 外部 Dashboard 隐藏 provider 级配置项。
3. `DASH-C-003` provider 凭证改为内部托管。
4. `DASH-C-004` fallback/failover 基线能力接入。
5. `DASH-C-005` 路由结果观测指标（served/no_fill/error）。
6. `DASH-C-006` staging 灰度验证与回退开关。

Exit Criteria:

1. 新项目无需 provider key 即可跑通。
2. 统一路由失败不阻塞主流程（fail-open 成立）。

## 3.4 Milestone D: Internal Simulator Reset (Must for internal dev)

目标：支持内部反复“重置-重配-重测”，但外部不可见。

任务：

1. `DASH-D-001` internal role + feature flag gating。
2. `DASH-D-002` soft reset（清理测试配置，保留账号组织）。
3. `DASH-D-003` snapshot restore（回到指定联调状态）。
4. `DASH-D-004` validation run 隔离（runId + 数据隔离）。
5. `DASH-D-005` simulator 内部 UI 面板。
6. `DASH-D-006` reset 安全保护（禁止外部和 prod 误用）。

Exit Criteria:

1. 内部可连续 3 轮重置调试。
2. 外部门户完全不可见 reset 功能。

## 3.5 Milestone E: Migration Compatibility Kit (P2)

目标：接手 ZeroClick/TryGravity 客户时快速迁移评估。

任务：

1. `DASH-E-001` ZeroClick 字段映射模板。
2. `DASH-E-002` TryGravity 字段映射模板。
3. `DASH-E-003` migration intake checklist。
4. `DASH-E-004` 迁移辅助导入脚本（配置级）。
5. `DASH-E-005` 试点客户迁移 dry-run。

Exit Criteria:

1. 迁移评估可在 1-2 天完成。
2. 迁移方案可输出“差异项 + 风险项 + 工作量估算”。

## 4. Start-Now Task Pack (本周开工建议)

1. `DASH-A-001` 项目骨架与 flag。
2. `DASH-A-003` Quick Start 页面。
3. `DASH-A-004` API Keys 页面。
4. `DASH-A-008` key 数据模型。
5. `DASH-A-009` key 生命周期 API。
6. `DASH-A-010` Quick Start 验证 API。
7. `DASH-A-012` happy path E2E。
8. `DASH-B-002` integration token。
9. `DASH-B-004` Agent 模板生成器。
10. `DASH-C-001` managed default 路由策略。

## 5. RACI (简版)

1. Product: `DASH-A-002~A-006` 页面内容和文案确认。
2. Backend: `DASH-A-008~A-011`, `B-002~B-003`, `C-001~C-004`, `D-*`。
3. Frontend: `DASH-A-001~A-007`, `B-001`, `B-004`, `D-005`。
4. QA: `DASH-A-012`, `B-005`, `C-006`, `D-006`, `E-005`。
5. Security: `DASH-B-007`, `D-006`。

## 6. Risks and Gates

1. 若 Quick Start 首条链路不能稳定出 `requestId`，Milestone A 不可出站。
2. 若 Agent 流程存在长期 key 暴露风险，Milestone B 不可出站。
3. 若外部路径仍可见 provider 复杂配置，Milestone C 不可出站。
4. 若 reset 能被外部账号触发，Milestone D 不可出站。

