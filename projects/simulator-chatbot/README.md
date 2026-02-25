# Simulator: Chatbot Container

这是 AI Native App 模拟与测试模块的第一个容器。

## 核心能力

- ChatGPT Light 风格聊天界面（首页 + 会话页 + 响应式侧栏）
- ChatGPT-like 对话流程（提问 -> 推理中 -> 流式输出）
- DeepSeek 流式回复
- 多会话管理（新建、搜索、切换、删除、清空历史）
- 会话历史持久化（`localStorage`）
- Web Search Tool Call 模拟链路（触发 -> 执行 -> 状态展示 -> 结果注入回答）
- Follow-up 推荐组件（每轮回答后展示追问建议）
- Citation / Source 独立区块（展示外部来源）
- Regenerate / Retry（可对同一问题重试）
- Query Rewrite（编辑历史用户消息后，从该节点重写 query 并重跑链路）
- Ads SDK 集成（异步广告卡 + 曝光/点击/postback 上报，fail-open）

## 运行

```bash
npm install
npm run dev
```

## 配置

- `VITE_DEEPSEEK_API_KEY`
- `VITE_DEEPSEEK_MODEL`（默认：`deepseek-reasoner`）
- `MEDIATION_RUNTIME_API_PROXY_TARGET`（开发代理目标，默认：`http://127.0.0.1:3100`）
- `VITE_MEDIATION_RUNTIME_API_BASE_URL`（可选，浏览器 API base，默认：`/api`）
- `VITE_ADS_API_KEY`（可选，不填时广告请求自动停用，主对话链路保持 fail-open）
- `VITE_ADS_BASE_URL`（可选，默认继承 `VITE_MEDIATION_RUNTIME_API_BASE_URL`）
- `VITE_ADS_PLACEMENT_IDS`（可选，默认：`chat_from_answer_v1,chat_intent_recommendation_v1`；兼容 `VITE_ADS_PLACEMENT_ID`）
- `VITE_ADS_BID_TIMEOUT_MS`（可选，默认：`5000`）

## Tool Call 说明

- 当用户问题包含实时/搜索意图关键词时，会触发 `web_search` 工具。
- 也支持通过 `/search ...` 前缀强制触发搜索链路。
- 搜索执行状态会在对话区以 Tool 卡片展示（Planned / Running / Completed / Failed）。
- Assistant 回复下方会显示 Sources 区块（自然来源）。
- Assistant 回复完成后会展示可点击追问项。
- Assistant 回复完成后会异步拉取广告，若有 bid 则在回答下方展示广告卡片，并上报曝光/点击事件（fail-open）。
- 点击后会基于 `hash(requestId|adId|turnId)` 与 `bid.pricing.pConv` 做可复现采样，命中则上报 `postback`，`cpaUsd` 取 `bid.pricing.cpaUsd`。
