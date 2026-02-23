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

test.beforeEach(() => {
  clearRuntimeCaches()
  clearNetworkHealthState()
})

test('relevance guard: finance intent blocks cloud-only ad matches', async () => {
  const runtimeConfig = createRuntimeConfig()
  const request = {
    appId: 'simulator-chatbot',
    sessionId: 'session_finance_relevance_guard',
    userId: 'user_finance_relevance_guard',
    placementId: 'attach.post_answer_render',
    context: {
      query: 'Recent upgrade trend for Amazon stock?',
      answerText: 'Analysts discussed AWS cloud growth and operating margin.',
      locale: 'en-US',
      testAllOffers: false,
      debug: {
        disableQueryCache: true,
      },
    },
  }

  const result = await runAdsRetrievalPipeline(request, {
    runtimeConfig,
    disableQueryCache: true,
    nerExtractor: async () => ({
      entities: [
        {
          entityText: 'Amazon',
          normalizedText: 'Amazon',
          entityType: 'brand',
          confidence: 0.95,
        },
      ],
    }),
    partnerstackConnector: {
      async fetchOffers() {
        return {
          offers: [
            {
              sourceNetwork: 'partnerstack',
              sourceType: 'link',
              sourceId: 'ps_aws_offer',
              offerId: 'partnerstack:link:ps_aws_offer',
              title: 'Amazon Web Services',
              description: 'Cloud infrastructure platform for builders.',
              targetUrl: 'https://aws.amazon.com',
              trackingUrl: 'https://aws.amazon.com',
              availability: 'active',
              entityText: 'Amazon',
              entityType: 'service',
            },
          ],
          debug: {
            mode: 'live',
          },
        }
      },
    },
    cjConnector: {
      async fetchOffers() {
        return {
          offers: [],
          debug: {
            mode: 'live',
          },
        }
      },
    },
  })

  assert.equal(result.debug.totalOffers, 1)
  assert.equal(result.debug.semanticFilteredOut, 1)
  assert.equal(result.debug.matchedCandidates, 0)
  assert.equal(result.adResponse.ads.length, 0)
})
