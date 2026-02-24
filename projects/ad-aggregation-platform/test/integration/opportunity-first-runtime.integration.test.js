import assert from 'node:assert/strict'
import test from 'node:test'

import { inferIntentByRules, scoreIntentOpportunityFirst } from '../../src/runtime/intent-scoring.js'
import { rankOpportunityCandidates } from '../../src/runtime/opportunity-ranking.js'
import { createOpportunityWriter } from '../../src/runtime/opportunity-writer.js'

test('opportunity-first intent: commerce query is scored by rules and supports no-llm mode', async () => {
  const rule = inferIntentByRules({
    query: 'best iphone deals and macbook air coupon',
    answerText: '',
  })

  assert.equal(['shopping', 'purchase_intent', 'product_exploration'].includes(rule.class), true)
  assert.equal(rule.score > 0.4, true)

  const scored = await scoreIntentOpportunityFirst({
    query: 'hostinger coupon and shopify pricing',
    answerText: '',
    locale: 'en-US',
  }, {
    useLlmFallback: false,
  })

  assert.equal(scored.source, 'rule')
  assert.equal(scored.score > 0.3, true)
  assert.equal(typeof scored.class, 'string')
})

test('opportunity-first ranking: emits stable reason codes for miss and low-rank paths', () => {
  const miss = rankOpportunityCandidates({
    candidates: [],
    query: 'generic conversation',
    answerText: 'no commerce intent',
    intentScore: 0.1,
  })
  assert.equal(miss.reasonCode, 'inventory_no_match')

  const lowRank = rankOpportunityCandidates({
    candidates: [
      {
        offerId: 'house:product:001',
        network: 'house',
        title: 'camera bundle',
        description: 'entry camera',
        targetUrl: 'https://example.com/camera',
        availability: 'active',
        quality: 0.1,
        bidHint: 0.01,
        policyWeight: 0,
        lexicalScore: 0.01,
        vectorScore: 0.01,
        fusedScore: 0.01,
      },
    ],
    query: 'camera deals',
    answerText: '',
    intentScore: 0.2,
    scoreFloor: 0.8,
  })
  assert.equal(lowRank.reasonCode, 'rank_below_floor')

  const served = rankOpportunityCandidates({
    candidates: [
      {
        offerId: 'partnerstack:link:001',
        network: 'partnerstack',
        title: 'Canva Pro discount',
        description: 'save now',
        targetUrl: 'https://example.com/canva',
        availability: 'active',
        quality: 0.9,
        bidHint: 2.1,
        policyWeight: 0.4,
        lexicalScore: 0.6,
        vectorScore: 0.7,
        fusedScore: 0.75,
      },
    ],
    query: 'canva pro discount',
    answerText: '',
    intentScore: 0.86,
  })

  assert.equal(served.reasonCode, 'served')
  assert.equal(Boolean(served.winner?.bid), true)
  assert.equal(served.winner.bid.dsp, 'partnerstack')
})

test('opportunity writer: state fallback records opportunity->delivery->event chain', async () => {
  const state = {}
  const requestContext = new Map()
  const writer = createOpportunityWriter({
    pool: null,
    state,
    requestContext,
  })

  const opportunity = await writer.createOpportunityRecord({
    requestId: 'req_chain_001',
    appId: 'simulator-chatbot',
    placementId: 'chat_inline_v1',
    payload: { query: 'vpn deals' },
  })
  assert.equal(Boolean(opportunity.opportunityKey), true)

  const delivery = await writer.writeDeliveryRecord({
    requestId: 'req_chain_001',
    appId: 'simulator-chatbot',
    placementId: 'chat_inline_v1',
    opportunityKey: opportunity.opportunityKey,
    deliveryStatus: 'served',
    payload: { reasonCode: 'served' },
  })
  assert.equal(delivery.deliveryStatus, 'served')

  const event = await writer.writeEventRecord({
    requestId: 'req_chain_001',
    appId: 'simulator-chatbot',
    placementId: 'chat_inline_v1',
    eventType: 'sdk_event',
    kind: 'click',
    eventStatus: 'recorded',
    payload: { click: true },
  })

  assert.equal(Boolean(event.eventKey), true)
  assert.equal(Array.isArray(state.opportunityRecords), true)
  assert.equal(Array.isArray(state.deliveryRecords), true)
  assert.equal(Array.isArray(state.opportunityEventRecords), true)

  const stored = state.opportunityRecords.find((item) => item.opportunityKey === opportunity.opportunityKey)
  assert.equal(Boolean(stored), true)
  assert.equal(stored.state, 'clicked')
})
