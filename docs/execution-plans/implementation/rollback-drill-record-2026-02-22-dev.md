# Rollback Drill Record

- Drill date: 2026-02-22
- Target environment: dev
- Release tag / commit: main@dc05f97 (drill baseline)
- Incident / change id: RBDRILL-2026-02-22-DEV-001
- Commander: Noah
- Executor: Codex

## 1. Trigger

- Trigger symptom: Planned rollback drill for OPS-02 reliability gate validation.
- First alert timestamp: 2026-02-22T09:37:40Z (synthetic drill trigger)
- Reason codes observed:
  - publish: `h_publish_published`
  - rollback: `h_publish_rolled_back`

## 2. Actions Timeline

1. 2026-02-22T09:37:40Z - freeze publish traffic (dev drill scope)
2. 2026-02-22T09:37:40Z - rollback config snapshot (`publish -> rollback` state machine executed)
3. 2026-02-22T09:37:40Z - drain/retry queue workers (no-op in dev gateway mock queue)
4. 2026-02-22T09:37:40Z - rollback runtime artifact (no new artifact deployed in drill; remained on same dev build)
5. 2026-02-22T09:37:41Z - verify health metrics and closed-loop behavior

## 3. Verification

- `request_availability`: 100% in drill verification sample (`/api/health` OK + minimal closed-loop test pass)
- `event_ack_success`: 100% in drill verification sample (minimal closed-loop includes event ACK path and passed)
- `closed_loop_completion`: 100% in drill verification sample (minimal closed-loop test pass)
- DLQ trend: N/A in current dev gateway (MQ lag/DLQ metrics not exposed by endpoint)
- replay determinism check: PASS (`g-replay-determinism` test 3/3 passed)

Verification evidence:

- health: `curl http://127.0.0.1:3100/api/health` -> `{"ok":true,...}`
- minimal closed-loop:
  - `node --test ./projects/ad-aggregation-platform/tests/e2e/minimal-closed-loop.spec.js`
  - pass `1`, fail `0`
- replay determinism:
  - `node --test ./projects/ad-aggregation-platform/tests/e2e/g-replay-determinism.spec.js`
  - pass `3`, fail `0`

State transition evidence:

- rollback operation id: `pubop_1771753060585_0002`
- state history: `draft -> validated -> published -> rollback -> rolled_back`

## 4. Result

- Rollback success/fail: **success**
- Total recovery time: **1 second** (`2026-02-22T09:37:40Z` -> `2026-02-22T09:37:41Z`)
- RTO target: `<= 15 minutes`
- RTO verdict: **PASS**
- Follow-up actions:
  - expose MQ lag / DLQ metrics in dev gateway so OPS verification can include queue recovery signal
  - keep the rollback drill command sequence in runbook for repeatability
- Owner and deadline:
  - owner: Noah
  - deadline: 2026-02-24
