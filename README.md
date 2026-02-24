# AI Native Ad Network Workspace（内部协同版）

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

这是一个多项目工作区，目标是完成 AI Native App 场景的广告聚合、策略验证与可观测闭环。

当前仓库分为三块：

1. `projects/ad-aggregation-platform`
- 广告聚合平台核心（协议、runtime、gateway、control plane）。

2. `projects/simulator-chatbot`
- AI Native Chat 容器（用户侧），负责触发和渲染广告结果。

3. `projects/simulator-dashboard`
- Developer Dashboard（接入方侧），负责配置、审计、决策和事件观测。

<a id="readme-status"></a>
## 当前状态（2026-02-24）

1. 对外 SDK 主链路固定为：
- `GET /api/v1/mediation/config`
- `POST /api/v2/bid`
- `POST /api/v1/sdk/events`

2. 默认已接通广告位：
- `chat_inline_v1`（`attach.post_answer_render`）
- `chat_followup_v1`（`next_step.intent_card`）

3. `No bid` 语义稳定：
- `HTTP 200` + `status=success` + `data.bid=null`，属于正常业务结果，不是错误。

4. 迁移说明：
- 旧路径 `/api/v1/sdk/evaluate` 不再作为主接入路径，统一使用 `/api/v2/bid`。

<a id="readme-placements"></a>
## 广告位配置与接入方式

配置来源：`projects/ad-aggregation-platform/config/default-placements.json`

### 已接入广告位（默认）

1. `chat_inline_v1`
- `placementKey`: `attach.post_answer_render`
- `surface`: `CHAT_INLINE`
- `format`: `NATIVE_BLOCK`
- 用途：主回答后展示 Sponsored links

2. `chat_followup_v1`
- `placementKey`: `next_step.intent_card`
- `surface`: `FOLLOW_UP`
- `format`: `CARD`
- 用途：回答后展示 Next-Step Intent Card

### 端到端接入链路

1. Attach（`chat_inline_v1`）
- Chatbot 在回答完成后触发广告请求。
- 通过 `POST /api/v2/bid` 请求单一 winner bid。
- 前端按返回渲染 Sponsored links，并调用 `POST /api/v1/sdk/events` 上报事件。

2. Next-Step（`chat_followup_v1`）
- Chatbot 在 `followup_generation` 事件触发请求。
- 通过 `POST /api/v2/bid` 拉取候选并落地为 Intent Card。
- 渲染后通过 `POST /api/v1/sdk/events` 上报 impression/click/dismiss。

### 契约与配置入口

- Placement schema：`projects/ad-aggregation-platform/schemas/placement.schema.json`
- V2 Bid schema：
  - `projects/ad-aggregation-platform/schemas/v2-bid-request.schema.json`
  - `projects/ad-aggregation-platform/schemas/v2-bid-response.schema.json`
- Next-Step schema：
  - `projects/ad-aggregation-platform/schemas/next-step-intent-card-request.schema.json`
  - `projects/ad-aggregation-platform/schemas/next-step-intent-card-response.schema.json`

<a id="readme-output-modes"></a>
## 输出方式（按形态）

### Attach 输出：Post-Answer Sponsored Links

- 触发点：`answer_completed`
- 渲染位置：assistant 消息下方 Sponsored 区块
- 关键代码：
  - `projects/simulator-chatbot/src/views/ChatView.vue`
  - `projects/simulator-chatbot/src/api/adsSdk.js`
  - `projects/ad-aggregation-platform/src/devtools/simulator/simulator-gateway.js`

### Next-Step 输出：Intent Card

- 触发点：`followup_generation` / `follow_up_generation`
- 渲染位置：回答下方 Next-Step 卡片区
- 契约文档：
  - `projects/ad-aggregation-platform/docs/next-step-intent-card-contract.md`

<a id="readme-architecture"></a>
## 框架设计（控制面/决策面/检索面/体验面）

1. 控制面（Control Plane）
- Dashboard + Gateway 负责 placement 配置管理、发布和审计。

2. 决策面（Decision Plane）
- Gateway 统一产出 `served | no_fill | blocked | error` 的标准决策。

3. 检索面（Retrieval Plane）
- Runtime 并发聚合多网络（CJ / PartnerStack / house），执行召回、归一化、排序、降级。

4. 体验面（Experience Plane）
- Chatbot 负责 SDK 调用和渲染；广告链路全部 fail-open，不阻塞主回答。

<a id="readme-sdk-docs"></a>
## SDK 文档入口（重点）

1. 平台 Quick Start（对外主文档）：
- `projects/ad-aggregation-platform/docs/sdk-quick-start-v2.md`

2. SDK 文档规范（编写标准）：
- `projects/ad-aggregation-platform/docs/sdk-integration-document-spec.md`

3. Integration Pack 索引：
- `docs/other/integration/developer-integration-pack/README.md`

4. Integration Pack Quickstart：
- `docs/other/integration/developer-integration-pack/02-quickstart.md`

5. Integration Pack API 参考：
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

- `projects/ad-aggregation-platform`
- `projects/simulator-chatbot`
- `projects/simulator-dashboard`
- `scripts/dev-local.js`

### 关键文档目录

- 文档分类索引：`docs/README.md`
- 路线图：`docs/ai-network-development-plan.md`
- Placement 框架：`docs/design/ai-assistant-placement-framework.md`
- Gateway 设计：`projects/ad-aggregation-platform/docs/local-simulator-gateway.md`
- SDK Quick Start：`projects/ad-aggregation-platform/docs/sdk-quick-start-v2.md`
- SDK 文档规范：`projects/ad-aggregation-platform/docs/sdk-integration-document-spec.md`
- 集成文档包：`docs/other/integration/developer-integration-pack/README.md`

<a id="readme-run"></a>
## 本地联调与运行

### 一键联调（Gateway + Chatbot + Dashboard）

```bash
npm run dev:local
```

默认本地拓扑：

1. Gateway: `http://127.0.0.1:3100`
2. Chatbot: `http://127.0.0.1:3001`
3. Dashboard: `http://127.0.0.1:3002`

### 单独启动

```bash
npm --prefix ./projects/ad-aggregation-platform run dev:gateway
npm --prefix ./projects/simulator-chatbot run dev
npm --prefix ./projects/simulator-dashboard run dev
```

### 重置联调状态（可选）

```bash
npm run sim:reset
```
