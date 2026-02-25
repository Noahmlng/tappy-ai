# Developer Integration Pack

- Version: v1.0
- Last Updated: 2026-02-25
- Audience: SDK integrators, product reviewers, release managers

This folder tracks external integration docs for the V2 baseline:
1. `GET /api/v1/mediation/config`
2. `POST /api/v2/bid`
3. `POST /api/v1/sdk/events`

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

## Publishing Order

1. `01-one-pager.md`
2. `02-quickstart.md`
3. `03-api-sdk-reference.md`
4. `04-environment-and-credentials.md`
5. `08-troubleshooting-playbook.md`
6. `09-version-and-compatibility-policy.md`
7. `10-release-and-rollback-runbook.md`

## Completion Rule

- [ ] All files include `Owner`, `Last Updated`, and environment scope.
- [ ] Quickstart can produce first requestId in <= 15 minutes.
- [ ] API examples are copy-paste runnable and aligned with current gateway behavior.
- [ ] Troubleshooting includes no-bid, auth, scope mismatch, and payload validation failures.
