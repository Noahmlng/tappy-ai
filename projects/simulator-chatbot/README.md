# Simulator: Chatbot Container

这是 AI Native App 模拟与测试模块的第一个容器。

## 核心能力

- ChatGPT-like 对话流程（提问 -> 推理中 -> 输出）
- DeepSeek 流式回复
- 多会话历史持久化（`localStorage`）
- Web Search Tool Call 模拟链路（触发 -> 执行 -> 状态展示 -> 结果注入回答）
- Follow-up 推荐组件（每轮回答后展示追问建议）
- Citation / Source 独立区块（展示外部来源）
- Regenerate / Retry（可对同一问题重试）
- Query Rewrite（编辑历史用户消息后，从该节点重写 query 并重跑链路）
- Turn Trace（可回看每轮的工具调用与关键事件）
- 前端可编辑 System Prompt（按会话生效，新建 Chat 自动重置默认值）

## 运行

```bash
npm install
npm run dev
```

## 配置

- `VITE_DEEPSEEK_API_KEY`
- `VITE_DEEPSEEK_MODEL`（默认：`deepseek-reasoner`）
- `SIMULATOR_API_PROXY_TARGET`（开发代理目标，默认：`http://127.0.0.1:3100`）
- `VITE_SIMULATOR_API_BASE_URL`（浏览器 API base，默认：`/api`）
- `MEDIATION_API_BASE_URL`（外部接入 API base，例如：`http://127.0.0.1:3100/api`）
- `MEDIATION_API_KEY`（从 Dashboard API Keys 获取）
- `VITE_MEDIATION_LOOPBACK_AUTH_MODE`（本地 loopback 默认 `anonymous`，可选：`anonymous|bootstrap|env_key`）
- `MEDIATION_ENV`（可选：`sandbox|staging|prod`，默认 `staging`）
- `APP_ID`（例如：`simulator-chatbot`）
- `PLACEMENT_ID`（例如：`chat_inline_v1`）

## Tool Call 说明

- 当用户问题包含实时/搜索意图关键词时，会触发 `web_search` 工具。
- 也支持通过 `/search ...` 前缀强制触发搜索链路。
- 搜索执行状态会在对话区以 Tool 卡片展示（Planned / Running / Completed / Failed）。
- Assistant 回复下方会显示 Sources 区块（自然来源）。
- Assistant 回复完成后会展示可点击追问项。
- Sidebar 内置 Turn Trace 面板，可按轮查看链路事件。
- Sidebar 内置 System Prompt 面板，可实时编辑当前会话提示词。

## Ads Platform 接入设计

- `docs/sdk-integration-design.md`：Chatbot Simulator 接入广告平台官方 SDK client 的完整设计（架构、触发点、数据模型、分阶段计划）
- Simulator 侧仅调用平台 client wrapper：`src/api/adsPlatformClient.js`
- 官方 shared client 来源：`../ad-aggregation-platform/src/sdk/client.js`（统一处理 `config -> evaluate -> events` 与 fail-open）
