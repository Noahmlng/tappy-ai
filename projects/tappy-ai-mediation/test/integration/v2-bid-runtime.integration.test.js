import assert from 'node:assert/strict'
import test from 'node:test'

import { runBidAggregationPipeline } from '../../src/runtime/index.js'

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
