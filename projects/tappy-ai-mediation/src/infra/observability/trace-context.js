import crypto from 'node:crypto'

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
}

function normalizeTraceContext(input = {}) {
  return {
    traceKey: String(input.traceKey || '').trim(),
    requestKey: String(input.requestKey || '').trim(),
    opportunityKey: String(input.opportunityKey || '').trim(),
    spanId: String(input.spanId || '').trim(),
    parentSpanId: String(input.parentSpanId || '').trim()
  }
}

function createTraceContext(seed = {}) {
  const normalizedSeed = normalizeTraceContext(seed)

  return {
    traceKey: normalizedSeed.traceKey || randomId('trace'),
    requestKey: normalizedSeed.requestKey || randomId('request'),
    opportunityKey: normalizedSeed.opportunityKey || '',
    spanId: normalizedSeed.spanId || randomId('span'),
    parentSpanId: normalizedSeed.parentSpanId || ''
  }
}

function createChildTraceContext(parentContext = {}, overrides = {}) {
  const parent = createTraceContext(parentContext)
  const next = createTraceContext({
    traceKey: parent.traceKey,
    requestKey: parent.requestKey,
    opportunityKey: parent.opportunityKey,
    parentSpanId: parent.spanId,
    ...overrides,
    spanId: ''
  })

  return {
    ...next,
    parentSpanId: parent.spanId
  }
}

function traceContextToHeaders(context = {}) {
  const traceContext = createTraceContext(context)

  return {
    'x-trace-key': traceContext.traceKey,
    'x-request-key': traceContext.requestKey,
    'x-opportunity-key': traceContext.opportunityKey,
    'x-span-id': traceContext.spanId,
    'x-parent-span-id': traceContext.parentSpanId
  }
}

function headersToTraceContext(headers = {}) {
  const source = headers && typeof headers === 'object' ? headers : {}

  return createTraceContext({
    traceKey: source['x-trace-key'],
    requestKey: source['x-request-key'],
    opportunityKey: source['x-opportunity-key'],
    spanId: source['x-span-id'],
    parentSpanId: source['x-parent-span-id']
  })
}

export {
  createChildTraceContext,
  createTraceContext,
  headersToTraceContext,
  normalizeTraceContext,
  traceContextToHeaders
}
