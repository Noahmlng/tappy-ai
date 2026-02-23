import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdsSdkClient } from '../../src/sdk/client.js'

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type'
          ? 'application/json'
          : null
      },
    },
    async json() {
      return payload
    },
    async text() {
      return JSON.stringify(payload)
    },
  }
}

function createFetchMock({ decisionResult = 'no_fill', ads = [] } = {}) {
  const calls = []

  const fetchImpl = async (url, init = {}) => {
    const parsedUrl = new URL(url, 'http://localhost')
    const method = String(init.method || 'GET').toUpperCase()
    const body = typeof init.body === 'string' && init.body
      ? JSON.parse(init.body)
      : null

    calls.push({
      method,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      body,
    })

    if (parsedUrl.pathname === '/api/v1/mediation/config') {
      return createJsonResponse(200, {
        placements: [
          {
            placementId: 'chat_inline_v1',
            placementKey: 'attach.post_answer_render',
            enabled: true,
          },
        ],
      })
    }

    if (parsedUrl.pathname === '/api/v1/sdk/evaluate') {
      return createJsonResponse(200, {
        requestId: 'adreq_attach_001',
        placementId: 'chat_inline_v1',
        decision: {
          result: decisionResult,
          reason: decisionResult,
          reasonDetail: decisionResult,
        },
        ads,
      })
    }

    if (parsedUrl.pathname === '/api/v1/sdk/events') {
      return createJsonResponse(200, {
        ok: true,
      })
    }

    throw new Error(`unexpected request: ${method} ${parsedUrl.pathname}`)
  }

  return {
    calls,
    fetchImpl,
  }
}

function buildAttachInput() {
  return {
    appId: 'simulator-chatbot',
    sessionId: 'session_attach_001',
    turnId: 'turn_attach_001',
    query: 'Recent upgrade trend for Amazon stock?',
    answerText: 'Analysts recently revised targets upward.',
    intentScore: 0.88,
    locale: 'en-US',
  }
}

test('sdk attach flow: no_fill does not report impression event', async () => {
  const mock = createFetchMock({
    decisionResult: 'no_fill',
    ads: [],
  })

  const sdkClient = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl: mock.fetchImpl,
  })

  const flow = await sdkClient.runAttachFlow(buildAttachInput())
  const eventCalls = mock.calls.filter((item) => item.pathname === '/api/v1/sdk/events')

  assert.equal(flow.decision.result, 'no_fill')
  assert.equal(flow.evidence.events.ok, true)
  assert.equal(flow.evidence.events.skipped, true)
  assert.equal(eventCalls.length, 0)
})

test('sdk attach flow: served decision reports impression with adId', async () => {
  const mock = createFetchMock({
    decisionResult: 'served',
    ads: [
      {
        adId: 'ad_stock_001',
        title: 'Brokerage Bonus Offer',
        description: 'Open an account and get bonus credits.',
        targetUrl: 'https://broker.example.com/bonus',
      },
    ],
  })

  const sdkClient = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl: mock.fetchImpl,
  })

  const flow = await sdkClient.runAttachFlow(buildAttachInput())
  const eventCalls = mock.calls.filter((item) => item.pathname === '/api/v1/sdk/events')

  assert.equal(flow.decision.result, 'served')
  assert.equal(flow.evidence.events.ok, true)
  assert.equal(flow.evidence.events.skipped, false)
  assert.equal(eventCalls.length, 1)
  assert.equal(eventCalls[0].body.kind, 'impression')
  assert.equal(eventCalls[0].body.adId, 'ad_stock_001')
  assert.equal(eventCalls[0].body.placementId, 'chat_inline_v1')
})
