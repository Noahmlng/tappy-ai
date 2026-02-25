# Developer Integration Pack (Production-Network Only)

- Version: v1.0
- Last Updated: 2026-02-22
- Audience: external developers integrating Mediation / Ad Aggregation service

## Positioning

`mediation` 只是一个示例客户端，不是 Mediation 服务的一部分。

外部开发者接入时，默认模型是：

1. 你的应用（或 mediation）作为独立 client。
2. 通过公网 HTTPS 调用 Mediation Public API。
3. 不依赖任何内部 gateway/dashboard/本地状态文件。

## What This Pack Includes

1. 接入指南（15 分钟跑通首条线上链路）：`docs/other/integration/quickstart.md`
2. 接口契约（生产 API）：`docs/other/integration/api-reference.md`
3. 对接流程（从开通到上线）：`docs/other/integration/runbook.md`
4. 测试方案（功能/稳定性/安全）：`docs/other/integration/developer-integration-pack/07-test-plan-and-checklist.md`
5. 发布与回滚：`docs/other/integration/developer-integration-pack/10-release-and-rollback-runbook.md`

## Non-Goals (Do Not Use)

以下路径属于内部联调或本地开发，不应作为外部开发者接入路径：

1. `POST /api/v1/dev/reset`
2. `GET /api/v1/dashboard/*`
3. 本地 `127.0.0.1:3100` 网关联调链路
4. 依赖仓库内部测试脚本作为外部验收唯一标准

## Integration Principle

1. 以生产 API 契约为准，而不是以内部实现为准。
2. 全链路 requestId 可追踪。
3. 广告链路必须 fail-open，不阻塞主业务回答。
4. 事件上报采用 at-least-once + 幂等键策略。

## Recommended Reading Order

1. `docs/other/integration/quickstart.md`
2. `docs/other/integration/api-reference.md`
3. `docs/other/integration/runbook.md`
4. `docs/other/integration/developer-integration-pack/07-test-plan-and-checklist.md`
5. `docs/other/integration/developer-integration-pack/10-release-and-rollback-runbook.md`
