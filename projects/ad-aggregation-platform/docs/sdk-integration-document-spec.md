# SDK Integration Documentation Spec

- Version: v0.1 (Draft)
- Last Updated: 2026-02-17
- Scope: 规定 SDK 接入文档应如何组织、如何写、覆盖哪些必备内容

## 1. 文档目标

接入文档需要同时满足三类角色：

1. 工程接入方（如何最快跑通）
2. 运营/产品（如何配 placement 和参数）
3. 排障人员（出问题如何定位）

目标是让接入方在 30 分钟内完成首条广告链路验证。

## 2. 文档包结构（建议固定）

建议按以下 6 份文档发布，不要混成一篇超长文档：

1. `Quickstart`
- 10 分钟跑通
- 最小请求/响应示例
- 常见报错和自检命令

2. `Integration Guide`
- 初始化 SDK
- Placement 选择与配置
- Trigger 参数与 intent 策略
- 事件上报（impression/click）

3. `API Reference`
- 每个 endpoint 的字段说明
- 错误码和重试语义
- 幂等约束

4. `Placement Catalog`
- 每个 placement 的定位、触发条件、可配置项
- 默认值、推荐区间、风险说明

5. `Dashboard Operations`
- 如何在 Dashboard 改配置、看收益、查决策日志
- 参数变更后的观察窗口建议

6. `Runbook / Troubleshooting`
- no fill、低 CTR、收益突降、触发异常的定位流程

## 3. 每份文档的写作要求

## 3.1 必须具备

1. 适用版本（SDK/API 文档版本 + 生效日期）
2. 前置条件（密钥、环境变量、运行端要求）
3. 请求与响应示例（可直接复制）
4. 失败路径（错误码 + 建议动作）
5. 可观测字段（日志中如何定位 requestId/placementId）

## 3.2 必须避免

1. 只讲概念、不讲字段
2. 没有默认值和推荐值
3. 没有“失败时怎么处理”的说明
4. 没有兼容性与升级说明

## 4. Quickstart 建议模板

```md
# Quickstart

## 1) Prerequisites
- Node 20+
- SDK key
- App ID

## 2) Install
- npm install @ai-network/sdk

## 3) Init
- createAdsSdk({ appId, placements, ... })

## 4) First Request
- POST /api/v1/ads/query
- include sessionId, placementId, intentScore

## 5) Render
- if ads.length > 0 render sponsored card

## 6) Track
- report impression on visible
- report click on action

## 7) Verify in Dashboard
- check requestId in decision logs
```

## 5. Integration Guide 建议模板

1. 集成模式
- `Hosted API mode`（推荐）
- `Embedded runtime mode`（服务端 Node 环境）

2. 初始化
- appId
- placement 配置拉取策略（远端下发 + 本地兜底）

3. 请求构建
- 必填：`sessionId`, `placementId`, `context.intentScore`
- 推荐：`context.query`, `context.answerText`, `context.locale`

4. 触发时机
- `answer_completed` -> attach placements
- `followup_generation` -> next_step placements

5. 事件上报
- `impression`
- `click`
- （可选）`dismiss`, `conversion`

6. 失败与降级
- 超时或 5xx: fail-open，不阻塞主回答
- no-fill: 记录 reason，不展示广告

## 6. API Reference 建议模板

每个 endpoint 固定包含：

1. 路由与方法
2. 请求 schema
3. 响应 schema
4. 错误码
5. 重试建议（是否可重试、退避策略）

错误码建议分层：

1. `4xx`: 参数/权限问题（不可直接重试）
2. `429`: 限流（可退避重试）
3. `5xx`: 服务问题（可短退避重试）

## 7. Placement Catalog 建议模板

每个 placement 固定说明：

1. `placementKey`
2. 面向场景
3. 触发条件（硬门槛）
4. 排序因子（软约束）
5. 默认值
6. 推荐调参区间
7. 风险提示（体验打断、误触发、合规）

## 8. Dashboard Operations 建议模板

必须覆盖：

1. 参数修改流程（谁可以改、何时生效）
2. 变更审计（who/when/what）
3. 看板指标解释（CTR/eCPM/fill rate）
4. 决策日志筛选方式（按 placement/result/reason）

## 9. Runbook 建议模板

每个问题用同一结构：

1. 现象
2. 可能原因
3. 检查步骤
4. 修复动作
5. 验证方式

示例问题建议优先写：

1. `intent_below_threshold` 持续偏高
2. `no_offer` 持续偏高
3. `frequency_cap` 过严导致填充下降
4. 配置改了但收益不变

## 10. 版本与变更策略

1. 每篇文档头部带 `Version` 与 `Last Updated`
2. SDK/API 有 breaking change 时，保留上一个版本文档
3. 每次字段调整都追加 changelog（日期 + 字段 + 影响）

## 11. 与当前仓库的对齐建议

当前可直接引用：

1. `schemas/placement.schema.json`
2. `schemas/ad-request.schema.json`
3. `schemas/ad-response.schema.json`
4. `config/default-placements.json`

建议下一步新增：

1. `docs/integration/quickstart.md`
2. `docs/integration/api-reference.md`
3. `docs/integration/troubleshooting.md`

