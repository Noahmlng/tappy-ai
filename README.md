# AI Native Network Workspace

本仓库已按开发计划拆分为两个明确子项目：

1. `projects/ad-aggregation-platform`
- 目标：应用侧广告聚合平台（第一阶段核心）
- 范围：广告位定义、广告拉取协议、触发配置、策略参数与可扩展接口

2. `projects/simulator-chatbot`
- 目标：模拟与测试模块中的第一个 AI Native App 容器（Chatbot）
- 范围：ChatGPT-like 对话容器，用于测试广告 SDK 接入前后的效果

## 项目地图

- 长期计划文档：`docs/ai-network-development-plan.md`
- 结构说明：`docs/project-structure.md`

## 快速运行（Chatbot 容器）

```bash
npm --prefix ./projects/simulator-chatbot run dev
```

## 快速构建（Chatbot 容器）

```bash
npm --prefix ./projects/simulator-chatbot run build
```
