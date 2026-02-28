import assert from 'node:assert/strict'
import test from 'node:test'

import { clearNetworkHealthState, clearRuntimeCaches, runAdsRetrievalPipeline } from '../../src/runtime/index.js'

function createRuntimeConfig() {
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

test.beforeEach(() => {
  clearRuntimeCaches()
  clearNetworkHealthState()
})

test('ads runtime keeps multi-network coverage when top candidates tie on relevance', async () => {
  const runtimeConfig = createRuntimeConfig()
  const request = {
    appId: 'sample-client-app',
    sessionId: 'session_network_diversity',
    userId: 'user_network_diversity',
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

  const result = await runAdsRetrievalPipeline(request, {
    runtimeConfig,
    maxAds: 3,
    disableQueryCache: true,
    nerExtractor: async () => ({
      entities: [
        {
          entityText: 'Acme',
          normalizedText: 'acme',
          entityType: 'brand',
          confidence: 0.95,
        },
      ],
    }),
    partnerstackConnector: {
      async fetchOffers() {
        return {
          offers: [createOffer('partnerstack', 1), createOffer('partnerstack', 2), createOffer('partnerstack', 3)],
          debug: {
            mode: 'partnerstack_mock',
          },
        }
      },
    },
    cjConnector: {
      async fetchOffers() {
        return {
          offers: [createOffer('cj', 1), createOffer('cj', 2), createOffer('cj', 3)],
          debug: {
            mode: 'cj_mock',
          },
        }
      },
    },
  })

  assert.equal(result.adResponse.ads.length, 3)
  assert.equal(result.adResponse.ads.some((item) => item.sourceNetwork === 'cj'), true)
  assert.equal(result.adResponse.ads.some((item) => item.sourceNetwork === 'partnerstack'), true)
})
