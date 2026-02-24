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

    if (parsedUrl.pathname === '/api/v2/bid') {
      const firstAd = Array.isArray(ads) ? ads[0] : null
      const served = decisionResult === 'served' && Boolean(firstAd)
      const bid = served
        ? {
          price: 1.24,
          advertiser: 'Mock Advertiser',
          headline: String(firstAd.title || 'Mock headline'),
          description: String(firstAd.description || ''),
          cta_text: 'Learn more',
          url: String(firstAd.targetUrl || 'https://example.com'),
          image_url: '',
          dsp: 'mock-dsp',
          bidId: String(firstAd.adId || 'ad_mock_001'),
          placement: 'CHAT_INLINE',
          variant: 'base',
        }
        : null
      return createJsonResponse(200, {
        requestId: 'adreq_attach_001',
        timestamp: '2026-01-01T00:00:00.000Z',
        status: 'success',
        message: bid ? 'Bid successful' : 'No bid',
        data: {
          bid,
        },
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

function createNextStepFetchMock({ decisionResult = 'served', ads = [] } = {}) {
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
            placementId: 'chat_followup_v1',
            placementKey: 'next_step.intent_card',
            enabled: true,
          },
        ],
      })
    }

    if (parsedUrl.pathname === '/api/v2/bid') {
      const firstAd = Array.isArray(ads) ? ads[0] : null
      const served = decisionResult === 'served' && Boolean(firstAd)
      const bid = served
        ? {
          price: 2.11,
          advertiser: 'Mock Advertiser',
          headline: String(firstAd.title || 'Mock headline'),
          description: String(firstAd.snippet || firstAd.description || ''),
          cta_text: 'Learn more',
          url: String(firstAd.target_url || firstAd.targetUrl || 'https://example.com'),
          image_url: '',
          dsp: 'mock-dsp',
          bidId: String(firstAd.item_id || firstAd.itemId || firstAd.adId || 'next_item_001'),
          placement: 'FOLLOW_UP',
          variant: 'base',
        }
        : null
      return createJsonResponse(200, {
        requestId: 'adreq_next_step_001',
        timestamp: '2026-01-01T00:00:00.000Z',
        status: 'success',
        message: bid ? 'Bid successful' : 'No bid',
        data: {
          bid,
        },
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

function buildNextStepInput() {
  return {
    appId: 'simulator-chatbot',
    sessionId: 'session_next_step_001',
    turnId: 'turn_next_step_001',
    userId: 'user_next_step_001',
    event: 'followup_generation',
    placementId: 'chat_followup_v1',
    placementKey: 'next_step.intent_card',
    context: {
      query: 'Recent upgrade trend for Amazon stock?',
      answerText: 'Analysts recently revised targets upward.',
      locale: 'en-US',
      intent_class: 'shopping',
      intent_score: 0.88,
      preference_facets: [],
    },
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

test('sdk next_step flow: served decision reports impression with kind and adId', async () => {
  const mock = createNextStepFetchMock({
    decisionResult: 'served',
    ads: [
      {
        item_id: 'next_item_001',
        title: 'Brokerage Bonus Offer',
        snippet: 'Open an account and get bonus credits.',
        target_url: 'https://broker.example.com/bonus',
      },
    ],
  })

  const sdkClient = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl: mock.fetchImpl,
  })

  const flow = await sdkClient.runNextStepFlow(buildNextStepInput())
  const eventCalls = mock.calls.filter((item) => item.pathname === '/api/v1/sdk/events')

  assert.equal(flow.decision.result, 'served')
  assert.equal(flow.evidence.events.ok, true)
  assert.equal(flow.evidence.events.skipped, false)
  assert.equal(eventCalls.length, 1)
  assert.equal(eventCalls[0].body.kind, 'impression')
  assert.equal(eventCalls[0].body.adId, 'next_item_001')
  assert.equal(eventCalls[0].body.placementId, 'chat_followup_v1')
  assert.equal(eventCalls[0].body.placementKey, 'next_step.intent_card')
})
