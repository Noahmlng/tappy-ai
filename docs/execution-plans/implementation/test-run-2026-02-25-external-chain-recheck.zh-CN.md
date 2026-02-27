# 外部链路复核报告（Key Scope + 链路追踪 + CPA 结算）

- 日期：2026-02-25（CST）
- 工作区：`/Users/zeming/Documents/mediation-main`
- 负责人：Codex

## 1. 目标

在“外部用户接入”条件下，对以下 3 个问题做端到端复核：

1. 仅使用外部 runtime key，是否可以拿到广告结果？
2. 广告链路数据是否在 decision/event/fact 三层完整闭环？
3. 用户行为之后，模拟 CPA 收益是否真实计入结算口径？

## 2. 基线与范围

运行时使用 strict/manual + durable persistence（Supabase Postgres），并使用每次运行唯一的 account/app/key。

## 3. 已执行检查

### 3.1 自动化回归（本地确定性套件）

命令：

```bash
node --test test/integration/public-key-api.integration.test.js test/integration/cpa-postback-metrics.integration.test.js test/integration/v2-bid-api.integration.test.js
```

结果：`3 passed, 0 failed`

覆盖意义：

- `public-key-api`：外部 key 全生命周期（create/list/rotate/revoke）
- `cpa-postback-metrics`：收益由 conversion fact 驱动（仅 postback success 计入）、去重行为、Dashboard 聚合
- `v2-bid-api`：外部出价接口契约

### 3.2 外部链路手工跑通（修复前观察）

Run ID：`external_chain_1771961461644`

证据摘要：

- 外部 key 成功拿到投放广告（`partnerstack` 出价）
- decision/event/fact 链路完整
- CPA 收益已计入（`3.33`）
- **发现问题**：`bid.url` 缺少 `aid` 跟踪参数（`aidMatchesAccount=false`）

产物：

- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961461644/summary.json`
- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961461644/snapshots.json`

### 3.3 已应用修复

变更文件：

- `/Users/zeming/Documents/mediation-main/mediation/src/devtools/mediation/mediation-gateway.js`

修复内容：

- 新增 `injectTrackingScopeIntoBid(...)`
- 在 `/api/v2/bid` 赢家广告路径注入 account 追踪作用域
- `bid.url` 现在稳定携带 `aid=<accountId>`（与现有 scoped ad tracking 语义一致）

### 3.4 外部链路手工复测（修复后）

Run ID：`external_chain_1771961602184`

关键结果：

- `bid.url`：`https://get.business.bolt.eu/r90pau9k8blr?aid=org_ext_chain_1771961602184`
- `aidMatchesAccount=true`
- 事件链路完整：`decision -> sdk_event(impression) -> sdk_event(click) -> postback(success)`
- Dashboard 口径指标：
  - `metricsSummary.revenueUsd=4.21`
  - `usageRevenue.totals.settledRevenueUsd=4.21`
  - `usageRevenue.totals.settledConversions=1`
- 同一 `requestId` 的 DB 校验：
  - decision rows：`1`
  - event rows：`4`
  - conversion fact rows：`1`（`revenue_usd=4.2100`）

产物：

- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961602184/summary.json`
- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961602184/snapshots.json`
- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961602184/gateway-stdout.log`

## 4. 结论

针对三项核心问题：

1. 外部 key 拉取广告：**PASS**
2. 广告链路完整性：**PASS（修复后）**（`/api/v2/bid` 赢家 URL 已含 `aid` 追踪）
3. 用户行为后模拟 CPA 结算入账：**PASS**

额外确认：

- impression/click 事件本身**不会**记收益
- 只有 successful postback conversion fact 会增加收益，并按 idempotency 去重

## 5. Final Check 收口（V2-only / Fast-first）

- 时间：2026-02-25 17:37:16 CST
- 范围：外部开发者接入一致性 + Dashboard 可见性 + 生产门禁稳定性（仅 API + Dashboard）

### 5.1 根因与修复摘要

| 领域 | 修复前 | 修复动作 | 修复后 |
| --- | --- | --- | --- |
| 对外接入内容 | 文档/模板混用旧新链路（`config -> evaluate -> events`） | 集成包 + Dashboard onboarding 统一到 V2-only（`config -> v2/bid -> events`） | 对外资料中不再有 `/api/v1/sdk/evaluate` |
| 运行环境模型 | 网关/UI/SDK 同时存在 `sandbox/staging/prod` 默认 | 网关默认值与校验、Dashboard 表单、SDK 默认值、集成文档统一改为 `prod` | 对外接入改为 prod-only，移除 staging key 依赖 |
| API 服务边界 | runtime 与 control-plane 路由同入口暴露 | 新增按角色路由隔离 + 独立 Vercel 入口（`api/runtime.js`、`api/control-plane.js`） | runtime/control-plane 可独立部署与扩缩容 |
| E2E 稳定性（`test:functional:p0`） | 本地 `.env` durable 设置导致网关启动超时，出现 3 个假失败 | E2E 启动强制 fast-first 环境（`state_file` + 关闭 durable 强制项），移除对 `.env` 的隐式依赖，增加健康检查窗口 | E2E 稳定全绿 |

### 5.2 Final Check 命令矩阵

执行目录：`/Users/zeming/Documents/mediation-main`

```bash
npm --prefix mediation run test:integration
npm --prefix mediation run test:functional:p0
npm --prefix /Users/zeming/Documents/mediation-dashboard run build
```

结果：

1. `test:integration`：**PASS**
   - 45 个文件
   - 189 tests，189 pass，0 fail
2. `test:functional:p0`：**PASS**
   - contracts：38 pass，0 fail
   - integration：189 pass，0 fail
   - e2e：7 pass，0 fail
3. `mediation-dashboard build`：**PASS**

### 5.3 外部开发者路径验证

当前状态已一致：

1. Onboarding 主链路明确为 `config -> v2/bid -> events`
2. Dashboard 导航开放 `Home + Usage + Quick Start`
3. 收益继续由 fact 驱动（`mediation_settlement_conversion_facts`），并在 Dashboard 结算聚合中可见
4. 运行时环境固定为 `environment=prod`，用户侧不再暴露 staging/sandbox 选择
5. 对外接入文档已从占位模板补齐为可执行版本

### 5.4 最终判定

在 V2-only / Fast-first + prod-only 策略下，Final Check 门禁结论为 **PASS**：

1. 外部接入链路一致且可执行
2. 收益站内可见与可落档分析能力完整
3. 上线门禁命令可重复执行且全部通过
4. 就当前 MVP 范围（站内收益可见与落档分析）已达到 production 可用，用户侧不再依赖 staging，且部署范围不包含 chatbot

## 6. 面向 SDK/Runtime 上游的待修复项（2026-02-27）

### 6.1 P0：`/api/ads/bid` 上游稳定 500（阻塞联调）

- 严重级别：`P0`
- 现象：线上直测 `POST /api/ads/bid`，10/10 次返回 `filled=false`
- 诊断字段：
  - `diagnostics.reasonCode=upstream_non_2xx`
  - `diagnostics.upstreamStatus=500`
- 影响：应用侧无法区分“真实 no bid”与“上游运行时崩溃”，当前链路等价于不可用

需要上游修改：

1. 修复 runtime 内部错误，消除稳定性 `500 INTERNAL_ERROR`
2. 即使上游失败，也要返回可用业务响应（`no bid`），不要把失败直接暴露为 500

验收标准（建议）：

1. 回归样例中，`/api/ads/bid` 不再出现 500
2. 上游异常时返回 200 + 明确 `no bid` 语义（含可追踪 diagnostics），而不是网关级错误
3. 同一输入连续回归压测（至少 50 次）无 500

### 6.2 P1：明确当前生效契约 + 给出回归样例

- 严重级别：`P1`
- 诉求：由上游给出“当前生产环境真实生效”的字段契约与验收样例，避免双方按不同假设联调

需要上游明确：

1. 当前是否仅支持 `userId` / `chatId` / `messages`
2. `placementId` 的处理策略：
   - 明确拒绝并返回可识别错误
   - 或兼容降级（忽略该字段并走默认 placement）
3. 给出一组在其环境中“必定 200 且非 500”的回归请求样例，供应用侧重复联调

建议样例至少覆盖：

1. 标准请求（最小必填字段）
2. 缺失可选字段请求（验证降级行为）
3. 带 `placementId` 请求（验证拒绝或兼容策略）

### 6.3 应用侧接入反馈（当前）

1. 目前主阻塞点不是流量填充率，而是上游稳定性：稳定 500 导致链路不可验收
2. 仅有 `upstream_non_2xx` 无法支撑应用侧精确分流（重试、降级、熔断策略难以落地）
3. 契约边界（尤其 `placementId`）未被上游明确定义，导致接入实现与验收口径反复调整
