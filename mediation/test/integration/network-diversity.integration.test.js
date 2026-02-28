import assert from 'node:assert/strict'
import test from 'node:test'

import { clearNetworkHealthState, clearRuntimeCaches, runAdsRetrievalPipeline } from '../../src/runtime/index.js'

function createRuntimeConfig(overrides = {}) {
  return {
    openrouter: {
      apiKey: 'test-openrouter-key',
      model: 'test-openrouter-model',
    },
    partnerstack: {
      apiKey: 'test-partnerstack-key',
    },
    cj: {
      token: 'test-cj-token',
    },
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  }
}

function createOffer(network, index) {
  return {
    sourceNetwork: network,
    sourceType: 'link',
    sourceId: `${network}_offer_${index}`,
    offerId: `${network}:link:${network}_offer_${index}`,
    title: `Acme offer ${index}`,
    description: 'Acme recommendation for finance workflows.',
    targetUrl: `https://${network}.example.com/acme/${index}`,
    trackingUrl: `https://${network}.example.com/track/acme/${index}`,
    availability: 'active',
    entityText: 'Acme',
    normalizedEntityText: 'acme',
    entityType: 'service',
  }
}

function buildAttachRequest(suffix = '') {
  return {
    appId: 'sample-client-app',
    sessionId: `session_network_${suffix || Date.now()}`,
    userId: `user_network_${suffix || Date.now()}`,
    placementId: 'attach.post_answer_render',
    context: {
      query: 'Acme tools for finance workflow',
      answerText: 'Compare Acme offers and recommendations.',
      locale: 'en-US',
      testAllOffers: false,
      debug: {
        disableQueryCache: true,
      },
    },
  }
}

function createNerExtractor() {
  return async () => ({
    entities: [
      {
        entityText: 'Acme',
        normalizedText: 'acme',
        entityType: 'brand',
        confidence: 0.95,
      },
    ],
  })
}

test.beforeEach(() => {
  clearRuntimeCaches()
  clearNetworkHealthState()
})

test('ads runtime: attach placement loads house catalog by default and can serve house result', async () => {
  const runtimeConfig = createRuntimeConfig()
  let cjCalls = 0
  let houseCalls = 0

  const result = await runAdsRetrievalPipeline(buildAttachRequest('attach_house_default'), {
    runtimeConfig,
    maxAds: 3,
    disableQueryCache: true,
    nerExtractor: createNerExtractor(),
    partnerstackConnector: {
      async fetchOffers() {
        return {
          offers: [],
          debug: { mode: 'partnerstack_mock' },
        }
      },
    },
    cjConnector: {
      async fetchOffers() {
        cjCalls += 1
        return {
          offers: [createOffer('cj', 1)],
          debug: { mode: 'cj_mock' },
        }
      },
    },
    houseConnector: {
      async fetchProductOffersCatalog() {
        houseCalls += 1
        return {
          offers: [createOffer('house', 1)],
          debug: { mode: 'house_mock' },
        }
      },
    },
  })

  assert.equal(cjCalls, 0)
  assert.equal(houseCalls, 1)
  assert.deepEqual(result.debug.networkPolicy.enabledNetworks, ['partnerstack', 'house'])
  assert.equal(result.debug.networkFetchState.cj, 'disabled_by_policy')
  assert.equal(result.debug.networkHits.house, 1)
  assert.equal(result.adResponse.ads.length, 1)
  assert.equal(result.adResponse.ads[0].sourceNetwork, 'house')
})

test('ads runtime: cj can be enabled explicitly through network policy', async () => {
  const runtimeConfig = createRuntimeConfig({
    networkPolicy: {
      enabledNetworks: ['partnerstack', 'cj', 'house'],
    },
  })
  let cjCalls = 0

  const result = await runAdsRetrievalPipeline(buildAttachRequest('attach_cj_enabled'), {
    runtimeConfig,
    maxAds: 3,
    disableQueryCache: true,
    nerExtractor: createNerExtractor(),
    partnerstackConnector: {
      async fetchOffers() {
        return { offers: [] }
      },
    },
    cjConnector: {
      async fetchOffers() {
        cjCalls += 1
        return {
          offers: [createOffer('cj', 1)],
        }
      },
    },
    houseConnector: {
      async fetchProductOffersCatalog() {
        return { offers: [] }
      },
    },
  })

  assert.equal(cjCalls, 1)
  assert.equal(result.debug.networkFetchState.cj !== 'disabled_by_policy', true)
  assert.equal(result.debug.networkHits.cj, 1)
  assert.equal(result.adResponse.ads.length, 1)
  assert.equal(result.adResponse.ads[0].sourceNetwork, 'cj')
})

test('ads runtime: house source failure only reports warning and does not crash', async () => {
  const runtimeConfig = createRuntimeConfig()
  const warnings = []

  const result = await runAdsRetrievalPipeline(buildAttachRequest('attach_house_fail'), {
    runtimeConfig,
    maxAds: 3,
    disableQueryCache: true,
    nerExtractor: createNerExtractor(),
    logger: {
      info() {},
      warn(payload) {
        warnings.push(payload)
      },
    },
    partnerstackConnector: {
      async fetchOffers() {
        return { offers: [] }
      },
    },
    houseConnector: {
      async fetchProductOffersCatalog() {
        const error = new Error('house source unavailable')
        error.code = 'HOUSE_SOURCE_DOWN'
        throw error
      },
    },
  })

  assert.equal(Array.isArray(result.adResponse.ads), true)
  assert.equal(result.adResponse.ads.length, 0)
  assert.equal(result.debug.networkHits.house, 0)
  assert.equal(result.debug.networkFetchState.house, 'snapshot_fallback_error')
  assert.equal(
    result.debug.networkErrors.some((item) => item.network === 'house' && item.errorCode === 'HOUSE_SOURCE_DOWN'),
    true,
  )
  assert.equal(
    warnings.some((item) => item?.event === 'ads_pipeline_house_error' && item?.errorCode === 'HOUSE_SOURCE_DOWN'),
    true,
  )
})
