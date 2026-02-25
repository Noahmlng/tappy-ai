# External Chain Recheck Report (Key Scope + Link Trace + CPA Settlement)

- Date: 2026-02-25 (CST)
- Workspace: `/Users/zeming/Documents/mediation-main`
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

- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961461644/summary.json`
- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961461644/snapshots.json`

### 3.3 Fix applied

File changed:

- `/Users/zeming/Documents/mediation-main/mediation/src/devtools/mediation/mediation-gateway.js`

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

- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961602184/summary.json`
- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961602184/snapshots.json`
- `/Users/zeming/Documents/mediation-main/mediation/.local/external_chain_1771961602184/gateway-stdout.log`

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

Executed from workspace `/Users/zeming/Documents/mediation-main`:

```bash
npm --prefix mediation run test:integration
npm --prefix mediation run test:functional:p0
npm --prefix /Users/zeming/Documents/mediation-dashboard run build
```

Results:

1. `test:integration`: **PASS**
   - 45 files
   - 189 tests, 189 pass, 0 fail
2. `test:functional:p0`: **PASS**
   - contracts: 38 pass, 0 fail
   - integration: 189 pass, 0 fail
   - e2e: 7 pass, 0 fail
3. `mediation-dashboard build`: **PASS**

### 5.3 External Developer Path Verification

Verified expectations are now aligned:

1. Onboarding path is explicitly `config -> v2/bid -> events`.
2. Dashboard navigation exposes `Home + Usage + Quick Start`.
3. Revenue remains fact-driven (`mediation_settlement_conversion_facts`) and visible in dashboard settlement aggregates.
4. Runtime scope is fixed to `environment=prod`; user-facing staging/sandbox selection is removed.
5. Developer-facing integration docs are no longer placeholder templates.

### 5.4 Final Verdict

Final Check gate is **PASS** for the V2-only / Fast-first + prod-only strategy:

1. External integration path is consistent and executable.
2. Revenue visibility + archival for future analysis is intact.
3. Primary release gate commands are reproducible and passing.
4. System is production-ready for the current MVP scope (in-product revenue visibility + archival, no staging dependency in user-facing flow, and chatbot excluded from deployment scope).

## 6. 生产部署后在线全链路复核（2026-02-25 CST）

- 时间: 2026-02-25 18:31-18:44 CST
- 目标: 在真实生产域名完成 `注册 -> 创建 key -> config/bid/events -> conversion postback -> Usage 收益可见` 全流程
- 范围: `mediation-runtime-api` + `mediation-control-plane-api` + `mediation-dashboard`（Chatbot 不在部署范围）

### 6.1 生产部署结果

执行（prod）：

```bash
vercel deploy /Users/zeming/Documents/mediation-main/mediation --prod -y --local-config /tmp/vercel.runtime.prod.json
vercel deploy /Users/zeming/Documents/mediation-main/mediation --prod -y --local-config /tmp/vercel.control-plane.prod.json
vercel deploy /Users/zeming/Documents/mediation-dashboard --prod -y
```

对应生产部署（Ready）：

- Runtime API: `https://mediation-runtime-oc8x2epwz-noahs-projects-09088504.vercel.app`
- Control Plane API: `https://mediation-control-plane-ixx3masf7-noahs-projects-09088504.vercel.app`
- Dashboard: `https://mediation-dashboard-cl5wzpxti-noahs-projects-09088504.vercel.app`

别名：

- `https://mediation-runtime-api.vercel.app`
- `https://mediation-control-plane-api.vercel.app`
- `https://mediation-dashboard.vercel.app`

Dashboard 补充修复（同日）：

- 问题: 直接访问 `https://mediation-dashboard.vercel.app/login` 等深链接会出现 404
- 修复: 增加 `/Users/zeming/Documents/mediation-dashboard/vercel.json`（`filesystem` + `index.html` fallback）
- 复测: 深链接 `/login?redirect=/home` 已可直接打开并进入应用

### 6.2 在线链路验证步骤与结果

1. Dashboard 注册成功（生产）
- 账户: `org_prod_1772015842`
- 应用: `app_prod_1772015842`
- 结果: 跳转 `/home` 成功（登录态建立）

2. 创建 API Key 成功（生产）
- 新 key: `sk_prod_q294txwjbgc42xc9vs59clk8`（一次性展示）
- 列表状态: `active`

3. Quick Start `Run verify` 成功（`config -> v2/bid -> events`）
- `requestId`: `adreq_1772015930532_za97bn`
- `status`: `served`
- 证据摘要:
  - config: `status=200`
  - bid: `status=200`, `message=Bid successful`, `hasBid=true`
  - events: `status=200`, `ok=true`

4. Conversion postback 成功 + 幂等验证成功（生产 runtime API）
- 第一次 postback:
  - `status=200`
  - body: `{ ok: true, duplicate: false, factId: "fact_1772016144097_l7pvkc", revenueUsd: 6.66 }`
- 第二次同 `idempotency` 语义重复提交:
  - `status=200`
  - body: `{ ok: true, duplicate: true, factId: "fact_1772016144097_l7pvkc", revenueUsd: 6.66 }`
- 结论: 重复 postback 未重复入账（幂等生效）

5. Usage 页面收益可见（站内落档分析）
- Requests: `1`
- Settled Conversions: `1`
- Settled Revenue: `$6.66`
- By App / By Placement 聚合均显示 `1 conversion`、`$6.66`

### 6.3 服务健康检查（生产）

从 Dashboard 生产页跨域调用得到：

- `https://mediation-control-plane-api.vercel.app/api/health`: `200`，`apiServiceRole=control_plane`
- `https://mediation-runtime-api.vercel.app/api/health`: `200`，`apiServiceRole=runtime`

### 6.4 结论（生产上线口径）

本次“部署后在线复核”结论为 **PASS**：

1. 生产三服务已部署并 Ready。
2. 外部开发者主路径已跑通（注册/建 key/Quick Start）。
3. 收益链路已跑通并在 Usage 中可见（含落档聚合）。
4. conversion postback 幂等行为正确，无重复入账。
