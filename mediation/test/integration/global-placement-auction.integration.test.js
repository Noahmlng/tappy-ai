import assert from 'node:assert/strict'
import test from 'node:test'

import { runGlobalPlacementAuction } from '../../src/runtime/global-placement-auction.js'

test('global placement auction selects highest bid price with deterministic tie-breakers', () => {
  const result = runGlobalPlacementAuction({
    options: [
      {
        placementId: 'chat_from_answer_v1',
        bid: {
          price: 1.2,
          pricing: { ecpmUsd: 1.2 },
        },
        rankScore: 0.75,
        auctionScore: 0.81,
        priority: 20,
      },
      {
        placementId: 'chat_intent_recommendation_v1',
        bid: {
          price: 1.2,
          pricing: { ecpmUsd: 1.3 },
        },
        rankScore: 0.7,
        auctionScore: 0.79,
        priority: 10,
      },
      {
        placementId: 'chat_custom_v1',
        bid: {
          price: 1.4,
          pricing: { ecpmUsd: 1.0 },
        },
        rankScore: 0.5,
        auctionScore: 0.55,
        priority: 30,
      },
    ],
  })

  assert.equal(result.winnerPlacementId, 'chat_custom_v1')
  assert.equal(result.selectionReason, 'highest_bid_price')
  assert.equal(result.noBidReasonCode, '')
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
