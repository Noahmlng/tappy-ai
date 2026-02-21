# AI Native Ad Network Workspace（内部协同版）

本 README 面向内部协作，目标是让团队成员快速对齐三件事：

1. 项目里到底有什么（代码与文档资产）。
2. 整体框架是怎么设计和串起来的。
3. 广告位和输出方式当前接到什么程度、怎么接。

<a id="readme-nav"></a>
## 导航（稳定跳转链接）

- [项目概览](#readme-overview)
- [广告位配置与接入方式](#readme-placements)
- [输出方式（按形态）](#readme-output-modes)
- [框架设计（控制面/决策面/检索面/体验面）](#readme-architecture)
- [整体构思逻辑（端到端链路）](#readme-logic)
- [Mediation 设计文档入口（最新）](#readme-mediation)
- [项目资产总览（代码 + 文档）](#readme-assets)
- [本地联调与运行](#readme-run)

<a id="readme-overview"></a>
## 项目概览

这是一个多项目工作区，核心目标是先完成 AI Native App 场景下的广告聚合与策略验证，再逐步走向完整 AI Network。

当前仓库拆分为三块：

1. `projects/ad-aggregation-platform`
- 广告聚合平台核心。
- 负责协议定义、运行时检索、策略判定、Gateway 接口。

2. `projects/simulator-chatbot`
- AI Native Chat 容器（用户视角）。
- 负责承接 SDK 配置、触发广告评估、渲染输出（Sponsored Links / Intent Card / Sources / Follow-up）。

3. `projects/simulator-dashboard`
- Developer Dashboard（接入方视角）。
- 负责配置广告位与触发参数，查看收益、决策日志、事件日志、网络健康。

<a id="readme-placements"></a>
## 广告位配置与接入方式

配置来源：`projects/ad-aggregation-platform/config/default-placements.json`

### 已接入广告位（当前默认）

1. `chat_inline_v1`
- `placementKey`: `attach.post_answer_render`
- `surface`: `CHAT_INLINE`
- `format`: `NATIVE_BLOCK`
- 默认状态：`enabled=true`
- 用途：主回答完成后，在回答区域附加 Sponsored links。

2. `chat_followup_v1`
- `placementKey`: `next_step.intent_card`
- `surface`: `FOLLOW_UP`
- `format`: `CARD`
- 默认状态：`enabled=false`
- 用途：在回答后 Next-Step 区域给出意图驱动的推荐卡片。

### 接入方式（按广告位）

1. `attach.post_answer_render`（`chat_inline_v1`）
- Chatbot 在回答完成后触发：`runAttachAdsFlow()`。
- 前端请求：`POST /api/v1/sdk/evaluate`（Attach payload）。
- Gateway 落地为 `answer_completed` 事件并走 `evaluateRequest()`。
- Runtime 执行 `runAdsRetrievalPipeline()`，返回 `decision + ads[]`。
- 前端落到 `msg.attachAdSlot` 并渲染 Sponsored links；同时上报 `POST /api/v1/sdk/events`。

2. `next_step.intent_card`（`chat_followup_v1`）
- Chatbot 触发：`runNextStepIntentCardFlow()`（事件：`followup_generation`）。
- 前端请求：`POST /api/v1/sdk/evaluate`（Next-Step payload，带 `context.intent_*`）。
- Gateway 先做意图推理 `inferIntentWithLlm()`，再进入 `evaluateRequest()`。
- Runtime 返回后由 Gateway 组装 `next-step-intent-card-response`。
- 前端落到 `msg.nextStepAdSlot` 并渲染 IntentCard；同时上报 `POST /api/v1/sdk/events`。
- 当前状态：前端开关 `ENABLE_NEXT_STEP_FLOW=false`，且默认 placement 也为 `enabled=false`，因此默认联调中不主动展示。

### 契约与配置入口

- Placement schema：`projects/ad-aggregation-platform/schemas/placement.schema.json`
- 通用请求/响应：
  - `projects/ad-aggregation-platform/schemas/ad-request.schema.json`
  - `projects/ad-aggregation-platform/schemas/ad-response.schema.json`
- Next-Step 专用请求/响应：
  - `projects/ad-aggregation-platform/schemas/next-step-intent-card-request.schema.json`
  - `projects/ad-aggregation-platform/schemas/next-step-intent-card-response.schema.json`

<a id="readme-output-modes"></a>
## 输出方式（按形态）

### 稳定链接索引

- [Attach 输出：Post-Answer Sponsored Links](#output-attach-post-answer)
- [Next-Step 输出：Intent Card](#output-next-step-intent-card)
- [Web Search 链路输出](#output-web-search-chain)
- [Follow-up 链路输出](#output-follow-up-chain)

<a id="output-attach-post-answer"></a>
### Attach 输出：Post-Answer Sponsored Links

- 触发点：`answer_completed`
- 渲染位置：assistant 消息下方 Sponsored links 区块
- 数据结构：`ad-response`（`ads[].title/targetUrl/disclosure/tracking`）
- 关键代码：
  - `projects/simulator-chatbot/src/views/ChatView.vue`
  - `projects/simulator-chatbot/src/api/adsSdk.js`
  - `projects/ad-aggregation-platform/src/server/simulator-gateway.js`

<a id="output-next-step-intent-card"></a>
### Next-Step 输出：Intent Card

- 触发点：`followup_generation` / `follow_up_generation`
- 渲染位置：回答下方 Next-Step 卡片区域（独立于主回答）
- 数据结构：`next-step-intent-card-response`
- 关键代码/契约：
  - `projects/ad-aggregation-platform/docs/next-step-intent-card-contract.md`
  - `projects/ad-aggregation-platform/schemas/next-step-intent-card-request.schema.json`
  - `projects/ad-aggregation-platform/schemas/next-step-intent-card-response.schema.json`

<a id="output-web-search-chain"></a>
### Web Search 链路输出

- 输出目标：对话内搜索工具结果 + Sponsored merge（配置化）。
- 配置契约：
  - `projects/ad-aggregation-platform/schemas/web-search-config.schema.json`
  - `projects/ad-aggregation-platform/schemas/web-search-events.schema.json`
  - `projects/ad-aggregation-platform/config/default-web-search-chain.json`
- 默认策略：`triggerPolicy=auto`、`sponsored.mergeMode=separate_block`、`maxSlots=1`。

<a id="output-follow-up-chain"></a>
### Follow-up 链路输出

- 输出目标：回答后追问建议流（包含 sponsored follow-up 扩展位）。
- 配置契约：
  - `projects/ad-aggregation-platform/schemas/follow-up-config.schema.json`
  - `projects/ad-aggregation-platform/schemas/follow-up-events.schema.json`
  - `projects/ad-aggregation-platform/config/default-follow-up-chain.json`
- 默认策略：`generatorPolicy=hybrid`、`suggestionCount=4`、`sponsored.maxSlots=1`。

<a id="readme-architecture"></a>
## 框架设计（控制面/决策面/检索面/体验面）

1. 控制面（Control Plane）
- `simulator-dashboard` + Gateway 的 placement 配置管理与审计。
- 核心接口：`/api/v1/dashboard/placements`、`/api/v1/dashboard/placement-audits`。

2. 决策面（Decision Plane）
- Gateway `evaluateRequest()` 负责统一判定：
  - enabled、intentThreshold、blockedTopics、cooldown、frequency cap、expected revenue。
- 产出标准化 `decision`：`served | no_fill | blocked | error`。

3. 检索面（Retrieval Plane）
- `runAdsRetrievalPipeline()` 聚合多网络 connector（CJ / PartnerStack）。
- 负责实体抽取、候选召回、归一化、排序、降级与快照回退。

4. 体验面（Experience Plane）
- Chatbot 负责 SDK 调用与多形态渲染（message/sources/follow-up/ads）。
- 所有广告链路采用 fail-open，不阻塞主回答完成。

<a id="readme-logic"></a>
## 整体构思逻辑（端到端链路）

1. 用户发问，LLM 先完成主回答（保障核心对话路径）。
2. 回答完成后，按事件触发可选商业化链路（Attach/Next-Step）。
3. Gateway 统一做策略判定和可观测记录，不把策略硬编码在 UI。
4. Runtime 向外部资源池检索候选并做归一化输出。
5. Chatbot 根据返回结构渲染对应形态，Dashboard 同步可见决策与事件。

这套结构的关键目标是：主对话稳定、商业化可插拔、策略可运营、链路可审计。

<a id="readme-mediation"></a>
## Mediation 设计文档入口（最新）

当前 Mediation 设计已切到结构化文档体系，主入口和索引如下：

1. 主入口（Main Doc）：`docs/mediation-module-design.md`（当前版本 `v4.48`）
2. 结构化索引：`docs/mediation-design/INDEX.md`
3. 结构化说明：`docs/mediation-design/README.md`
4. 变更历史：`docs/mediation-design/CHANGELOG.md`

模块合同文件（A-H）：

1. `docs/mediation-design/modules/module-a-sdk-ingress-opportunity-sensing.md`
2. `docs/mediation-design/modules/module-b-schema-translation-signal-normalization.md`
3. `docs/mediation-design/modules/module-c-policy-safety-governor.md`
4. `docs/mediation-design/modules/module-d-supply-orchestrator-adapter-layer.md`
5. `docs/mediation-design/modules/module-e-delivery-composer.md`
6. `docs/mediation-design/modules/module-f-event-attribution-processor.md`
7. `docs/mediation-design/modules/module-g-audit-replay-controller.md`
8. `docs/mediation-design/modules/module-h-config-version-governance.md`

<a id="readme-assets"></a>
## 项目资产总览（代码 + 文档）

### 核心代码目录

- `projects/ad-aggregation-platform`
- `projects/simulator-chatbot`
- `projects/simulator-dashboard`
- `scripts/dev-local.js`

### 关键文档目录

- 路线图：`docs/ai-network-development-plan.md`
- Mediation 主入口：`docs/mediation-module-design.md`
- Mediation 索引：`docs/mediation-design/INDEX.md`
- Mediation 变更记录：`docs/mediation-design/CHANGELOG.md`
- 项目结构：`docs/project-structure.md`
- Placement 框架：`docs/ai-assistant-placement-framework.md`
- Gateway 设计：`projects/ad-aggregation-platform/docs/local-simulator-gateway.md`
- SDK 设置草案：`projects/ad-aggregation-platform/docs/sdk-placement-settings-draft.md`
- Chatbot SDK 接入设计：`projects/simulator-chatbot/docs/sdk-integration-design.md`

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
