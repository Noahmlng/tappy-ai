# Performance Batch Run Record (Dev, 2026-02-22)

- Date: 2026-02-22
- Environment: dev
- Owner: Noah
- Executor: Codex
- Gateway: `http://127.0.0.1:3100`

## 1. Run Command

```bash
npm --prefix ./projects/tappy-ai-mediation run perf:sdk-batch -- \
  --gateway-pid=51043 \
  --baseline-duration-sec=300 \
  --burst-duration-sec=300 \
  --soak-duration-sec=3600 \
  --baseline-qps=5 \
  --burst-qps=10 \
  --soak-qps=5 \
  --timeout-ms=12000 \
  --print-progress-every-sec=60
```

## 2. Evidence Artifact

- `projects/tappy-ai-mediation/tests/performance-reports/perf-sdk-batch-2026-02-22_08-19-09-597.json`

## 3. Summary Metrics

### Overall

- total closed-loop: `22500`
- failed closed-loop: `249`
- error rate: `1.1067%`

### Baseline (5 min @ 5 qps)

- total: `1500`
- error rate: `2.0667%`
- evaluate p95/p99: `4105.503ms / 12001ms`
- events p95/p99: `17.423ms / 35.709ms`

### Burst (5 min @ 10 qps)

- total: `3000`
- error rate: `1.2667%`
- evaluate p95/p99: `4702.25ms / 12000.011ms`
- events p95/p99: `257.448ms / 2024.886ms`

### Soak (60 min @ 5 qps)

- total: `18000`
- error rate: `1.0%`
- evaluate p95/p99: `4718.37ms / 11996.752ms`
- events p95/p99: `17.01ms / 36.054ms`

### Memory Stability (Gateway RSS)

- start RSS: `49.359MB`
- end RSS: `140.516MB`
- growth: `+91.157MB` (`184.6816%`)

## 4. Threshold Verdict (From Reliability Matrix)

- PERF-01 (`evaluate p95 <= 300ms`): **Failed**
- PERF-02 (`events p95 <= 200ms`): **Passed**
- PERF-03 (`burst error_rate <= 1.0%`): **Failed**
- PERF-04 (`RSS growth <= 10% and MQ lag <= 60s`): **Failed**
  - RSS exceeded threshold.
  - MQ lag metric is not exposed by current dev gateway endpoint, so this portion cannot be verified from this run.

## 5. Immediate Follow-up

1. isolate evaluate latency hotspots (adapter timeout, upstream dependency latency, and fallback path timing)
2. add explicit MQ lag export in dev observability endpoint for PERF-04 closure
3. re-run the same batch after performance fixes using identical load profile
