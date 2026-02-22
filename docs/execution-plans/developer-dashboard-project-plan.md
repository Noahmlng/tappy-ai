# Developer Dashboard Plan (External Developer Portal, Production-Only)

- Version: v1.0
- Last Updated: 2026-02-22
- Goal: 将 `projects/simulator-dashboard` 从“本地模拟调参台”升级为“外部开发者门户”，使开发者在 UI 或 Agent 指令中完成账号、配置、接入、计费、验证与上线。

## 1. Product Positioning and Hard Boundaries

### 1.1 Positioning

`simulator-dashboard` 是外部开发者控制平面（control plane），不是内部运维台。

### 1.2 Hard Boundaries (必须遵守)

1. 外部接入只走生产可用的公网 API 链路，不走内部联调链路。
2. 不依赖本地网关地址（例如 `127.0.0.1:3100`）作为外部接入路径。
3. 不将 `/api/v1/dashboard/*` 或 `/api/v1/dev/*` 作为外部接入合同。
4. Dashboard 上的所有动作都要映射到可审计的公开控制平面 API。

### 1.3 North Star

一个完全外部的开发者在 15-30 分钟内完成：

1. 注册与身份验证。
2. 创建 app 与 placement。
3. 获取 API 凭证。
4. 跑通首次广告请求与回传事件。
5. 在同一界面看到配置状态、计费与效果数据。

## 2. End-to-End Integration Chain (Developer Journey)

## 2.1 Phase A: Account and Organization Bootstrap

Dashboard 必备能力：

1. 开发者注册、邮箱验证、2FA（可选）。
2. 创建 Organization 和 Project（app）。
3. 角色权限（Owner/Admin/Developer/Viewer）。

后端能力：

1. `POST /api/v1/public/auth/register`
2. `POST /api/v1/public/auth/verify-email`
3. `POST /api/v1/public/orgs`
4. `POST /api/v1/public/projects`

## 2.2 Phase B: Credentials and Environment Setup

Dashboard 必备能力：

1. 环境切换：`sandbox | staging | prod`。
2. API Key 管理：创建、展示一次、轮换、撤销。
3. 回调白名单、来源域名白名单、IP 白名单（按产品需要可选）。

后端能力：

1. `POST /api/v1/public/credentials/keys`
2. `POST /api/v1/public/credentials/keys/:keyId/rotate`
3. `POST /api/v1/public/credentials/keys/:keyId/revoke`

## 2.3 Phase C: Placement and Runtime Config

Dashboard 必备能力：

1. 创建/编辑 placement（surface、format、frequency cap、trigger guardrails）。
2. 配置版本管理（草稿、发布、回滚）。
3. 变更审计日志（谁在何时改了什么）。

后端能力：

1. `GET /api/v1/public/placements`
2. `POST /api/v1/public/placements`
3. `PUT /api/v1/public/placements/:placementId`
4. `POST /api/v1/public/config/releases`
5. `POST /api/v1/public/config/releases/:releaseId/rollback`

## 2.4 Phase D: First Live Call and Event Tracking

Dashboard 必备能力：

1. Quick Start Runner（直接发起 `config -> evaluate -> events`）。
2. requestId 追踪与请求重放（仅脱敏字段）。
3. 失败分类（transport error / business no_fill / blocked）。

后端能力：

1. `GET /api/v1/mediation/config`
2. `POST /api/v1/sdk/evaluate`
3. `POST /api/v1/sdk/events`
4. `GET /api/v1/public/trace/:requestId`

## 2.5 Phase E: Billing and Analytics Closure

Dashboard 必备能力：

1. 账单视图（周期、应收、已结算、争议中）。
2. 使用量与收益（impression/click/revenue/eCPM/fill-rate）。
3. 事件对账（按 requestId / eventId / provider）。

后端能力：

1. `GET /api/v1/public/billing/summary`
2. `GET /api/v1/public/billing/invoices`
3. `GET /api/v1/public/analytics/overview`
4. `GET /api/v1/public/reconciliation/events`

## 3. Agent-First Onboarding (Codex / CloudCode / Cursor)

## 3.1 Product Goal

用户已有账号时，默认入口不再只是读文档，而是“一条 Agent 指令 + 一次授权”，由系统自动完成集成改造。

## 3.2 Dashboard Capability

新增页面：`Agent Onboarding`

1. 选择目标 Agent：`Codex` / `CloudCode` / `Cursor`。
2. 选择目标仓库技术栈：Node / Python / Browser SDK。
3. 生成一次性 Bootstrap Token（短期有效，默认 15 分钟）。
4. 生成对应指令模板（Prompt + CLI 命令）。
5. 展示“预期文件变更清单”和“回滚命令”。

## 3.3 Recommended Security Model

1. 指令里不直接暴露长期 API Key。
2. Agent 使用 Bootstrap Token 换取短期凭证。
3. 短期凭证仅允许读取当前项目最小范围配置。
4. 全量操作写入审计日志（actor=agent + tool + commitSha）。

## 3.4 Agent Instruction Contract (v1)

```json
{
  "version": "agent_onboarding_v1",
  "projectId": "proj_xxx",
  "environment": "staging",
  "bootstrapToken": "one_time_token",
  "integrationMode": "mediated",
  "placements": ["chat_inline_v1"],
  "tasks": [
    "install_sdk",
    "inject_env",
    "add_evaluate_call",
    "add_events_reporting",
    "run_smoke_test"
  ]
}
```

## 3.5 One-line Prompt Examples

Codex:

```text
Use this onboarding payload and complete integration automatically in this repository: <payload_json>. Keep fail-open behavior and output test evidence.
```

CloudCode:

```text
Apply the onboarding payload to this workspace, generate required config files, wire evaluate/events calls, and return a verification checklist.
```

Cursor:

```text
Execute onboarding from this payload, patch project files, and produce a runnable smoke-test script plus rollback script.
```

## 4. Provider Compatibility Layer (ZeroClick / TryGravity)

## 4.1 Adapter Abstraction (统一模型)

控制平面统一接口：

1. `fetchCandidates(context) -> candidates[]`
2. `trackImpression(event) -> ack`
3. `trackClick(event) -> ack or redirect`
4. `health() -> provider health`

Dashboard 对外只暴露“统一配置模型”，不暴露供应商差异给新手用户。

## 4.2 ZeroClick Compatibility Notes (as of 2026-02-22)

1. Offers endpoint: `POST https://zeroclick.dev/api/v2/offers`，认证头 `x-zc-api-key`。
2. `method=client` 由请求头推导 IP/UA；`method=server` 需要传 `ipAddress`。
3. Impression endpoint: `POST https://zeroclick.dev/api/v2/impressions`。
4. Impression 上报无鉴权，且官方要求从终端设备发起（client-side）。

Dashboard 必备校验：

1. 若选择 ZeroClick + server mode，必须检查是否可提供终端 `ipAddress`。
2. 若业务端无法 client-side 上报 impression，阻止上线并给出红色告警。

## 4.3 TryGravity Compatibility Notes (as of 2026-02-22)

1. Contextual endpoint: `POST https://server.trygravity.ai/api/v1/ad/contextual`。
2. 认证头 `Authorization: Bearer <API_KEY>`。
3. 必填核心字段：`messages`、`sessionId`、`render_context.placements`、`numAds`（需与 placements 长度一致）。
4. 返回 `impUrl` 与 `clickUrl`；展示和点击都需要正确触发以保证计费归因。
5. 公共健康检查：`GET https://server.trygravity.ai/health`。

Dashboard 必备校验：

1. `numAds` 与 placement 数量不一致时禁止发布。
2. 缺少 `impUrl` firing 逻辑时禁止生产放量。

## 4.4 Multi-provider Routing Strategy

1. `managed_mediation`（推荐默认）：由平台统一路由到 ZeroClick/TryGravity/其他供应方。
2. `direct_provider`：由开发者在 Dashboard 显式选择单一供应方。
3. `hybrid_fallback`：主路由失败后切换备用供应方，保证 fail-open。

## 5. Testing and Reset Strategy (反复重测能力)

## 5.1 Problem to Solve

接入会反复试错，必须支持“快速清空并重配”，避免人工逐项回退。

## 5.2 Reset Modes

1. Soft Reset（保留账号）：
   - 禁用全部 placement。
   - 撤销当前环境 API keys 并重发。
   - 清空测试白名单与测试 webhook。
2. Hard Reset（保留组织、清空集成）：
   - 归档 app 下所有 placement/config release。
   - 清空沙盒事件数据与临时证书。
   - 恢复为“未接入”初始态模板。
3. Snapshot Restore：
   - 每次“接入前”自动生成快照。
   - 一键回滚到任意快照版本。

## 5.3 Test Workflow Template

1. 点击 `Start New Validation Run`。
2. 系统创建 `integrationRunId` 并绑定独立测试配置。
3. 执行自动冒烟：
   - config 拉取
   - evaluate 请求
   - impression/click 事件
   - 账单计数一致性检查
4. 输出通过/失败报告与 requestId 证据。
5. 失败时允许 `Reset + Retry`，不污染上一轮数据。

## 5.4 Required Test Matrix

1. Functional: 正常返回 `served|blocked|no_fill|error`。
2. Contract: 字段完整性与类型校验。
3. Compatibility: ZeroClick/TryGravity 分别跑通。
4. Reliability: 超时、5xx、限流下 fail-open。
5. Billing: `impression/click/revenue` 对账一致。
6. Security: key 轮换、权限最小化、审计完整性。

## 6. Dashboard IA (Target Information Architecture)

1. `Home`：关键接入状态、上线 readiness。
2. `Accounts & Access`：账号、成员、API keys。
3. `Apps & Placements`：app、placement、配置版本、发布与回滚。
4. `Quick Start Runner`：在线发起首条链路请求与验证。
5. `Agent Onboarding`：生成 Codex/CloudCode/Cursor 指令。
6. `Providers`：ZeroClick/TryGravity 连接状态与参数映射。
7. `Analytics & Billing`：效果指标、账单、对账。
8. `Audit & Trace`：requestId 追踪、变更审计、错误定位。
9. `Reset & Snapshots`：一键重置、快照恢复、测试 run 管理。

## 7. Development Plan (Alignment Baseline)

## 7.1 Milestone 0 (Docs Freeze, 1-2 days)

1. 冻结外部接入合同与 Dashboard 信息架构。
2. 冻结 Agent onboarding payload v1。
3. 冻结 ZeroClick/TryGravity 适配字段映射表。

Exit Criteria:

1. 产品、后端、前端、SDK 四方评审通过。

## 7.2 Milestone 1 (Control Plane Foundation, 4-6 days)

1. 账号/组织/项目模型。
2. 凭证管理（创建、轮换、撤销）。
3. 环境管理（sandbox/staging/prod）。

Exit Criteria:

1. 新用户可在 UI 完成注册到 key 发放。

## 7.3 Milestone 2 (Placement + Runtime Integration, 5-7 days)

1. placement/config/release/rollback。
2. Quick Start Runner 跑通 `config -> evaluate -> events`。
3. trace by requestId。

Exit Criteria:

1. 从零账号到首条 requestId 全链路打通。

## 7.4 Milestone 3 (Provider Adapters, 5-7 days)

1. ZeroClick 适配器接入与校验器。
2. TryGravity 适配器接入与校验器。
3. managed/direct/hybrid 路由配置。

Exit Criteria:

1. 两家供应方都可通过统一配置完成联调。

## 7.5 Milestone 4 (Agent Automation, 4-6 days)

1. Bootstrap token + 短期凭证交换。
2. Codex/CloudCode/Cursor 指令模板落地。
3. 自动化改造结果回传（变更清单 + 冒烟结果）。

Exit Criteria:

1. 至少一个样例仓库通过“一条指令完成接入”验收。

## 7.6 Milestone 5 (Reset + Test Orchestrator, 4-6 days)

1. Soft/Hard reset。
2. Snapshot 管理。
3. 验证 run 编排与报告导出。

Exit Criteria:

1. 同一账号可连续 3 轮“重置-重配-重测”且数据隔离清晰。

## 8. Risks and Controls

1. 风险：Agent 自动改代码可能越权或引入不安全改动。
   - 控制：最小权限 token + 变更预览 + 人工批准开关。
2. 风险：多供应方字段差异导致计费错配。
   - 控制：统一事件模型 + provider-specific 校验器 + 上线前对账门禁。
3. 风险：测试重置误删生产配置。
   - 控制：环境隔离、prod 二次确认、prod 禁用 hard reset。

## 9. Decisions Needed Before Coding

1. Agent 自动接入的默认模式是否启用“自动提交 PR”（建议默认关闭）。
2. `managed_mediation` 是否作为新项目默认路由（建议是）。
3. sandbox/staging/prod 是否强制分离 API key（建议强制分离）。
4. reset 能力是否先只开放 sandbox/staging（建议是）。
5. 是否先支持 ZeroClick + TryGravity 两家，后续再扩展更多 adapter（建议是）。
