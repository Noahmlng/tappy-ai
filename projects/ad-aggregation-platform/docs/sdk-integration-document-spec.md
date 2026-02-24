# SDK Integration Documentation Spec (V2)

- Version: v1.0
- Last Updated: 2026-02-24
- Scope: 规定 SDK 对外接入文档的结构、质量门槛和版本策略

## 1. 文档目标

SDK 文档必须同时服务三类角色：
1. 工程接入方：最快速度跑通首条链路
2. 运营/产品：理解 placement 配置与观测指标
3. 排障人员：出现 no-fill/报错时能快速定位

验收目标：
1. 新接入方 30 分钟内完成首条请求闭环（config -> bid -> events）
2. 关键错误可在 10 分钟内完成一级分诊

## 2. V2 基线契约（必须统一）

对外 SDK 文档默认基线为：
1. `GET /api/v1/mediation/config`
2. `POST /api/v2/bid`
3. `POST /api/v1/sdk/events`

约束：
1. 不再以 `POST /api/v1/sdk/evaluate` 作为主链路文档入口
2. 所有示例必须围绕 `v2/bid + sdk/events` 编写

## 3. 文档包结构（固定）

建议按以下 6 份文档发布，不要混成单篇长文：

1. `Quickstart`
- 10-15 分钟跑通最小链路
- 可复制的 curl 示例

2. `Integration Guide`
- 初始化方式、触发时机、fail-open 处理

3. `API Reference`
- endpoint 字段、错误码、重试与幂等策略

4. `Placement Catalog`
- 每个 placement 的场景、门槛、默认值、风险

5. `Dashboard Operations`
- 配置变更、审计、指标查看、日志筛选

6. `Troubleshooting / Runbook`
- 常见故障定位步骤和修复动作

## 4. 每份文档的强制项

每份文档必须包含：
1. `Version` 与 `Last Updated`
2. 适用环境范围（sandbox/staging/prod）
3. 前置条件（密钥、环境变量、运行端要求）
4. 请求/响应示例（可直接运行）
5. 失败路径（错误码 + 建议动作）
6. 可观测字段（至少 `requestId`, `placementId`）

每份文档必须避免：
1. 只讲概念不讲字段
2. 无默认值、无推荐值
3. 无失败处理和降级策略
4. 无兼容性与升级说明

## 5. Quickstart 质量标准

Quickstart 至少覆盖：
1. 配置拉取：`GET /api/v1/mediation/config`
2. 出价请求：`POST /api/v2/bid`
3. 事件上报：`POST /api/v1/sdk/events`
4. `No bid` 正常语义
5. fail-open 示例（不阻塞主回答）

Quickstart 通过条件：
1. 响应中可提取 `requestId`
2. `served` 与 `no_fill` 路径均有示例
3. 至少一个 impression 上报示例

## 6. API Reference 质量标准

每个 endpoint 固定包含：
1. 路径与方法
2. 鉴权要求
3. 必填字段与可选字段
4. 成功响应示例
5. 失败响应示例
6. 重试建议与幂等语义

错误码说明建议分层：
1. `4xx` 参数或权限问题，不盲目重试
2. `5xx` 短时故障，可有限重试并 fail-open

## 7. 兼容与版本策略

1. 每次文档变更必须更新 `Last Updated`
2. breaking change 必须保留上一版本文档至少一个发布周期
3. 字段调整需在文档中记录：日期、变更字段、影响范围、迁移动作

## 8. 发布前检查清单

1. 文档示例全部可复制执行
2. endpoint 与 schema 一致（以代码和 schema 为准）
3. 关键链路都说明了 fail-open 策略
4. `requestId` 追踪路径明确
5. 迁移说明包含旧版路径下线信息

## 9. 仓库对齐（当前文件）

当前应优先维护：
1. `projects/ad-aggregation-platform/docs/sdk-quick-start-v2.md`
2. `docs/other/integration/developer-integration-pack/02-quickstart.md`
3. `docs/other/integration/developer-integration-pack/03-api-sdk-reference.md`

契约来源：
1. `projects/ad-aggregation-platform/schemas/v2-bid-request.schema.json`
2. `projects/ad-aggregation-platform/schemas/v2-bid-response.schema.json`
3. `projects/ad-aggregation-platform/src/devtools/simulator/simulator-gateway.js`
