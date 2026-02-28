# Tappy AI Mediation Workspace（内部协同版）

本 README 面向内部协作，帮助团队快速定位当前可用链路、关键文档和本地联调入口。

<a id="readme-nav"></a>
## 导航（稳定跳转链接）

- [项目概览](#readme-overview)
- [当前状态（2026-02-24）](#readme-status)
- [广告位配置与接入方式](#readme-placements)
- [输出方式（按形态）](#readme-output-modes)
- [框架设计（控制面/决策面/检索面/体验面）](#readme-architecture)
- [SDK 文档入口（重点）](#readme-sdk-docs)
- [Mediation 设计文档入口（最新）](#readme-mediation)
- [项目资产总览（代码 + 文档）](#readme-assets)
- [本地联调与运行](#readme-run)

<a id="readme-overview"></a>
## 项目概览

这是 Mediation Core 仓库，目标是完成 AI Native App 场景下的广告聚合、策略验证与可观测闭环。

当前仓库仅承载 Core 平台（协议、runtime、gateway、control plane）：

1. `mediation`
- 广告聚合平台核心（协议、runtime、gateway、control plane）。

2. `mediation-dashboard`（外部独立仓库）
- Developer Dashboard（接入方侧），负责配置、审计、决策和事件观测。
- 本地路径：`/Users/zeming/Documents/mediation-dashboard`

外部测试客户端（已迁出仓库）：
- `/Users/zeming/Documents/mediation-chatbot`
- 作为独立 AI Native Chat 容器，用于触发与验证广告链路。

<a id="readme-status"></a>
## 当前状态（2026-02-26）

1. 对外接入主链路固定为：
- `POST /api/v2/bid`（必需）
- `POST /api/v1/sdk/events`（可选增强）
- 应用侧推荐只使用 SDK 的 `runChatTurnWithAd`。

2. 默认已接通广告位：
- `chat_from_answer_v1`（`attach.post_answer_render`）
- `chat_intent_recommendation_v1`（`next_step.intent_card`）

3. `No bid` 语义稳定：
- `HTTP 200` + `status=success` + `data.bid=null`，属于正常业务结果，不是错误。

4. 生产运行硬约束：
- `SUPABASE_DB_URL`、`MEDIATION_ALLOWED_ORIGINS` 必填；缺失时网关启动失败（fail-fast）。

5. 错误分型基线：
- 严格库存预检失败会返回 `409 INVENTORY_EMPTY`（不是 `No bid`）。
- `No bid` 路径保持 `HTTP 200 + status=success + data.bid=null`。

6. 接入规则：
- 默认不传 `placementId`，由 Dashboard 配置解析。
- 对外不提供历史接入路径，统一使用 `POST /api/v2/bid`。

<a id="readme-placements"></a>
## 广告位配置与接入方式

配置来源：`mediation/config/default-placements.json`

### 已接入广告位（默认）

1. `chat_from_answer_v1`
- `placementKey`: `attach.post_answer_render`
- `surface`: `CHAT_INLINE`
- `format`: `NATIVE_BLOCK`
- 用途：主回答后展示 Sponsored links

2. `chat_intent_recommendation_v1`
- `placementKey`: `next_step.intent_card`
- `surface`: `FOLLOW_UP`
- `format`: `CARD`
- 用途：回答后展示 Next-Step Intent Card

### 端到端接入链路

1. Attach（`chat_from_answer_v1`）
- 客户端在回答完成后触发广告请求。
- 通过 `POST /api/v2/bid` 请求单一 winner bid。
- 前端按返回渲染 Sponsored links，并调用 `POST /api/v1/sdk/events` 上报事件。

2. Next-Step（`chat_intent_recommendation_v1`）
- 客户端在 `followup_generation` 事件触发请求。
- 通过 `POST /api/v2/bid` 拉取候选并落地为 Intent Card。
- 渲染后通过 `POST /api/v1/sdk/events` 上报 impression/click/dismiss。

### 契约与配置入口

- Placement schema：`mediation/schemas/placement.schema.json`
- V2 Bid schema：
  - `mediation/schemas/v2-bid-request.schema.json`
  - `mediation/schemas/v2-bid-response.schema.json`
- Next-Step schema：
  - `mediation/schemas/next-step-intent-card-request.schema.json`
  - `mediation/schemas/next-step-intent-card-response.schema.json`

<a id="readme-output-modes"></a>
## 输出方式（按形态）

### Attach 输出：Post-Answer Sponsored Links

- 触发点：`answer_completed`
- 渲染位置：assistant 消息下方 Sponsored 区块
- 关键代码：
  - `mediation/src/devtools/mediation/mediation-gateway.js`
  - `mediation/src/devtools/mediation/runtime-api-handler.js`
  - `mediation/src/devtools/mediation/control-plane-api-handler.js`
  - 外部客户端：`/Users/zeming/Documents/mediation-chatbot`

### Next-Step 输出：Intent Card

- 触发点：`followup_generation` / `follow_up_generation`
- 渲染位置：回答下方 Next-Step 卡片区
- 契约文档：
  - `mediation/docs/next-step-intent-card-contract.md`

<a id="readme-architecture"></a>
## 框架设计（控制面/决策面/检索面/体验面）

1. 控制面（Control Plane）
- Dashboard + Gateway 负责 placement 配置管理、发布和审计。

2. 决策面（Decision Plane）
- Gateway 统一产出 `served | no_fill | blocked | error` 的标准决策。

3. 检索面（Retrieval Plane）
- Runtime 并发聚合多网络（PartnerStack / house；CJ 默认关闭），执行召回、归一化、排序、降级。
- 可通过 `MEDIATION_ENABLED_NETWORKS` 覆盖默认网络白名单（默认：`partnerstack,house`）。

4. 体验面（Experience Plane）
- 客户端负责 SDK 调用和渲染；广告链路全部 fail-open，不阻塞主回答。

<a id="readme-sdk-docs"></a>
## SDK 文档入口（重点）

1. 平台 Quick Start（对外主文档）：
- `mediation/docs/sdk-quick-start-v2.md`

2. SDK 文档规范（编写标准）：
- `mediation/docs/sdk-integration-document-spec.md`

3. Integration Pack 索引：
- `docs/other/integration/developer-integration-pack/README.md`

4. Integration Pack 对外交付主文档（默认只发这份）：
- `docs/other/integration/developer-integration-pack/11-end-to-end-integration-playbook.md`

5. Integration Pack 内部补充文档（可选）：
- `docs/other/integration/developer-integration-pack/00-external-integration-overview.md`
- `docs/other/integration/developer-integration-pack/02-quickstart.md`
- `docs/other/integration/developer-integration-pack/03-api-sdk-reference.md`

<a id="readme-mediation"></a>
## Mediation 设计文档入口（最新）

1. 主入口：`docs/design/mediation-module-design.md`
2. 结构化索引：`docs/design/mediation/INDEX.md`
3. 结构化说明：`docs/design/mediation/README.md`
4. 变更历史：`docs/design/mediation/CHANGELOG.md`

<a id="readme-assets"></a>
## 项目资产总览（代码 + 文档）

### 核心代码目录

- `mediation`
- `apps/runtime-api`
- `apps/control-plane-api`
- `packages/mediation-sdk-contracts`
- `/Users/zeming/Documents/mediation-chatbot`（外部仓库）
- `/Users/zeming/Documents/mediation-dashboard`（外部仓库）

### 关键文档目录

- 文档分类索引：`docs/README.md`
- 路线图：`docs/ai-network-development-plan.md`
- Placement 框架：`docs/design/ai-assistant-placement-framework.md`
- Gateway 设计：`mediation/docs/local-mediation-gateway.md`
- SDK Quick Start：`mediation/docs/sdk-quick-start-v2.md`
- SDK 文档规范：`mediation/docs/sdk-integration-document-spec.md`
- 集成文档包：`docs/other/integration/developer-integration-pack/README.md`

<a id="readme-run"></a>
## 本地联调与运行

### 一键联调（Core Gateway）

```bash
npm run dev:local
```

默认本地拓扑：

1. Gateway: `http://127.0.0.1:3100`

### 单独启动

```bash
npm --prefix ./mediation run dev:gateway
npm --prefix /Users/zeming/Documents/mediation-dashboard run dev
```

外部客户端（可选）：

```bash
npm --prefix /Users/zeming/Documents/mediation-chatbot run dev
```

### 重置联调状态（可选）

```bash
npm run mediation:reset
```

说明：`/api/v1/dev/reset` 已下线。该命令会改为清理 Supabase 测试库（`SUPABASE_DB_URL_TEST`）。

## Vercel 重建入口（双仓）

1. `mediation-runtime-api`
- Root Directory: `apps/runtime-api`

2. `mediation-control-plane-api`
- Root Directory: `apps/control-plane-api`

Production env（两个 API 项目都要设置）：
- `SUPABASE_DB_URL=<prod db>`
- `MEDIATION_ALLOWED_ORIGINS=https://<dashboard-prod-domain>`（仅 bootstrap；运行期请通过 dashboard API 动态维护）

运行期动态白名单接口（需 dashboard 登录态）：
- `GET /api/v1/dashboard/security/origins`
- `PUT /api/v1/dashboard/security/origins`

3. `mediation-dashboard`
- Root Directory: Dashboard 独立仓库根目录
