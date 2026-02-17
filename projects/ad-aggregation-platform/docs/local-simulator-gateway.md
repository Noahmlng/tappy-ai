# Local Simulator Gateway

- Version: v0.1
- Last Updated: 2026-02-17

## Purpose

Provide one local API surface for both:

1. `simulator-dashboard` (read/write config, read metrics/logs)
2. `simulator-chatbot` (future SDK evaluate/events)

This avoids hardcoding placement logic in Chatbot and keeps settings centralized.

## Start

```bash
npm --prefix ./projects/ad-aggregation-platform run dev:gateway
```

Default address:

- `http://127.0.0.1:3100`

## Core Endpoints

1. `GET /api/health`
2. `GET /api/v1/dashboard/state`
3. `GET /api/v1/dashboard/placements`
4. `PUT /api/v1/dashboard/placements/:placementId`
5. `GET /api/v1/dashboard/metrics/summary`
6. `GET /api/v1/dashboard/decisions`
7. `GET /api/v1/dashboard/placement-audits`
8. `GET /api/v1/dashboard/network-health`
9. `GET /api/v1/sdk/config`
10. `POST /api/v1/sdk/evaluate`
11. `POST /api/v1/sdk/events`

## Placement Config Versioning

1. 每个 placement 包含 `configVersion` 字段。
2. Gateway 全局维护 `placementConfigVersion`（单调递增）。
3. `PUT /api/v1/dashboard/placements/:placementId` 仅在配置真实变化时递增版本。

## Placement Change Audit

1. 每次配置变化都会写入 `placementAuditLogs`。
2. 审计项字段：
   - `id`
   - `createdAt`
   - `placementId`
   - `configVersion`
   - `actor`
   - `patch`
   - `before`
   - `after`
3. 审计查询接口：`GET /api/v1/dashboard/placement-audits?placementId=...`

## Network Health & Circuit Visualization

1. 运行时健康状态来自 connector 级健康与熔断策略（healthy / degraded / open）。
2. 仪表盘状态快照中包含：
   - `networkHealth`
   - `networkHealthSummary`
   - `networkFlowStats`
   - `networkFlowLogs`
3. 专用接口：`GET /api/v1/dashboard/network-health`
4. 目标：单网失败时可观察到降级与熔断，但总返回仍可由其余网络或快照兜底。

## Local Persistence

Gateway state is persisted to:

- `projects/ad-aggregation-platform/.local/simulator-gateway-state.json`

This file is local-only and ignored by git.

## Environment Variables

- `SIMULATOR_GATEWAY_PORT` (default `3100`)
- `SIMULATOR_GATEWAY_HOST` (default `127.0.0.1`)

## Hardcode Policy

1. Do not hardcode placement list/thresholds in Chatbot.
2. All placement and trigger policies must come from gateway config.
3. Only development proxy target can have local default (`http://127.0.0.1:3100`), and it must be overridable by env.
