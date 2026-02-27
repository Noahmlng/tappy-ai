# External Developer Documentation Entry (Mediation + Dashboard)

- Version: v1.4
- Last Updated: 2026-02-27
- Audience: external developers integrating Mediation Runtime API
- Assumption: API key is already provisioned and active

## 1. Handoff Rule

对外交付默认只使用一份文档：
1. `docs/other/integration/developer-integration-pack/11-end-to-end-integration-playbook.md`

该文档已包含：
1. 接入步骤
2. API/SDK 调用示例
3. Dashboard 验收流程
4. 上线清单

## 2. Runtime Contract (External)

1. `POST /api/v2/bid`（必需）
2. `POST /api/v1/sdk/events`（推荐）

约束：`/api/v2/bid` 不接受 `placementId`。

## 3. Non-Goals (Do Not Use as External Path)

1. `POST /api/v1/dev/reset`
2. 内部调试脚本作为对外交付标准
3. 历史多路径（如旧 evaluate 路由）
