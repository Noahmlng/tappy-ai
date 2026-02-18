# Next-Step Intent Card E2E Scenarios

- Version: v0.1
- Script: `scripts/e2e-next-step-scenarios.js`

## Run

```bash
npm --prefix ./projects/ad-aggregation-platform run e2e:next-step
```

The script will:
1. Start local gateway (default `127.0.0.1:3213`) unless `--gatewayUrl=...` is provided.
2. Execute `POST /api/v1/sdk/evaluate` for each scenario.
3. Report `POST /api/v1/sdk/events` with the same `requestId`.
4. Assert `requestId` is traceable in both:
   - `/api/v1/dashboard/decisions?requestId=...`
   - `/api/v1/dashboard/events?requestId=...`

## Scenario Set

1. `shopping`
- Example intent: buying running shoes.
- Expected: `served` or `no_fill`.
- If LLM inference falls back, `blocked(intent_non_commercial|intent_below_threshold)` is accepted with fallback note.

2. `gifting_preference`
- Example intent: gifting for girlfriend with colorful preference.
- Expected: `served` or `no_fill`.
- If LLM inference falls back, `blocked(intent_non_commercial|intent_below_threshold)` is accepted with fallback note.

3. `non_commercial`
- Example intent: physics explanation.
- Expected: `blocked` with `reasonDetail=intent_non_commercial`.

4. `sensitive_topic`
- Example intent: medical diagnosis/recommendation.
- Expected: `blocked` with `reasonDetail` prefix `blocked_topic:`.
