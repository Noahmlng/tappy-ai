# External E2E Test Report (Manual Integration + DB Persistence)

- Date: 2026-02-24
- Workspace: `/Users/zeming/Documents/chat-ads-main`
- Run ID: `e2e_20260224_154150`
- Owner: Codex

## 1. Goal

Verify a complete external-user flow under **strict manual integration** with **DB persistence**:

1. Developer account authorization on Dashboard
2. Manual API key provisioning and chatbot integration
3. Ad request send -> ad content return -> chatbot render
4. User behavior tracking (impression/click/dismiss)
5. Postback conversion recording
6. Data persistence and consistency across Dashboard and DB

## 2. Runtime Baseline

Gateway runtime confirmed:

- `MEDIATION_STRICT_MANUAL_INTEGRATION=true`
- `MEDIATION_SETTLEMENT_STORAGE=postgres`
- `MEDIATION_REQUIRE_DURABLE_SETTLEMENT=true`
- `MEDIATION_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE=true`

Gateway startup logs confirmed:

- `settlement store mode: postgres`
- `strict manual integration: true`
- `runtime log db persistence required: true`

## 3. Test Identity (Created During Run)

- Dashboard user: `sim-e2e-1771919050@local.test`
- Account ID: `org_ext_e2e_1771919050`
- App ID: `simulator_chatbot_e2e_1771919050`
- API key status: `active` (staging key created via Dashboard credentials API)

Evidence:

- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/register-response.json`
- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/key-create-response.json`

## 4. Test Cases and Results

### TC-01 Developer Auth + Manual Provisioning

- Action:
  - Register Dashboard account
  - Login success
  - Create staging API key
  - Enable `chat_followup_v1`
- Expected: Account-scoped auth and key issuance work under strict-manual mode
- Result: **PASS**
- Evidence:
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/register-response.json`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/key-create-response.json`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/placement-followup-enable-response.json`

### TC-02 config -> evaluate -> events API chain

- Action:
  - Call `/api/v1/mediation/config`
  - Call `/api/v1/sdk/evaluate`
  - Call `/api/v1/sdk/events`
- Expected: requestId returned; events ack success
- Result: **PASS**
- Evidence:
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/manual-config-response.json`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/manual-evaluate-response.json`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/manual-events-response.json`

### TC-03 Chatbot render chain (real UI)

- Action:
  - Send query in chatbot
  - Verify next-step ad card rendered (`Related Products`)
  - Verify ad link contains account tracking query `aid=org_ext_e2e_1771919050`
- Expected: non-blocking chat completion + ad card render with real links
- Result: **PASS**
- Evidence:
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/playwright-evidence/chatbot-related-products.png`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/playwright-evidence/chatbot-related-products.yml`

### TC-04 Behavior tracking (impression/click/dismiss)

- Action:
  - Rendered request: `adreq_1771919809050_4380e7`
  - Triggered click and dismiss from chatbot UI
- Expected: `sdk_event` rows include `impression/click/dismiss`
- Result: **PASS**
- Evidence:
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/dashboard-events-after-ui-click.json`
  - Request-specific DB events in:
    `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/db-verification.json`

### TC-05 Postback conversion persistence

- Action:
  - Send `eventType=postback`, `postbackType=conversion`, `postbackStatus=success`, `cpaUsd=6.25`
- Expected:
  - `/sdk/events` returns `ok=true`
  - conversion fact inserted once
  - Dashboard usage shows `settledConversions=1`, `settledRevenueUsd=6.25`
- Result: **PASS**
- Evidence:
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/postback-response.json`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/dashboard-state-after-postback.json`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/db-verification.json`

### TC-06 Dashboard display and refresh stability

- Action:
  - Open `Usage` page, confirm non-zero settled metrics
  - Open `Decision Logs`, click `Refresh`
- Expected: logs remain visible after refresh (not empty reset)
- Result: **PASS** (for this run and this account scope)
- Evidence:
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/playwright-evidence/dashboard-usage-postback.png`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/playwright-evidence/dashboard-decision-logs.png`
  - `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/e2e_20260224_154150/playwright-evidence/dashboard-decision-logs-refresh.yml`

## 5. Key Data Checkpoints

### Dashboard totals (postback completed)

From `dashboard-state-after-postback.json`:

- `requests=18`
- `served=3`
- `impressions=3`
- `clicks=3`
- `settledConversions=1`
- `settledRevenueUsd=6.25`

### DB verification (same request)

From `db-verification.json` for `requestId=adreq_1771919809050_4380e7`:

- Decision row exists with `placement_id=chat_followup_v1`, `result=served`
- Event rows include ordered chain:
  - `decision`
  - `sdk_event/impression`
  - `sdk_event/click`
  - `sdk_event/dismiss`
  - `postback/conversion`
- Conversion fact exists:
  - `fact_id=fact_1771919899025_2ndvvq`
  - `revenue_usd=6.2500`
  - `conversion_id=conv_1771919899_e2e`

## 6. Fix Applied During This Run

### Chatbot evaluate timeout false-negative fix

Problem observed:

- Backend occasionally reached `served`, but frontend SDK timed out at 20s and failed-open before render.

Fix:

- Increased default evaluate timeout to 30s and made it env-configurable.

Changed file:

- `/Users/zeming/Documents/chat-ads-main/projects/simulator-chatbot/src/api/adsPlatformClient.js`

## 7. Known Blocker (MCP)

Supabase MCP in this Codex runtime remains blocked despite re-auth attempts:

- Error: `OAuth token refresh failed: Failed to parse server response` during MCP initialize/handshake.

Impact:

- MCP resource browsing is unavailable in this session.
- DB verification was completed through direct DB connection (Postgres) and management API fallback.

## 8. Final Verdict

For the required scope (**strict manual integration + DB persistence + full chain test**), this run is **PASS**:

- End-to-end chain executed with real account/key/scoped app
- Chatbot side rendered ad content and produced behavior events
- Postback conversion persisted and surfaced on Dashboard + DB
- Dashboard refresh did not reproduce empty-log regression in this scoped run
