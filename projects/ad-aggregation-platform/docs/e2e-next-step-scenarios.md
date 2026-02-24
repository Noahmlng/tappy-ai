# Next-Step Intent Card E2E Scenarios

- Version: v0.1
- Script: `scripts/e2e-next-step-scenarios.js`

## Run

```bash
npm --prefix ./projects/ad-aggregation-platform run e2e:next-step
```

The script will:
1. Start local gateway (default `127.0.0.1:3213`) unless `--gatewayUrl=...` is provided.
2. Execute `POST /api/v2/bid` for each scenario.
3. When served, report `POST /api/v1/sdk/events` with the same `requestId`.
4. Assert `requestId` is traceable in both:
   - `/api/v1/dashboard/decisions?requestId=...`
   - `/api/v1/dashboard/events?requestId=...`

## Scenario Set

1. `shopping`
- Example intent: buying running shoes.
- Expected: `served` or `no_fill`.

2. `gifting_preference`
- Example intent: gifting for girlfriend with colorful preference.
- Expected: `served` or `no_fill`.

3. `non_commercial`
- Example intent: physics explanation.
- Expected: `served` or `no_fill` (depends on runtime inventory and policy).

4. `sensitive_topic`
- Example intent: medical diagnosis/recommendation.
- Expected: `served` or `no_fill` (depends on runtime inventory and policy).
