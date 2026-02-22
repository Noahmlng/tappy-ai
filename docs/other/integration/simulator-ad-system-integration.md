# Simulator -> Ad System Integration Guide

- Last Updated: 2026-02-22
- Scope: local simulator integration for `projects/simulator-chatbot` + `projects/simulator-dashboard` + `projects/ad-aggregation-platform`

## 1) Developer-facing integration files (read all)

### A. Entry docs (for integrators)

1. `docs/other/integration/quickstart.md`
2. `docs/other/integration/api-reference.md`
3. `docs/other/integration/runbook.md`
4. `README.md`
5. `projects/ad-aggregation-platform/README.md`
6. `projects/simulator-chatbot/README.md`
7. `projects/ad-aggregation-platform/docs/local-simulator-gateway.md`
8. `projects/simulator-chatbot/docs/sdk-integration-design.md`
9. `projects/ad-aggregation-platform/docs/next-step-intent-card-contract.md`

### B. Contract and config source of truth

1. `projects/ad-aggregation-platform/config/default-placements.json`
2. `projects/ad-aggregation-platform/schemas/ad-request.schema.json`
3. `projects/ad-aggregation-platform/schemas/ad-response.schema.json`
4. `projects/ad-aggregation-platform/schemas/next-step-intent-card-request.schema.json`
5. `projects/ad-aggregation-platform/schemas/next-step-intent-card-response.schema.json`

### C. Runtime and simulator code entry points

1. `projects/ad-aggregation-platform/src/devtools/simulator/simulator-gateway.js`
2. `projects/simulator-chatbot/src/api/adsSdk.js`
3. `projects/simulator-chatbot/src/views/ChatView.vue`
4. `projects/simulator-dashboard/src/api/dashboard-api.js`
5. `projects/simulator-dashboard/src/state/dashboard-state.js`
6. `projects/simulator-chatbot/vite.config.js`
7. `projects/simulator-dashboard/vite.config.js`
8. `projects/simulator-chatbot/.env.example`
9. `projects/simulator-dashboard/.env.example`
10. `projects/ad-aggregation-platform/.env.example`

### D. Integration validation files

1. `projects/ad-aggregation-platform/tests/e2e/minimal-closed-loop.spec.js`
2. `projects/ad-aggregation-platform/scripts/e2e-next-step-scenarios.js`
3. `projects/ad-aggregation-platform/tests/e2e/closed-loop-8-scenarios.spec.js`

### E. Publishing template pack (currently template status)

Folder: `docs/other/integration/developer-integration-pack/`

1. `01-one-pager.md`
2. `02-quickstart.md`
3. `03-api-sdk-reference.md`
4. `04-environment-and-credentials.md`
5. `05-network-adapter-support-matrix.md`
6. `06-callback-signature-guide.md`
7. `07-test-plan-and-checklist.md`
8. `08-troubleshooting-playbook.md`
9. `09-version-and-compatibility-policy.md`
10. `10-release-and-rollback-runbook.md`

## 2) How to integrate simulator in current version

### 2.1 Start services

At repo root (`/Users/zeming/Documents/chat-ads-main`):

```bash
npm ci
npm run dev:local
```

This starts:

1. gateway: `http://127.0.0.1:3100`
2. chatbot: `http://127.0.0.1:3001`
3. dashboard: `http://127.0.0.1:3002`

Health check:

```bash
curl -sS http://127.0.0.1:3100/api/health
```

### 2.2 Attach flow (enabled by default)

Current defaults:

1. `chat_inline_v1` (`attach.post_answer_render`) is enabled.
2. Chatbot runs `runAttachAdsFlow()` after assistant answer completes.
3. Chatbot calls `POST /api/v1/sdk/evaluate` and then `POST /api/v1/sdk/events`.
4. Gateway writes decision and sdk event logs.

Validate with dashboard APIs:

```bash
curl -sS "http://127.0.0.1:3100/api/v1/dashboard/decisions"
curl -sS "http://127.0.0.1:3100/api/v1/dashboard/events"
```

### 2.3 Next-Step Intent Card flow (disabled by default)

Two switches must both be ON:

1. frontend flag in `projects/simulator-chatbot/src/views/ChatView.vue`:
   - `ENABLE_NEXT_STEP_FLOW = true`
2. placement config `chat_followup_v1.enabled = true`
   - set from dashboard, or PATCH through gateway API.

After enabling, chatbot calls:

1. `POST /api/v1/sdk/evaluate` (Next-Step payload)
2. `POST /api/v1/sdk/events`

Smoke validation command:

```bash
npm --prefix ./projects/ad-aggregation-platform run e2e:next-step
```

## 3) Repeatable reset/wash strategy

Goal: after each integration attempt, quickly reset to a clean baseline and reconfigure.

### 3.1 One-command reset

Run:

```bash
npm run sim:reset
```

This command will:

1. If gateway is online, call `POST /api/v1/dev/reset`.
2. If gateway is offline, delete `projects/ad-aggregation-platform/.local/simulator-gateway-state.json`.
3. Restore default placement/config/metrics/decision logs/event logs in gateway state.

### 3.2 Browser-side cleanup

For fully clean replay:

1. Chatbot page (`http://127.0.0.1:3001`): click `Clear History`.
2. Dashboard page (`http://127.0.0.1:3002`): hard refresh.

Optional manual localStorage cleanup from browser console:

```js
localStorage.removeItem('chat_bot_history_v3')
localStorage.removeItem('chat_bot_turn_logs_v2')
localStorage.removeItem('ai-network-simulator-dashboard-state-v2')
location.reload()
```

### 3.3 Recommended test loop

1. `npm run sim:reset`
2. `npm run dev:local`
3. Configure placement/trigger in dashboard.
4. Run chatbot scenario.
5. Verify via `/api/v1/dashboard/decisions` and `/api/v1/dashboard/events`.
6. Repeat from step 1.

This loop keeps each test attempt isolated and reproducible.
