# Mediation Reliability Test Matrix Template

- Version: v0.1
- Last Updated: 2026-02-22
- Owner: Noah
- Test Window: 2026-02-22 to 2026-02-23
- Environment: dev
- Build/Commit: TBD

## 1. Goal

Use this matrix to prove the mediation system is complete and reliable before release.

## 2. Entry Criteria

- [ ] Runtime dependencies are healthy (Postgres/Redis/MQ/network adapters).
- [ ] Required secrets and service tokens are configured.
- [ ] Config snapshot for this run is frozen and versioned.
- [ ] Dashboard + logs are queryable for request/event/replay paths.
- [ ] Rollback operator and on-call owner are assigned.

## 3. Preflight (Run Code Safety)

Execute these checks first and record failures early:

```bash
npm --prefix ./projects/ad-aggregation-platform run check:env
npm --prefix ./projects/ad-aggregation-platform run check:managed-services
npm --prefix ./projects/ad-aggregation-platform run test:functional:p0
```

If preflight fails, stop the matrix and create a blocker ticket with logs.

## 4. Test Matrix

Status values: `Not Started | Running | Passed | Failed | Blocked`

| ID | Priority | Scenario | Setup / Input | Execute | Expected Result | SLO / Threshold | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CORE-01 | P0 | Closed loop happy path (`request -> decision -> render -> impression -> click`) | Valid placement + eligible traffic | Run SDK evaluate + events flow | Decision is `served`; events are accepted and archived | 100% pass on 20 runs | Not Started | |
| CORE-02 | P0 | No-fill fallback path | Force adapters to return empty inventory | Run evaluate call | Decision is `no_fill`; fallback reason is explicit | 100% pass | Not Started | |
| CORE-03 | P0 | Policy blocked path | Input includes blocked topic or unsafe content | Run evaluate call | Decision is `blocked` with deterministic reason code | 100% pass | Not Started | |
| CORE-04 | P0 | Event idempotency on duplicate callback | Send same event twice with same idempotency key | POST standard events endpoint | First accepted, second marked duplicate, no double count | 100% pass | Not Started | |
| RES-01 | P0 | Adapter timeout degradation | Inject timeout on top priority adapter | Run evaluate call | No crash; route falls back or returns controlled `no_fill` | Timeout handling <= 2500 ms | Not Started | |
| RES-02 | P0 | Adapter 5xx degradation | Inject 5xx response from adapter | Run evaluate call | Request survives; adapter error is logged and tagged | No unhandled exception | Not Started | |
| RES-03 | P1 | Invalid request payload | Missing required request fields | Call evaluate/events with bad payload | HTTP 400 with stable error code | 100% pass | Not Started | |
| RES-04 | P1 | Network jitter and retry behavior | Simulate transient transport error | Run event post with retry policy | Retry happens only for retryable errors; no retry storm | Retry attempts <= 3 per request | Not Started | |
| PERF-01 | P0 | Evaluate latency baseline | Normal load profile | Load test evaluate endpoint | p95 latency <= target_ms | p95 <= 300 ms | Not Started | |
| PERF-02 | P0 | Event ingest latency baseline | Normal load profile | Load test events endpoint | p95 latency <= target_ms | p95 <= 200 ms | Not Started | |
| PERF-03 | P1 | Burst traffic resilience | 2x-3x expected QPS for 5 min | Run burst test | Error rate stays under threshold; autoscaling/degrade works | error_rate <= 1.0% | Not Started | |
| PERF-04 | P1 | Sustained load stability | 60 min at expected peak | Run soak test | No memory leak, no queue backlog growth | RSS growth <= 10% and MQ lag <= 60s | Not Started | |
| DATA-01 | P0 | Decision to event reconciliation | Sample same request set from logs, archive, report | Run reconciliation script | Delta is explainable and under threshold | mismatch <= 1% | Not Started | |
| DATA-02 | P0 | Billing facts consistency | Compare billing records vs archive facts | Daily reconciliation check | Counts and revenue align within tolerance | delta <= 1% | Not Started | |
| DATA-03 | P1 | Replay determinism | Replay archived request set | Run replay API / script | Same input yields same decision envelope (within allowed non-deterministic fields) | deterministic pass >= 99.99% | Not Started | |
| OPS-01 | P0 | Config publish guardrail | Publish staged config with approval | Run config publish flow | Version anchor created; rollout gates enforced | 100% pass | Not Started | |
| OPS-02 | P0 | Rollback drill | Trigger planned rollback from current build | Execute rollback playbook | Service recovers within RTO; metrics normalize | RTO <= 15 min | Not Started | |
| OBS-01 | P0 | Alert routing | Trigger synthetic high error / latency | Fire alert test | P0/P1 alerts page correct channel and owner | 100% pass | Not Started | |
| OBS-02 | P1 | Debug trace completeness | Inspect one failed and one successful request | Check logs/trace ids across modules | End-to-end trace is searchable in one query path | 100% pass | Not Started | |

## 5. Exit Criteria (Go / No-Go)

- [ ] All `P0` rows are `Passed`.
- [ ] `P1` pass rate is at least `95%` (or approved exceptions are documented).
- [ ] No open `Severity 1` or `Severity 2` reliability issue.
- [ ] Reconciliation and rollback evidence are attached.

Decision:

- [ ] Go
- [ ] No-Go

Decision owner: Noah
Date:

## 6. Evidence Index

| Artifact | Location | Owner | Notes |
| --- | --- | --- | --- |
| Test run logs |  |  |  |
| Dashboard screenshots |  |  |  |
| Reconciliation report |  |  |  |
| Rollback drill record |  |  |  |
| Open issue list |  |  |  |

## 7. Common Runtime Failures Checklist

- Port conflict (`EADDRINUSE`) during local gateway start.
- Missing env var or invalid token for managed services.
- Adapter credential mismatch (401/403).
- Queue/topic not created in target environment.
- Redis keyspace TTL drift causing idempotency miss.
- Schema mismatch between request payload and runtime parser.

Use this section to map each failure to: root cause, owner, fix, and retest timestamp.
