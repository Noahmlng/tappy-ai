import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRolloutEvaluator,
  H_ROLLOUT_REASON_CODES
} from '../../src/mediation/config-governance/rollout.js'
import {
  evaluateFailureMatrix,
  H_CONFIG_FAILURE_REASON_CODES,
  H_CONFIG_FAILURE_SCENARIOS
} from '../../src/mediation/config-governance/failure-matrix.js'

function baseRequest(overrides = {}) {
  return {
    requestKey: 'req_rollout_001',
    traceKey: 'trace_rollout_001',
    appId: 'app_chat_main',
    placementId: 'chat_inline_v1',
    sdkVersion: '2.1.0',
    adapterIds: ['cj', 'partnerstack'],
    environment: 'prod',
    rolloutPolicyVersion: 'rollout_policy_v7',
    rolloutAt: '2026-02-21T17:00:00.000Z',
    rolloutContractVersion: 'h_rollout_v1',
    userBucketHintOrNA: 'user_42',
    ...overrides
  }
}

function basePolicy(overrides = {}) {
  return {
    policyId: 'policy_exp_7',
    lastStablePolicyId: 'policy_stable_6',
    rolloutPercent: 25,
    appSelector: {
      includeAppIds: ['app_chat_main'],
      excludeAppIds: []
    },
    placementSelector: {
      includePlacementIds: ['chat_inline_v1'],
      excludePlacementIds: []
    },
    sdkSelector: {
      minSdkVersion: '2.0.0',
      maxSdkVersionOrNA: '3.0.0'
    },
    adapterSelector: {
      includeAdapterIds: ['cj', 'partnerstack'],
      excludeAdapterIds: []
    },
    adapterRolloutPercentMap: {
      cj: 100,
      partnerstack: 100
    },
    errorRateThreshold: 0.2,
    noFillRateThreshold: 0.4,
    latencyP95ThresholdMs: 800,
    criticalReasonThreshold: 10,
    ...overrides
  }
}

test('h-rollout: same request and policy produce deterministic splitKey/bucket/action', () => {
  const evaluator = createRolloutEvaluator({
    nowFn: () => Date.parse('2026-02-21T17:00:10.000Z')
  })

  const decisionA = evaluator.evaluateRolloutSelector(baseRequest(), basePolicy())
  const decisionB = evaluator.evaluateRolloutSelector(baseRequest(), basePolicy())

  assert.deepEqual(decisionA, decisionB)
  assert.equal(typeof decisionA.splitKey, 'string')
  assert.equal(decisionA.splitKey.length, 64)
  assert.equal(decisionA.bucketValue >= 0 && decisionA.bucketValue <= 99.99, true)
  assert.equal(['in_experiment', 'out_of_experiment', 'force_fallback'].includes(decisionA.rolloutAction), true)
})

test('h-rollout: selector exclude wins and returns out_of_experiment', () => {
  const evaluator = createRolloutEvaluator({
    nowFn: () => Date.parse('2026-02-21T17:01:00.000Z')
  })

  const decision = evaluator.evaluateRolloutSelector(
    baseRequest(),
    basePolicy({
      appSelector: {
        includeAppIds: ['app_chat_main'],
        excludeAppIds: ['app_chat_main']
      }
    })
  )

  assert.equal(decision.rolloutAction, 'out_of_experiment')
  assert.equal(decision.reasonCodes.includes(H_ROLLOUT_REASON_CODES.SELECTOR_EXCLUDED), true)
  assert.deepEqual(decision.allowedAdapters, [])
  assert.deepEqual(decision.blockedAdapters, ['cj', 'partnerstack'])
})

test('h-rollout: invalid rolloutPercent triggers force_fallback with reason code and audit snapshot', () => {
  const evaluator = createRolloutEvaluator({
    nowFn: () => Date.parse('2026-02-21T17:02:00.000Z')
  })

  const decision = evaluator.evaluateRolloutSelector(
    baseRequest({
      userBucketHintOrNA: ''
    }),
    basePolicy({
      rolloutPercent: 101
    })
  )

  assert.equal(decision.rolloutAction, 'force_fallback')
  assert.equal(decision.selectedPolicyId, 'policy_stable_6')
  assert.equal(decision.reasonCodes.includes(H_ROLLOUT_REASON_CODES.INVALID_PERCENT), true)
  assert.equal(decision.reasonCodes.includes(H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED), true)
  assert.equal(decision.reasonCodes.includes(H_ROLLOUT_REASON_CODES.SPLIT_KEY_FALLBACK_TRACE), true)
  assert.equal(Boolean(decision.auditSnapshot), true)
  assert.equal(typeof decision.auditSnapshot.snapshotId, 'string')
  assert.equal(decision.auditSnapshot.reasonCodes.includes(H_ROLLOUT_REASON_CODES.INVALID_PERCENT), true)
})

test('h-rollout: circuit breaker triggers force_fallback and reuses last stable policy', () => {
  const clock = { nowMs: Date.parse('2026-02-21T17:03:00.000Z') }
  const evaluator = createRolloutEvaluator({
    nowFn: () => clock.nowMs
  })

  const first = evaluator.evaluateRolloutSelector(
    baseRequest({
      rolloutMetrics: {
        error_rate: 0.25,
        no_fill_rate: 0.2,
        p95_latency_ms: 300,
        critical_reason_code_count: 0
      }
    }),
    basePolicy({
      errorRateThreshold: 0.2
    })
  )

  assert.equal(first.rolloutAction, 'force_fallback')
  assert.equal(first.selectedPolicyId, 'policy_stable_6')
  assert.equal(first.reasonCodes.includes(H_ROLLOUT_REASON_CODES.CIRCUIT_BREAKER_TRIGGERED), true)
  assert.equal(first.reasonCodes.includes(H_ROLLOUT_REASON_CODES.FORCE_FALLBACK_APPLIED), true)

  clock.nowMs += 60_000
  const second = evaluator.evaluateRolloutSelector(baseRequest(), basePolicy())
  assert.equal(second.rolloutAction, 'force_fallback')
  assert.equal(second.reasonCodes.includes(H_ROLLOUT_REASON_CODES.CIRCUIT_BREAKER_TRIGGERED), true)
})

test('h-failure-matrix: timeout/unavailable/version_invalid produce stable A-H actions and reason codes', () => {
  const timeoutOpen = evaluateFailureMatrix({
    requestKey: 'req_fail_001',
    traceKey: 'trace_fail_001',
    configFailureScenario: H_CONFIG_FAILURE_SCENARIOS.CONFIG_TIMEOUT,
    failureDetectedAt: '2026-02-21T17:04:00.000Z',
    detectedByModule: 'Module H',
    stableSnapshotRefOrNA: 'cfgsnap_1',
    lastStablePolicyIdOrNA: 'policy_stable_6',
    anchorHashOrNA: 'anchor_hash_1',
    failureAuditContractVersion: 'h_failure_v1'
  })

  assert.equal(timeoutOpen.failureMode, 'fail_open')
  assert.equal(timeoutOpen.primaryReasonCode, H_CONFIG_FAILURE_REASON_CODES.FAIL_OPEN_TIMEOUT_STALE_GRACE)
  assert.equal(timeoutOpen.moduleActions.moduleDAction.includes('compatible_adapters'), true)

  const unavailableClosed = evaluateFailureMatrix({
    requestKey: 'req_fail_002',
    traceKey: 'trace_fail_002',
    configFailureScenario: H_CONFIG_FAILURE_SCENARIOS.CONFIG_UNAVAILABLE,
    failureDetectedAt: '2026-02-21T17:04:10.000Z',
    detectedByModule: 'Module H',
    stableSnapshotRefOrNA: 'NA',
    failureAuditContractVersion: 'h_failure_v1'
  })

  assert.equal(unavailableClosed.failureMode, 'fail_closed')
  assert.equal(unavailableClosed.primaryReasonCode, H_CONFIG_FAILURE_REASON_CODES.FAIL_CLOSED_NO_STABLE_SNAPSHOT)
  assert.equal(unavailableClosed.moduleActions.moduleAAction, 'reject_without_stable_snapshot')

  const versionInvalid = evaluateFailureMatrix({
    requestKey: 'req_fail_003',
    traceKey: 'trace_fail_003',
    configFailureScenario: H_CONFIG_FAILURE_SCENARIOS.CONFIG_VERSION_INVALID,
    failureDetectedAt: '2026-02-21T17:04:20.000Z',
    detectedByModule: 'Module H',
    stableSnapshotRefOrNA: 'cfgsnap_2',
    failureAuditContractVersion: 'h_failure_v1'
  })

  assert.equal(versionInvalid.failureMode, 'fail_closed')
  assert.equal(versionInvalid.primaryReasonCode, H_CONFIG_FAILURE_REASON_CODES.FAIL_CLOSED_VERSION_INVALID)
  assert.equal(versionInvalid.moduleActions.moduleDAction, 'skip_supply_request')
  assert.equal(versionInvalid.moduleActions.moduleEAction, 'skip_delivery_plan')
  assert.equal(typeof versionInvalid.snapshotId, 'string')
})
