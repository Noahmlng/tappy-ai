import assert from 'node:assert/strict'
import test from 'node:test'

import { createAuditStore } from '../../src/mediation/audit-replay/audit-store.js'
import { createReplayController } from '../../src/mediation/audit-replay/replay-controller.js'
import {
  createReplayEngine,
  G_REPLAY_DETERMINISM_STATUSES,
  G_REPLAY_DIFF_STATUSES,
  G_REPLAY_EXECUTION_MODES,
  G_REPLAY_OUTPUT_MODES,
  G_REPLAY_QUERY_MODES,
  G_REPLAY_REASON_CODES
} from '../../src/mediation/audit-replay/replay-engine.js'

function buildAdapterParticipation(overrides = {}) {
  return {
    adapterId: 'cj',
    adapterRequestId: 'adapter_req_g_replay_001',
    requestSentAt: '2026-02-22T09:59:59.900Z',
    responseReceivedAtOrNA: '2026-02-22T10:00:00.020Z',
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

function buildAuditRecord(overrides = {}) {
  const auditAt = overrides.auditAt || '2026-02-22T10:00:00.800Z'
  return {
    auditRecordId: 'audit_replay_001',
    opportunityKey: 'opp_replay_001',
    traceKey: 'trace_replay_001',
    requestKey: 'req_replay_001',
    attemptKey: 'att_replay_001',
    responseReferenceOrNA: 'resp_replay_001',
    auditAt,
    opportunityInputSnapshot: {
      requestSchemaVersion: 'schema_v1',
      placementKey: 'chat_inline',
      placementType: 'native',
      placementSurface: 'chat',
      policyContextDigest: 'policy_ctx_v1',
      userContextDigest: 'user_ctx_v1',
      opportunityContextDigest: 'opp_ctx_v1',
      ingressReceivedAt: '2026-02-22T10:00:00.000Z'
    },
    adapterParticipation: [buildAdapterParticipation()],
    winnerSnapshot: {
      winnerAdapterIdOrNA: 'cj',
      winnerCandidateRefOrNA: 'cand_replay_001',
      winnerBidPriceOrNA: 1.25,
      winnerCurrencyOrNA: 'USD',
      winnerReasonCode: 'd_route_winner_selected',
      winnerSelectedAtOrNA: '2026-02-22T10:00:00.100Z'
    },
    renderResultSnapshot: {
      renderStatus: 'rendered',
      renderAttemptIdOrNA: 'render_replay_001',
      renderStartAtOrNA: '2026-02-22T10:00:00.120Z',
      renderEndAtOrNA: '2026-02-22T10:00:00.200Z',
      renderLatencyMsOrNA: 80,
      renderReasonCodeOrNA: 'e_render_success'
    },
    keyEventSummary: {
      eventWindowStartAt: '2026-02-22T10:00:00.120Z',
      eventWindowEndAt: '2026-02-22T10:02:00.000Z',
      impressionCount: 1,
      clickCount: 0,
      failureCount: 0,
      interactionCount: 0,
      postbackCount: 0,
      terminalEventTypeOrNA: 'impression',
      terminalEventAtOrNA: '2026-02-22T10:00:00.220Z'
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

function buildAppendRequest(overrides = {}) {
  return {
    requestId: 'append_req_replay_001',
    appendAt: '2026-02-22T10:00:01.000Z',
    appendContractVersion: 'g_append_v1',
    auditRecord: buildAuditRecord(),
    forceSync: true,
    ...overrides
  }
}

function buildReplayQuery(overrides = {}) {
  return {
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
    ...overrides
  }
}

function buildReplayHarness() {
  const fixedNowMs = Date.parse('2026-02-22T12:00:00.000Z')
  const auditStore = createAuditStore({
    nowFn: () => fixedNowMs
  })

  const appendRequests = [
    buildAppendRequest({
      requestId: 'append_req_replay_001',
      auditRecord: buildAuditRecord({
        auditRecordId: 'audit_replay_001',
        opportunityKey: 'opp_replay_001',
        traceKey: 'trace_replay_001',
        requestKey: 'req_replay_001',
        attemptKey: 'att_replay_001',
        responseReferenceOrNA: 'resp_replay_001',
        auditAt: '2026-02-22T10:00:00.800Z'
      })
    }),
    buildAppendRequest({
      requestId: 'append_req_replay_002',
      auditRecord: buildAuditRecord({
        auditRecordId: 'audit_replay_002',
        opportunityKey: 'opp_replay_001',
        traceKey: 'trace_replay_002',
        requestKey: 'req_replay_002',
        attemptKey: 'att_replay_002',
        responseReferenceOrNA: 'resp_replay_002',
        auditAt: '2026-02-22T10:01:00.800Z'
      })
    }),
    buildAppendRequest({
      requestId: 'append_req_replay_003',
      auditRecord: buildAuditRecord({
        auditRecordId: 'audit_replay_003',
        opportunityKey: 'opp_replay_001',
        traceKey: 'trace_replay_003',
        requestKey: 'req_replay_003',
        attemptKey: 'att_replay_003',
        responseReferenceOrNA: 'resp_replay_003',
        auditAt: '2026-02-22T10:02:00.800Z'
      })
    }),
    buildAppendRequest({
      requestId: 'append_req_replay_004',
      auditRecord: buildAuditRecord({
        auditRecordId: 'audit_replay_004',
        opportunityKey: 'opp_replay_other',
        traceKey: 'trace_replay_004',
        requestKey: 'req_replay_004',
        attemptKey: 'att_replay_004',
        responseReferenceOrNA: 'resp_replay_004',
        auditAt: '2026-02-22T10:03:00.800Z'
      })
    })
  ]

  for (const req of appendRequests) {
    const ack = auditStore.append(req)
    assert.equal(ack.ackStatus, 'accepted')
  }

  const replayEngine = createReplayEngine({
    nowFn: () => fixedNowMs,
    loadRecords: () => Array.from(auditStore._debug.dedupStore.values()).map((entry) => ({
      auditRecord: entry.auditRecord,
      outputAt: entry.auditRecord?.auditAt,
      eventAt: entry.auditRecord?.keyEventSummary?.terminalEventAtOrNA,
      recordStatus: 'committed'
    }))
  })

  const replayController = createReplayController({
    replayEngine
  })

  return {
    replayController,
    fixedNowIso: new Date(fixedNowMs).toISOString()
  }
}

test('g-replay-determinism: snapshot replay with same anchor is deterministic and paginated stably', async () => {
  const { replayController, fixedNowIso } = buildReplayHarness()

  const first = await replayController.handleReplay(
    buildReplayQuery({
      replayAsOfAt: fixedNowIso
    })
  )

  assert.equal(first.statusCode, 200)
  assert.equal(first.body.resultMeta.totalMatched, 3)
  assert.equal(first.body.resultMeta.returnedCount, 2)
  assert.equal(first.body.resultMeta.hasMore, true)
  assert.equal(first.body.resultMeta.replayExecutionMode, G_REPLAY_EXECUTION_MODES.SNAPSHOT_REPLAY)
  assert.equal(first.body.resultMeta.determinismStatus, G_REPLAY_DETERMINISM_STATUSES.DETERMINISTIC)
  assert.equal(first.body.queryEcho.resolvedReplayAsOfAt, fixedNowIso)
  assert.equal(first.body.items[0].traceKey, 'trace_replay_003')
  assert.equal(first.body.items[1].traceKey, 'trace_replay_002')

  const secondPage = await replayController.handleReplay(
    buildReplayQuery({
      replayAsOfAt: fixedNowIso,
      pagination: {
        pageSize: 2,
        pageTokenOrNA: first.body.resultMeta.nextCursorOrNA
      }
    })
  )

  assert.equal(secondPage.statusCode, 200)
  assert.equal(secondPage.body.resultMeta.returnedCount, 1)
  assert.equal(secondPage.body.resultMeta.hasMore, false)
  assert.equal(secondPage.body.items[0].traceKey, 'trace_replay_001')

  const rerun = await replayController.handleReplay(
    buildReplayQuery({
      replayAsOfAt: fixedNowIso
    })
  )

  assert.equal(rerun.statusCode, 200)
  assert.deepEqual(rerun.body, first.body)
})

test('g-replay-determinism: rule_recompute returns stable diff summary with zero diff', async () => {
  const { replayController, fixedNowIso } = buildReplayHarness()

  const query = buildReplayQuery({
    replayAsOfAt: fixedNowIso,
    outputMode: G_REPLAY_OUTPUT_MODES.FULL,
    pagination: {
      pageSize: 5,
      pageTokenOrNA: 'NA'
    },
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

  const first = await replayController.handleReplay(query)
  assert.equal(first.statusCode, 200)
  assert.equal(first.body.resultMeta.replayExecutionMode, G_REPLAY_EXECUTION_MODES.RULE_RECOMPUTE)
  assert.equal(first.body.resultMeta.determinismStatus, G_REPLAY_DETERMINISM_STATUSES.DETERMINISTIC)
  assert.equal(first.body.replayDiffSummaryLite.diffStatus, G_REPLAY_DIFF_STATUSES.EXACT_MATCH)
  assert.equal(first.body.replayDiffSummaryLite.fieldDiffCount, 0)
  assert.deepEqual(first.body.replayDiffSummaryLite.diffReasonCodes, [G_REPLAY_REASON_CODES.DIFF_NONE])
  assert.equal(Array.isArray(first.body.items), true)
  assert.equal(Boolean(first.body.items[0].gAuditRecordLite), true)
  assert.equal(Array.isArray(first.body.items[0].fToGArchiveRecordLite), true)
  assert.equal(Array.isArray(first.body.items[0].factDecisionAuditLite), true)

  const second = await replayController.handleReplay(query)
  assert.equal(second.statusCode, 200)
  assert.deepEqual(second.body, first.body)
})

test('g-replay-determinism: empty result semantics distinguish not_found and filtered_out', async () => {
  const { replayController, fixedNowIso } = buildReplayHarness()

  const byOpportunityMissing = await replayController.handleReplay(
    buildReplayQuery({
      replayAsOfAt: fixedNowIso,
      opportunityKey: 'opp_not_exist'
    })
  )

  assert.equal(byOpportunityMissing.statusCode, 200)
  assert.equal(byOpportunityMissing.body.emptyResult.isEmpty, true)
  assert.equal(byOpportunityMissing.body.emptyResult.emptyReasonCode, G_REPLAY_REASON_CODES.NOT_FOUND_OPPORTUNITY)
  assert.deepEqual(byOpportunityMissing.body.items, [])

  const byTimeRangeFilteredOut = await replayController.handleReplay({
    queryMode: G_REPLAY_QUERY_MODES.BY_TIME_RANGE,
    outputMode: G_REPLAY_OUTPUT_MODES.SUMMARY,
    timeRange: {
      startAt: '2026-02-22T10:00:00.000Z',
      endAt: '2026-02-22T10:04:00.000Z'
    },
    filters: {
      traceKey: 'trace_not_exist'
    },
    pagination: {
      pageSize: 10,
      pageTokenOrNA: 'NA'
    },
    sort: {
      sortBy: 'auditAt',
      sortOrder: 'desc'
    },
    replayContractVersion: 'g_replay_v1',
    replayAsOfAt: fixedNowIso
  })

  assert.equal(byTimeRangeFilteredOut.statusCode, 200)
  assert.equal(byTimeRangeFilteredOut.body.emptyResult.isEmpty, true)
  assert.equal(byTimeRangeFilteredOut.body.emptyResult.emptyReasonCode, G_REPLAY_REASON_CODES.FILTERED_OUT)
  assert.equal(byTimeRangeFilteredOut.body.resultMeta.totalMatched, 0)
})

