import assert from 'node:assert/strict'
import test from 'node:test'
import { clearNetworkHealthState, clearRuntimeCaches, runAdsRetrievalPipeline } from '../../src/runtime/index.js'
import { rankOpportunityCandidates } from '../../src/runtime/opportunity-ranking.js'

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
    appId: 'sample-client-app',
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

test('relevance guard: v2 intent placement drops low lexical and low vector candidates', () => {
  const ranked = rankOpportunityCandidates({
    placementId: 'chat_intent_recommendation_v1',
    query: 'buy natural resource stocks',
    answerText: 'looking for investment platforms',
    intentScore: 0.82,
    scoreFloor: 0.38,
    minLexicalScore: 0.02,
    minVectorScore: 0.35,
    candidates: [
      {
        offerId: 'partnerstack:link:taxcycle',
        network: 'partnerstack',
        title: 'TaxCycle',
        description: 'Tax filing tool for accountants',
        targetUrl: 'https://example.com/taxcycle',
        availability: 'active',
        quality: 0.94,
        bidHint: 8.8,
        policyWeight: 0.1,
        lexicalScore: 0,
        vectorScore: 0.11,
        fusedScore: 0.92,
      },
    ],
  })

  assert.equal(ranked.reasonCode, 'relevance_blocked_strict')
  assert.equal(ranked.winner, null)
  assert.equal(ranked.debug.relevanceFilteredCount, 1)
  assert.equal(ranked.debug.relevanceGate?.applied, true)
  assert.equal(ranked.debug.relevanceDebug?.gateStage, 'blocked')
  assert.equal(ranked.debug.relevanceDebug?.blockedReason, 'relevance_blocked_strict')
  assert.equal(typeof ranked.debug.relevanceDebug?.thresholdsApplied?.strict, 'number')
  assert.equal(typeof ranked.debug.relevanceDebug?.thresholdsApplied?.relaxed, 'number')
})
