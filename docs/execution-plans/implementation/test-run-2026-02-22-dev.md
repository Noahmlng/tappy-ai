# Dev Test Run Record (2026-02-22)

- Date: 2026-02-22
- Environment: dev
- Owner: Noah
- Executor: Codex

## 1. Preflight Commands

1. `npm run infra:status`
   - Result: failed
   - Detail: missing required binary `docker`
2. `npm --prefix ./projects/ad-aggregation-platform run check:env`
   - Result: passed
3. `npm --prefix ./projects/ad-aggregation-platform run check:managed-services`
   - Result: passed (`doppler`, `grafana`, `synadia` reachable and authorized)

## 2. Functional Gate

Command:

```bash
npm --prefix ./projects/ad-aggregation-platform run test:functional:p0
```

Results:

- `test:contracts`: pass `38`, fail `0`
- `test:integration`: pass `139`, fail `0`
- `test:e2e`: pass `5`, fail `0`
- Final verdict: `PASS`

## 3. Reliability Mapping

- Core correctness (A-H contracts/integration): passed
- Closed-loop E2E smoke: passed
- Replay determinism E2E: passed
- Managed service connectivity/auth: passed

## 4. Open Gaps (Not Yet Executed in This Run)

- Performance thresholds (`p95 latency`, burst error rate, soak stability)
- Rollback drill timing (`RTO <= 15 min`)
- Reconciliation mismatch thresholds in live-like traffic window

## 5. Next Recommended Test Batch

1. Run a 30-60 min load/soak profile and record p95/p99 + error rate.
2. Execute rollback drill once and log recovery time.
3. Run reconciliation script against a full-day sample.
