import assert from 'node:assert/strict'
import test from 'node:test'

import { computeCandidateEconomicPricing, getPricingModelWeights } from '../../src/runtime/pricing-model.js'

test('pricing-model: returns deterministic pricing for same candidate', () => {
  const input = {
    candidate: {
      network: 'house',
      quality: 0.82,
      fusedScore: 0.77,
      bidHint: 24.6,
    },
    placementId: 'chat_from_answer_v1',
  }

  const first = computeCandidateEconomicPricing(input)
  const second = computeCandidateEconomicPricing(input)

  assert.deepEqual(second, first)
  assert.equal(first.modelVersion, 'cpa_mock_v2')
  assert.equal(first.triggerType, 'from_answer')
  assert.equal(typeof first.cpaUsd, 'number')
  assert.equal(typeof first.ecpmUsd, 'number')
  assert.equal(typeof first.pConv, 'number')
  assert.equal(typeof first.pClick, 'number')
})

test('pricing-model: keeps network raw-signal factors within configured bounds', () => {
  const house = computeCandidateEconomicPricing({
    candidate: {
      network: 'house',
      quality: 0.8,
      fusedScore: 0.7,
      bidHint: 40,
    },
    placementId: 'chat_from_answer_v1',
  })
  assert.equal(house.rawSignal.rawUnit, 'discount_pct')
  assert.equal(house.rawSignal.normalizedFactor <= 1.1, true)
  assert.equal(house.rawSignal.normalizedFactor >= 0.9, true)

  const partnerstack = computeCandidateEconomicPricing({
    candidate: {
      network: 'partnerstack',
      quality: 0.8,
      fusedScore: 0.7,
      bidHint: 9.4,
    },
    placementId: 'chat_from_answer_v1',
  })
  assert.equal(partnerstack.rawSignal.rawUnit, 'base_rate_or_bid_value')
  assert.equal(partnerstack.rawSignal.normalizedFactor <= 1.3, true)
  assert.equal(partnerstack.rawSignal.normalizedFactor >= 0.7, true)

  const cj = computeCandidateEconomicPricing({
    candidate: {
      network: 'cj',
      quality: 0.8,
      fusedScore: 0.7,
      bidHint: 0.18,
    },
    placementId: 'chat_from_answer_v1',
  })
  assert.equal(cj.rawSignal.rawUnit, 'commission_ratio')
  assert.equal(cj.rawSignal.normalizedFactor <= 1.3, true)
  assert.equal(cj.rawSignal.normalizedFactor >= 0.7, true)
})

test('pricing-model: keeps rank/economic blending weights at expected defaults', () => {
  const weights = getPricingModelWeights()
  assert.equal(weights.rankWeight, 0.65)
  assert.equal(weights.economicWeight, 0.35)
})

test('pricing-model: cpaUsd is clamped to global mock band and independent from network share', () => {
  const weakRawSignal = computeCandidateEconomicPricing({
    candidate: {
      network: 'partnerstack',
      quality: 0.6,
      fusedScore: 0.6,
      bidHint: 0.01,
    },
    placementId: 'chat_from_answer_v1',
  })
  const strongRawSignal = computeCandidateEconomicPricing({
    candidate: {
      network: 'partnerstack',
      quality: 0.6,
      fusedScore: 0.6,
      bidHint: 99,
    },
    placementId: 'chat_from_answer_v1',
  })

  assert.equal(weakRawSignal.cpaUsd >= 1.8, true)
  assert.equal(weakRawSignal.cpaUsd <= 3.2, true)
  assert.equal(strongRawSignal.cpaUsd >= 1.8, true)
  assert.equal(strongRawSignal.cpaUsd <= 3.2, true)
})

test('pricing-model: triggerFactor only affects pConv/eCPM, not cpaUsd', () => {
  const fromAnswer = computeCandidateEconomicPricing({
    candidate: {
      network: 'house',
      quality: 0.85,
      fusedScore: 0.74,
      bidHint: 24,
    },
    placementId: 'chat_from_answer_v1',
    triggerType: 'from_answer',
  })
  const intentRecommendation = computeCandidateEconomicPricing({
    candidate: {
      network: 'house',
      quality: 0.85,
      fusedScore: 0.74,
      bidHint: 24,
    },
    placementId: 'chat_intent_recommendation_v1',
    triggerType: 'intent_recommendation',
  })

  assert.equal(intentRecommendation.cpaUsd, fromAnswer.cpaUsd)
  assert.equal(intentRecommendation.pConv > fromAnswer.pConv, true)
  assert.equal(intentRecommendation.ecpmUsd > fromAnswer.ecpmUsd, true)
})
