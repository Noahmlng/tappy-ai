# Reconciliation and Dispute Baseline (INFRA-009)

- Date: 2026-02-21
- Scope: F/G archived facts vs billing/export facts

## 1. Canonical Fact Key

1. `recordKey` is the canonical reconciliation key.
2. Every diff must map to a concrete `recordKey` and version anchor fields:
   - `versionAnchorSnapshotRef`
   - `anchorHash`

## 2. Reconciliation Frequency

1. Hourly quick check:
   - missing record drift
   - DLQ impact trend
2. Daily full check:
   - archive vs billing full snapshot comparison
   - diff reason code classification

## 3. Diff Reason Codes

1. `RECON_ARCHIVE_MISSING`
2. `RECON_BILLING_MISSING`
3. `RECON_BILLABLE_MISMATCH`
4. `RECON_AMOUNT_MISMATCH`
5. `RECON_ANCHOR_MISMATCH`

## 4. Tooling

1. generate daily report:
   - `node ./projects/ad-aggregation-platform/scripts/reconcile-daily.js --archive-file=<archive.json> --billing-file=<billing.json> --output-file=<report.json> --fail-on-diff=true`
2. generate replay jobs from diff report:
   - `node ./projects/ad-aggregation-platform/scripts/reconcile-replay.js --diff-file=<report.json> --output-file=<jobs.json>`

## 5. Dispute Replay Policy

1. replay query mode is `recordKey`.
2. replay request must carry fixed anchor (`versionAnchorSnapshotRef` + `anchorHash`).
3. replay is explicit operator action, never auto on production without approval.

## 6. Operational Gate

1. `npm --prefix ./projects/ad-aggregation-platform run test:integration -- reconcile`
2. Any unresolved high-severity diff -> `No-Go` for release.
