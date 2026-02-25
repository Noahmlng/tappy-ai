import assert from 'node:assert/strict'
import test from 'node:test'

import { assertRequiredFields, assertErrorCode } from '../utils/contract-runner.js'
import {
  A_TRIGGER_REASON_CODES,
  createTriggerHandler
} from '../../src/mediation/ingress-opportunity/trigger-handler.js'

function buildValidRequest(overrides = {}) {
  return {
    placementId: 'chat_from_answer_v1',
    appContext: {
      appId: 'app_chat_main',
      sessionId: 'sess_001',
      channelType: 'chat',
      requestAt: '2026-02-21T18:00:00.000Z'
    },
    triggerContext: {
      triggerType: 'answer_end',
      triggerAt: '2026-02-21T18:00:01.000Z'
    },
    sdkVersion: '2.1.0',
    ingressEnvelopeVersion: 'ingress_v1',
    triggerContractVersion: 'a_trigger_v1',
    ...overrides
  }
}

test('a-trigger: valid request returns create_opportunity contract shape', () => {
  const handler = createTriggerHandler({
    nowFn: () => Date.parse('2026-02-21T18:00:02.000Z')
  })

  const result = handler.trigger(buildValidRequest())

  assert.equal(result.triggerAction, 'create_opportunity')
  assert.equal(result.errorAction, 'allow')
  assert.equal(result.reasonCode, 'a_trg_map_trigger_eligible')
  assert.equal(result.opportunityRefOrNA.startsWith('opp_'), true)
  assert.equal(result.generatedClientRequestIdOrNA.startsWith('cli_'), true)
  assertRequiredFields(result, [
    'requestAccepted',
    'triggerAction',
    'decisionOutcome',
    'reasonCode',
    'errorAction',
    'traceInitLite.traceKey',
    'traceInitLite.requestKey',
    'traceInitLite.attemptKey',
    'opportunityRefOrNA',
    'retryable',
    'returnedAt',
    'triggerContractVersion'
  ])
})

test('a-trigger: missing required field returns stable reject reason code', () => {
  const handler = createTriggerHandler({
    nowFn: () => Date.parse('2026-02-21T18:01:00.000Z')
  })

  const result = handler.trigger(
    buildValidRequest({
      placementId: ''
    })
  )

  assert.equal(result.triggerAction, 'reject')
  assert.equal(result.errorAction, 'reject')
  assert.equal(result.requestAccepted, false)
  assertErrorCode(result, A_TRIGGER_REASON_CODES.MISSING_REQUIRED_FIELD)
})

test('a-trigger: invalid context structure returns deterministic reason code', () => {
  const handler = createTriggerHandler({
    nowFn: () => Date.parse('2026-02-21T18:02:00.000Z')
  })

  const result = handler.trigger(
    buildValidRequest({
      appContext: {
        appId: 'app_chat_main',
        sessionId: 'sess_001',
        channelType: 'chat',
        requestAt: 'not-a-timestamp'
      }
    })
  )

  assert.equal(result.triggerAction, 'reject')
  assert.equal(result.errorAction, 'reject')
  assertErrorCode(result, A_TRIGGER_REASON_CODES.INVALID_CONTEXT_STRUCTURE)
})

test('a-trigger: invalid placement and triggerType are rejected with stable reason codes', () => {
  const handler = createTriggerHandler({
    nowFn: () => Date.parse('2026-02-21T18:03:00.000Z')
  })

  const invalidPlacement = handler.trigger(
    buildValidRequest({
      placementId: 'missing_placement'
    })
  )
  assertErrorCode(invalidPlacement, A_TRIGGER_REASON_CODES.INVALID_PLACEMENT_ID)

  const invalidType = handler.trigger(
    buildValidRequest({
      triggerContext: {
        triggerType: 'non_existing_trigger',
        triggerAt: '2026-02-21T18:00:01.000Z'
      }
    })
  )
  assertErrorCode(invalidType, A_TRIGGER_REASON_CODES.INVALID_TRIGGER_TYPE)
})

test('a-trigger: duplicate inflight maps to no_op + allow and keeps retryable false', () => {
  const handler = createTriggerHandler({
    nowFn: () => Date.parse('2026-02-21T18:04:00.000Z')
  })

  const result = handler.trigger(
    buildValidRequest({
      triggerContext: {
        triggerType: 'answer_end',
        triggerAt: '2026-02-21T18:00:01.000Z',
        dedupState: 'inflight_duplicate'
      }
    })
  )

  assert.equal(result.triggerAction, 'no_op')
  assert.equal(result.errorAction, 'allow')
  assert.equal(result.retryable, false)
  assertErrorCode(result, A_TRIGGER_REASON_CODES.DUPLICATE_INFLIGHT)
})
