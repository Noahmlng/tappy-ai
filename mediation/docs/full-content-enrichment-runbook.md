# Full Content Enrichment Runbook (PartnerStack + House)

This runbook executes full enrichment for `partnerstack` and `house`, then generates delivery artifacts.

## 1. Run full enrichment by network

```bash
npm --prefix ./mediation run content:enrich:full -- \
  --networks=house \
  --batch-size=500 \
  --concurrency-crawl=20 \
  --concurrency-llm=8 \
  --fetch-timeout-ms=9000
```

```bash
npm --prefix ./mediation run content:enrich:full -- \
  --networks=partnerstack \
  --batch-size=500 \
  --concurrency-crawl=20 \
  --concurrency-llm=8 \
  --fetch-timeout-ms=9000
```

Key options:

- `--dry-run=true` to validate without database writes
- `--resume-from=output/content-enrichment/<run_id>` to continue a previous run
- `--max-offers=<N>` to cap scan count
- `--embed-incremental=true|false` to toggle per-batch embedding rebuild

## 2. Rebuild embeddings + materialize serving snapshot

```bash
npm --prefix ./mediation run inventory:embeddings:full
npm --prefix ./mediation run inventory:snapshot
```

## 3. Generate per-run reports

```bash
npm --prefix ./mediation run content:enrich:report -- --run-id=<run_id> --sample-size=200
```

Outputs per run:

- `output/content-enrichment/<run_id>/report/full-report.json`
- `output/content-enrichment/<run_id>/report/full-report.md`
- `output/content-enrichment/<run_id>/report/api-sample-inputs.json`
- `output/content-enrichment/<run_id>/report/screenshot-checklist.json`

## 4. Generate combined report across runs

```bash
npm --prefix ./mediation run content:enrich:report:combined -- \
  --run-ids=<house_run_id>,<partnerstack_run_id> \
  --sample-size=200
```

Outputs:

- `output/content-enrichment/combined/<combined_id>/report/combined-report.json`
- `output/content-enrichment/combined/<combined_id>/report/combined-report.md`
- `output/content-enrichment/combined/<combined_id>/report/combined-api-sample-inputs.json`
- `output/content-enrichment/combined/<combined_id>/report/combined-screenshot-checklist.json`

## 5. Fetch real API samples for combined inputs

```bash
npm --prefix ./mediation run content:enrich:api-samples -- \
  --runtime-url=https://<runtime>.vercel.app \
  --runtime-key=<runtime_api_key> \
  --input=output/content-enrichment/combined/<combined_id>/report/combined-api-sample-inputs.json \
  --output=output/content-enrichment/combined/<combined_id>/report/combined-api-samples.json
```

Alternative auth:

```bash
npm --prefix ./mediation run content:enrich:api-samples -- \
  --runtime-url=http://127.0.0.1:3210 \
  --auth-header="Bearer <runtime_secret>" \
  --input=output/content-enrichment/combined/<combined_id>/report/combined-api-sample-inputs.json
```

## 6. Screenshot checklist

Use combined checklist:

- `output/content-enrichment/combined/<combined_id>/report/combined-screenshot-checklist.json`

Capture:

1. cards with image
2. cards without image
3. disclosure visibility (`Sponsored` / `Ad`)
4. layout stability on desktop and mobile

## 7. Inventory audit baseline (Meyka + DeepAI)

Run against local batch artifacts (no DB required):

```bash
npm --prefix ./mediation run inventory:health:links -- \
  --batch-files=mediation/output/content-enrichment/full_mm76vakx_2d6v8z/batches/house_batch_0001.json,mediation/output/content-enrichment/full_mm76y5s1_7m6gfo/batches/partnerstack_batch_0001.json
```

```bash
npm --prefix ./mediation run inventory:health:images -- \
  --batch-files=mediation/output/content-enrichment/full_mm76vakx_2d6v8z/batches/house_batch_0001.json,mediation/output/content-enrichment/full_mm76y5s1_7m6gfo/batches/partnerstack_batch_0001.json
```

```bash
npm --prefix ./mediation run inventory:coverage:products -- \
  --batch-files=mediation/output/content-enrichment/full_mm76vakx_2d6v8z/batches/house_batch_0001.json,mediation/output/content-enrichment/full_mm76y5s1_7m6gfo/batches/partnerstack_batch_0001.json
```

Generate Meyka/DeepAI dialogue outcome report from the latest product coverage report:

```bash
npm --prefix ./mediation run inventory:report:dialogues
```

Default outputs:

- `mediation/output/inventory-audit/link-health-*.json`
- `mediation/output/inventory-audit/image-health-*.json`
- `mediation/output/inventory-audit/product-coverage-*.json`
- `mediation/output/product-dialogue/product-dialogue-report-*.json`
