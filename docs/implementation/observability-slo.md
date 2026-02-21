# Observability and SLO Baseline (INFRA-007)

- Date: 2026-02-21
- Scope: request path, event ingest path, archive path, replay path, publish path

## 1. SLI/SLO Contract

Tracked SLI:

1. `request_availability` >= 99.9%
2. `event_ack_success` >= 99.9%
3. `closed_loop_completion` >= 99.5%
4. `replay_determinism` >= 99.99%
5. `publish_success` >= 99.5%

Budget window: 30 days rolling + 1 day burn-rate dashboard.

## 2. Telemetry Structure

1. Logging:
   - JSON structured logs only
   - sensitive fields redacted (`token`, `secret`, `password`, `authorization`, `api_key`)
   - mandatory dimensions: `traceKey`, `requestKey`, `module`, `reasonCode`
2. Metrics:
   - counters: request/event/archive/publish/replay success/failure
   - gauges: MQ lag, worker backlog, dead-letter queue size
   - histogram: request latency and async stage latency (`p50/p95/p99`)
3. Tracing:
   - context propagation via headers:
     - `x-trace-key`
     - `x-request-key`
     - `x-opportunity-key`
     - `x-span-id`
     - `x-parent-span-id`

## 3. Alert Levels

P0 alerts:

1. MQ lag > 300s
2. DLQ records >= 100
3. replay determinism SLO breached

P1 alerts:

1. any non-determinism SLO breach except replay determinism
2. DLQ records >= 20
3. sustained SLI drop below target

P2 alerts:

1. metric ingestion delay
2. log sink backpressure

## 4. Oncall Actions (minimum)

1. P0: freeze publish traffic and switch to safe profile.
2. P0: prioritize drain for `mediation.dead_letter` and run replay diagnostics.
3. P1: investigate top reason codes and recent config publish operations.
4. P2: track during business hours and include in weekly reliability review.

## 5. Validation Gate

1. `npm --prefix ./projects/ad-aggregation-platform run test:integration -- observability`
2. Alert routing test proves P0/P1 classification is deterministic.
3. Log redaction tests prove sensitive fields never leak in structured output.
