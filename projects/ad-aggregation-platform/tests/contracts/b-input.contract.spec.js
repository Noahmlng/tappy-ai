import assert from 'node:assert/strict'
import test from 'node:test'

import { assertErrorCode, assertRequiredFields } from '../utils/contract-runner.js'
import {
  B_INPUT_REASON_CODES,
  createInputNormalizerService
} from '../../src/mediation/b/input-normalizer.js'

function buildValidIngress(overrides = {}) {
  return {
    opportunitySeed: {
      opportunityKey: 'opp_b_001',
      state: 'received',
      requestKey: 'req_b_001',
      placementType: 'chat-inline',
      actorType: 'human_user',
      channelType: 'rest'
    },
    traceInitLite: {
      traceKey: 'trace_b_000001',
      requestKey: 'req_b_001',
      attemptKey: 'attempt_b_0001'
    },
    triggerSnapshotLite: {
      triggerType: 'answer_end',
      triggerDecision: 'opportunity_eligible'
    },
    sensingDecisionLite: {
      decisionOutcome: 'eligible',
      hitType: 'intent_hit',
      confidenceBand: 0.82
    },
    sourceInputBundleLite: {
      appExplicit: {
        app_context: {
          language: 'en-US',
          session_state: 'active',
          device_performance_score: 0.66,
          privacy_status: 'consent_granted'
        },
        actorType: 'human_user',
        channelType: 'rest'
      },
      placementConfig: {
        placementType: 'chat-inline'
      },
      defaultPolicy: {
        policyProfile: 'default_v1'
      }
    },
    bInputContractVersion: 'b_input_contract_v1',
    ...overrides
  }
}

test('b-input: valid ingress is normalized to canonical values', () => {
  const normalizer = createInputNormalizerService()
  const result = normalizer.normalizeInput(buildValidIngress())

  assert.equal(result.normalizeAccepted, true)
  assert.equal(result.normalizeAction, 'continue')
  assert.equal(result.resultState, 'mapped')
  assert.equal(result.errorAction, 'allow')
  assert.equal(result.reasonCode, B_INPUT_REASON_CODES.INPUT_MAPPED_COMPLETE)
  assertRequiredFields(result, [
    'normalizeAccepted',
    'normalizeAction',
    'resultState',
    'reasonCode',
    'errorAction',
    'traceInitLite.traceKey',
    'traceInitLite.requestKey',
    'traceInitLite.attemptKey',
    'normalizedIngressPacketOrNA.canonicalSignals.triggerDecision',
    'normalizedIngressPacketOrNA.canonicalSignals.decisionOutcome',
    'normalizedIngressPacketOrNA.canonicalSignals.hitType'
  ])

  assert.equal(result.normalizedIngressPacketOrNA.canonicalSignals.decisionOutcome, 'opportunity_eligible')
  assert.equal(result.normalizedIngressPacketOrNA.canonicalSignals.hitType, 'explicit_hit')
  assert.equal(result.normalizedIngressPacketOrNA.canonicalSignals.placementType, 'chat_inline')
  assert.equal(result.normalizedIngressPacketOrNA.canonicalSignals.actorType, 'human')
  assert.equal(result.normalizedIngressPacketOrNA.canonicalSignals.channelType, 'sdk_server')
  assert.equal(result.mappingWarnings.length, 0)
})

test('b-input: missing required matrix field is rejected with stable reason code', () => {
  const normalizer = createInputNormalizerService()
  const request = buildValidIngress({
    traceInitLite: {
      traceKey: 'trace_b_000001',
      requestKey: 'req_b_001'
    }
  })

  const result = normalizer.normalizeInput(request)
  assert.equal(result.normalizeAccepted, false)
  assert.equal(result.normalizeAction, 'reject')
  assertErrorCode(result, B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD)
})

test('b-input: invalid trace context is rejected deterministically', () => {
  const normalizer = createInputNormalizerService()
  const request = buildValidIngress({
    traceInitLite: {
      traceKey: 'bad',
      requestKey: 'req_b_001',
      attemptKey: 'attempt_b_0001'
    }
  })

  const result = normalizer.normalizeInput(request)
  assert.equal(result.normalizeAccepted, false)
  assert.equal(result.normalizeAction, 'reject')
  assertErrorCode(result, B_INPUT_REASON_CODES.INVALID_TRACE_CONTEXT)
})

test('b-input: gating slot unknown fallback is rejected', () => {
  const normalizer = createInputNormalizerService()
  const request = buildValidIngress({
    triggerSnapshotLite: {
      triggerType: 'answer_end',
      triggerDecision: 'totally_unknown_decision'
    }
  })

  const result = normalizer.normalizeInput(request)
  assert.equal(result.normalizeAccepted, false)
  assert.equal(result.normalizeAction, 'reject')
  assertErrorCode(result, B_INPUT_REASON_CODES.INVALID_REQUIRED_ENUM)
})

test('b-input: non-gating slot unknown fallback degrades with stable reason code', () => {
  const normalizer = createInputNormalizerService()
  const request = buildValidIngress({
    opportunitySeed: {
      opportunityKey: 'opp_b_001',
      state: 'received',
      requestKey: 'req_b_001',
      placementType: 'chat-inline',
      actorType: 'actor_from_mars',
      channelType: 'rest'
    }
  })

  const result = normalizer.normalizeInput(request)
  assert.equal(result.normalizeAccepted, true)
  assert.equal(result.normalizeAction, 'degrade')
  assert.equal(result.resultState, 'partial')
  assert.equal(result.errorAction, 'degrade')
  assertErrorCode(result, B_INPUT_REASON_CODES.INVALID_OPTIONAL_ENUM)
  assert.equal(result.normalizedIngressPacketOrNA.canonicalSignals.actorType, 'unknown_actor_type')
})

test('b-input: source slot empty degrades and keeps request consumable', () => {
  const normalizer = createInputNormalizerService()
  const request = buildValidIngress({
    sourceInputBundleLite: {
      appExplicit: {
        app_context: {
          language: 'en-US',
          session_state: 'active',
          device_performance_score: 0.66,
          privacy_status: 'consent_granted'
        },
        actorType: 'human_user',
        channelType: 'rest'
      },
      placementConfig: {
        placementType: 'chat-inline'
      },
      defaultPolicy: {}
    }
  })

  const result = normalizer.normalizeInput(request)
  assert.equal(result.normalizeAccepted, true)
  assert.equal(result.normalizeAction, 'degrade')
  assertErrorCode(result, B_INPUT_REASON_CODES.SOURCE_SLOT_EMPTY)
})

test('b-input: value correction degrades with b_value_corrected', () => {
  const normalizer = createInputNormalizerService()
  const request = buildValidIngress({
    sensingDecisionLite: {
      decisionOutcome: 'eligible',
      hitType: 'intent_hit',
      confidenceBand: '1.27'
    }
  })

  const result = normalizer.normalizeInput(request)
  assert.equal(result.normalizeAccepted, true)
  assert.equal(result.normalizeAction, 'degrade')
  assertErrorCode(result, B_INPUT_REASON_CODES.VALUE_CORRECTED)
  assert.equal(result.normalizedIngressPacketOrNA.canonicalSignals.confidenceBand, 1)
})
