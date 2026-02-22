# Local Simulator Gateway

- Version: v0.1
- Last Updated: 2026-02-22

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
7. `GET /api/v1/dashboard/events`
8. `GET /api/v1/dashboard/placement-audits`
9. `GET /api/v1/dashboard/network-health`
10. `GET /api/v1/sdk/config`
11. `POST /api/v1/sdk/evaluate`
12. `POST /api/v1/sdk/events`
13. `POST /api/v1/intent-card/retrieve`
14. `POST /api/v1/dev/reset`

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

## Decision/Event Logs

1. Decision logs (`/api/v1/dashboard/decisions`) 包含：
   - `result` (`served|no_fill|blocked|error`)
   - `reason` / `reasonDetail`
   - `requestId`
   - 支持按 `result/placementId/requestId` 过滤
2. Event logs (`/api/v1/dashboard/events`) 会记录：
   - `eventType=decision`（决策事件，含 `result` + `requestId`）
   - `eventType=sdk_event`（SDK 上报事件，支持携带 `requestId`）
3. `GET /api/v1/dashboard/events` 支持按 `result/placementId/requestId/eventType` 过滤。

## Network Health & Circuit Visualization

1. 运行时健康状态来自 connector 级健康与熔断策略（healthy / degraded / open）。
2. 仪表盘状态快照中包含：
   - `networkHealth`
   - `networkHealthSummary`
   - `networkFlowStats`
   - `networkFlowLogs`
3. 专用接口：`GET /api/v1/dashboard/network-health`
4. 目标：单网失败时可观察到降级与熔断，但总返回仍可由其余网络或快照兜底。

## Intent Card Retrieval API

Endpoint:
- `POST /api/v1/intent-card/retrieve`

Request body:

```json
{
  "query": "gift for girlfriend colorful",
  "facets": [
    { "facet_key": "recipient", "facet_value": "girlfriend", "confidence": 0.9 },
    { "facet_key": "style", "facet_value": "colorful", "confidence": 0.8 }
  ],
  "topK": 3,
  "minScore": 0,
  "catalog": [
    {
      "item_id": "cj:link:1001",
      "title": "Color Bloom Gift Set",
      "url": "https://merchant.example.com/bloom",
      "network": "cj",
      "category": "fashion",
      "tags": ["gift", "colorful", "girlfriend"]
    }
  ]
}
```

Response contains:
1. `items[]` with `item_id/title/url/network/category/tags/score/match_reasons`
2. `meta` with `retrieval_ms/index_item_count/index_vocabulary_size/candidate_count/top_k`

## Local Persistence

Gateway state is persisted to:

- `projects/ad-aggregation-platform/.local/simulator-gateway-state.json`

This file is local-only and ignored by git.

## Fast Reset for Repeated Integration Tests

Use:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/v1/dev/reset -H 'Content-Type: application/json' -d '{}'
```

Behavior:

1. Reset placements to defaults from `config/default-placements.json`.
2. Clear placement audits, decisions, events, metrics, and network flow stats/logs.
3. Clear in-memory cooldown/frequency runtime counters.
4. Persist a fresh snapshot to `.local/simulator-gateway-state.json`.

## Environment Variables

- `SIMULATOR_GATEWAY_PORT` (default `3100`)
- `SIMULATOR_GATEWAY_HOST` (default `127.0.0.1`)

## Hardcode Policy

1. Do not hardcode placement list/thresholds in Chatbot.
2. All placement and trigger policies must come from gateway config.
3. Only development proxy target can have local default (`http://127.0.0.1:3100`), and it must be overridable by env.
