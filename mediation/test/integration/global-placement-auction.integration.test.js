import assert from 'node:assert/strict'
import test from 'node:test'

import { runGlobalPlacementAuction } from '../../src/runtime/global-placement-auction.js'

test('global placement auction picks winner by weighted relevance and bid score', () => {
  const result = runGlobalPlacementAuction({
    options: [
      {
        placementId: 'high_price_low_relevance',
        bid: {
          price: 2,
          pricing: { ecpmUsd: 2.1 },
        },
        relevanceScore: 0.2,
        rankScore: 0.2,
        auctionScore: 0.4,
        priority: 20,
      },
      {
        placementId: 'mid_price_high_relevance',
        bid: {
          price: 1.2,
          pricing: { ecpmUsd: 1.3 },
        },
        relevanceScore: 0.95,
        rankScore: 0.85,
        auctionScore: 0.9,
        priority: 10,
      },
    ],
  })

  assert.equal(result.winnerPlacementId, 'mid_price_high_relevance')
  assert.equal(result.selectionReason, 'weighted_relevance_bid')
  assert.equal(result.noBidReasonCode, '')
  assert.equal(result.scoring?.relevanceWeight, 0.95)
  assert.equal(result.scoring?.bidWeight, 0.05)
  assert.equal(result.scoring?.bidNormalization, 'log1p_max')
  assert.equal(result.scoring?.maxBidPrice, 2)
  assert.equal(Array.isArray(result.scoredOptions), true)
  assert.equal(result.scoredOptions.length, 2)
  const highPriceLowRelevance = result.scoredOptions.find((item) => item.placementId === 'high_price_low_relevance')
  const midPriceHighRelevance = result.scoredOptions.find((item) => item.placementId === 'mid_price_high_relevance')
  assert.equal(typeof highPriceLowRelevance?.compositeScore, 'number')
  assert.equal(typeof midPriceHighRelevance?.compositeScore, 'number')
  assert.equal((midPriceHighRelevance?.compositeScore || 0) > (highPriceLowRelevance?.compositeScore || 0), true)
})

test('global placement auction tie-break remains deterministic after weighted score', () => {
  const result = runGlobalPlacementAuction({
    options: [
      {
        placementId: 'placement_a',
        bid: {
          price: 1.5,
          pricing: { ecpmUsd: 1.2 },
        },
        relevanceScore: 0.8,
        rankScore: 0.6,
        auctionScore: 0.7,
        priority: 20,
      },
      {
        placementId: 'placement_b',
        bid: {
          price: 1.5,
          pricing: { ecpmUsd: 1.3 },
        },
        relevanceScore: 0.8,
        rankScore: 0.5,
        auctionScore: 0.65,
        priority: 10,
      },
    ],
  })

  assert.equal(result.winnerPlacementId, 'placement_b')
  assert.equal(result.selectionReason, 'weighted_relevance_bid')
})

test('global placement auction keeps best gate-passed no-fill reason when all placements no bid', () => {
  const result = runGlobalPlacementAuction({
    options: [
      {
        placementId: 'chat_from_answer_v1',
        gatePassed: false,
        reasonCode: 'policy_blocked',
        priority: 10,
      },
      {
        placementId: 'chat_intent_recommendation_v1',
        gatePassed: true,
        reasonCode: 'inventory_no_match',
        priority: 20,
      },
      {
        placementId: 'chat_other_v1',
        gatePassed: true,
        reasonCode: 'rank_below_floor',
        priority: 30,
      },
    ],
  })

  assert.equal(result.winner, null)
  assert.equal(result.selectionReason, 'best_no_fill_after_gate')
  assert.equal(result.noBidReasonCode, 'rank_below_floor')
  assert.equal(result.selectedOption?.placementId, 'chat_other_v1')
})

test('global placement auction falls back to rankScore when relevanceScore is missing', () => {
  const result = runGlobalPlacementAuction({
    options: [
      {
        placementId: 'fallback_to_rankscore',
        bid: {
          price: 1,
          pricing: { ecpmUsd: 1.1 },
        },
        rankScore: 0.9,
        auctionScore: 0.8,
        priority: 20,
      },
      {
        placementId: 'explicit_low_relevance',
        bid: {
          price: 2,
          pricing: { ecpmUsd: 2.1 },
        },
        relevanceScore: 0.5,
        rankScore: 0.4,
        auctionScore: 0.7,
        priority: 10,
      },
    ],
  })

  assert.equal(result.winnerPlacementId, 'fallback_to_rankscore')
  const scoredFallback = result.scoredOptions.find((item) => item.placementId === 'fallback_to_rankscore')
  assert.equal(scoredFallback?.relevanceScore, 0.9)
})

test('global placement auction prioritizes budget and risk no-fill reasons', () => {
  const result = runGlobalPlacementAuction({
    options: [
      {
        placementId: 'chat_from_answer_v1',
        gatePassed: true,
        reasonCode: 'inventory_no_match',
        priority: 5,
      },
      {
        placementId: 'chat_intent_recommendation_v1',
        gatePassed: true,
        reasonCode: 'budget_exhausted',
        priority: 20,
      },
      {
        placementId: 'chat_other_v1',
        gatePassed: true,
        reasonCode: 'risk_blocked',
        priority: 30,
      },
    ],
  })

  assert.equal(result.winner, null)
  assert.equal(result.noBidReasonCode, 'budget_exhausted')
  assert.equal(result.selectedOption?.placementId, 'chat_intent_recommendation_v1')
})
