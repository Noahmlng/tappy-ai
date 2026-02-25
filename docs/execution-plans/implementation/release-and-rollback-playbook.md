# Release and Rollback Playbook (INFRA-008)

- Date: 2026-02-21
- Scope: mediation service rollout (`dev -> staging -> preprod -> prod`)

## 1. Release Pipeline Baseline

CI gate workflow:

1. `/.github/workflows/mediation-release-gate.yml`
2. hard gate commands:
   - `npm --prefix ./projects/tappy-ai-mediation run db:migrate:dry-run`
   - `npm --prefix ./projects/tappy-ai-mediation run test:integration`
3. Manual action path:
   - `workflow_dispatch` with `action=release`

## 2. Promotion Rules

1. `dev -> staging`:
   - all integration tests pass
   - migration dry-run clean
2. `staging -> preprod`:
   - no P0/P1 unresolved alert for 24h
   - release checklist signed by reviewer
3. `preprod -> prod`:
   - freeze window policy respected
   - rollback drill template prepared
   - oncall shift confirmed

## 3. Freeze Window

1. Business peak periods: no non-emergency prod changes.
2. Any emergency change requires:
   - incident id
   - rollback owner
   - explicit Go approval from admin role

## 4. Canary and Rollout

1. tenant whitelist canary first.
2. percentage rollout sequence: `5% -> 20% -> 50% -> 100%`.
3. hold each step at least 15 minutes and observe:
   - request latency p95
   - event ack success
   - DLQ growth

## 5. Rollback Order

1. Config rollback first (Module H snapshot rollback).
2. Worker drain and queue throttle second.
3. Code rollback (artifact/image) third.
4. Re-run functional integration tests after rollback.

## 6. Rollback Drill

1. Run workflow with `action=rollback`.
2. Fill `docs/execution-plans/implementation/templates/rollback-drill-record.md`.
3. Attach timeline and reason-code evidence.

## 7. No-Go Conditions

Immediate No-Go when any one happens:

1. functional integration tests fail
2. migration dry-run/check fails
3. rollback path is not executable
4. unresolved P0 alert exists
