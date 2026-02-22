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

- Performance batch: executed (see `docs/execution-plans/implementation/perf-run-2026-02-22-dev.md`)
- Rollback drill: executed, RTO validated (see `docs/execution-plans/implementation/rollback-drill-record-2026-02-22-dev.md`)
- Reconciliation mismatch thresholds in live-like traffic window

## 5. Next Recommended Test Batch

1. Run reconciliation script against a full-day sample.
2. Tune evaluate path latency and memory usage, then rerun the same performance batch profile.
