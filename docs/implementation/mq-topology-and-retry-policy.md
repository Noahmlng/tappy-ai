# MQ Topology and Retry Policy (INFRA-005)

- Date: 2026-02-21
- Scope: Mediation async lanes (`E->F`, `F->G`, config publish compensation)
- Queue choice for local baseline: NATS JetStream

## 1. Topic/Stream Topology

Required streams:

1. `mediation.e_to_f.events`
   - Source: Module E event output
   - Consumer: F ingest worker
2. `mediation.f_to_g.archive`
   - Source: Module F archive output
   - Consumer: G append/archive worker
3. `mediation.h.publish.jobs`
   - Source: H publish controller
   - Consumer: config-publish worker
4. `mediation.replay.jobs`
   - Source: replay API async mode
   - Consumer: replay worker
5. `mediation.dead_letter`
   - Unified dead-letter stream

## 2. Message Envelope (minimum)

Each message should carry:

1. `messageId`
2. `traceKey`
3. `opportunityKey` (if applicable)
4. `module`
5. `eventType`
6. `payloadDigest`
7. `createdAt`
8. `retryCount`
9. `maxRetries`

## 3. Retry Policy

Default backoff ladder:

1. `1s`
2. `5s`
3. `30s`
4. `120s`
5. `600s`

Policy rules:

1. Retry only when `retryable=true`.
2. Preserve `messageId` and business idempotency keys across retries.
3. Increment only transport-level `retryCount`.
4. After max retries, route to dead-letter stream.

## 4. Dead-Letter Handling

1. All failed terminal messages go to `mediation.dead_letter`.
2. Dead-letter payload must include:
   - `failedStream`
   - `reasonCode`
   - `lastError`
   - `payload`
   - `retryHistory`
3. Dead-letter replay must be explicit operator action.

## 5. Consumer Group Rules

1. One logical consumer group per processing stage:
   - `cg_f_ingest`
   - `cg_g_archive`
   - `cg_h_publish`
   - `cg_replay`
2. At-least-once delivery with idempotent consumer contract.
3. Ordering expectations:
   - Per-key ordering should be guaranteed by partition/subject key when required.

## 6. Monitoring and Alerts

Must-monitor metrics:

1. consumer lag by stream/group
2. retry rate by reason code
3. dead-letter count
4. processing latency (p50/p95/p99)
5. success/failure ratio per worker

P0 alert conditions:

1. lag > 5 minutes sustained
2. dead-letter spike above baseline
3. success ratio drop below threshold

## 7. Capacity Baseline

Initial baseline:

1. `E->F`: peak 600 msg/s
2. `F->G`: peak 400 msg/s
3. `H publish`: low frequency but high criticality
4. `Replay`: low normal traffic, burst during disputes

Scale strategy:

1. Increase worker replicas first.
2. Increase partitions/subjects second.
3. Apply controlled throttling on replay/publish non-critical jobs if needed.

