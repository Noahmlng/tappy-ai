# Simulator: Chatbot Container

这是 AI Native App 模拟与测试模块的第一个容器。

## 核心能力

- ChatGPT-like 对话流程（提问 -> 推理中 -> 输出）
- DeepSeek 流式回复
- 多会话历史持久化（`localStorage`）
- Web Search Tool Call 模拟链路（触发 -> 执行 -> 状态展示 -> 结果注入回答）
- Follow-up 推荐组件（每轮回答后展示 3 个普通追问 + 1 个 Sponsored 追问）
- 全链路 Turn Trace 日志（可回看每轮是否触发广告机会）

## 运行

```bash
npm install
npm run dev
```

## 配置

- `VITE_DEEPSEEK_API_KEY`
- `VITE_DEEPSEEK_MODEL`（默认：`deepseek-reasoner`）

## Tool Call 说明

- 当用户问题包含实时/搜索意图关键词时，会触发 `web_search` 工具。
- 也支持通过 `/search ...` 前缀强制触发搜索链路。
- 搜索执行状态会在对话区以 Tool 卡片展示（Planned / Running / Completed / Failed）。
- 搜索结果区内置固定 1 个 Sponsored 插槽（标记为 `Sponsored`）。
- Assistant 回复完成后会展示可点击追问项，含固定 1 个 Sponsored 选项。
- Sidebar 内置 Turn Trace 面板，可按轮查看链路事件和 `Ad: YES/NO` 判断结果。
