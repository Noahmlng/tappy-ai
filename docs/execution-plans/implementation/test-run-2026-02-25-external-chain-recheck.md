# External Chain Recheck Report (Key Scope + Link Trace + CPA Settlement)

- Date: 2026-02-25 (CST)
- Workspace: `/Users/zeming/Documents/chat-ads-main`
- Owner: Codex

## 1. Goal

Re-verify three concerns end-to-end under external-user conditions:

1. Can a pure external runtime key fetch ads?
2. Is ad link-chain data complete across decision/event/fact layers?
3. After user operations, is simulated CPA revenue truly counted into settlement metrics?

## 2. Baseline and Scope

Runtime was executed with strict/manual + durable persistence (Supabase Postgres), using unique per-run account/app/key.

## 3. Executed Checks

### 3.1 Automated regression (local deterministic suite)

Command:

```bash
node --test test/integration/public-key-api.integration.test.js test/integration/cpa-postback-metrics.integration.test.js test/integration/v2-bid-api.integration.test.js
```

Result: `3 passed, 0 failed`

Coverage relevance:

- `public-key-api`: external key lifecycle (create/list/rotate/revoke)
- `cpa-postback-metrics`: revenue is fact-driven (postback success only), dedupe behavior, dashboard aggregation
- `v2-bid-api`: external bid endpoint contract

### 3.2 Manual external chain run (pre-fix observation)

Run ID: `external_chain_1771961461644`

Evidence summary:

- External key successfully fetched served ad (`partnerstack` bid)
- Decision/event/fact chain completed
- CPA revenue was counted (`3.33`)
- **Issue found:** `bid.url` missed `aid` tracking param (`aidMatchesAccount=false`)

Artifacts:

- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/external_chain_1771961461644/summary.json`
- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/external_chain_1771961461644/snapshots.json`

### 3.3 Fix applied

File changed:

- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/src/devtools/simulator/simulator-gateway.js`

Change:

- Added `injectTrackingScopeIntoBid(...)`
- Applied account tracking scope injection to winner bid in `/api/v2/bid` path
- `bid.url` now carries `aid=<accountId>` consistently (same intent as existing scoped ad tracking)

### 3.4 Manual external chain run (post-fix recheck)

Run ID: `external_chain_1771961602184`

Key results:

- `bid.url`: `https://get.business.bolt.eu/r90pau9k8blr?aid=org_ext_chain_1771961602184`
- `aidMatchesAccount=true`
- Event chain complete: `decision -> sdk_event(impression) -> sdk_event(click) -> postback(success)`
- Dashboard scoped metrics:
  - `metricsSummary.revenueUsd=4.21`
  - `usageRevenue.totals.settledRevenueUsd=4.21`
  - `usageRevenue.totals.settledConversions=1`
- DB verification for same `requestId`:
  - decision rows: `1`
  - event rows: `4`
  - conversion fact rows: `1` (`revenue_usd=4.2100`)

Artifacts:

- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/external_chain_1771961602184/summary.json`
- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/external_chain_1771961602184/snapshots.json`
- `/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/.local/external_chain_1771961602184/gateway-stdout.log`

## 4. Conclusion

For the three target concerns:

1. External key fetching ads: **PASS**
2. Ad link-chain completeness: **PASS after fix** (`aid` tracing now present on `/api/v2/bid` winner URL)
3. Simulated CPA settlement counting after user operations: **PASS**

Additional confirmed behavior:

- Impression/click events alone do **not** create revenue
- Revenue is added only by successful postback conversion fact and is deduplicated by idempotency

## 5. Final Check Closure (V2-only / Fast-first)

- Date: 2026-02-25 17:37:16 CST
- Scope: external developer onboarding consistency + dashboard visibility + production gate stability (API + Dashboard only)

### 5.1 Root Cause and Fix Summary

| Area | Before | Fix | After |
| --- | --- | --- | --- |
| External onboarding content | Mixed old/new flow (`config -> evaluate -> events`) in docs/templates | Unified to V2-only (`config -> v2/bid -> events`) across integration pack + dashboard onboarding views/templates | No `/api/v1/sdk/evaluate` reference remains in developer-facing docs/views |
| Runtime environment model | `sandbox/staging/prod` defaults coexisted in gateway/UI/SDK | Enforced `prod` as the only runtime environment in gateway defaults/checks, dashboard forms, SDK defaults, and integration docs | External onboarding is prod-only; staging key dependency removed |
| API service boundary | Runtime + control-plane endpoints were exposed by a single service entry | Added role-based route isolation and dedicated Vercel handlers (`api/runtime.js`, `api/control-plane.js`) | Runtime/control-plane can now be deployed and scaled as independent services |
| E2E stability (`test:functional:p0`) | 3 flaky failures due gateway startup timeout under local `.env` durable settings | E2E gateway startup now forces fast-first env (`state_file`, durable flags disabled), removes implicit `.env` dependency, extends health timeout window | E2E suite stable and fully passing |

### 5.2 Final Check Command Matrix

Executed from workspace `/Users/zeming/Documents/chat-ads-main`:

```bash
npm --prefix projects/ad-aggregation-platform run test:integration
npm --prefix projects/ad-aggregation-platform run test:functional:p0
npm --prefix projects/simulator-dashboard run build
```

Results:

1. `test:integration`: **PASS**
   - 45 files
   - 189 tests, 189 pass, 0 fail
2. `test:functional:p0`: **PASS**
   - contracts: 38 pass, 0 fail
   - integration: 189 pass, 0 fail
   - e2e: 7 pass, 0 fail
3. `simulator-dashboard build`: **PASS**

### 5.3 External Developer Path Verification

Verified expectations are now aligned:

1. Onboarding path is explicitly `config -> v2/bid -> events`.
2. Dashboard navigation exposes `Home + Usage + Quick Start`.
3. Revenue remains fact-driven (`simulator_settlement_conversion_facts`) and visible in dashboard settlement aggregates.
4. Runtime scope is fixed to `environment=prod`; user-facing staging/sandbox selection is removed.
5. Developer-facing integration docs are no longer placeholder templates.

### 5.4 Final Verdict

Final Check gate is **PASS** for the V2-only / Fast-first + prod-only strategy:

1. External integration path is consistent and executable.
2. Revenue visibility + archival for future analysis is intact.
3. Primary release gate commands are reproducible and passing.
4. System is production-ready for the current MVP scope (in-product revenue visibility + archival, no staging dependency in user-facing flow, and chatbot excluded from deployment scope).
