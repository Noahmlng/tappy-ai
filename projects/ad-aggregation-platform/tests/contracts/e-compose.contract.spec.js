import assert from 'node:assert/strict'
import test from 'node:test'

import { assertRequiredFields } from '../utils/contract-runner.js'
import {
  E_COMPOSE_REASON_CODES,
  createComposeService
} from '../../src/mediation/delivery-composer/compose.js'

function buildDToEOutputLite(overrides = {}) {
  return {
    opportunityKey: 'opp_e_001',
    traceKey: 'trace_e_001',
    requestKey: 'req_e_001',
    attemptKey: 'att_e_001',
    hasCandidate: true,
    candidateCount: 1,
    normalizedCandidates: [
      {
        sourceId: 'source_primary_a',
        candidateId: 'cand_001',
        routeTier: 'primary',
        pricing: {
          bidValue: 2.8,
          currency: 'USD'
        },
        creativeRef: {
          creativeId: 'creative_001',
          landingType: 'external'
        },
        assetRefs: ['asset:creative_001:image'],
        destinationRef: 'dest:creative_001'
      }
    ],
    auctionDecisionLite: {
      served: true,
      winner: {
        sourceId: 'source_primary_a',
        candidateId: 'cand_001'
      },
      price: {
        value: 2.8,
        currency: 'USD'
      },
      creativeHandle: {
        creativeId: 'creative_001',
        landingType: 'external'
      },
      debugRef: {
        routePlanId: 'rp_e_001'
      }
    },
    policyConstraintsLite: {
      constraintSetVersion: 'c_constraints_v1',
      categoryConstraints: {
        bcat: [],
        badv: []
      },
      personalizationConstraints: {
        nonPersonalizedOnly: false
      },
      renderConstraints: {
        disallowRenderModes: []
      }
    },
    routeConclusion: {
      routeOutcome: 'served_candidate'
    },
    routeAuditSnapshotLite: {
      id: 'route_audit_e_001'
    },
    stateUpdate: {
      fromState: 'routed',
      toState: 'served'
    },
    versionAnchors: {
      dOutputContractVersion: 'd_output_contract_v1',
      routingPolicyVersion: 'd_routing_policy_v2'
    },
    ...overrides
  }
}

function buildPlacementSpecLite(overrides = {}) {
  return {
    placementKey: 'placement_chat_inline',
    placementType: 'chat_inline',
    placementSurface: 'chat_surface',
    allowedRenderModes: ['native_card', 'webview'],
    maxRenderCount: 1,
    uiConstraintProfile: {
      templateId: 'tpl_chat_inline_v1',
      maxHeightPx: 320,
      maxWidthPx: 320,
      safeAreaRequired: true,
      clickGuardEnabled: true,
      closeable: true,
      frequencyCapHint: 3
    },
    disclosurePolicy: {
      disclosureLabel: 'Sponsored',
      labelPosition: 'top_left',
      mustBeVisible: true
    },
    ...overrides
  }
}

function buildDeviceCapabilitiesLite(overrides = {}) {
  return {
    platformType: 'ios',
    sdkVersion: '1.2.0',
    supportedRenderModes: ['native_card', 'webview'],
    webviewSupported: true,
    mraidSupported: false,
    videoVastSupported: false,
    maxRenderSlotCount: 2,
    ...overrides
  }
}

function buildComposeInput(overrides = {}) {
  return {
    dToEOutputLite: buildDToEOutputLite(),
    placementSpecLite: buildPlacementSpecLite(),
    deviceCapabilitiesLite: buildDeviceCapabilitiesLite(),
    composeContextLite: {
      composeRequestAt: '2026-02-22T06:00:00.000Z',
      composeMode: 'sync_delivery',
      renderTtlMs: 7000
    },
    versionAnchors: {
      eComposeInputContractVersion: 'e_compose_input_contract_v1',
      dOutputContractVersion: 'd_output_contract_v1',
      schemaVersion: 'schema_v1',
      placementConfigVersion: 'placement_cfg_v1',
      renderPolicyVersion: 'render_policy_v1',
      deviceCapabilityProfileVersion: 'device_profile_v1',
      routingPolicyVersion: 'd_routing_policy_v2',
      constraintSetVersion: 'c_constraints_v1',
      trackingInjectionVersion: 'e_tracking_injection_v1',
      uiConstraintProfileVersion: 'e_ui_constraint_profile_v1'
    },
    ...overrides
  }
}

test('e-compose: valid input returns render_plan with full required contract', () => {
  const composeService = createComposeService({
    nowFn: () => Date.parse('2026-02-22T06:00:01.000Z')
  })

  const result = composeService.compose(buildComposeInput())
  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.RENDER_PLAN_READY)

  const output = result.renderPlanLite
  assertRequiredFields(output, [
    'opportunityKey',
    'traceKey',
    'requestKey',
    'attemptKey',
    'responseReference',
    'deliveryStatus',
    'renderMode',
    'renderContainer.containerType',
    'renderContainer.containerParams',
    'creativeBinding.creativeId',
    'creativeBinding.assetRefs',
    'creativeBinding.destinationRef',
    'trackingInjection.onRenderStart.responseReference',
    'trackingInjection.onRenderStart.traceKey',
    'trackingInjection.onRenderSuccess.responseReference',
    'trackingInjection.onRenderFailure.responseReference',
    'trackingInjection.onClick.responseReference',
    'uiConstraints.layoutConstraint.maxHeightPx',
    'uiConstraints.layoutConstraint.maxWidthPx',
    'uiConstraints.layoutConstraint.safeAreaRequired',
    'uiConstraints.disclosureConstraint.disclosureLabel',
    'uiConstraints.disclosureConstraint.labelPosition',
    'uiConstraints.disclosureConstraint.mustBeVisible',
    'uiConstraints.interactionConstraint.clickGuardEnabled',
    'uiConstraints.interactionConstraint.closeable',
    'uiConstraints.interactionConstraint.frequencyCapHint',
    'ttl.renderTtlMs',
    'ttl.expireAt',
    'versionAnchors.renderPlanContractVersion',
    'versionAnchors.renderPolicyVersion',
    'versionAnchors.placementConfigVersion',
    'versionAnchors.trackingInjectionVersion',
    'versionAnchors.uiConstraintProfileVersion',
    'candidateConsumptionDecision.selectionMode',
    'candidateConsumptionDecision.scannedCandidateCount',
    'candidateConsumptionDecision.selectedCandidateRefs',
    'candidateConsumptionDecision.droppedCandidateRefs',
    'candidateConsumptionDecision.consumptionReasonCode',
    'renderCapabilityGateSnapshotLite.selectionDecision.selectedRenderMode',
    'eValidationSnapshotLite.finalValidationAction',
    'eErrorDegradeDecisionSnapshotLite.finalDeliveryStatus'
  ])

  assert.equal(output.deliveryStatus, 'served')
  assert.equal(output.renderMode, 'native_card')
  assert.equal(output.renderContainer.containerType, 'native_card')
  assert.equal(output.candidateConsumptionDecision.selectionMode, 'top1_strict')
  assert.equal(output.candidateConsumptionDecision.scannedCandidateCount, 1)
  assert.equal(output.candidateConsumptionDecision.selectedCandidateRefs.length, 1)
  assert.equal(output.renderCapabilityGateSnapshotLite.selectionDecision.selectedRenderMode, output.renderMode)
  assert.equal(output.eErrorDegradeDecisionSnapshotLite.finalDeliveryStatus, output.deliveryStatus)
  assert.equal(output.ttl.renderTtlMs, 7000)
  assert.equal(output.ttl.expireAt, '2026-02-22T06:00:07.000Z')
})

test('e-compose: missing auction required fields returns stable reason code', () => {
  const composeService = createComposeService()
  const result = composeService.compose(
    buildComposeInput({
      dToEOutputLite: buildDToEOutputLite({
        auctionDecisionLite: null
      })
    })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.MISSING_AUCTION_REQUIRED)
  assert.equal(result.renderPlanLite, null)
})

test('e-compose: winner binding mismatch is rejected deterministically', () => {
  const composeService = createComposeService()
  const result = composeService.compose(
    buildComposeInput({
      dToEOutputLite: buildDToEOutputLite({
        auctionDecisionLite: {
          served: true,
          winner: {
            sourceId: 'source_primary_b',
            candidateId: 'cand_009'
          },
          price: {
            value: 3.1,
            currency: 'USD'
          },
          creativeHandle: {
            creativeId: 'creative_009',
            landingType: 'external'
          },
          debugRef: {
            routePlanId: 'rp_e_009'
          }
        }
      })
    })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.WINNER_BINDING_INVALID)
})

test('e-compose: hasCandidate and candidate list conflict is rejected', () => {
  const composeService = createComposeService()
  const result = composeService.compose(
    buildComposeInput({
      dToEOutputLite: buildDToEOutputLite({
        hasCandidate: true,
        candidateCount: 1,
        normalizedCandidates: []
      })
    })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.INCONSISTENT_AUCTION_RESULT)
})

test('e-compose: missing device capabilities degrades to safe default native_card path', () => {
  const composeService = createComposeService({
    nowFn: () => Date.parse('2026-02-22T06:10:00.000Z')
  })
  const result = composeService.compose(
    buildComposeInput({
      deviceCapabilitiesLite: null
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.renderPlanLite.renderMode, 'native_card')
  assert.equal(
    result.warnings.some((item) => item.reasonCode === E_COMPOSE_REASON_CODES.MISSING_DEVICE_CAPABILITIES),
    true
  )
})

test('e-compose: missing device capabilities with placement without native_card is rejected', () => {
  const composeService = createComposeService()
  const result = composeService.compose(
    buildComposeInput({
      placementSpecLite: buildPlacementSpecLite({
        allowedRenderModes: ['webview']
      }),
      deviceCapabilitiesLite: null
    })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.MISSING_DEVICE_CAPABILITIES)
})

test('e-compose: invalid render modes are filtered and empty set is rejected', () => {
  const composeService = createComposeService()

  const degraded = composeService.compose(
    buildComposeInput({
      placementSpecLite: buildPlacementSpecLite({
        allowedRenderModes: ['native_card', 'bad_mode']
      }),
      deviceCapabilitiesLite: buildDeviceCapabilitiesLite({
        supportedRenderModes: ['native_card', 'invalid_mode']
      })
    })
  )
  assert.equal(degraded.ok, true)
  assert.equal(
    degraded.warnings.some((item) => item.reasonCode === E_COMPOSE_REASON_CODES.INVALID_RENDER_MODE),
    true
  )

  const rejected = composeService.compose(
    buildComposeInput({
      placementSpecLite: buildPlacementSpecLite({
        allowedRenderModes: ['bad_mode_x']
      })
    })
  )
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reasonCode, E_COMPOSE_REASON_CODES.INVALID_RENDER_MODE)
})

test('e-compose: missing required version anchor returns stable reject reason', () => {
  const composeService = createComposeService()
  const result = composeService.compose(
    buildComposeInput({
      versionAnchors: {
        eComposeInputContractVersion: 'e_compose_input_contract_v1'
      }
    })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.INVALID_VERSION_ANCHOR)
})

test('e-compose: invalid ttl is corrected to default 5000ms with warning', () => {
  const composeService = createComposeService({
    nowFn: () => Date.parse('2026-02-22T06:20:00.000Z')
  })
  const result = composeService.compose(
    buildComposeInput({
      composeContextLite: {
        composeRequestAt: '2026-02-22T06:20:00.000Z',
        composeMode: 'sync_delivery',
        renderTtlMs: 0
      }
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.renderPlanLite.ttl.renderTtlMs, 5000)
  assert.equal(result.renderPlanLite.ttl.expireAt, '2026-02-22T06:20:05.000Z')
  assert.equal(
    result.warnings.some((item) => item.reasonCode === E_COMPOSE_REASON_CODES.TTL_CORRECTED_DEFAULT),
    true
  )
})
