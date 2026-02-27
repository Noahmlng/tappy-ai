# External Developer Documentation Entry (Mediation + Dashboard)

- Version: v1.3
- Last Updated: 2026-02-27
- Audience: external developers integrating Mediation Runtime API
- Assumption: API key is already provisioned and active

## 1. What This Entry Covers

外部开发者只需要关注两件事：
1. 如何从应用侧调用 Mediation Runtime
2. 如何在 Dashboard 做联调核验与上线验收

不包含：
1. API key 签发/轮换/回收流程
2. Dashboard 管理员后台操作手册

## 2. Single Runtime Contract

运行时对外只保留：
1. `POST /api/v2/bid`（必需）
2. `POST /api/v1/sdk/events`（推荐）

约束：`/api/v2/bid` 不接受 `placementId`，placement 由 Dashboard 已发布配置自动解析。

## 3. Read In This Order

1. `docs/other/integration/developer-integration-pack/00-external-integration-overview.md`
2. `docs/other/integration/developer-integration-pack/02-quickstart.md`
3. `docs/other/integration/developer-integration-pack/03-api-sdk-reference.md`
4. `docs/other/integration/developer-integration-pack/11-end-to-end-integration-playbook.md`

## 4. Non-Goals (Do Not Use as External Path)

1. `POST /api/v1/dev/reset`
2. 内部调试脚本作为对外接入标准
3. 历史多路径（如旧 evaluate 路由）

## 5. Core Integration Principles

1. 以 `v2/bid + sdk/events` 契约为唯一准入标准
2. 全链路以 `requestId` 追踪
3. 广告链路 fail-open，不阻塞主业务回答
