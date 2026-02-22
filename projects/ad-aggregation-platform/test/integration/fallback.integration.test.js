import assert from 'node:assert/strict'
import test from 'node:test'
import { clearNetworkHealthState, clearRuntimeCaches, runAdsRetrievalPipeline } from '../../src/runtime/index.js'

function createRuntimeConfig() {
  return {
    openrouter: {
      apiKey: '',
      model: '',
    },
    partnerstack: {
      apiKey: 'test-partnerstack-key',
    },
    cj: {
      token: 'test-cj-token',
    },
  }
}

function buildRequest(suffix = '') {
  return {
    appId: 'simulator-chatbot',
    sessionId: `session_${suffix || Date.now()}`,
    userId: `user_${suffix || Date.now()}`,
    placementId: 'attach.post_answer_render',
    context: {
      query: `best ai coding tools ${suffix}`.trim(),
      answerText: 'Try a reliable coding agent and review performance.',
      locale: 'en-US',
      testAllOffers: true,
      debug: {
        disableQueryCache: true,
      },
    },
  }
}

function createOffer(network, id) {
  return {
    sourceNetwork: network,
    offerId: id,
    title: `${network} offer ${id}`,
    description: 'Offer description',
    targetUrl: `https://${network}.example.com/${id}`,
    trackingUrl: `https://${network}.example.com/track/${id}`,
    availability: 'active',
    entityText: 'coding tool',
    entityType: 'service',
  }
}

function createFailingError(message, code = 'NETWORK_FAIL') {
  const error = new Error(message)
  error.code = code
  return error
}

test.beforeEach(() => {
  clearRuntimeCaches()
  clearNetworkHealthState()
})

test('fallback baseline: one network failure still serves from healthy network', async () => {
  const runtimeConfig = createRuntimeConfig()
  const request = buildRequest('single_failover')

  const result = await runAdsRetrievalPipeline(request, {
    runtimeConfig,
    disableQueryCache: true,
    partnerstackConnector: {
      async fetchOffers() {
        throw createFailingError('partnerstack down', 'PS_DOWN')
      },
    },
    cjConnector: {
      async fetchOffers() {
        return {
          offers: [createOffer('cj', 'cj_offer_1')],
          debug: {
            mode: 'live',
          },
        }
      },
    },
  })

  assert.equal(Array.isArray(result?.adResponse?.ads), true)
  assert.equal(result.adResponse.ads.length, 1)
  assert.equal(result.adResponse.ads[0].sourceNetwork, 'cj')
  assert.equal(result.debug.networkHits.partnerstack, 0)
  assert.equal(result.debug.networkHits.cj, 1)
  assert.equal(result.debug.snapshotUsage.partnerstack, false)
  assert.equal(result.debug.snapshotCacheStatus.partnerstack, 'snapshot_fallback_error')
  assert.equal(
    result.debug.networkErrors.some((item) => item.network === 'partnerstack' && item.errorCode === 'PS_DOWN'),
    true,
  )
})

test('fallback baseline: all network failures return empty ads without throwing', async () => {
  const runtimeConfig = createRuntimeConfig()
  const request = buildRequest('all_fail_open')

  const result = await runAdsRetrievalPipeline(request, {
    runtimeConfig,
    disableQueryCache: true,
    partnerstackConnector: {
      async fetchOffers() {
        throw createFailingError('partnerstack timeout', 'PS_TIMEOUT')
      },
    },
    cjConnector: {
      async fetchOffers() {
        throw createFailingError('cj timeout', 'CJ_TIMEOUT')
      },
    },
  })

  assert.equal(result.adResponse.ads.length, 0)
  assert.equal(result.debug.totalOffers, 0)
  assert.equal(result.debug.networkHits.partnerstack, 0)
  assert.equal(result.debug.networkHits.cj, 0)
  assert.equal(result.debug.snapshotCacheStatus.partnerstack, 'snapshot_fallback_error')
  assert.equal(result.debug.snapshotCacheStatus.cj, 'snapshot_fallback_error')
  assert.equal(
    result.debug.networkErrors.some((item) => item.network === 'partnerstack' && item.errorCode === 'PS_TIMEOUT'),
    true,
  )
  assert.equal(
    result.debug.networkErrors.some((item) => item.network === 'cj' && item.errorCode === 'CJ_TIMEOUT'),
    true,
  )
})

test('fallback baseline: circuit-open skips live fetch and uses snapshot fallback', async () => {
  const runtimeConfig = createRuntimeConfig()
  const request = buildRequest('circuit_snapshot')
  let partnerstackMode = 'success'
  let partnerstackCalls = 0

  const partnerstackConnector = {
    async fetchOffers() {
      partnerstackCalls += 1
      if (partnerstackMode === 'success') {
        return {
          offers: [createOffer('partnerstack', 'ps_offer_1')],
          debug: {
            mode: 'live',
          },
        }
      }
      throw createFailingError('partnerstack unavailable', 'PS_UNAVAILABLE')
    },
  }

  const cjConnector = {
    async fetchOffers() {
      return {
        offers: [],
        debug: {
          mode: 'live',
        },
      }
    },
  }

  const first = await runAdsRetrievalPipeline(request, {
    runtimeConfig,
    disableQueryCache: true,
    healthFailureThreshold: 1,
    circuitOpenMs: 60000,
    partnerstackConnector,
    cjConnector,
  })
  assert.equal(first.adResponse.ads.length, 1)
  assert.equal(partnerstackCalls, 1)

  partnerstackMode = 'fail'

  const second = await runAdsRetrievalPipeline(request, {
    runtimeConfig,
    disableQueryCache: true,
    healthFailureThreshold: 1,
    circuitOpenMs: 60000,
    partnerstackConnector,
    cjConnector,
  })
  assert.equal(second.adResponse.ads.length, 1)
  assert.equal(second.debug.snapshotUsage.partnerstack, true)
  assert.equal(second.debug.snapshotCacheStatus.partnerstack, 'snapshot_fallback_error')
  assert.equal(partnerstackCalls, 2)
  assert.equal(String(second.debug.networkHealth?.partnerstack?.status || ''), 'open')

  const third = await runAdsRetrievalPipeline(request, {
    runtimeConfig,
    disableQueryCache: true,
    healthFailureThreshold: 1,
    circuitOpenMs: 60000,
    partnerstackConnector,
    cjConnector,
  })
  assert.equal(third.adResponse.ads.length, 1)
  assert.equal(third.debug.snapshotUsage.partnerstack, true)
  assert.equal(third.debug.snapshotCacheStatus.partnerstack, 'circuit_open')
  assert.equal(partnerstackCalls, 2)
  assert.equal(
    third.debug.networkErrors.some((item) => item.network === 'partnerstack' && item.errorCode === 'CIRCUIT_OPEN'),
    true,
  )
})
