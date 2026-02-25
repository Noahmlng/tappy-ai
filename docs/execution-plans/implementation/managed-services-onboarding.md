# Managed Services Onboarding (Synadia + Doppler + Grafana)

- Date: 2026-02-21
- Scope: production external dependencies for mediation runtime

## 1. Required Runtime Variables

Put these in `mediation/.env` (local) and secret manager (staging/prod):

1. `NATS_URL`
2. `SYNADIA_CLOUD_USER_PUBLIC_KEY`
3. One Synadia auth material:
   - `SYNADIA_CLOUD_USER_SEED`, or
   - `SYNADIA_CLOUD_CREDS`, or
   - `SYNADIA_CLOUD_CREDS_FILE`, or
   - `NATS_USER` + `NATS_PASSWORD`
4. `DOPPLER_TOKEN`
5. `DOPPLER_PROJECT`
6. `DOPPLER_CONFIG`
7. `GRAFANA_URL`
8. `GRAFANA_SERVICE_ACCOUNT_TOKEN`

## 2. Synadia Permission Baseline (least privilege)

Recommended allow list for mediation MVP:

1. publish allow:
   - `mediation.>`
   - `$JS.API.>`
   - `$JS.ACK.>`
   - `_INBOX.>`
2. subscribe allow:
   - `mediation.>`
   - `_INBOX.>`

Do not grant `>` wildcard full access.

## 3. Doppler Permission Baseline

1. Create one service token per environment (`dev`, `staging`, `prod`).
2. Scope token to one project+config only.
3. Prefer read-only token for runtime fetch.

## 4. Grafana Permission Baseline

1. Create service account `codex-mediation`.
2. Use `Editor` role only if dashboard/alert changes are required.
3. Use `Viewer` role for read-only health verification.

## 5. One-command Verification

Run:

```bash
npm --prefix ./mediation run check:managed-services
```

This validates:

1. Doppler API authorization
2. Grafana API authorization
3. Synadia endpoint reachability + auth material completeness

If any check fails, command exits non-zero.
