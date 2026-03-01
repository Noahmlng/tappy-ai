import assert from 'node:assert/strict'
import test from 'node:test'

import { rankOpportunityCandidates } from '../../src/runtime/opportunity-ranking.js'

function buildTravelCandidate(overrides = {}) {
  return {
    offerId: 'partnerstack:travel:fuji_trip',
    network: 'partnerstack',
    title: 'Fuji mountain luxury travel tours',
    description: 'Book flights and hotels now',
    targetUrl: 'https://example.com/travel/fuji',
    availability: 'active',
    quality: 1,
    bidHint: 5.5,
    policyWeight: 0.1,
    lexicalScore: 0.95,
    vectorScore: 0.94,
    fusedScore: 0.95,
    metadata: {
      vertical: 'travel',
    },
    ...overrides,
  }
}

function buildElectronicsRelaxedCandidate(overrides = {}) {
  return {
    offerId: 'partnerstack:electronics:camera_bundle',
    network: 'partnerstack',
    title: 'Mirrorless bundle',
    description: 'starter package',
    targetUrl: 'https://example.com/camera/bundle',
    availability: 'active',
    quality: 0.2,
    bidHint: 0.8,
    policyWeight: 0.1,
    lexicalScore: 0.03,
    vectorScore: 0.36,
    fusedScore: 0.36,
    metadata: {
      vertical: 'electronics',
    },
    ...overrides,
  }
}

for (const placementId of ['chat_intent_recommendation_v1', 'chat_from_answer_v1']) {
  test(`relevance policy v2: ${placementId} uses same-vertical relaxed fallback for fuji camera ambiguity`, () => {
    const ranked = rankOpportunityCandidates({
      placementId,
      query: 'nikon vs fuji camera',
      answerText: 'i want to buy a vlogging camera',
      intentClass: 'shopping',
      intentScore: 0.85,
      candidates: [
        buildTravelCandidate(),
        buildElectronicsRelaxedCandidate(),
      ],
    })

    assert.equal(ranked.reasonCode, 'relevance_pass_relaxed_same_vertical')
    assert.equal(ranked.winner?.offerId, 'partnerstack:electronics:camera_bundle')
    assert.equal(ranked.debug.relevanceDebug?.gateStage, 'relaxed')
    assert.equal(ranked.debug.relevanceDebug?.verticalDecision?.candidateVertical, 'electronics')
    assert.equal(ranked.debug.relevanceDebug?.verticalDecision?.lockReason, 'ambiguous_entity:fuji->electronics')
    assert.equal(typeof ranked.debug.relevanceDebug?.thresholdsApplied?.strict, 'number')
    assert.equal(typeof ranked.debug.relevanceDebug?.thresholdsApplied?.relaxed, 'number')
  })
}

test('relevance policy v2: blocks cross-vertical relaxed-only candidates', () => {
  const ranked = rankOpportunityCandidates({
    placementId: 'chat_from_answer_v1',
    query: 'nikon vs fuji camera',
    answerText: 'i need camera recommendations',
    intentClass: 'shopping',
    intentScore: 1,
    candidates: [
      buildTravelCandidate(),
    ],
  })

  assert.equal(ranked.reasonCode, 'relevance_blocked_cross_vertical')
  assert.equal(ranked.winner, null)
  assert.equal(ranked.debug.relevanceDebug?.gateStage, 'blocked')
  assert.equal(ranked.debug.relevanceDebug?.blockedReason, 'relevance_blocked_cross_vertical')
})
