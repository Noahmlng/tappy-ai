# Ad Aggregation Platform

该子项目对应开发计划中的第一大模块：应用侧广告聚合平台。

## 第一阶段目标

- 提供 AI Native App 可集成的广告位协议。
- 支持从外部资源池拉取候选广告（联盟 / DSP / 自有库存）。
- 支持广告位配置与触发参数管理。

## 当前仓库内交付（结构化基础）

- `schemas/placement.schema.json`：广告位定义
- `schemas/ad-request.schema.json`：应用发起广告请求协议
- `schemas/ad-response.schema.json`：平台返回广告协议
- `schemas/web-search-events.schema.json`：Web Search 链路事件协议
- `schemas/web-search-config.schema.json`：Web Search 链路配置协议
- `schemas/follow-up-events.schema.json`：Follow-up 链路事件协议
- `schemas/follow-up-config.schema.json`：Follow-up 链路配置协议
- `config/default-placements.json`：默认广告位配置
- `config/default-web-search-chain.json`：Web Search 默认配置
- `config/default-follow-up-chain.json`：Follow-up 默认配置
- `docs/phase-1-scope.md`：阶段范围与后续实现清单

## 下步实现建议

1. 建立 connectors（联盟/DSP 适配层）
2. 建立 placement config service（配置中心）
3. 建立 trigger engine（触发策略）
4. 建立 delivery API（统一广告输出）
