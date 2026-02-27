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

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('sdk client exposes only modern integration methods', () => {
  const sdk = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl: async () => createJsonResponse(200, {}),
  })

  assert.equal(typeof sdk.requestBid, 'function')
  assert.equal(typeof sdk.reportEvent, 'function')
  assert.equal(typeof sdk.runChatTurnWithAd, 'function')
  assert.equal(Object.prototype.hasOwnProperty.call(sdk, 'runManagedFlow'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(sdk, 'runAttachFlow'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(sdk, 'runNextStepFlow'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(sdk, 'fetchConfig'), false)
})

test('requestBid ignores placementId override and posts v2 canonical payload', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsedUrl = new URL(url, 'http://localhost')
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {}
    calls.push({ pathname: parsedUrl.pathname, body })
    if (parsedUrl.pathname === '/api/v2/bid') {
      return createJsonResponse(200, {
        requestId: 'adreq_sdk_bid_001',
        status: 'success',
        message: 'No bid',
        data: { bid: null },
      })
    }
    throw new Error(`unexpected request: ${parsedUrl.pathname}`)
  }

  const sdk = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl,
  })

  const result = await sdk.requestBid({
    userId: 'user_sdk_bid_001',
    chatId: 'chat_sdk_bid_001',
    placementId: 'chat_intent_recommendation_v1',
    messages: [{ role: 'user', content: 'best cashback card offer' }],
  })

  const bidCall = calls.find((item) => item.pathname === '/api/v2/bid')
  assert.equal(Boolean(bidCall), true)
  assert.equal(Object.prototype.hasOwnProperty.call(bidCall.body || {}, 'placementId'), false)
  assert.equal(result.status, 'success')
  assert.equal(result.message, 'No bid')
})

test('runChatTurnWithAd keeps fastPath behavior and emits bid diagnostics', async () => {
  const callTimestamps = {
    bidCalledAt: 0,
    chatResolvedAt: 0,
  }
  const chatDone = createDeferred()

  const fetchImpl = async (url) => {
    const parsedUrl = new URL(url, 'http://localhost')
    if (parsedUrl.pathname === '/api/v1/mediation/config') {
      return createJsonResponse(200, {
        placements: [
          {
            placementId: 'chat_from_answer_v1',
            placementKey: 'attach.post_answer_render',
            enabled: true,
          },
        ],
      })
    }
    if (parsedUrl.pathname === '/api/v2/bid') {
      callTimestamps.bidCalledAt = Date.now()
      return createJsonResponse(200, {
        requestId: 'adreq_fastpath_001',
        status: 'success',
        message: 'No bid',
        data: { bid: null },
      })
    }
    if (parsedUrl.pathname === '/api/v1/sdk/events') {
      return createJsonResponse(200, { ok: true })
    }
    throw new Error(`unexpected request: ${parsedUrl.pathname}`)
  }

  const sdk = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl,
  })

  const turnPromise = sdk.runChatTurnWithAd({
    appId: 'sample-client-app',
    userId: 'user_fastpath_001',
    chatId: 'chat_fastpath_001',
    bidPayload: {
      userId: 'user_fastpath_001',
      chatId: 'chat_fastpath_001',
      messages: [{ role: 'user', content: 'best broker offer' }],
    },
    chatDonePromise: chatDone.promise,
  })

  await new Promise((resolve) => setTimeout(resolve, 10))
  callTimestamps.chatResolvedAt = Date.now()
  chatDone.resolve()
  const flow = await turnPromise

  assert.equal(flow.diagnostics.fastPath, true)
  assert.equal(flow.diagnostics.bidProbeStatus, 'seen')
  assert.equal(flow.evidence.bid.ok, true)
  assert.equal(callTimestamps.bidCalledAt > 0, true)
  assert.equal(callTimestamps.bidCalledAt <= callTimestamps.chatResolvedAt, true)
})

test('runChatTurnWithAd with fastPath=false waits for chat completion', async () => {
  const callTimestamps = {
    bidCalledAt: 0,
    chatResolvedAt: 0,
  }
  const chatDone = createDeferred()

  const fetchImpl = async (url) => {
    const parsedUrl = new URL(url, 'http://localhost')
    if (parsedUrl.pathname === '/api/v1/mediation/config') {
      return createJsonResponse(200, {
        placements: [
          {
            placementId: 'chat_from_answer_v1',
            placementKey: 'attach.post_answer_render',
            enabled: true,
          },
        ],
      })
    }
    if (parsedUrl.pathname === '/api/v2/bid') {
      callTimestamps.bidCalledAt = Date.now()
      return createJsonResponse(200, {
        requestId: 'adreq_slowpath_001',
        status: 'success',
        message: 'No bid',
        data: { bid: null },
      })
    }
    throw new Error(`unexpected request: ${parsedUrl.pathname}`)
  }

  const sdk = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl,
  })

  const turnPromise = sdk.runChatTurnWithAd({
    appId: 'sample-client-app',
    userId: 'user_slowpath_001',
    chatId: 'chat_slowpath_001',
    bidPayload: {
      userId: 'user_slowpath_001',
      chatId: 'chat_slowpath_001',
      messages: [{ role: 'user', content: 'best broker offer' }],
    },
    fastPath: false,
    chatDonePromise: chatDone.promise,
  })

  await new Promise((resolve) => setTimeout(resolve, 10))
  callTimestamps.chatResolvedAt = Date.now()
  chatDone.resolve()
  const flow = await turnPromise

  assert.equal(flow.diagnostics.fastPath, false)
  assert.equal(flow.diagnostics.bidProbeStatus, 'seen')
  assert.equal(callTimestamps.bidCalledAt > 0, true)
  assert.equal(callTimestamps.bidCalledAt >= callTimestamps.chatResolvedAt, true)
})

test('runChatTurnWithAd fails open on bid timeout and does not block chat flow', async () => {
  const fetchImpl = async (url) => {
    const parsedUrl = new URL(url, 'http://localhost')
    if (parsedUrl.pathname === '/api/v1/mediation/config') {
      return createJsonResponse(200, {
        placements: [
          {
            placementId: 'chat_from_answer_v1',
            placementKey: 'attach.post_answer_render',
            enabled: true,
          },
        ],
      })
    }
    if (parsedUrl.pathname === '/api/v2/bid') {
      throw new Error('network timeout while requesting bid')
    }
    throw new Error(`unexpected request: ${parsedUrl.pathname}`)
  }

  const sdk = createAdsSdkClient({
    apiBaseUrl: '/api',
    fetchImpl,
  })

  const flow = await sdk.runChatTurnWithAd({
    appId: 'sample-client-app',
    userId: 'user_timeout_001',
    chatId: 'chat_timeout_001',
    bidPayload: {
      userId: 'user_timeout_001',
      chatId: 'chat_timeout_001',
      messages: [{ role: 'user', content: 'best broker offer' }],
    },
  })

  assert.equal(flow.failOpenApplied, true)
  assert.equal(flow.decision.result, 'no_fill')
  assert.equal(flow.decision.reasonDetail, 'bid_timeout_fail_open')
  assert.equal(flow.evidence.bid.ok, false)
})
