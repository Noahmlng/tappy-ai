import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateVersionGate,
  H_VERSION_GATE_REASON_CODES
} from '../../src/mediation/h/version-gate.js'
import {
  injectVersionAnchors,
  H_ANCHOR_REASON_CODES
} from '../../src/mediation/h/anchor-injector.js'

function baseResolvedConfigSnapshot() {
  return {
    configResolutionContractVersion: 'h_cfg_resolution_v1',
    appliedVersions: {
      schemaVersion: '1.2.0',
      routingStrategyVersion: '2.0.0',
      placementConfigVersion: '5.1.0',
      globalConfigVersion: 'global_v12',
      appConfigVersionOrNA: 'app_v20',
      placementSourceVersionOrNA: 'placement_source_v31'
    },
    effectiveConfig: {
      sdkMinVersion: '2.0.0',
      missingMinVersionPolicy: 'degrade_block_adapter',
      adapterMinVersionMap: {
        cj: '2.1.0',
        partnerstack: '2.0.0'
      }
    }
  }
}

function baseGateInput(overrides = {}) {
  return {
    requestKey: 'req_gate_001',
    traceKey: 'trace_gate_001',
    schemaVersion: '1.2.0',
    sdkVersion: '2.0.1',
    adapterVersionMap: {
      cj: '2.1.0',
      partnerstack: '2.0.5'
    },
    sdkMinVersion: '2.0.0',
    adapterMinVersionMap: {
      cj: '2.1.0',
      partnerstack: '2.0.0'
    },
    missingMinVersionPolicy: 'degrade_block_adapter',
    schemaCompatibilityPolicyRef: {
      fullySupportedSchemaVersions: ['1.2.0'],
      degradeSchemaVersions: ['1.1.0']
    },
    gateAt: '2026-02-21T16:00:00.000Z',
    versionGateContractVersion: 'h_gate_v1',
    ...overrides
  }
}

function moduleVersionRefs(overrides = {}) {
  return {
    enumDictVersion: 'enum_v1',
    mappingRuleVersion: 'mapping_v1',
    policyRuleVersion: 'policy_v1',
    routingPolicyVersion: 'routing_policy_v1',
    deliveryRuleVersion: 'delivery_rule_v1',
    eventContractVersion: 'event_contract_v1',
    dedupFingerprintVersion: 'dedup_v1',
    closureRuleVersion: 'closure_v1',
    billingRuleVersion: 'billing_v1',
    archiveContractVersion: 'archive_v1',
    ...overrides
  }
}

test('h-version-gate: same input produces deterministic allow decision', () => {
  const input = baseGateInput()
  const resolved = baseResolvedConfigSnapshot()

  const decisionA = evaluateVersionGate(input, resolved)
  const decisionB = evaluateVersionGate(input, resolved)

  assert.deepEqual(decisionA, decisionB)
  assert.equal(decisionA.gateAction, 'allow')
  assert.equal(decisionA.gateStageResult.schemaGate, 'pass')
  assert.equal(decisionA.gateStageResult.sdkGate, 'pass')
  assert.equal(decisionA.gateStageResult.adapterGate, 'pass')
  assert.deepEqual(decisionA.reasonCodes, [H_VERSION_GATE_REASON_CODES.ALL_PASS])
})

test('h-version-gate: degrade accumulates schema/sdk/adapter degradation details', () => {
  const decision = evaluateVersionGate(
    baseGateInput({
      schemaVersion: '1.1.0',
      sdkVersion: '1.9.0',
      adapterVersionMap: {
        cj: '2.0.0',
        partnerstack: '2.0.5',
        unknown_adapter: '0.9.0'
      },
      adapterMinVersionMap: {
        cj: '2.1.0',
        partnerstack: '2.0.0'
      },
      gracePolicyRef: {
        allowBelowMin: true
      }
    }),
    baseResolvedConfigSnapshot()
  )

  assert.equal(decision.gateAction, 'degrade')
  assert.equal(decision.gateStageResult.schemaGate, 'degrade')
  assert.equal(decision.gateStageResult.sdkGate, 'degrade')
  assert.equal(decision.gateStageResult.adapterGate, 'degrade')
  assert.equal(decision.compatibleAdapters.includes('partnerstack'), true)
  assert.equal(decision.blockedAdapters.includes('cj'), true)
  assert.equal(decision.blockedAdapters.includes('unknown_adapter'), true)
  assert.equal(decision.reasonCodes.includes(H_VERSION_GATE_REASON_CODES.SCHEMA_COMPATIBLE_DEGRADE), true)
  assert.equal(decision.reasonCodes.includes(H_VERSION_GATE_REASON_CODES.SDK_BELOW_MIN_DEGRADE), true)
  assert.equal(decision.reasonCodes.includes(H_VERSION_GATE_REASON_CODES.ADAPTER_MIN_VERSION_MISSING_BLOCKED), true)
  assert.equal(decision.reasonCodes.includes(H_VERSION_GATE_REASON_CODES.ADAPTER_PARTIAL_DEGRADE), true)
})

test('h-version-gate: reject distinguishes unknown adapter reject and invalid version format', () => {
  const unknownAdapterReject = evaluateVersionGate(
    baseGateInput({
      adapterVersionMap: {
        unknown_adapter: '1.0.0'
      },
      adapterMinVersionMap: {},
      missingMinVersionPolicy: 'reject'
    }),
    baseResolvedConfigSnapshot()
  )

  assert.equal(unknownAdapterReject.gateAction, 'reject')
  assert.deepEqual(unknownAdapterReject.reasonCodes, [H_VERSION_GATE_REASON_CODES.ADAPTER_MIN_VERSION_MISSING_REJECT])

  const invalidVersionReject = evaluateVersionGate(
    baseGateInput({
      sdkVersion: '2.0'
    }),
    baseResolvedConfigSnapshot()
  )

  assert.equal(invalidVersionReject.gateAction, 'reject')
  assert.deepEqual(invalidVersionReject.reasonCodes, [H_VERSION_GATE_REASON_CODES.INVALID_VERSION_FORMAT])
})

test('h-anchor-injector: freeze points append deterministically and forbid illegal mutations', () => {
  const gateDecision = evaluateVersionGate(baseGateInput(), baseResolvedConfigSnapshot())

  const ingress = injectVersionAnchors({
    requestKey: 'req_anchor_001',
    traceKey: 'trace_anchor_001',
    resolvedConfigSnapshot: baseResolvedConfigSnapshot(),
    versionGateDecision: gateDecision,
    moduleVersionRefs: moduleVersionRefs(),
    injectAt: '2026-02-21T16:05:00.000Z',
    versionAnchorContractVersion: 'h_anchor_v1',
    freezePoint: 'freeze_point_ingress'
  })

  assert.equal(ingress.reasonCodes.includes(H_ANCHOR_REASON_CODES.ALL_PASS), true)
  assert.equal(ingress.freezeState.currentFreezePoint, 'freeze_point_ingress')
  assert.equal(typeof ingress.anchorHash, 'string')
  assert.equal(ingress.anchorHash.length > 0, true)

  const routing = injectVersionAnchors({
    requestKey: 'req_anchor_001',
    traceKey: 'trace_anchor_001',
    resolvedConfigSnapshot: baseResolvedConfigSnapshot(),
    versionGateDecision: gateDecision,
    moduleVersionRefs: moduleVersionRefs({
      routingPolicyVersion: 'routing_policy_v1'
    }),
    injectAt: '2026-02-21T16:05:05.000Z',
    versionAnchorContractVersion: 'h_anchor_v1',
    freezePoint: 'freeze_point_routing',
    previousAnchorSnapshot: ingress
  })

  assert.equal(routing.freezeState.currentFreezePoint, 'freeze_point_routing')

  const preRouteMutationReject = injectVersionAnchors({
    requestKey: 'req_anchor_001',
    traceKey: 'trace_anchor_001',
    resolvedConfigSnapshot: {
      ...baseResolvedConfigSnapshot(),
      appliedVersions: {
        ...baseResolvedConfigSnapshot().appliedVersions,
        schemaVersion: '1.3.0'
      }
    },
    versionGateDecision: gateDecision,
    moduleVersionRefs: moduleVersionRefs(),
    injectAt: '2026-02-21T16:05:03.000Z',
    versionAnchorContractVersion: 'h_anchor_v1',
    freezePoint: 'freeze_point_ingress',
    previousAnchorSnapshot: ingress
  })

  assert.equal(preRouteMutationReject.freezeState.anchorAction, 'reject')
  assert.deepEqual(preRouteMutationReject.reasonCodes, [H_ANCHOR_REASON_CODES.SWITCH_DETECTED_PRE_ROUTE])

  const postRouteSwitch = injectVersionAnchors({
    requestKey: 'req_anchor_001',
    traceKey: 'trace_anchor_001',
    resolvedConfigSnapshot: {
      ...baseResolvedConfigSnapshot(),
      appliedVersions: {
        ...baseResolvedConfigSnapshot().appliedVersions,
        schemaVersion: '1.9.9'
      }
    },
    versionGateDecision: gateDecision,
    moduleVersionRefs: moduleVersionRefs(),
    injectAt: '2026-02-21T16:05:10.000Z',
    versionAnchorContractVersion: 'h_anchor_v1',
    freezePoint: 'freeze_point_delivery',
    previousAnchorSnapshot: routing
  })

  assert.equal(postRouteSwitch.freezeState.anchorAction, 'degrade')
  assert.equal(postRouteSwitch.reasonCodes.includes(H_ANCHOR_REASON_CODES.SWITCH_DETECTED_POST_ROUTE), true)
  assert.equal(postRouteSwitch.anchorSet.schemaVersion, routing.anchorSet.schemaVersion)

  const mutationForbidden = injectVersionAnchors({
    requestKey: 'req_anchor_001',
    traceKey: 'trace_anchor_001',
    resolvedConfigSnapshot: baseResolvedConfigSnapshot(),
    versionGateDecision: gateDecision,
    moduleVersionRefs: moduleVersionRefs({
      policyRuleVersion: 'policy_v2'
    }),
    injectAt: '2026-02-21T16:05:12.000Z',
    versionAnchorContractVersion: 'h_anchor_v1',
    freezePoint: 'freeze_point_delivery',
    previousAnchorSnapshot: routing
  })

  assert.equal(mutationForbidden.freezeState.anchorAction, 'reject')
  assert.deepEqual(mutationForbidden.reasonCodes, [H_ANCHOR_REASON_CODES.MUTATION_FORBIDDEN])
})
