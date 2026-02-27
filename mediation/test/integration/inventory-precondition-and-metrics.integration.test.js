import assert from 'node:assert/strict'
import test from 'node:test'

import { handleControlPlaneRoutes } from '../../src/devtools/mediation/control-plane-routes.js'
import { computeScopedMetricsSummary } from '../../src/devtools/mediation/mediation-gateway.js'

function createSendJsonCapture() {
  const result = { status: 0, payload: null }
  const sendJson = (_res, status, payload) => {
    result.status = status
    result.payload = payload
  }
  return { result, sendJson }
}

test('quick-start verify returns INVENTORY_EMPTY precondition when strict inventory readiness is not met', async () => {
  const { result, sendJson } = createSendJsonCapture()

  const handled = await handleControlPlaneRoutes({
    req: { method: 'POST', headers: {} },
    res: {},
    pathname: '/api/v1/public/quick-start/verify',
    requestUrl: new URL('http://127.0.0.1/api/v1/public/quick-start/verify'),
  }, {
    sendJson,
    readJsonBody: async () => ({}),
    buildQuickStartVerifyRequest: () => ({
      accountId: 'org_demo',
      appId: 'sample-client-app',
      environment: 'prod',
      placementId: 'chat_from_answer_v1',
      sessionId: 'session_1',
      turnId: 'turn_1',
      query: 'hello',
      answerText: 'world',
      intentScore: 0.8,
      locale: 'en-US',
    }),
    findActiveApiKey: async () => ({ keyId: 'key_1' }),
    isPostgresSettlementStore: () => true,
    settlementStore: { pool: {} },
    getInventoryStatus: async () => ({
      ok: true,
      mode: 'postgres',
      counts: [],
      checkedAt: '2026-02-26T00:00:00.000Z',
    }),
    summarizeInventoryReadiness: () => ({
      ready: false,
      totalOffers: 0,
      missingNetworks: ['partnerstack', 'cj', 'house'],
      coveredNetworks: [],
      coreNetworks: ['partnerstack', 'cj', 'house'],
      countsByNetwork: {},
      checkedAt: '2026-02-26T00:00:00.000Z',
    }),
    INVENTORY_SYNC_COMMAND: 'npm --prefix ./mediation run inventory:sync:all',
  })

  assert.equal(handled, true)
  assert.equal(result.status, 409)
  assert.equal(result.payload?.error?.code, 'INVENTORY_EMPTY')
  assert.equal(
    String(result.payload?.error?.remediation || '').includes('inventory:sync:all'),
    true,
  )
})

test('internal inventory status endpoint returns INVENTORY_EMPTY when readiness is not met', async () => {
  const { result, sendJson } = createSendJsonCapture()

  const handled = await handleControlPlaneRoutes({
    req: { method: 'GET', headers: {} },
    res: {},
    pathname: '/api/v1/internal/inventory/status',
    requestUrl: new URL('http://127.0.0.1/api/v1/internal/inventory/status'),
  }, {
    sendJson,
    isPostgresSettlementStore: () => true,
    settlementStore: { pool: {} },
    getInventoryStatus: async () => ({
      ok: true,
      mode: 'postgres',
      counts: [{ network: 'partnerstack', offer_count: 0 }],
      checkedAt: '2026-02-26T00:00:00.000Z',
    }),
    summarizeInventoryReadiness: () => ({
      ready: false,
      totalOffers: 0,
      missingNetworks: ['partnerstack', 'cj', 'house'],
      coveredNetworks: [],
      coreNetworks: ['partnerstack', 'cj', 'house'],
      countsByNetwork: { partnerstack: 0 },
      checkedAt: '2026-02-26T00:00:00.000Z',
    }),
    INVENTORY_SYNC_COMMAND: 'npm --prefix ./mediation run inventory:sync:all',
  })

  assert.equal(handled, true)
  assert.equal(result.status, 409)
  assert.equal(result.payload?.error?.code, 'INVENTORY_EMPTY')
  assert.equal(typeof result.payload?.status?.ok, 'boolean')
})

test('metrics summary exposes placement_unavailable/inventory_empty/scope_violation ratios', () => {
  const summary = computeScopedMetricsSummary(
    [
      { result: 'served', reasonDetail: 'served' },
      { result: 'blocked', reasonDetail: 'placement_unavailable' },
      { result: 'no_fill', reasonDetail: 'inventory_empty' },
      { result: 'no_fill', reasonDetail: 'inventory_no_match' },
      {
        result: 'error',
        reasonDetail: 'runtime_pipeline_fail_open',
        runtime: {
          timeoutSignal: { occurred: true, stage: 'total', budgetMs: 1000 },
          precheck: {
            inventory: { ready: false },
          },
          budgetExceeded: { total: true },
          reasonCode: 'upstream_timeout',
        },
      },
    ],
    [
      { eventType: 'sdk_event', kind: 'click' },
    ],
    [
      { postbackStatus: 'success', cpaUsd: 1.25, occurredAt: '2026-02-26T00:00:00.000Z' },
    ],
    [
      { action: 'agent_access_deny', metadata: { code: 'ACCESS_TOKEN_SCOPE_VIOLATION' } },
    ],
  )

  assert.equal(summary.reasonCounts?.placementUnavailable, 1)
  assert.equal(summary.reasonCounts?.inventoryEmpty, 1)
  assert.equal(summary.reasonCounts?.scopeViolation, 1)
  assert.equal(summary.reasonRatios?.placementUnavailable, 0.2)
  assert.equal(summary.reasonRatios?.inventoryEmpty, 0.2)
  assert.equal(summary.reasonRatios?.scopeViolation, 0.2)
  assert.equal(summary.bidKnownCount, 4)
  assert.equal(summary.bidUnknownCount, 1)
  assert.equal(summary.bidFillRateKnown, 0.25)
  assert.equal(summary.unknownRate, 0.2)
  assert.equal(summary.resultBreakdown?.served, 1)
  assert.equal(summary.resultBreakdown?.error, 1)
  assert.equal(summary.timeoutRelatedCount, 1)
  assert.equal(summary.precheckInventoryNotReadyCount, 1)
  assert.equal(summary.budgetExceededCount, 1)
})
