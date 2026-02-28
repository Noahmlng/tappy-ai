# PartnerStack + House Ads Pilot Runbook

This runbook executes the six-case pilot without triggering full catalog migration.

## 1. Prepare pilot cases

```bash
npm --prefix ./mediation run pilot:content:enrich
```

Outputs:

- `mediation/output/pilot-content/<run_id>/selected-cases.json`
- `mediation/output/pilot-content/<run_id>/before-after.json`
- `mediation/output/pilot-content/<run_id>/acceptance.json`

## 2. Rebuild embeddings (full for pilot) and snapshot

```bash
npm --prefix ./mediation run pilot:content:reindex
```

For incremental runs:

```bash
npm --prefix ./mediation run inventory:embeddings -- --offer-ids=offer_1,offer_2
npm --prefix ./mediation run inventory:snapshot
```

## 3. Deploy preview (runtime + control-plane)

```bash
vercel deploy apps/runtime-api -y
vercel deploy apps/control-plane-api -y
```

## 4. Collect API samples from preview runtime

```bash
npm --prefix ./mediation run pilot:content:api-samples -- \
  --runtime-url=https://<runtime-preview>.vercel.app
```

Optional auth:

```bash
npm --prefix ./mediation run pilot:content:api-samples -- \
  --runtime-url=https://<runtime-preview>.vercel.app \
  --runtime-key=<runtime_api_key>
```

## 5. Build review pack

```bash
npm --prefix ./mediation run pilot:content:review-pack
```

Outputs:

- `mediation/output/pilot-content/review-pack/<run_id>/review-pack.json`
- `mediation/output/pilot-content/review-pack/<run_id>/review-pack.md`

## 6. Screenshot checklist

Use Playwright to capture:

1. House card with image
2. House card without image
3. PartnerStack card with image
4. PartnerStack card without image

Recommended artifact directory:

- `mediation/output/playwright/`
