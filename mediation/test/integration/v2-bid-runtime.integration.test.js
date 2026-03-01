import assert from 'node:assert/strict'
import test from 'node:test'

import { runBidAggregationPipeline } from '../../src/runtime/index.js'
import { retrieveOpportunityCandidates } from '../../src/runtime/opportunity-retrieval.js'

function makeOffer({ network, offerId, price, quality = 0 }) {
  return {
    offerId,
    sourceNetwork: network,
    sourceType: 'offer',
    title: `${network} offer ${offerId}`,
    description: 'mock offer',
    targetUrl: `https://${network}.example.com/${offerId}`,
    trackingUrl: `https://${network}.example.com/click/${offerId}`,
    entityText: network,
    entityType: 'service',
    qualityScore: quality,
    bidValue: price,
  }
}

function makeInventoryRow({
  offerId,
  network,
  title,
  description,
  targetUrl,
  language = 'en-US',
  tags = [],
  lexicalScore = 0,
  vectorScore = 0,
}) {
  return {
    offer_id: offerId,
    network,
    upstream_offer_id: `${offerId}:upstream`,
    title,
    description,
    target_url: targetUrl,
    market: 'US',
    language,
    availability: 'active',
    quality: 0.8,
    bid_hint: 1.2,
    policy_weight: 0.1,
    freshness_at: '2026-02-26T00:00:00.000Z',
    tags,
    metadata: {},
    updated_at: '2026-02-26T00:00:00.000Z',
    lexical_score: lexicalScore,
    vector_score: vectorScore,
  }
}

test('v2 bid runtime: picks highest priced bid as winner', async () => {
  const connectors = new Map([
    ['partnerstack', {
      async fetchOffers() {
        return {
          offers: [makeOffer({ network: 'partnerstack', offerId: 'ps_1', price: 1.2, quality: 0.5 })],
        }
      },
    }],
    ['cj', {
      async fetchOffers() {
        return {
          offers: [makeOffer({ network: 'cj', offerId: 'cj_1', price: 2.7, quality: 0.4 })],
        }
      },
    }],
    ['house', {
      async fetchProductOffersCatalog() {
        return { offers: [] }
      },
    }],
  ])

  const result = await runBidAggregationPipeline({
    requestId: 'req_highest_price',
    placementId: 'chat_from_answer_v1',
    placement: {
      placementId: 'chat_from_answer_v1',
      bidders: [
        { networkId: 'partnerstack', timeoutMs: 800, enabled: true, policyWeight: 0 },
        { networkId: 'cj', timeoutMs: 800, enabled: true, policyWeight: 0 },
      ],
      fallback: { store: { enabled: false, floorPrice: 0 } },
      maxFanout: 3,
      globalTimeoutMs: 1200,
    },
    messages: [{ role: 'user', content: 'best camera for vlog' }],
  }, {
    connectors,
  })

  assert.equal(Boolean(result.winnerBid), true)
  assert.equal(result.winnerBid.dsp, 'cj')
  assert.equal(result.winnerBid.price, 2.7)
})

test('v2 bid runtime: tie breaks by policy weight then networkId', async () => {
  const connectors = new Map([
    ['partnerstack', {
      async fetchOffers() {
        return {
          offers: [makeOffer({ network: 'partnerstack', offerId: 'ps_tie', price: 3, quality: 0.8 })],
        }
      },
    }],
    ['cj', {
      async fetchOffers() {
        return {
          offers: [makeOffer({ network: 'cj', offerId: 'cj_tie', price: 3, quality: 0.8 })],
        }
      },
    }],
    ['house', {
      async fetchProductOffersCatalog() {
        return { offers: [] }
      },
    }],
  ])

  const weighted = await runBidAggregationPipeline({
    requestId: 'req_tie_policy_weight',
    placementId: 'chat_from_answer_v1',
    placement: {
      placementId: 'chat_from_answer_v1',
      bidders: [
        { networkId: 'partnerstack', timeoutMs: 800, enabled: true, policyWeight: 0.3 },
        { networkId: 'cj', timeoutMs: 800, enabled: true, policyWeight: 0.1 },
      ],
      fallback: { store: { enabled: false, floorPrice: 0 } },
      maxFanout: 3,
      globalTimeoutMs: 1200,
    },
    messages: [{ role: 'user', content: 'buy gifts' }],
  }, {
    connectors,
  })

  assert.equal(weighted.winnerBid.dsp, 'partnerstack')

  const lexical = await runBidAggregationPipeline({
    requestId: 'req_tie_lexical',
    placementId: 'chat_from_answer_v1',
    placement: {
      placementId: 'chat_from_answer_v1',
      bidders: [
        { networkId: 'partnerstack', timeoutMs: 800, enabled: true, policyWeight: 0 },
        { networkId: 'cj', timeoutMs: 800, enabled: true, policyWeight: 0 },
      ],
      fallback: { store: { enabled: false, floorPrice: 0 } },
      maxFanout: 3,
      globalTimeoutMs: 1200,
    },
    messages: [{ role: 'user', content: 'buy gifts' }],
  }, {
    connectors,
  })

  assert.equal(lexical.winnerBid.dsp, 'cj')
})

test('v2 bid runtime: retrieval language policy locale_or_base keeps house en for en-US request', async () => {
  const languageFilters = []
  const pool = {
    async query(sql, params) {
      languageFilters.push(params[3])
      if (String(sql).includes('websearch_to_tsquery')) {
        return {
          rows: [
            makeInventoryRow({
              offerId: 'house:resource:001',
              network: 'house',
              title: 'Natural Resource Broker',
              description: 'Buy commodity and mining stocks on one platform.',
              targetUrl: 'https://house.example.com/resource',
              language: 'en',
              lexicalScore: 0.21,
            }),
          ],
        }
      }
      return {
        rows: [
          makeInventoryRow({
            offerId: 'partnerstack:stocks:001',
            network: 'partnerstack',
            title: 'Global Stocks Platform',
            description: 'Research and trade resource equities.',
            targetUrl: 'https://partner.example.com/stocks',
            language: 'en-US',
            vectorScore: 0.56,
          }),
        ],
      }
    },
  }

  const result = await retrieveOpportunityCandidates({
    query: 'where can i buy natural resource stocks',
    filters: {
      networks: ['partnerstack', 'house'],
      market: 'US',
      language: 'en-US',
    },
    languageMatchMode: 'locale_or_base',
    houseLowInfoFilterEnabled: false,
    lexicalTopK: 10,
    vectorTopK: 10,
    finalTopK: 10,
  }, {
    pool,
  })

  assert.deepEqual(languageFilters[0], ['en-us', 'en'])
  assert.deepEqual(languageFilters[1], ['en-us', 'en'])
  assert.equal(result.debug.languageMatchMode, 'locale_or_base')
  assert.deepEqual(result.debug.languageResolved.accepted, ['en-us', 'en'])
  assert.equal(result.debug.networkCandidateCountsBeforeFilter.house > 0, true)
})

test('v2 bid runtime: retrieval low-info house candidates are filtered before ranking', async () => {
  const pool = {
    async query(sql) {
      if (String(sql).includes('websearch_to_tsquery')) {
        return {
          rows: [
            makeInventoryRow({
              offerId: 'house:synthetic:001',
              network: 'house',
              title: 'Generic Offer',
              description: 'Option with strong category relevance and direct shopping intent.',
              targetUrl: 'https://house.example.com/generic',
              language: 'en',
              tags: ['synthetic', 'finance'],
              lexicalScore: 0.01,
            }),
            makeInventoryRow({
              offerId: 'partnerstack:broker:001',
              network: 'partnerstack',
              title: 'Commodity Trading Platform',
              description: 'Compare broker plans and trading tools.',
              targetUrl: 'https://partner.example.com/broker',
              language: 'en-US',
              lexicalScore: 0.09,
            }),
          ],
        }
      }
      return { rows: [] }
    },
  }

  const result = await retrieveOpportunityCandidates({
    query: 'platforms to buy natural resource stocks',
    filters: {
      networks: ['partnerstack', 'house'],
      market: 'US',
      language: 'en-US',
    },
    languageMatchMode: 'locale_or_base',
    minLexicalScore: 0.02,
    houseLowInfoFilterEnabled: true,
    lexicalTopK: 10,
    vectorTopK: 10,
    finalTopK: 10,
  }, {
    pool,
  })

  assert.equal(result.debug.networkCandidateCountsBeforeFilter.house > 0, true)
  assert.equal(result.debug.networkCandidateCountsAfterFilter.house, 0)
  assert.equal(result.debug.houseLowInfoFilteredCount > 0, true)
  assert.equal(result.candidates.some((item) => String(item.network).toLowerCase() === 'house'), false)
})

test('v2 bid runtime: retrieval hybrid fusion reranks by sparse+dense and keeps rrfScore', async () => {
  const pool = {
    async query(sql) {
      if (String(sql).includes('websearch_to_tsquery')) {
        return {
          rows: [
            makeInventoryRow({
              offerId: 'partnerstack:brand:strong_lexical',
              network: 'partnerstack',
              title: 'Murf AI Voice Tools',
              description: 'AI voice generation for multilingual dubbing.',
              targetUrl: 'https://partner.example.com/murf',
              lexicalScore: 0.9,
              vectorScore: 0.2,
            }),
            makeInventoryRow({
              offerId: 'partnerstack:generic:strong_dense',
              network: 'partnerstack',
              title: 'Generic Sales Platform',
              description: 'General business lead management software.',
              targetUrl: 'https://partner.example.com/generic',
              lexicalScore: 0.1,
              vectorScore: 0.95,
            }),
          ],
        }
      }
      return {
        rows: [
          makeInventoryRow({
            offerId: 'partnerstack:generic:strong_dense',
            network: 'partnerstack',
            title: 'Generic Sales Platform',
            description: 'General business lead management software.',
            targetUrl: 'https://partner.example.com/generic',
            lexicalScore: 0.1,
            vectorScore: 0.95,
          }),
          makeInventoryRow({
            offerId: 'partnerstack:brand:strong_lexical',
            network: 'partnerstack',
            title: 'Murf AI Voice Tools',
            description: 'AI voice generation for multilingual dubbing.',
            targetUrl: 'https://partner.example.com/murf',
            lexicalScore: 0.9,
            vectorScore: 0.2,
          }),
        ],
      }
    },
  }

  const result = await retrieveOpportunityCandidates({
    query: 'how do you feel about murf ai and elevenlabs',
    queryMode: 'latest_user_plus_entities',
    filters: {
      networks: ['partnerstack'],
      market: 'US',
      language: 'en-US',
    },
    languageMatchMode: 'locale_or_base',
    lexicalTopK: 10,
    vectorTopK: 10,
    finalTopK: 10,
    hybridSparseWeight: 0.65,
    hybridDenseWeight: 0.35,
  }, {
    pool,
  })

  assert.equal(result.candidates.length, 2)
  assert.equal(result.candidates[0].offerId, 'partnerstack:brand:strong_lexical')
  assert.equal(result.candidates[0].fusedScore > result.candidates[1].fusedScore, true)
  assert.equal(typeof result.candidates[0].rrfScore, 'number')
  assert.equal(typeof result.debug?.scoring, 'object')
  assert.equal(result.debug?.scoring?.strategy, 'rrf_then_linear')
  assert.equal(result.debug?.scoring?.sparseWeight, 0.65)
  assert.equal(result.debug?.scoring?.denseWeight, 0.35)
  assert.equal(result.debug?.queryMode, 'latest_user_plus_entities')
  assert.equal(typeof result.debug?.queryUsed, 'string')
  assert.equal(typeof result.debug?.scoreStats?.sparseMin, 'number')
  assert.equal(typeof result.debug?.scoreStats?.sparseMax, 'number')
  assert.equal(typeof result.debug?.scoreStats?.denseMin, 'number')
  assert.equal(typeof result.debug?.scoreStats?.denseMax, 'number')
})

test('v2 bid runtime: retrieval hybrid normalizes invalid weights and returns score stats', async () => {
  const pool = {
    async query(sql) {
      if (String(sql).includes('websearch_to_tsquery')) {
        return { rows: [] }
      }
      return {
        rows: [
          makeInventoryRow({
            offerId: 'partnerstack:vector:001',
            network: 'partnerstack',
            title: 'ElevenLabs Voice AI',
            description: 'Voice cloning and dubbing API.',
            targetUrl: 'https://partner.example.com/elevenlabs',
            lexicalScore: 0,
            vectorScore: 0.4,
          }),
        ],
      }
    },
  }

  const result = await retrieveOpportunityCandidates({
    query: 'elevenlabs voice dubbing tool',
    queryMode: 'latest_user_plus_entities',
    filters: {
      networks: ['partnerstack'],
      market: 'US',
      language: 'en-US',
    },
    languageMatchMode: 'locale_or_base',
    lexicalTopK: 10,
    vectorTopK: 10,
    finalTopK: 10,
    hybridSparseWeight: -1,
    hybridDenseWeight: -1,
  }, {
    pool,
  })

  assert.equal(result.candidates.length, 1)
  assert.equal(result.debug?.scoring?.sparseWeight, 0.65)
  assert.equal(result.debug?.scoring?.denseWeight, 0.35)
  assert.equal(result.debug?.scoreStats?.sparseMin, 0)
  assert.equal(result.debug?.scoreStats?.sparseMax, 0)
})
