import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ALERT_LEVELS,
  SLI_KEYS,
  buildAlertDecisions,
  createChildTraceContext,
  createMetricsRegistry,
  createStructuredLogger,
  createTraceContext,
  traceContextToHeaders,
  headersToTraceContext
} from '../../src/infra/observability/index.js'

test('observability: metrics registry records counter gauge and latency histogram', () => {
  const metrics = createMetricsRegistry()

  metrics.incCounter('event_ingest_success_total', 2, { module: 'F' })
  metrics.incCounter('event_ingest_success_total', 3, { module: 'F' })
  metrics.setGauge('mq_lag_seconds', 120, { stream: 'mediation.e_to_f.events' })
  metrics.observeHistogram('request_latency_ms', 80, { endpoint: '/opportunity' })
  metrics.observeHistogram('request_latency_ms', 120, { endpoint: '/opportunity' })
  metrics.observeHistogram('request_latency_ms', 200, { endpoint: '/opportunity' })

  assert.equal(metrics.getCounter('event_ingest_success_total', { module: 'F' }), 5)
  assert.equal(metrics.getGauge('mq_lag_seconds', { stream: 'mediation.e_to_f.events' }), 120)

  const summary = metrics.getHistogramSummary('request_latency_ms', { endpoint: '/opportunity' })
  assert.equal(summary.count, 3)
  assert.equal(summary.p50, 120)
  assert.equal(summary.p95, 200)
})

test('observability: alert decision emits P0 when lag and DLQ are critical', () => {
  const decision = buildAlertDecisions({
    sliSnapshot: {
      [SLI_KEYS.REQUEST_AVAILABILITY]: 0.999,
      [SLI_KEYS.EVENT_ACK_SUCCESS]: 0.999,
      [SLI_KEYS.CLOSED_LOOP_COMPLETION]: 0.996,
      [SLI_KEYS.REPLAY_DETERMINISM]: 0.99995,
      [SLI_KEYS.PUBLISH_SUCCESS]: 0.996
    },
    queueLagSeconds: 420,
    deadLetterCount: 130
  })

  assert.equal(decision.pass, false)
  assert.equal(decision.summary.p0 >= 2, true)
  assert.equal(decision.alerts.some((item) => item.code === 'MQ_LAG_TOO_HIGH' && item.level === ALERT_LEVELS.P0), true)
  assert.equal(decision.alerts.some((item) => item.code === 'DLQ_SPIKE' && item.level === ALERT_LEVELS.P0), true)
})

test('observability: logger redacts secrets from structured payload', () => {
  const output = []
  const logger = createStructuredLogger({
    service: 'mediation-api',
    environment: 'test',
    sink(line) {
      output.push(JSON.parse(line))
    }
  })

  logger.info('auth deny', {
    traceKey: 'trace_123',
    authorization: 'Bearer abc',
    nested: {
      apiKey: 'k-123',
      token: 'foo'
    }
  })

  assert.equal(output.length, 1)
  assert.equal(output[0].fields.authorization, '[REDACTED]')
  assert.equal(output[0].fields.nested.apiKey, '[REDACTED]')
  assert.equal(output[0].fields.nested.token, '[REDACTED]')
})

test('observability: trace context propagates parent child linkage', () => {
  const parent = createTraceContext({
    traceKey: 'trace_fixed',
    requestKey: 'request_fixed',
    opportunityKey: 'opp_fixed'
  })

  const child = createChildTraceContext(parent)
  const headers = traceContextToHeaders(child)
  const restored = headersToTraceContext(headers)

  assert.equal(restored.traceKey, 'trace_fixed')
  assert.equal(restored.requestKey, 'request_fixed')
  assert.equal(restored.parentSpanId, child.parentSpanId)
  assert.notEqual(restored.spanId, parent.spanId)
})
