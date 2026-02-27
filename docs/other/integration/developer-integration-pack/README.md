# Developer Integration Pack

- Version: v1.1
- Last Updated: 2026-02-27
- Audience: SDK integrators, product reviewers, release managers

This folder tracks external integration docs for the MVP-first V2 baseline:
1. `POST /api/v2/bid` (required)
2. `POST /api/v1/sdk/events` (optional enhancement)
3. `GET /api/v1/mediation/config` (optional diagnostics)

## Document Index

1. `01-one-pager.md` - product/system one pager (ready)
2. `02-quickstart.md` - first integration quickstart (ready)
3. `03-api-sdk-reference.md` - API and SDK contract reference (ready)
4. `04-environment-and-credentials.md` - environment and credentials guide (ready)
5. `05-network-adapter-support-matrix.md` - adapter capability matrix (ready)
6. `06-callback-signature-guide.md` - callback/signature guidance (ready)
7. `07-test-plan-and-checklist.md` - integration test checklist (ready)
8. `08-troubleshooting-playbook.md` - troubleshooting playbook (ready)
9. `09-version-and-compatibility-policy.md` - compatibility policy (ready)
10. `10-release-and-rollback-runbook.md` - release/rollback runbook (draft)
11. `11-end-to-end-integration-playbook.md` - full-chain implementation playbook (ready)

## Publishing Order

1. `01-one-pager.md`
2. `02-quickstart.md`
3. `03-api-sdk-reference.md`
4. `04-environment-and-credentials.md`
5. `08-troubleshooting-playbook.md`
6. `09-version-and-compatibility-policy.md`
7. `10-release-and-rollback-runbook.md`
8. `11-end-to-end-integration-playbook.md`

## Completion Rule

- [ ] All files include `Owner`, `Last Updated`, and production scope notes.
- [ ] Quickstart can produce first requestId in <= 15 minutes.
- [ ] API examples are copy-paste runnable and aligned with current gateway behavior.
- [ ] Troubleshooting includes no-bid, auth, scope mismatch, and payload validation failures.
- [ ] Full-chain playbook covers Dashboard provisioning, FastPath SDK integration, and Known Fill observability.
