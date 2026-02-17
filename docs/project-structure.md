# 项目结构梳理

## A. 广告侧：广告聚合平台
路径：`projects/ad-aggregation-platform`

包含：
- `schemas/`：广告位配置、请求、响应协议
- `config/`：默认广告位预置
- `docs/`：阶段范围与落地清单

用途：
- 面向 AI Native App 提供标准化广告拉取与配置能力。

## B. 模拟与测试模块
路径：`projects/simulator-chatbot`

包含：
- Vue Chatbot 容器（首个 AI Native App）
- DeepSeek 推理与流式回复
- 本地会话历史记录（用于实验复现）

用途：
- 作为 SDK 接入前后的验证容器，观察参数变化与用户体验。

## 已清理内容

- 与当前两项目不相关的旧模板与演示文件（Vue Welcome/Home/About、HelloWorld、旧图标集、旧 store、历史 demo 页等）。
- 已去除旧 Dify 依赖，统一使用 DeepSeek。
