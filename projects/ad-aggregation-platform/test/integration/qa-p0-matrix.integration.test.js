import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  A_TRIGGER_REASON_CODES,
  createTriggerHandler
} from '../../src/mediation/ingress-opportunity/trigger-handler.js'
import { createCreateOpportunityService } from '../../src/mediation/ingress-opportunity/create-opportunity.js'
import {
  A_OPPORTUNITY_EVENT_REASON_CODES,
  createOpportunityEventEmitterService
} from '../../src/mediation/ingress-opportunity/opportunity-event-emitter.js'

import {
  B_INPUT_REASON_CODES,
  createInputNormalizerService
} from '../../src/mediation/schema-normalization/input-normalizer.js'
import {
  B_SIGNAL_EVENT_REASON_CODES,
  createSignalEventEmitterService
} from '../../src/mediation/schema-normalization/signal-event-emitter.js'

import {
  C_POLICY_ACTIONS,
  C_POLICY_REASON_CODES,
  createPolicyEngine
} from '../../src/mediation/policy-safety/policy-engine.js'
import { createPolicyAuditBuilder } from '../../src/mediation/policy-safety/policy-audit.js'

import {
  D_ROUTE_PLAN_REASON_CODES,
  createRoutePlanner
} from '../../src/mediation/supply-routing/route-planner.js'
import {
  D_ROUTE_AUDIT_REASON_CODES,
  createRouteAuditBuilder
} from '../../src/mediation/supply-routing/route-audit.js'

import {
  E_COMPOSE_REASON_CODES,
  createComposeService
} from '../../src/mediation/delivery-composer/compose.js'

import {
  F_EVENTS_OVERALL_STATUSES,
  F_EVENTS_REASON_CODES,
  createEventsController
} from '../../src/mediation/event-attribution/events-controller.js'
import {
  F_IDEMPOTENCY_REASON_CODES,
  F_IDEMPOTENCY_STATES,
  createIdempotencyEngine
} from '../../src/mediation/event-attribution/idempotency.js'

import { createAppendController } from '../../src/mediation/audit-replay/append-controller.js'
import { createAuditStore } from '../../src/mediation/audit-replay/audit-store.js'
import { createReplayController } from '../../src/mediation/audit-replay/replay-controller.js'
import {
  G_REPLAY_EXECUTION_MODES,
  G_REPLAY_OUTPUT_MODES,
  G_REPLAY_QUERY_MODES,
  G_REPLAY_REASON_CODES,
  createReplayEngine
} from '../../src/mediation/audit-replay/replay-engine.js'

import {
  H_CONFIG_RESOLUTION_REASON_CODES,
  H_CONFIG_RESOLUTION_STATUSES,
  resolveConfig
} from '../../src/mediation/config-governance/config-resolution.js'
import {
  H_ROLLOUT_REASON_CODES,
  createRolloutEvaluator
} from '../../src/mediation/config-governance/rollout.js'
import {
  H_CONFIG_FAILURE_REASON_CODES,
  H_CONFIG_FAILURE_SCENARIOS,
  evaluateFailureMatrix
} from '../../src/mediation/config-governance/failure-matrix.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const REPORT_PATH = path.join(PROJECT_ROOT, 'tests', 'p0-matrix-report.json')

function buildATriggerRequest(overrides = {}) {
  return {
    placementId: 'chat_inline_v1',
    appContext: {
      appId: 'app_chat_main',
      sessionId: 'sess_a_001',
      channelType: 'chat',
      requestAt: '2026-02-23T01:00:00.000Z'
    },
    triggerContext: {
      triggerType: 'answer_end',
      triggerAt: '2026-02-23T01:00:01.000Z'
    },
    sdkVersion: '2.1.0',
    ingressEnvelopeVersion: 'ingress_v1',
    triggerContractVersion: 'a_trigger_v1',
    ...overrides
  }
}

function buildACreateInput(overrides = {}) {
  return {
    requestKey: 'req_a_matrix_001',
    opportunityKey: 'opp_a_matrix_001',
    impSeed: [
      {
        impKey: 'imp_a_matrix_001',
        placementId: 'chat_inline_v1',
        placementType: 'inline',
        slotIndex: 0
      }
    ],
    timestamps: {
      requestAt: '2026-02-23T01:05:00.000Z',
      triggerAt: '2026-02-23T01:05:01.000Z',
      opportunityCreatedAt: '2026-02-23T01:05:02.000Z'
    },
    traceInit: {
      traceKey: 'tr_a_matrix_001',
      requestKey: 'req_a_matrix_001',
      attemptKey: 'att_a_matrix_001'
    },
    schemaVersion: 'schema_v1',
    state: 'received',
    createOpportunityContractVersion: 'a_create_opportunity_v1',
    ...overrides
  }
}

function buildBIngress(overrides = {}) {
  return {
    opportunitySeed: {
      opportunityKey: 'opp_b_matrix_001',
      state: 'received',
      requestKey: 'req_b_matrix_001',
      placementType: 'chat-inline',
      actorType: 'human_user',
      channelType: 'rest'
    },
    traceInitLite: {
      traceKey: 'trace_b_matrix_001',
      requestKey: 'req_b_matrix_001',
      attemptKey: 'attempt_b_matrix_001'
    },
    triggerSnapshotLite: {
      triggerType: 'answer_end',
      triggerDecision: 'opportunity_eligible'
    },
    sensingDecisionLite: {
      decisionOutcome: 'eligible',
      hitType: 'intent_hit',
      confidenceBand: 0.92
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

function buildBSignalInput(overrides = {}) {
  return {
    traceInitLite: {
      traceKey: 'trace_b_sig_matrix_001',
      requestKey: 'req_b_sig_matrix_001',
      attemptKey: 'att_b_sig_matrix_001'
    },
    opportunityKey: 'opp_b_sig_matrix_001',
    sampleRateBps: 10000,
    samplingRuleVersion: 'b_sampling_rule_v1',
    signalNormalizedEventContractVersion: 'b_signal_event_v1',
    mappingProfileVersion: 'b_mapping_profile_v1',
    enumDictVersion: 'b_enum_dict_v1',
    bucketDictVersion: 'b_bucket_dict_v1',
    sampledSemanticSlots: ['triggerDecision', 'hitType'],
    mappingAuditSnapshotRefOrNA: 'map_audit_ref_001',
    bucketAuditSnapshotRefOrNA: 'bucket_audit_ref_001',
    eventAt: '2026-02-23T01:10:01.000Z',
    ...overrides
  }
}

function buildCInput(overrides = {}) {
  return {
    opportunityKey: 'opp_c_matrix_001',
    schemaVersion: 'schema_v1',
    cInputContractVersion: 'c_input_contract_v1',
    state: 'received',
    RequestMeta: {
      requestKey: 'req_c_matrix_001',
      requestTimestamp: '2026-02-23T01:20:00.000Z',
      channelType: 'sdk_server',
      frequencyCount: 1
    },
    PlacementMeta: {
      placementKey: 'plc_inline_001',
      placementType: 'chat_inline',
      placementSurface: 'chat_surface'
    },
    UserContext: {
      sessionKey: 'sess_c_001',
      actorType: 'human'
    },
    OpportunityContext: {
      triggerDecision: 'opportunity_eligible',
      decisionOutcome: 'opportunity_eligible',
      hitType: 'explicit_hit'
    },
    PolicyContext: {
      consentScope: 'consent_granted',
      policyGateHint: 'allow',
      restrictedCategoryFlags: [],
      frequencyCount: 1
    },
    TraceContext: {
      traceKey: 'trace_c_matrix_001',
      requestKey: 'req_c_matrix_001',
      attemptKey: 'att_c_matrix_001'
    },
    normalizationSummary: {
      mappingProfileVersion: 'b_mapping_profile_v1',
      enumDictVersion: 'b_enum_dict_v1',
      conflictPolicyVersion: 'b_conflict_policy_v1'
    },
    mappingAuditSnapshotLite: {},
    policySnapshotLite: {
      policySnapshotId: 'ps_matrix_001',
      policySnapshotVersion: 'ps_v1',
      policyPackVersion: 'pp_v1',
      policyRuleVersion: 'pr_v1',
      snapshotSource: 'resolvedConfigSnapshot',
      resolvedConfigRef: 'resolve_001',
      configHash: 'hash_001',
      effectiveAt: '2026-02-23T01:00:00.000Z',
      expireAtOrNA: '2026-02-23T02:00:00.000Z',
      failureMode: 'fail_closed',
      policyConstraintsLite: {
        complianceGate: {
          hardBlocked: false,
          ruleId: 'r_compliance_allow'
        },
        consentAuthGate: {
          blockedConsentScopes: ['consent_denied'],
          degradeOnLimited: true,
          degradeRuleId: 'r_consent_degrade',
          degradeRiskLevel: 'medium'
        },
        frequencyCapGate: {
          hardCap: 10,
          degradeThreshold: 5,
          ruleId: 'r_frequency_block',
          degradeRuleId: 'r_frequency_degrade',
          degradeRiskLevel: 'medium'
        },
        categoryGate: {
          hardBlockedCategories: ['restricted_hard'],
          degradedCategories: ['restricted_soft'],
          ruleId: 'r_category_block',
          degradeRuleId: 'r_category_degrade',
          degradeRiskLevel: 'low'
        }
      }
    },
    ...overrides
  }
}

function buildDSource(overrides = {}) {
  return {
    sourceId: 'source_default',
    status: 'active',
    supportedPlacementTypes: ['chat_inline'],
    timeoutPolicyMs: 1200,
    sourcePriorityScore: 10,
    historicalSuccessRate: 0.5,
    p95LatencyMs: 200,
    costWeight: 5,
    routeTier: 'primary',
    ...overrides
  }
}

function buildDRouteInput(overrides = {}) {
  return {
    opportunityKey: 'opp_d_matrix_001',
    traceKey: 'trace_d_matrix_001',
    requestKey: 'req_d_matrix_001',
    attemptKey: 'att_d_matrix_001',
    placementType: 'chat_inline',
    routeBudgetMs: 4500,
    isRoutable: true,
    routingPolicyVersion: 'd_routing_policy_v2',
    fallbackProfileVersion: 'd_fallback_profile_v2',
    configSnapshotLite: {
      configSnapshotId: 'cfg_snap_d_001',
      resolvedConfigRef: 'resolve_d_001',
      configHash: 'hash_d_001',
      effectiveAt: '2026-02-23T01:30:00.000Z'
    },
    executionStrategyLite: {
      strategyType: 'waterfall',
      parallelFanout: 3,
      strategyTimeoutMs: 1300,
      fallbackPolicy: 'on_no_fill_or_error',
      executionStrategyVersion: 'd_execution_strategy_v2'
    },
    constraintsLite: {
      sourceConstraints: {
        sourceSelectionMode: 'all_except_blocked',
        allowedSourceIds: [],
        blockedSourceIds: []
      }
    },
    sources: [
      buildDSource({
        sourceId: 'source_primary_1',
        sourcePriorityScore: 80,
        historicalSuccessRate: 0.92,
        p95LatencyMs: 90,
        costWeight: 2,
        routeTier: 'primary'
      }),
      buildDSource({
        sourceId: 'source_fallback_1',
        sourcePriorityScore: 40,
        routeTier: 'fallback'
      })
    ],
    ...overrides
  }
}

function buildEComposeInput(overrides = {}) {
  return {
    dToEOutputLite: {
      opportunityKey: 'opp_e_matrix_001',
      traceKey: 'trace_e_matrix_001',
      requestKey: 'req_e_matrix_001',
      attemptKey: 'att_e_matrix_001',
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
      }
    },
    placementSpecLite: {
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
      }
    },
    deviceCapabilitiesLite: {
      platformType: 'ios',
      sdkVersion: '1.2.0',
      supportedRenderModes: ['native_card', 'webview'],
      webviewSupported: true,
      mraidSupported: false,
      videoVastSupported: false,
      maxRenderSlotCount: 2
    },
    composeContextLite: {
      composeRequestAt: '2026-02-23T01:40:00.000Z',
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

function buildFEnvelope(overrides = {}) {
  return {
    batchId: 'batch_f_matrix_001',
    appId: 'app_chat_main',
    sdkVersion: '1.2.0',
    sentAt: '2026-02-23T01:50:00.000Z',
    schemaVersion: 'schema_v1',
    events: [],
    ...overrides
  }
}

function buildFEvent(overrides = {}) {
  return {
    eventId: 'evt_f_matrix_001',
    eventType: 'impression',
    eventAt: '2026-02-23T01:50:01.000Z',
    traceKey: 'trace_f_matrix_001',
    requestKey: 'req_f_matrix_001',
    attemptKey: 'att_f_matrix_001',
    opportunityKey: 'opp_f_matrix_001',
    responseReference: 'resp_f_matrix_001',
    eventVersion: 'f_evt_v1',
    renderAttemptId: 'render_attempt_001',
    creativeId: 'creative_001',
    ...overrides
  }
}

function buildGAdapterParticipation(overrides = {}) {
  return {
    adapterId: 'cj',
    adapterRequestId: 'adapter_req_001',
    requestSentAt: '2026-02-23T02:00:00.000Z',
    responseReceivedAtOrNA: '2026-02-23T02:00:00.120Z',
    responseStatus: 'responded',
    responseLatencyMsOrNA: 120,
    timeoutThresholdMs: 1000,
    didTimeout: false,
    responseCodeOrNA: '200',
    candidateReceivedCount: 2,
    candidateAcceptedCount: 1,
    filterReasonCodes: [],
    ...overrides
  }
}

function buildGAuditRecord(overrides = {}) {
  const adapterParticipation = overrides.adapterParticipation || [buildGAdapterParticipation()]
  return {
    auditRecordId: 'audit_matrix_001',
    opportunityKey: 'opp_matrix_001',
    traceKey: 'trace_matrix_001',
    requestKey: 'req_matrix_001',
    attemptKey: 'att_matrix_001',
    responseReferenceOrNA: 'resp_matrix_001',
    auditAt: '2026-02-23T02:00:00.900Z',
    opportunityInputSnapshot: {
      requestSchemaVersion: 'schema_v1',
      placementKey: 'chat_inline',
      placementType: 'native',
      placementSurface: 'chat',
      policyContextDigest: 'p_ctx',
      userContextDigest: 'u_ctx',
      opportunityContextDigest: 'o_ctx',
      ingressReceivedAt: '2026-02-23T02:00:00.000Z'
    },
    adapterParticipation,
    winnerSnapshot: {
      winnerAdapterIdOrNA: 'cj',
      winnerCandidateRefOrNA: 'cand_001',
      winnerBidPriceOrNA: 1.2,
      winnerCurrencyOrNA: 'USD',
      winnerReasonCode: 'd_route_winner_selected',
      winnerSelectedAtOrNA: '2026-02-23T02:00:00.200Z'
    },
    renderResultSnapshot: {
      renderStatus: 'rendered',
      renderAttemptIdOrNA: 'render_001',
      renderStartAtOrNA: '2026-02-23T02:00:00.220Z',
      renderEndAtOrNA: '2026-02-23T02:00:00.260Z',
      renderLatencyMsOrNA: 40,
      renderReasonCodeOrNA: 'e_render_success'
    },
    keyEventSummary: {
      eventWindowStartAt: '2026-02-23T02:00:00.220Z',
      eventWindowEndAt: '2026-02-23T02:02:00.000Z',
      impressionCount: 1,
      clickCount: 0,
      failureCount: 0,
      interactionCount: 0,
      postbackCount: 0,
      terminalEventTypeOrNA: 'impression',
      terminalEventAtOrNA: '2026-02-23T02:00:00.300Z'
    },
    auditRecordVersion: 'g_audit_record_v1',
    auditRuleVersion: 'g_audit_rule_v1',
    auditContractVersion: 'g_audit_contract_v1',
    mappingRuleVersion: 'b_mapping_rule_v2',
    routingPolicyVersion: 'd_routing_policy_v3',
    policyRuleVersion: 'c_policy_rule_v2',
    deliveryRuleVersion: 'e_delivery_rule_v4',
    eventContractVersion: 'f_event_contract_v2',
    dedupFingerprintVersion: 'f_dedup_v2',
    ...overrides
  }
}

function buildGAppendRequest(overrides = {}) {
  return {
    requestId: 'req_append_matrix_001',
    appendAt: '2026-02-23T02:00:01.000Z',
    appendContractVersion: 'g_append_v1',
    auditRecord: buildGAuditRecord(),
    ...overrides
  }
}

function buildHContext(overrides = {}) {
  return {
    requestKey: 'req_h_matrix_001',
    traceKey: 'trace_h_matrix_001',
    appId: 'app_chat_main',
    placementId: 'chat_inline_v1',
    environment: 'prod',
    schemaVersion: 'schema_v1',
    resolveAt: '2026-02-23T02:20:00.000Z',
    configResolutionContractVersion: 'h_cfg_resolution_v1',
    routingStrategyVersion: 'route_v3',
    ...overrides
  }
}

function buildHGlobal(overrides = {}) {
  return {
    configVersion: 'global_v12',
    schemaVersion: 'schema_v1',
    config: {
      policyThresholdsRef: 'policy/global/v3',
      routePolicyRef: 'route/global/v1',
      templateWhitelistRef: 'tpl/global/v7',
      blackWhiteListRef: 'bw/global/v2',
      sdkMinVersion: '1.8.0',
      missingMinVersionPolicy: 'reject',
      adapterMinVersionMap: {
        cj: '2.1.0',
        partnerstack: '2.0.0'
      },
      ttlSec: 300,
      experimentTagList: ['global_a', 'global_b']
    },
    ...overrides
  }
}

function buildHApp(overrides = {}) {
  return {
    configVersion: 'app_v20',
    schemaVersion: 'schema_v1',
    config: {},
    ...overrides
  }
}

function buildHPlacement(overrides = {}) {
  return {
    configVersion: 'placement_v31',
    placementSourceVersion: 'placement_source_v31',
    schemaVersion: 'schema_v1',
    config: {},
    ...overrides
  }
}

async function runMatrixCase(caseDef) {
  const startedAt = Date.now()
  try {
    await caseDef.execute()
    return {
      id: caseDef.id,
      module: caseDef.module,
      title: caseDef.title,
      dimensions: caseDef.dimensions,
      status: 'PASS',
      durationMs: Date.now() - startedAt
    }
  } catch (error) {
    return {
      id: caseDef.id,
      module: caseDef.module,
      title: caseDef.title,
      dimensions: caseDef.dimensions,
      status: 'FAIL',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : {
        name: 'UnknownError',
        message: String(error),
        stack: ''
      }
    }
  }
}

function summarizeByModule(results) {
  const moduleSummary = {}
  for (const item of results) {
    if (!moduleSummary[item.module]) {
      moduleSummary[item.module] = {
        total: 0,
        passed: 0,
        failed: 0
      }
    }
    moduleSummary[item.module].total += 1
    if (item.status === 'PASS') moduleSummary[item.module].passed += 1
    else moduleSummary[item.module].failed += 1
  }
  return moduleSummary
}

test('qa-p0-matrix: A-H contract/state/error/idempotency/audit matrix with explicit PASS/FAIL report', async () => {
  const matrixCases = [
    {
      id: 'A-P0-001',
      module: 'A',
      title: 'trigger contract + state transition',
      dimensions: ['contract', 'status'],
      execute: () => {
        const handler = createTriggerHandler({
          nowFn: () => Date.parse('2026-02-23T01:00:02.000Z')
        })
        const result = handler.trigger(buildATriggerRequest())
        assert.equal(result.requestAccepted, true)
        assert.equal(result.triggerAction, 'create_opportunity')
        assert.equal(result.errorAction, 'allow')
        assert.equal(typeof result.traceInitLite.traceKey, 'string')
      }
    },
    {
      id: 'A-P0-002',
      module: 'A',
      title: 'trigger error reason code stability',
      dimensions: ['error_code'],
      execute: () => {
        const handler = createTriggerHandler()
        const result = handler.trigger(buildATriggerRequest({ placementId: '' }))
        assert.equal(result.requestAccepted, false)
        assert.equal(result.reasonCode, A_TRIGGER_REASON_CODES.MISSING_REQUIRED_FIELD)
      }
    },
    {
      id: 'A-P0-003',
      module: 'A',
      title: 'opportunity event idempotency + audit trace',
      dimensions: ['idempotency', 'audit'],
      execute: async () => {
        let ackCount = 0
        const emitter = createOpportunityEventEmitterService({
          nowFn: () => Date.parse('2026-02-23T01:05:03.000Z'),
          eventKeyFactory: () => 'evt_a_matrix_fixed_001',
          ackFn: async () => {
            ackCount += 1
            return { ackStatus: 'accepted', retryable: false }
          }
        })
        const createService = createCreateOpportunityService({
          nowFn: () => Date.parse('2026-02-23T01:05:02.000Z')
        })
        const created = createService.createOpportunity(buildACreateInput())
        const first = await emitter.emitOpportunityCreated({ createOpportunityResult: created })
        const second = await emitter.emitOpportunityCreated({ createOpportunityResult: created })

        assert.equal(first.emitAccepted, true)
        assert.equal(second.emitAction, 'duplicate_noop')
        assert.equal(second.reasonCode, A_OPPORTUNITY_EVENT_REASON_CODES.DUPLICATE_NOOP)
        assert.equal(ackCount, 1)
        assert.equal(first.eventOrNA.traceKey, 'tr_a_matrix_001')
        assert.equal(emitter._debug.eventStore.size, 1)
      }
    },
    {
      id: 'B-P0-001',
      module: 'B',
      title: 'input contract normalization output state',
      dimensions: ['contract', 'status'],
      execute: () => {
        const normalizer = createInputNormalizerService()
        const result = normalizer.normalizeInput(buildBIngress())
        assert.equal(result.normalizeAccepted, true)
        assert.equal(result.resultState, 'mapped')
        assert.equal(result.reasonCode, B_INPUT_REASON_CODES.INPUT_MAPPED_COMPLETE)
      }
    },
    {
      id: 'B-P0-002',
      module: 'B',
      title: 'input required matrix error code',
      dimensions: ['error_code'],
      execute: () => {
        const normalizer = createInputNormalizerService()
        const result = normalizer.normalizeInput(buildBIngress({
          traceInitLite: {
            traceKey: 'trace_b_bad',
            requestKey: 'req_b_matrix_001'
          }
        }))
        assert.equal(result.normalizeAccepted, false)
        assert.equal(result.reasonCode, B_INPUT_REASON_CODES.MISSING_REQUIRED_FIELD)
      }
    },
    {
      id: 'B-P0-003',
      module: 'B',
      title: 'signal event duplicate no-op + mapping audit refs',
      dimensions: ['idempotency', 'audit'],
      execute: async () => {
        const emitter = createSignalEventEmitterService({
          nowFn: () => Date.parse('2026-02-23T01:10:02.000Z'),
          eventKeyFactory: () => 'evt_b_matrix_fixed_001',
          ackFn: async () => ({ ackStatus: 'accepted', retryable: false })
        })

        const first = await emitter.emitSignalNormalized(buildBSignalInput())
        const second = await emitter.emitSignalNormalized(buildBSignalInput())

        assert.equal(first.emitAccepted, true)
        assert.equal(second.emitAction, 'duplicate_noop')
        assert.equal(second.reasonCode, B_SIGNAL_EVENT_REASON_CODES.ACK_DUPLICATE)
        assert.equal(first.eventOrNA.mappingAuditSnapshotRefOrNA, 'map_audit_ref_001')
        assert.equal(first.eventOrNA.bucketAuditSnapshotRefOrNA, 'bucket_audit_ref_001')
      }
    },
    {
      id: 'C-P0-001',
      module: 'C',
      title: 'policy engine contract + allow status',
      dimensions: ['contract', 'status'],
      execute: () => {
        const engine = createPolicyEngine({
          nowFn: () => Date.parse('2026-02-23T01:20:10.000Z')
        })
        const result = engine.evaluate(buildCInput())
        assert.equal(result.evaluateAccepted, true)
        assert.equal(result.finalPolicyAction, C_POLICY_ACTIONS.ALLOW)
        assert.equal(result.reasonCode, C_POLICY_REASON_CODES.POLICY_PASS)
      }
    },
    {
      id: 'C-P0-002',
      module: 'C',
      title: 'policy engine missing required error code',
      dimensions: ['error_code'],
      execute: () => {
        const engine = createPolicyEngine()
        const result = engine.evaluate({})
        assert.equal(result.evaluateAccepted, false)
        assert.equal(result.reasonCode, C_POLICY_REASON_CODES.POLICY_ENGINE_ERROR)
      }
    },
    {
      id: 'C-P0-003',
      module: 'C',
      title: 'policy deterministic replay + audit snapshot materialization',
      dimensions: ['idempotency', 'audit'],
      execute: () => {
        const engine = createPolicyEngine({
          nowFn: () => Date.parse('2026-02-23T01:20:10.000Z')
        })
        const auditBuilder = createPolicyAuditBuilder({
          nowFn: () => Date.parse('2026-02-23T01:20:11.000Z')
        })
        const input = buildCInput()
        const first = engine.evaluate(input)
        const second = engine.evaluate(input)
        assert.deepEqual(second, first)

        const snapshot = auditBuilder.buildPolicyAuditSnapshot({
          cInput: input,
          evaluationResult: first,
          cPolicyDecisionLite: {
            ...first,
            opportunityKey: input.opportunityKey,
            adDecisionLite: {
              decision: first.finalPolicyAction
            },
            constraintsLite: {
              policyHints: []
            },
            stateUpdate: {
              fromState: 'policy_checked',
              toState: first.finalPolicyAction
            }
          }
        })
        assert.equal(snapshot.traceKey, 'trace_c_matrix_001')
        assert.equal(Array.isArray(snapshot.decisionActions), true)
      }
    },
    {
      id: 'D-P0-001',
      module: 'D',
      title: 'route plan contract + planned status',
      dimensions: ['contract', 'status'],
      execute: () => {
        const planner = createRoutePlanner({
          nowFn: () => Date.parse('2026-02-23T01:30:10.000Z')
        })
        const result = planner.buildRoutePlan(buildDRouteInput())
        assert.equal(result.ok, true)
        assert.equal(result.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_PLAN_READY)
        assert.equal(result.routePlanLite.routePlanStatus, 'planned')
      }
    },
    {
      id: 'D-P0-002',
      module: 'D',
      title: 'route strategy contract error code',
      dimensions: ['error_code'],
      execute: () => {
        const planner = createRoutePlanner()
        const result = planner.buildRoutePlan(buildDRouteInput({
          executionStrategyLite: {
            strategyType: 'invalid_mode',
            parallelFanout: 1,
            strategyTimeoutMs: 1000,
            fallbackPolicy: 'on_no_fill_or_error'
          }
        }))
        assert.equal(result.ok, false)
        assert.equal(result.reasonCode, D_ROUTE_PLAN_REASON_CODES.INVALID_EXECUTION_STRATEGY_CONTRACT)
      }
    },
    {
      id: 'D-P0-003',
      module: 'D',
      title: 'route deterministic idempotency + route audit snapshot',
      dimensions: ['idempotency', 'audit'],
      execute: () => {
        const planner = createRoutePlanner({
          nowFn: () => Date.parse('2026-02-23T01:30:10.000Z')
        })
        const input = buildDRouteInput()
        const first = planner.buildRoutePlan(input)
        const second = planner.buildRoutePlan(input)

        assert.equal(first.routePlanLite.routePlanId, second.routePlanLite.routePlanId)
        assert.equal(Boolean(first.routeAuditHints), true)
        assert.equal(Boolean(first.routeAuditHints.sourceFilterSnapshot), true)
        assert.equal(Array.isArray(first.routeAuditHints.sourceFilterSnapshot.effectiveSourcePoolIds), true)
      }
    },
    {
      id: 'E-P0-001',
      module: 'E',
      title: 'compose contract + served status',
      dimensions: ['contract', 'status'],
      execute: () => {
        const composeService = createComposeService({
          nowFn: () => Date.parse('2026-02-23T01:40:01.000Z')
        })
        const result = composeService.compose(buildEComposeInput())
        assert.equal(result.ok, true)
        assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.RENDER_PLAN_READY)
        assert.equal(result.renderPlanLite.deliveryStatus, 'served')
      }
    },
    {
      id: 'E-P0-002',
      module: 'E',
      title: 'compose missing auction error code',
      dimensions: ['error_code'],
      execute: () => {
        const composeService = createComposeService()
        const result = composeService.compose(buildEComposeInput({
          dToEOutputLite: {
            ...buildEComposeInput().dToEOutputLite,
            auctionDecisionLite: null
          }
        }))
        assert.equal(result.ok, false)
        assert.equal(result.reasonCode, E_COMPOSE_REASON_CODES.MISSING_AUCTION_REQUIRED)
      }
    },
    {
      id: 'E-P0-003',
      module: 'E',
      title: 'compose deterministic idempotency + gate/degrade audit snapshots',
      dimensions: ['idempotency', 'audit'],
      execute: () => {
        const composeService = createComposeService({
          nowFn: () => Date.parse('2026-02-23T01:40:01.000Z')
        })
        const input = buildEComposeInput()
        const first = composeService.compose(input)
        const second = composeService.compose(input)

        assert.deepEqual(second, first)
        assert.equal(Boolean(first.renderPlanLite.renderCapabilityGateSnapshotLite), true)
        assert.equal(Boolean(first.renderPlanLite.eValidationSnapshotLite), true)
        assert.equal(Boolean(first.renderPlanLite.eErrorDegradeDecisionSnapshotLite), true)
      }
    },
    {
      id: 'F-P0-001',
      module: 'F',
      title: 'events API contract + accepted_all status',
      dimensions: ['contract', 'status'],
      execute: async () => {
        const controller = createEventsController({
          nowFn: () => Date.parse('2026-02-23T01:50:05.000Z')
        })
        const response = await controller.handlePostEvents(buildFEnvelope({
          events: [buildFEvent()]
        }))

        assert.equal(response.statusCode, 200)
        assert.equal(response.body.overallStatus, F_EVENTS_OVERALL_STATUSES.ACCEPTED_ALL)
        assert.equal(response.body.ackItems.length, 1)
      }
    },
    {
      id: 'F-P0-002',
      module: 'F',
      title: 'events API invalid event error code',
      dimensions: ['error_code'],
      execute: async () => {
        const controller = createEventsController({
          nowFn: () => Date.parse('2026-02-23T01:50:05.000Z')
        })
        const response = await controller.handlePostEvents(buildFEnvelope({
          events: [buildFEvent({ eventType: 'unknown_event_type' })]
        }))

        assert.equal(response.statusCode, 200)
        assert.equal(response.body.ackItems[0].ackReasonCode, F_EVENTS_REASON_CODES.EVENT_TYPE_UNSUPPORTED)
      }
    },
    {
      id: 'F-P0-003',
      module: 'F',
      title: 'idempotency engine duplicate + replay audit history',
      dimensions: ['idempotency', 'audit'],
      execute: () => {
        const engine = createIdempotencyEngine()
        const event = buildFEvent({ idempotencyKey: 'idem_f_matrix_001' })

        const first = engine.evaluate({
          appId: 'app_chat_main',
          batchId: 'batch_f_matrix_001',
          event,
          nowMs: Date.parse('2026-02-23T01:50:10.000Z')
        })
        assert.equal(first.ok, true)
        assert.equal(first.reasonCode, F_IDEMPOTENCY_REASON_CODES.ACCEPTED)

        const committed = engine.commit({
          canonicalDedupKey: first.canonicalDedupKey,
          nowMs: Date.parse('2026-02-23T01:50:11.000Z')
        })
        assert.equal(committed.ok, true)

        const duplicate = engine.evaluate({
          appId: 'app_chat_main',
          batchId: 'batch_f_matrix_002',
          event,
          nowMs: Date.parse('2026-02-23T01:50:12.000Z')
        })
        assert.equal(duplicate.ok, true)
        assert.equal(duplicate.ackStatus, 'duplicate')

        const replay = engine.replay(first.canonicalDedupKey)
        assert.equal(replay.state, F_IDEMPOTENCY_STATES.DUPLICATE_COMMITTED)
        assert.equal(Array.isArray(replay.history), true)
      }
    },
    {
      id: 'G-P0-001',
      module: 'G',
      title: 'append contract + queued/accepted state',
      dimensions: ['contract', 'status'],
      execute: async () => {
        const controller = createAppendController({
          auditStore: createAuditStore({
            nowFn: () => Date.parse('2026-02-23T02:00:02.000Z')
          })
        })
        const response = await controller.handleAppend(buildGAppendRequest())
        assert.equal(response.statusCode, 202)
        assert.equal(response.body.ackStatus, 'queued')
        assert.equal(typeof response.body.appendToken, 'string')
      }
    },
    {
      id: 'G-P0-002',
      module: 'G',
      title: 'replay invalid query rejects with stable reason code',
      dimensions: ['error_code'],
      execute: async () => {
        const replayController = createReplayController({
          replayEngine: createReplayEngine({
            nowFn: () => Date.parse('2026-02-23T02:00:10.000Z'),
            loadRecords: () => []
          })
        })
        const response = await replayController.handleReplay({
          queryMode: 'bad_mode',
          outputMode: 'summary',
          pagination: { pageSize: 10, pageTokenOrNA: 'NA' },
          sort: { sortBy: 'auditAt', sortOrder: 'desc' },
          replayContractVersion: 'g_replay_v1'
        })
        assert.equal(response.statusCode, 400)
        assert.equal(response.body.reasonCode, G_REPLAY_REASON_CODES.INVALID_QUERY_MODE)
      }
    },
    {
      id: 'G-P0-003',
      module: 'G',
      title: 'replay deterministic snapshot + diff summary in rule_recompute',
      dimensions: ['idempotency', 'audit'],
      execute: async () => {
        const store = createAuditStore({
          nowFn: () => Date.parse('2026-02-23T02:01:00.000Z')
        })
        store.append(buildGAppendRequest({
          forceSync: true,
          requestId: 'req_append_matrix_101',
          auditRecord: buildGAuditRecord({
            auditRecordId: 'audit_matrix_101',
            opportunityKey: 'opp_matrix_101',
            traceKey: 'trace_matrix_101',
            requestKey: 'req_matrix_101',
            attemptKey: 'att_matrix_101',
            responseReferenceOrNA: 'resp_matrix_101',
            auditAt: '2026-02-23T02:01:00.500Z'
          })
        }))

        const replayController = createReplayController({
          replayEngine: createReplayEngine({
            nowFn: () => Date.parse('2026-02-23T02:05:00.000Z'),
            loadRecords: () => Array.from(store._debug.dedupStore.values()).map((entry) => ({
              auditRecord: entry.auditRecord,
              outputAt: entry.auditRecord.auditAt,
              eventAt: entry.auditRecord.keyEventSummary.terminalEventAtOrNA,
              recordStatus: 'committed'
            }))
          })
        })

        const snapshotQuery = {
          queryMode: G_REPLAY_QUERY_MODES.BY_OPPORTUNITY,
          outputMode: G_REPLAY_OUTPUT_MODES.SUMMARY,
          opportunityKey: 'opp_matrix_101',
          pagination: {
            pageSize: 10,
            pageTokenOrNA: 'NA'
          },
          sort: {
            sortBy: 'auditAt',
            sortOrder: 'desc'
          },
          replayContractVersion: 'g_replay_v1',
          replayAsOfAt: '2026-02-23T02:05:00.000Z'
        }

        const first = await replayController.handleReplay(snapshotQuery)
        const second = await replayController.handleReplay(snapshotQuery)
        assert.equal(first.statusCode, 200)
        assert.deepEqual(second.body, first.body)

        const ruleRecompute = await replayController.handleReplay({
          ...snapshotQuery,
          outputMode: G_REPLAY_OUTPUT_MODES.FULL,
          replayExecutionMode: G_REPLAY_EXECUTION_MODES.RULE_RECOMPUTE,
          pinnedVersions: {
            schemaVersion: 'schema_v1',
            mappingRuleVersion: 'b_mapping_rule_v2',
            routingPolicyVersion: 'd_routing_policy_v3',
            policyRuleVersion: 'c_policy_rule_v2',
            deliveryRuleVersion: 'e_delivery_rule_v4',
            eventContractVersion: 'f_event_contract_v2',
            dedupFingerprintVersion: 'f_dedup_v2'
          }
        })
        assert.equal(ruleRecompute.statusCode, 200)
        assert.equal(ruleRecompute.body.replayDiffSummaryLite.fieldDiffCount, 0)
      }
    },
    {
      id: 'H-P0-001',
      module: 'H',
      title: 'config resolution contract + resolved status',
      dimensions: ['contract', 'status'],
      execute: () => {
        const snapshot = resolveConfig(
          buildHGlobal(),
          buildHApp(),
          buildHPlacement(),
          buildHContext()
        )

        assert.equal(snapshot.resolutionStatus, H_CONFIG_RESOLUTION_STATUSES.RESOLVED)
        assert.equal(typeof snapshot.resolveId, 'string')
        assert.equal(Array.isArray(snapshot.fieldProvenance), true)
      }
    },
    {
      id: 'H-P0-002',
      module: 'H',
      title: 'config resolution required-missing error code',
      dimensions: ['error_code'],
      execute: () => {
        const snapshot = resolveConfig(
          buildHGlobal(),
          buildHApp(),
          buildHPlacement({
            config: {
              sdkMinVersion: null
            }
          }),
          buildHContext()
        )

        assert.equal(snapshot.resolutionStatus, H_CONFIG_RESOLUTION_STATUSES.REJECTED)
        assert.equal(
          snapshot.reasonCodes.includes(H_CONFIG_RESOLUTION_REASON_CODES.MISSING_REQUIRED_AFTER_MERGE),
          true
        )
      }
    },
    {
      id: 'H-P0-003',
      module: 'H',
      title: 'rollout deterministic idempotency + failure matrix audit output',
      dimensions: ['idempotency', 'audit'],
      execute: () => {
        const evaluator = createRolloutEvaluator({
          nowFn: () => Date.parse('2026-02-23T02:20:30.000Z')
        })
        const request = {
          requestKey: 'req_rollout_matrix_001',
          traceKey: 'trace_rollout_matrix_001',
          appId: 'app_chat_main',
          placementId: 'chat_inline_v1',
          sdkVersion: '2.1.0',
          adapterIds: ['cj', 'partnerstack'],
          environment: 'prod',
          rolloutPolicyVersion: 'rollout_policy_v7',
          rolloutAt: '2026-02-23T02:20:00.000Z',
          rolloutContractVersion: 'h_rollout_v1',
          userBucketHintOrNA: 'user_42'
        }
        const policy = {
          policyId: 'policy_exp_7',
          lastStablePolicyId: 'policy_stable_6',
          rolloutPercent: 100,
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
          criticalReasonThreshold: 10
        }

        const first = evaluator.evaluateRolloutSelector(request, policy)
        const second = evaluator.evaluateRolloutSelector(request, policy)
        assert.deepEqual(second, first)

        const failureSnapshot = evaluateFailureMatrix({
          requestKey: 'req_fail_matrix_001',
          traceKey: 'trace_fail_matrix_001',
          configFailureScenario: H_CONFIG_FAILURE_SCENARIOS.CONFIG_TIMEOUT,
          failureDetectedAt: '2026-02-23T02:20:20.000Z',
          detectedByModule: 'Module H',
          stableSnapshotRefOrNA: 'cfgsnap_matrix_1',
          lastStablePolicyIdOrNA: 'policy_stable_6',
          anchorHashOrNA: 'anchor_hash_matrix_1',
          failureAuditContractVersion: 'h_failure_v1'
        })

        assert.equal(first.reasonCodes.includes(H_ROLLOUT_REASON_CODES.IN_EXPERIMENT), true)
        assert.equal(
          failureSnapshot.primaryReasonCode,
          H_CONFIG_FAILURE_REASON_CODES.FAIL_OPEN_TIMEOUT_STALE_GRACE
        )
        assert.equal(typeof failureSnapshot.snapshotId, 'string')
      }
    }
  ]

  const results = []
  for (const caseDef of matrixCases) {
    results.push(await runMatrixCase(caseDef))
  }

  const passed = results.filter((item) => item.status === 'PASS').length
  const failed = results.length - passed
  const moduleSummary = summarizeByModule(results)
  const passRatePercent = results.length === 0 ? 0 : Number(((passed / results.length) * 100).toFixed(2))

  const report = {
    generatedAt: new Date().toISOString(),
    suite: 'qa-p0-matrix',
    summary: {
      total: results.length,
      passed,
      failed,
      passRatePercent
    },
    moduleSummary,
    cases: results
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  assert.equal(
    failed,
    0,
    `P0 matrix has failing cases: ${results.filter((item) => item.status === 'FAIL').map((item) => item.id).join(', ')}`
  )
})
