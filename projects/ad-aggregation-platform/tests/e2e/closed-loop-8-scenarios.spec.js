import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  C_POLICY_ACTIONS,
  createPolicyEngine
} from '../../src/mediation/c/policy-engine.js'
import {
  D_ROUTE_PLAN_REASON_CODES,
  createRoutePlanner
} from '../../src/mediation/d/route-planner.js'
import { createDeliveryOutputBuilder } from '../../src/mediation/e/delivery-output.js'
import { createEventOutputBuilder } from '../../src/mediation/e/event-output.js'
import { createIdempotencyEngine } from '../../src/mediation/f/idempotency.js'
import {
  F_TERMINAL_CLOSURE_REASON_CODES,
  createTerminalClosureEngine
} from '../../src/mediation/f/terminal-closure.js'
import { createFactsMapper } from '../../src/mediation/f/facts-mapper.js'
import { createArchiveRecordBuilder } from '../../src/mediation/f/archive-record-builder.js'
import { createAppendController } from '../../src/mediation/g/append-controller.js'
import { createAuditStore } from '../../src/mediation/g/audit-store.js'
import { createReplayController } from '../../src/mediation/g/replay-controller.js'
import {
  G_REPLAY_DETERMINISM_STATUSES,
  G_REPLAY_DIFF_STATUSES,
  G_REPLAY_EXECUTION_MODES,
  G_REPLAY_OUTPUT_MODES,
  G_REPLAY_QUERY_MODES,
  createReplayEngine
} from '../../src/mediation/g/replay-engine.js'
import {
  H_CONFIG_FAILURE_REASON_CODES,
  H_CONFIG_FAILURE_SCENARIOS,
  evaluateFailureMatrix
} from '../../src/mediation/h/failure-matrix.js'
import {
  H_VERSION_GATE_REASON_CODES,
  evaluateVersionGate
} from '../../src/mediation/h/version-gate.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const REPORT_PATH = path.join(PROJECT_ROOT, 'tests', 'e2e-report.json')

function basePolicyInput(overrides = {}) {
  return {
    opportunityKey: 'opp_e2e_001',
    schemaVersion: 'schema_v1',
    cInputContractVersion: 'c_input_contract_v1',
    state: 'received',
    RequestMeta: {
      requestKey: 'req_e2e_001',
      requestTimestamp: '2026-02-22T00:10:00.000Z',
      channelType: 'sdk_server',
      frequencyCount: 1
    },
    PlacementMeta: {
      placementKey: 'plc_inline_001',
      placementType: 'chat_inline',
      placementSurface: 'chat_surface'
    },
    UserContext: {
      sessionKey: 'sess_e2e_001',
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
      traceKey: 'trace_e2e_001',
      requestKey: 'req_e2e_001',
      attemptKey: 'att_e2e_001'
    },
    normalizationSummary: {
      mappingProfileVersion: 'b_mapping_profile_v1',
      enumDictVersion: 'b_enum_dict_v1',
      conflictPolicyVersion: 'b_conflict_policy_v1'
    },
    mappingAuditSnapshotLite: {},
    policySnapshotLite: {
      policySnapshotId: 'ps_e2e_001',
      policySnapshotVersion: 'ps_v1',
      policyPackVersion: 'pp_v1',
      policyRuleVersion: 'pr_v1',
      snapshotSource: 'resolvedConfigSnapshot',
      resolvedConfigRef: 'resolve_e2e_001',
      configHash: 'hash_e2e_001',
      effectiveAt: '2026-02-22T00:00:00.000Z',
      expireAtOrNA: '2026-02-22T01:00:00.000Z',
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

function buildSource(overrides = {}) {
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

function baseRouteInput(overrides = {}) {
  return {
    opportunityKey: 'opp_e2e_route_001',
    traceKey: 'trace_e2e_route_001',
    requestKey: 'req_e2e_route_001',
    attemptKey: 'att_e2e_route_001',
    placementType: 'chat_inline',
    routeBudgetMs: 4500,
    isRoutable: true,
    routingPolicyVersion: 'd_routing_policy_v2',
    fallbackProfileVersion: 'd_fallback_profile_v2',
    configSnapshotLite: {
      configSnapshotId: 'cfg_snap_e2e_001',
      resolvedConfigRef: 'resolve_e2e_001',
      configHash: 'hash_e2e_001',
      effectiveAt: '2026-02-22T03:00:00.000Z'
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
      buildSource({
        sourceId: 'source_primary_1',
        sourcePriorityScore: 80,
        historicalSuccessRate: 0.92,
        p95LatencyMs: 90,
        costWeight: 2,
        routeTier: 'primary'
      }),
      buildSource({
        sourceId: 'source_fallback_1',
        sourcePriorityScore: 40,
        routeTier: 'fallback'
      })
    ],
    ...overrides
  }
}

function buildDToEOutputLite(overrides = {}) {
  return {
    opportunityKey: 'opp_e2e_001',
    traceKey: 'trace_e2e_001',
    requestKey: 'req_e2e_001',
    attemptKey: 'att_e2e_001',
    auctionDecisionLite: {
      winner: {
        sourceId: 'source_primary_1',
        candidateId: 'cand_e2e_001'
      }
    },
    routeConclusion: {
      routeOutcome: 'served_candidate',
      finalReasonCode: 'd_route_short_circuit_served'
    },
    versionAnchors: {
      routingPolicyVersion: 'd_routing_policy_v2'
    },
    ...overrides
  }
}

function buildRenderPlanLite(overrides = {}) {
  return {
    opportunityKey: 'opp_e2e_001',
    traceKey: 'trace_e2e_001',
    requestKey: 'req_e2e_001',
    attemptKey: 'att_e2e_001',
    responseReference: 'resp_e2e_001',
    deliveryStatus: 'served',
    candidateConsumptionDecision: {
      selectedCandidateRefs: [
        {
          sourceId: 'source_primary_1',
          candidateId: 'cand_e2e_001'
        }
      ]
    },
    versionAnchors: {
      renderPlanContractVersion: 'e_render_plan_contract_v1'
    },
    eErrorDegradeDecisionSnapshotLite: {
      finalCanonicalReasonCode: 'none',
      decisionRuleVersion: 'e_decision_rule_v1'
    },
    ...overrides
  }
}

function baseVersionGateInput(overrides = {}) {
  return {
    requestKey: 'req_gate_e2e_001',
    traceKey: 'trace_gate_e2e_001',
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

function buildAuditRecord(overrides = {}) {
  return {
    auditRecordId: 'audit_e2e_001',
    opportunityKey: 'opp_e2e_001',
    traceKey: 'trace_e2e_001',
    requestKey: 'req_e2e_001',
    attemptKey: 'att_e2e_001',
    responseReferenceOrNA: 'resp_e2e_001',
    auditAt: '2026-02-22T10:00:00.900Z',
    opportunityInputSnapshot: {
      requestSchemaVersion: 'schema_v1',
      placementKey: 'chat_inline',
      placementType: 'native',
      placementSurface: 'chat',
      policyContextDigest: 'p_ctx',
      userContextDigest: 'u_ctx',
      opportunityContextDigest: 'o_ctx',
      ingressReceivedAt: '2026-02-22T10:00:00.000Z'
    },
    adapterParticipation: [
      {
        adapterId: 'cj',
        adapterRequestId: 'adapter_req_e2e_001',
        requestSentAt: '2026-02-22T10:00:00.000Z',
        responseReceivedAtOrNA: '2026-02-22T10:00:00.120Z',
        responseStatus: 'responded',
        responseLatencyMsOrNA: 120,
        timeoutThresholdMs: 1000,
        didTimeout: false,
        responseCodeOrNA: '200',
        candidateReceivedCount: 1,
        candidateAcceptedCount: 1,
        filterReasonCodes: []
      }
    ],
    winnerSnapshot: {
      winnerAdapterIdOrNA: 'cj',
      winnerCandidateRefOrNA: 'cand_e2e_001',
      winnerBidPriceOrNA: 1.2,
      winnerCurrencyOrNA: 'USD',
      winnerReasonCode: 'd_route_winner_selected',
      winnerSelectedAtOrNA: '2026-02-22T10:00:00.200Z'
    },
    renderResultSnapshot: {
      renderStatus: 'rendered',
      renderAttemptIdOrNA: 'render_e2e_001',
      renderStartAtOrNA: '2026-02-22T10:00:00.220Z',
      renderEndAtOrNA: '2026-02-22T10:00:00.260Z',
      renderLatencyMsOrNA: 40,
      renderReasonCodeOrNA: 'e_render_success'
    },
    keyEventSummary: {
      eventWindowStartAt: '2026-02-22T10:00:00.220Z',
      eventWindowEndAt: '2026-02-22T10:02:00.000Z',
      impressionCount: 1,
      clickCount: 0,
      failureCount: 0,
      interactionCount: 0,
      postbackCount: 0,
      terminalEventTypeOrNA: 'impression',
      terminalEventAtOrNA: '2026-02-22T10:00:00.300Z'
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

function loadReplayRecordsFromStore(auditStore) {
  return Array.from(auditStore._debug.dedupStore.values()).map((entry) => ({
    auditRecord: entry.auditRecord,
    outputAt: entry.auditRecord?.auditAt,
    eventAt: entry.auditRecord?.keyEventSummary?.terminalEventAtOrNA,
    recordStatus: 'committed'
  }))
}

function replayControllerFromStore(auditStore, fixedNowIso) {
  const replayEngine = createReplayEngine({
    nowFn: () => Date.parse(fixedNowIso),
    loadRecords: () => loadReplayRecordsFromStore(auditStore)
  })
  return createReplayController({ replayEngine })
}

async function runScenario(caseDef) {
  const startedAt = Date.now()
  try {
    const details = await caseDef.execute()
    return {
      id: caseDef.id,
      name: caseDef.name,
      status: 'PASS',
      durationMs: Date.now() - startedAt,
      details
    }
  } catch (error) {
    return {
      id: caseDef.id,
      name: caseDef.name,
      status: 'FAIL',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          }
        : {
            name: 'UnknownError',
            message: String(error),
            stack: ''
          }
    }
  }
}

test('qa-e2e: closed-loop 8 scenarios with explicit pass/fail report', async () => {
  const scenarios = [
    {
      id: 'E2E-001',
      name: 'happy',
      execute: async () => {
        const versionDecision = evaluateVersionGate(baseVersionGateInput(), baseResolvedConfigSnapshot())
        assert.equal(versionDecision.gateAction, 'allow')

        const policyEngine = createPolicyEngine({ nowFn: () => Date.parse('2026-02-22T00:20:00.000Z') })
        const policyDecision = policyEngine.evaluate(basePolicyInput())
        assert.equal(policyDecision.finalPolicyAction, C_POLICY_ACTIONS.ALLOW)

        const planner = createRoutePlanner({ nowFn: () => Date.parse('2026-02-22T00:21:00.000Z') })
        const routeResult = planner.buildRoutePlan(baseRouteInput())
        assert.equal(routeResult.ok, true)
        assert.equal(routeResult.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_PLAN_READY)

        const deliveryBuilder = createDeliveryOutputBuilder({ nowFn: () => Date.parse('2026-02-22T00:22:00.000Z') })
        const delivery = deliveryBuilder.buildDeliveryResponse({
          dToEOutputLite: buildDToEOutputLite(),
          renderPlanLite: buildRenderPlanLite()
        })
        assert.equal(delivery.ok, true)
        assert.equal(delivery.eDeliveryResponseLite.deliveryStatus, 'served')

        const eventBuilder = createEventOutputBuilder({ nowFn: () => Date.parse('2026-02-22T00:22:01.000Z') })
        const eventOutput = eventBuilder.buildEvent({
          eDeliveryResponseLite: delivery.eDeliveryResponseLite,
          sourceRenderEventType: 'ad_rendered',
          renderAttemptId: 'render_e2e_001'
        })
        assert.equal(eventOutput.ok, true)
        assert.equal(eventOutput.emitted, true)
        assert.equal(eventOutput.eToFEventLite.eventType, 'impression')

        const idempotency = createIdempotencyEngine()
        const idempotencyResult = idempotency.evaluate({
          appId: 'app_e2e',
          batchId: 'batch_e2e_happy',
          event: eventOutput.eToFEventLite,
          nowMs: Date.parse('2026-02-22T00:22:02.000Z')
        })
        assert.equal(idempotencyResult.ok, true)
        assert.equal(idempotencyResult.ackStatus, 'accepted')

        const closure = createTerminalClosureEngine()
        const closureResult = closure.processEvent({
          event: {
            ...eventOutput.eToFEventLite,
            responseReference: eventOutput.eToFEventLite.responseReference,
            renderAttemptId: eventOutput.eToFEventLite.renderAttemptId
          },
          nowMs: Date.parse('2026-02-22T00:22:03.000Z')
        })
        assert.equal(closureResult.ok, true)

        const closureKey = `${eventOutput.eToFEventLite.responseReference}|${eventOutput.eToFEventLite.renderAttemptId}`
        const closureSnapshot = closure.replay(closureKey)
        assert.equal(closureSnapshot.state, 'closed_success')

        const mapper = createFactsMapper({ nowFn: () => Date.parse('2026-02-22T00:22:04.000Z') })
        const mapping = mapper.mapFacts({
          event: {
            ...eventOutput.eToFEventLite,
            eventVersion: 'f_event_contract_v2'
          },
          dedupAckStatus: idempotencyResult.ackStatus,
          closureSnapshot,
          closureKey
        })
        assert.equal(mapping.ok, true)
        assert.equal(mapping.billableFacts.length, 1)
        assert.equal(mapping.attributionFacts.length, 1)

        const archive = createArchiveRecordBuilder({ nowFn: () => Date.parse('2026-02-22T00:22:05.000Z') })
        const archiveResult = archive.buildArchiveRecords({
          mappingResult: mapping,
          sourceEvent: {
            ...eventOutput.eToFEventLite,
            eventVersion: 'f_event_contract_v2'
          },
          canonicalDedupKey: idempotencyResult.canonicalDedupKey,
          versionAnchors: {
            eventContractVersion: 'f_event_contract_v2',
            mappingRuleVersion: 'f_mapping_rule_v1',
            dedupFingerprintVersion: 'f_dedup_v1',
            closureRuleVersion: 'f_closure_rule_v1',
            billingRuleVersion: 'f_billing_rule_v1',
            archiveContractVersion: 'f_archive_contract_v1'
          },
          nowMs: Date.parse('2026-02-22T00:22:05.000Z')
        })
        assert.equal(archiveResult.ok, true)
        assert.equal(archiveResult.fToGArchiveRecordsLite.length >= 3, true)

        const auditStore = createAuditStore({ nowFn: () => Date.parse('2026-02-22T00:22:06.000Z') })
        const appendController = createAppendController({ auditStore })
        const appendResponse = await appendController.handleAppend({
          requestId: 'req_append_e2e_happy_001',
          appendAt: '2026-02-22T00:22:06.000Z',
          appendContractVersion: 'g_append_v1',
          auditRecord: buildAuditRecord()
        })
        assert.equal([200, 202].includes(appendResponse.statusCode), true)

        const replayController = replayControllerFromStore(auditStore, '2026-02-22T00:22:07.000Z')
        const replayQuery = {
          queryMode: G_REPLAY_QUERY_MODES.BY_OPPORTUNITY,
          outputMode: G_REPLAY_OUTPUT_MODES.SUMMARY,
          opportunityKey: 'opp_e2e_001',
          pagination: {
            pageSize: 10,
            pageTokenOrNA: 'NA'
          },
          sort: {
            sortBy: 'auditAt',
            sortOrder: 'desc'
          },
          replayContractVersion: 'g_replay_v1',
          replayAsOfAt: '2026-02-22T00:22:07.000Z'
        }

        const firstReplay = await replayController.handleReplay(replayQuery)
        const secondReplay = await replayController.handleReplay(replayQuery)
        assert.equal(firstReplay.statusCode, 200)
        assert.deepEqual(firstReplay.body, secondReplay.body)

        return {
          deliveryStatus: delivery.eDeliveryResponseLite.deliveryStatus,
          terminalState: closureSnapshot.state,
          replayDeterministic: true
        }
      }
    },
    {
      id: 'E2E-002',
      name: 'policy_block',
      execute: () => {
        const policyEngine = createPolicyEngine({ nowFn: () => Date.parse('2026-02-22T00:30:00.000Z') })
        const policyDecision = policyEngine.evaluate(
          basePolicyInput({
            PolicyContext: {
              consentScope: 'consent_denied',
              policyGateHint: 'deny',
              restrictedCategoryFlags: [],
              frequencyCount: 1
            }
          })
        )
        assert.equal(policyDecision.finalPolicyAction, C_POLICY_ACTIONS.BLOCK)

        const planner = createRoutePlanner()
        const routeResult = planner.buildRoutePlan(
          baseRouteInput({
            isRoutable: false
          })
        )
        assert.equal(routeResult.ok, false)
        assert.equal(routeResult.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_POLICY_BLOCK)

        const deliveryBuilder = createDeliveryOutputBuilder()
        const delivery = deliveryBuilder.buildDeliveryResponse({
          dToEOutputLite: buildDToEOutputLite({
            routeConclusion: {
              routeOutcome: 'no_fill',
              finalReasonCode: 'd_nf_policy_block'
            }
          }),
          renderPlanLite: buildRenderPlanLite({
            deliveryStatus: 'no_fill',
            candidateConsumptionDecision: {
              selectedCandidateRefs: []
            },
            eErrorDegradeDecisionSnapshotLite: {
              finalCanonicalReasonCode: 'e_nf_policy_block',
              decisionRuleVersion: 'e_decision_rule_v1'
            }
          })
        })
        assert.equal(delivery.ok, true)
        assert.equal(delivery.eDeliveryResponseLite.deliveryStatus, 'no_fill')

        const eventBuilder = createEventOutputBuilder()
        const failureEvent = eventBuilder.buildEvent({
          eDeliveryResponseLite: delivery.eDeliveryResponseLite,
          sourceRenderEventType: 'ad_render_failed',
          renderAttemptId: 'render_e2e_policy_001'
        })
        assert.equal(failureEvent.ok, true)
        assert.equal(failureEvent.emitted, true)
        assert.equal(failureEvent.eToFEventLite.eventType, 'failure')

        const closure = createTerminalClosureEngine()
        const closureAck = closure.processEvent({
          event: failureEvent.eToFEventLite,
          nowMs: Date.parse('2026-02-22T00:30:01.000Z')
        })
        assert.equal(closureAck.ok, true)
        assert.equal(closureAck.ackStatus, 'accepted')

        return {
          policyAction: policyDecision.finalPolicyAction,
          deliveryStatus: delivery.eDeliveryResponseLite.deliveryStatus,
          eventType: failureEvent.eToFEventLite.eventType
        }
      }
    },
    {
      id: 'E2E-003',
      name: 'no_fill',
      execute: () => {
        const planner = createRoutePlanner()
        const routeResult = planner.buildRoutePlan(
          baseRouteInput({
            constraintsLite: {
              sourceConstraints: {
                sourceSelectionMode: 'allowlist_only',
                allowedSourceIds: ['source_primary_1'],
                blockedSourceIds: ['source_primary_1']
              }
            }
          })
        )
        assert.equal(routeResult.ok, true)
        assert.equal(routeResult.reasonCode, D_ROUTE_PLAN_REASON_CODES.ROUTE_NO_AVAILABLE_SOURCE)

        const deliveryBuilder = createDeliveryOutputBuilder()
        const delivery = deliveryBuilder.buildDeliveryResponse({
          dToEOutputLite: buildDToEOutputLite({
            routeConclusion: {
              routeOutcome: 'no_fill',
              finalReasonCode: 'd_nf_no_candidate'
            }
          }),
          renderPlanLite: buildRenderPlanLite({
            deliveryStatus: 'no_fill',
            candidateConsumptionDecision: {
              selectedCandidateRefs: []
            },
            eErrorDegradeDecisionSnapshotLite: {
              finalCanonicalReasonCode: 'e_nf_no_candidate_input',
              decisionRuleVersion: 'e_decision_rule_v1'
            }
          })
        })
        assert.equal(delivery.ok, true)

        const closure = createTerminalClosureEngine()
        const terminal = closure.processEvent({
          event: {
            eventId: 'evt_nofill_failure_001',
            eventType: 'failure',
            responseReference: 'resp_nofill_001',
            renderAttemptId: 'render_nofill_001',
            traceKey: 'trace_nofill_001',
            requestKey: 'req_nofill_001',
            attemptKey: 'att_nofill_001',
            opportunityKey: 'opp_nofill_001'
          },
          nowMs: Date.parse('2026-02-22T00:40:00.000Z')
        })
        assert.equal(terminal.ok, true)
        assert.equal(terminal.ackStatus, 'accepted')

        return {
          routeReason: routeResult.reasonCode,
          deliveryStatus: delivery.eDeliveryResponseLite.deliveryStatus,
          closureAckStatus: terminal.ackStatus
        }
      }
    },
    {
      id: 'E2E-004',
      name: 'error',
      execute: () => {
        const failOpen = evaluateFailureMatrix({
          requestKey: 'req_fail_open_001',
          traceKey: 'trace_fail_open_001',
          configFailureScenario: H_CONFIG_FAILURE_SCENARIOS.CONFIG_UNAVAILABLE,
          stableSnapshotRefOrNA: 'stable_snap_001',
          lastStablePolicyIdOrNA: 'policy_stable_001',
          failureDetectedAt: '2026-02-22T00:50:00.000Z',
          failureAuditContractVersion: 'h_cfg_failure_audit_v1'
        })
        assert.equal(failOpen.failureMode, 'fail_open')
        assert.equal(
          failOpen.primaryReasonCode,
          H_CONFIG_FAILURE_REASON_CODES.FAIL_OPEN_UNAVAILABLE_STABLE_SNAPSHOT
        )

        const failClosed = evaluateFailureMatrix({
          requestKey: 'req_fail_closed_001',
          traceKey: 'trace_fail_closed_001',
          configFailureScenario: H_CONFIG_FAILURE_SCENARIOS.CONFIG_TIMEOUT,
          stableSnapshotRefOrNA: 'NA',
          lastStablePolicyIdOrNA: 'NA',
          failureDetectedAt: '2026-02-22T00:50:10.000Z',
          failureAuditContractVersion: 'h_cfg_failure_audit_v1'
        })
        assert.equal(failClosed.failureMode, 'fail_closed')
        assert.equal(
          failClosed.primaryReasonCode,
          H_CONFIG_FAILURE_REASON_CODES.FAIL_CLOSED_NO_STABLE_SNAPSHOT
        )

        return {
          failOpen: failOpen.primaryReasonCode,
          failClosed: failClosed.primaryReasonCode
        }
      }
    },
    {
      id: 'E2E-005',
      name: 'duplicate',
      execute: () => {
        const baseEvent = {
          eventId: 'evt_dup_001',
          eventType: 'impression',
          eventAt: '2026-02-22T01:00:00.000Z',
          traceKey: 'trace_dup_001',
          requestKey: 'req_dup_001',
          attemptKey: 'att_dup_001',
          opportunityKey: 'opp_dup_001',
          responseReference: 'resp_dup_001',
          renderAttemptId: 'render_dup_001',
          creativeId: 'creative_dup_001',
          eventVersion: 'f_event_contract_v2',
          idempotencyKey: 'dup_event_idem_001'
        }

        const idempotency = createIdempotencyEngine()
        const first = idempotency.evaluate({
          appId: 'app_dup',
          batchId: 'batch_dup_001',
          event: baseEvent,
          nowMs: Date.parse('2026-02-22T01:00:01.000Z')
        })
        const second = idempotency.evaluate({
          appId: 'app_dup',
          batchId: 'batch_dup_002',
          event: baseEvent,
          nowMs: Date.parse('2026-02-22T01:00:02.000Z')
        })

        assert.equal(first.ok, true)
        assert.equal(first.ackStatus, 'accepted')
        assert.equal(second.ok, true)
        assert.equal(second.ackStatus, 'duplicate')

        const closure = createTerminalClosureEngine()
        const closureResult = closure.processEvent({
          event: baseEvent,
          nowMs: Date.parse('2026-02-22T01:00:03.000Z')
        })
        assert.equal(closureResult.ok, true)

        const closureSnapshot = closure.replay('resp_dup_001|render_dup_001')
        const mapper = createFactsMapper()
        const firstMap = mapper.mapFacts({
          event: baseEvent,
          dedupAckStatus: first.ackStatus,
          closureSnapshot,
          closureKey: 'resp_dup_001|render_dup_001'
        })
        const secondMap = mapper.mapFacts({
          event: baseEvent,
          dedupAckStatus: second.ackStatus,
          closureSnapshot,
          closureKey: 'resp_dup_001|render_dup_001'
        })

        assert.equal(firstMap.billableFacts.length, 1)
        assert.equal(secondMap.billableFacts.length, 0)

        const store = createAuditStore({ nowFn: () => Date.parse('2026-02-22T01:00:04.000Z') })
        const appendController = createAppendController({ auditStore: store })
        const appendAuditRecord = buildAuditRecord({
          auditRecordId: 'audit_dup_001',
          opportunityKey: 'opp_dup_001',
          traceKey: 'trace_dup_001',
          requestKey: 'req_dup_001',
          attemptKey: 'att_dup_001'
        })
        const firstAppend = appendController.handleAppend({
          requestId: 'req_append_dup_001',
          appendAt: '2026-02-22T01:00:04.000Z',
          appendContractVersion: 'g_append_v1',
          idempotencyKey: 'append_dup_idem_001',
          auditRecord: appendAuditRecord
        })
        const secondAppend = appendController.handleAppend({
          requestId: 'req_append_dup_002',
          appendAt: '2026-02-22T01:00:05.000Z',
          appendContractVersion: 'g_append_v1',
          idempotencyKey: 'append_dup_idem_001',
          auditRecord: appendAuditRecord
        })

        return Promise.all([firstAppend, secondAppend]).then(([appendA, appendB]) => {
          assert.equal(appendA.statusCode, 202)
          assert.equal(appendB.statusCode, 200)
          assert.equal(appendB.body.ackReasonCode, 'g_append_duplicate_accepted_noop')

          return {
            fDedupSecondAck: second.ackStatus,
            gDedupReason: appendB.body.ackReasonCode,
            billableFirst: firstMap.billableFacts.length,
            billableSecond: secondMap.billableFacts.length
          }
        })
      }
    },
    {
      id: 'E2E-006',
      name: 'timeout',
      execute: () => {
        const baseNow = Date.parse('2026-02-22T01:10:00.000Z')
        const closure = createTerminalClosureEngine({ nowFn: () => baseNow })

        const openResult = closure.processEvent({
          event: {
            eventId: 'evt_open_timeout_001',
            eventType: 'ad_filled',
            responseReference: 'resp_timeout_001',
            renderAttemptId: 'render_timeout_001'
          },
          nowMs: baseNow
        })
        assert.equal(openResult.ok, true)
        assert.equal(openResult.closureState, 'open')

        const synthesized = closure.scanTimeouts(baseNow + 121_000)
        assert.equal(synthesized.length, 1)
        assert.equal(
          synthesized[0].reasonCode,
          F_TERMINAL_CLOSURE_REASON_CODES.TERMINAL_TIMEOUT_AUTOFILL
        )

        const secondScan = closure.scanTimeouts(baseNow + 240_000)
        assert.equal(secondScan.length, 0)

        const snapshot = closure.replay('resp_timeout_001|render_timeout_001')
        assert.equal(snapshot.state, 'closed_failure')

        return {
          synthesizedCount: synthesized.length,
          closureState: snapshot.state,
          terminalSource: snapshot.terminalSource
        }
      }
    },
    {
      id: 'E2E-007',
      name: 'version',
      execute: () => {
        const degradeDecision = evaluateVersionGate(
          baseVersionGateInput({
            schemaVersion: '1.1.0',
            sdkVersion: '1.9.0',
            gracePolicyRef: {
              allowBelowMin: true
            }
          }),
          baseResolvedConfigSnapshot()
        )
        assert.equal(degradeDecision.gateAction, 'degrade')
        assert.equal(
          degradeDecision.reasonCodes.includes(H_VERSION_GATE_REASON_CODES.SCHEMA_COMPATIBLE_DEGRADE),
          true
        )

        const rejectDecision = evaluateVersionGate(
          baseVersionGateInput({
            schemaVersion: '9.9.9'
          }),
          baseResolvedConfigSnapshot()
        )
        assert.equal(rejectDecision.gateAction, 'reject')
        assert.deepEqual(rejectDecision.reasonCodes, [H_VERSION_GATE_REASON_CODES.SCHEMA_INCOMPATIBLE_REJECT])

        return {
          degradeReasons: degradeDecision.reasonCodes,
          rejectReasons: rejectDecision.reasonCodes
        }
      }
    },
    {
      id: 'E2E-008',
      name: 'replay',
      execute: async () => {
        const auditStore = createAuditStore({ nowFn: () => Date.parse('2026-02-22T01:20:00.000Z') })
        const appendController = createAppendController({ auditStore })

        for (let i = 1; i <= 3; i += 1) {
          const response = await appendController.handleAppend({
            requestId: `req_append_replay_${i}`,
            appendAt: `2026-02-22T01:20:0${i}.000Z`,
            appendContractVersion: 'g_append_v1',
            forceSync: true,
            auditRecord: buildAuditRecord({
              auditRecordId: `audit_replay_${i}`,
              opportunityKey: 'opp_replay_001',
              traceKey: `trace_replay_${i}`,
              requestKey: `req_replay_${i}`,
              attemptKey: `att_replay_${i}`,
              responseReferenceOrNA: `resp_replay_${i}`,
              auditAt: `2026-02-22T01:1${i}:00.000Z`
            })
          })
          assert.equal(response.statusCode, 200)
        }

        const replayController = replayControllerFromStore(auditStore, '2026-02-22T01:30:00.000Z')

        const snapshotQuery = {
          queryMode: G_REPLAY_QUERY_MODES.BY_OPPORTUNITY,
          outputMode: G_REPLAY_OUTPUT_MODES.SUMMARY,
          opportunityKey: 'opp_replay_001',
          pagination: {
            pageSize: 2,
            pageTokenOrNA: 'NA'
          },
          sort: {
            sortBy: 'auditAt',
            sortOrder: 'desc'
          },
          replayContractVersion: 'g_replay_v1',
          replayAsOfAt: '2026-02-22T01:30:00.000Z'
        }

        const firstSnapshot = await replayController.handleReplay(snapshotQuery)
        const secondSnapshot = await replayController.handleReplay(snapshotQuery)
        assert.equal(firstSnapshot.statusCode, 200)
        assert.deepEqual(firstSnapshot.body, secondSnapshot.body)
        assert.equal(
          firstSnapshot.body.resultMeta.determinismStatus,
          G_REPLAY_DETERMINISM_STATUSES.DETERMINISTIC
        )

        const recompute = await replayController.handleReplay({
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
          },
          pagination: {
            pageSize: 5,
            pageTokenOrNA: 'NA'
          }
        })

        assert.equal(recompute.statusCode, 200)
        assert.equal(recompute.body.replayDiffSummaryLite.diffStatus, G_REPLAY_DIFF_STATUSES.EXACT_MATCH)
        assert.equal(recompute.body.replayDiffSummaryLite.fieldDiffCount, 0)

        return {
          matched: firstSnapshot.body.resultMeta.totalMatched,
          determinism: firstSnapshot.body.resultMeta.determinismStatus,
          diffStatus: recompute.body.replayDiffSummaryLite.diffStatus
        }
      }
    }
  ]

  const results = []
  for (const scenario of scenarios) {
    // Sequential execution keeps deterministic state and timing.
    results.push(await runScenario(scenario))
  }

  const passed = results.filter((item) => item.status === 'PASS').length
  const failed = results.length - passed
  const report = {
    suite: 'qa-e2e-closed-loop',
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      passRate: Number(((passed / results.length) * 100).toFixed(2))
    },
    scenarios: results
  }

  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  assert.equal(results.length, 8)
  assert.equal(failed, 0, `E2E scenarios failed: ${results.filter((item) => item.status === 'FAIL').map((item) => item.id).join(', ')}`)
})
