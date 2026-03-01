import assert from 'node:assert/strict'
import test from 'node:test'

import { calibrateRelevanceThresholds, extractWeakLabelSamples } from '../../src/runtime/relevance-calibration.js'

function makeDecision({
  requestId,
  placementId = 'chat_from_answer_v1',
  score = 0.6,
  vertical = 'electronics',
}) {
  return {
    requestId,
    placementId,
    runtime: {
      reasonCode: 'served',
      relevance: {
        relevanceScore: score,
        verticalDecision: {
          targetVertical: vertical,
          queryVertical: vertical,
          candidateVertical: vertical,
          sameVerticalFamily: true,
        },
      },
    },
  }
}

function makeEvent({
  requestId,
  kind,
  createdAt,
}) {
  return {
    requestId,
    kind,
    createdAt,
  }
}

test('relevance calibration: freezes thresholds when labeled sample size is insufficient', () => {
  const decisions = [
    makeDecision({ requestId: 'r1', score: 0.7 }),
    makeDecision({ requestId: 'r2', score: 0.62 }),
    makeDecision({ requestId: 'r3', score: 0.58 }),
    makeDecision({ requestId: 'r4', score: 0.52 }),
    makeDecision({ requestId: 'r5', score: 0.48 }),
  ]
  const baseTs = Date.parse('2026-03-01T00:00:00.000Z')
  const events = [
    makeEvent({ requestId: 'r1', kind: 'impression', createdAt: new Date(baseTs + 1000).toISOString() }),
    makeEvent({ requestId: 'r1', kind: 'click', createdAt: new Date(baseTs + 2000).toISOString() }),
    makeEvent({ requestId: 'r2', kind: 'impression', createdAt: new Date(baseTs + 3000).toISOString() }),
    makeEvent({ requestId: 'r2', kind: 'dismiss', createdAt: new Date(baseTs + 4000).toISOString() }),
    makeEvent({ requestId: 'r3', kind: 'impression', createdAt: new Date(baseTs + 5000).toISOString() }),
    makeEvent({ requestId: 'r3', kind: 'click', createdAt: new Date(baseTs + 6000).toISOString() }),
    makeEvent({ requestId: 'r4', kind: 'impression', createdAt: new Date(baseTs + 7000).toISOString() }),
    makeEvent({ requestId: 'r4', kind: 'dismiss', createdAt: new Date(baseTs + 8000).toISOString() }),
    makeEvent({ requestId: 'r5', kind: 'impression', createdAt: new Date(baseTs + 9000).toISOString() }),
  ]

  const calibrated = calibrateRelevanceThresholds({
    decisions,
    events,
    currentThresholdsByPlacement: {
      chat_from_answer_v1: { strict: 0.58, relaxed: 0.44 },
    },
    minSamples: 10,
    maxDeltaPerDay: 0.03,
    fillDropLimit: 0.03,
  })

  const row = calibrated.byPlacement.chat_from_answer_v1
  assert.equal(row.status, 'frozen_sample_insufficient')
  assert.equal(row.strict, 0.58)
  assert.equal(row.relaxed, 0.44)
})

test('relevance calibration: updates thresholds with max delta guardrail', () => {
  const decisions = []
  const events = []
  const baseTs = Date.parse('2026-03-01T02:00:00.000Z')

  for (let i = 0; i < 140; i += 1) {
    const requestId = `pos_${i}`
    const score = 0.72 + (i % 12) * 0.01
    decisions.push(makeDecision({ requestId, score, placementId: 'chat_from_answer_v1', vertical: 'electronics' }))
    events.push(makeEvent({ requestId, kind: 'impression', createdAt: new Date(baseTs + i * 3000).toISOString() }))
    events.push(makeEvent({ requestId, kind: 'click', createdAt: new Date(baseTs + i * 3000 + 1000).toISOString() }))
  }

  for (let i = 0; i < 60; i += 1) {
    const requestId = `neg_${i}`
    const score = 0.46 + (i % 10) * 0.01
    decisions.push(makeDecision({ requestId, score, placementId: 'chat_from_answer_v1', vertical: 'electronics' }))
    events.push(makeEvent({ requestId, kind: 'impression', createdAt: new Date(baseTs + 500000 + i * 3000).toISOString() }))
    events.push(makeEvent({ requestId, kind: 'dismiss', createdAt: new Date(baseTs + 500000 + i * 3000 + 1000).toISOString() }))
  }

  for (let i = 0; i < 20; i += 1) {
    const requestId = `neutral_${i}`
    const score = 0.6 + (i % 5) * 0.02
    decisions.push(makeDecision({ requestId, score, placementId: 'chat_from_answer_v1', vertical: 'electronics' }))
    events.push(makeEvent({ requestId, kind: 'impression', createdAt: new Date(baseTs + 900000 + i * 3000).toISOString() }))
  }

  const calibrated = calibrateRelevanceThresholds({
    decisions,
    events,
    currentThresholdsByPlacement: {
      chat_from_answer_v1: { strict: 0.58, relaxed: 0.44 },
    },
    minSamples: 100,
    maxDeltaPerDay: 0.03,
    fillDropLimit: 0.03,
  })

  const row = calibrated.byPlacement.chat_from_answer_v1
  assert.equal(row.status, 'updated')
  assert.equal(row.strict <= 0.61, true)
  assert.equal(row.relaxed <= 0.47, true)
  assert.equal(row.relaxed >= 0.44, true)
  assert.equal(row.fillDropRate <= 0.03, true)
})

test('relevance calibration: weak labels prioritize click over dismiss and enforce dismiss window', () => {
  const baseTs = Date.parse('2026-03-01T03:00:00.000Z')
  const decisions = [
    makeDecision({ requestId: 'mixed', score: 0.63 }),
    makeDecision({ requestId: 'late_dismiss', score: 0.55 }),
  ]
  const events = [
    makeEvent({ requestId: 'mixed', kind: 'impression', createdAt: new Date(baseTs).toISOString() }),
    makeEvent({ requestId: 'mixed', kind: 'dismiss', createdAt: new Date(baseTs + 20_000).toISOString() }),
    makeEvent({ requestId: 'mixed', kind: 'click', createdAt: new Date(baseTs + 30_000).toISOString() }),
    makeEvent({ requestId: 'late_dismiss', kind: 'impression', createdAt: new Date(baseTs + 40_000).toISOString() }),
    makeEvent({ requestId: 'late_dismiss', kind: 'dismiss', createdAt: new Date(baseTs + 40_000 + 10 * 60 * 1000).toISOString() }),
  ]

  const samples = extractWeakLabelSamples(decisions, events, {
    dismissWindowMs: 5 * 60 * 1000,
  })

  const mixed = samples.find((item) => item.requestId === 'mixed')
  const lateDismiss = samples.find((item) => item.requestId === 'late_dismiss')
  assert.equal(mixed?.label, 'positive')
  assert.equal(lateDismiss?.label, 'unlabeled')
})
