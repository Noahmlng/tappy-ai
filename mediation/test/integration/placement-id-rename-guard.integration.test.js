import assert from 'node:assert/strict'
import test from 'node:test'

import { handleRuntimeRoutes } from '../../src/devtools/mediation/runtime-routes.js'
import { handleControlPlaneRoutes } from '../../src/devtools/mediation/control-plane-routes.js'

const LEGACY_TO_NEW_PLACEMENT_ID = Object.freeze({
  chat_inline_v1: 'chat_from_answer_v1',
  chat_followup_v1: 'chat_intent_recommendation_v1',
})

function createPlacementRenamedError(placementId, fieldName = 'placementId') {
  const replacementPlacementId = String(LEGACY_TO_NEW_PLACEMENT_ID[placementId] || '').trim()
  const error = new Error(
    `${fieldName} "${placementId}" has been renamed to "${replacementPlacementId}". Use "${replacementPlacementId}" instead.`,
  )
  error.code = 'PLACEMENT_ID_RENAMED'
  error.statusCode = 400
  error.fieldName = fieldName
  error.placementId = placementId
  error.replacementPlacementId = replacementPlacementId
  return error
}

function assertPlacementIdNotRenamed(value, fieldName = 'placementId') {
  const placementId = String(value || '').trim()
  if (!placementId) return placementId
  if (Object.prototype.hasOwnProperty.call(LEGACY_TO_NEW_PLACEMENT_ID, placementId)) {
    throw createPlacementRenamedError(placementId, fieldName)
  }
  return placementId
}

function createSendJsonCapture() {
  const result = { status: 0, payload: null }
  const sendJson = (_res, status, payload) => {
    result.status = status
    result.payload = payload
  }
  return { result, sendJson }
}

test('runtime-routes rejects legacy placementId for /api/v1/mediation/config with structured error', async () => {
  const { result, sendJson } = createSendJsonCapture()
  const handled = await handleRuntimeRoutes({
    req: { method: 'GET', headers: {} },
    res: {},
    pathname: '/api/v1/mediation/config',
    requestUrl: new URL('http://127.0.0.1/api/v1/mediation/config?placementId=chat_inline_v1'),
  }, {
    sendJson,
    withCors: () => {},
    assertPlacementIdNotRenamed,
  })

  assert.equal(handled, true)
  assert.equal(result.status, 400)
  assert.equal(result.payload?.error?.code, 'PLACEMENT_ID_RENAMED')
  assert.equal(result.payload?.error?.placementId, 'chat_inline_v1')
  assert.equal(result.payload?.error?.replacementPlacementId, 'chat_from_answer_v1')
})

test('runtime-routes allows legacy placementId for /api/v2/bid after payload normalization', async () => {
  const { result, sendJson } = createSendJsonCapture()
  let authorizePlacementId = ''
  const handled = await handleRuntimeRoutes({
    req: { method: 'POST', headers: {} },
    res: {},
    pathname: '/api/v2/bid',
    requestUrl: new URL('http://127.0.0.1/api/v2/bid'),
  }, {
    sendJson,
    withCors: () => {},
    assertPlacementIdNotRenamed,
    readJsonBody: async () => ({
      userId: 'user_001',
      chatId: 'chat_001',
      placementId: 'chat_inline_v1',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    normalizeV2BidPayload: (payload) => ({
      userId: String(payload?.userId || '').trim(),
      chatId: String(payload?.chatId || '').trim(),
      placementId: String(LEGACY_TO_NEW_PLACEMENT_ID[payload?.placementId] || payload?.placementId || '').trim(),
      messages: Array.isArray(payload?.messages) ? payload.messages : [],
    }),
    authorizeRuntimeCredential: async (_req, options = {}) => {
      authorizePlacementId = String(options?.placementId || '').trim()
      return { ok: true, mode: 'anonymous' }
    },
    applyRuntimeCredentialScope: (scope) => scope,
    DEFAULT_CONTROL_PLANE_APP_ID: 'sample-client-app',
    normalizeControlPlaneAccountId: () => 'org_demo',
    resolveAccountIdForApp: () => 'org_demo',
    evaluateV2BidRequest: async () => ({
      requestId: 'req_legacy_mapped',
      timestamp: '2026-02-26T00:00:00.000Z',
      message: 'No bid',
      opportunityId: 'opp_legacy_mapped',
      diagnostics: { reasonCode: 'no_bid' },
      data: { bid: null },
    }),
    nowIso: () => '2026-02-26T00:00:00.000Z',
  })

  assert.equal(handled, true)
  assert.equal(authorizePlacementId, 'chat_from_answer_v1')
  assert.equal(result.status, 200)
  assert.equal(result.payload?.filled, false)
  assert.equal(result.payload?.landingUrl, null)
})

test('runtime-routes fail-opens /api/v2/bid when evaluator returns internal 5xx', async () => {
  const { result, sendJson } = createSendJsonCapture()
  const handled = await handleRuntimeRoutes({
    req: { method: 'POST', headers: {} },
    res: {},
    pathname: '/api/v2/bid',
    requestUrl: new URL('http://127.0.0.1/api/v2/bid'),
  }, {
    sendJson,
    withCors: () => {},
    assertPlacementIdNotRenamed,
    readJsonBody: async () => ({
      userId: 'user_internal_error',
      chatId: 'chat_internal_error',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    normalizeV2BidPayload: (payload) => ({
      userId: String(payload?.userId || '').trim(),
      chatId: String(payload?.chatId || '').trim(),
      placementId: '',
      messages: Array.isArray(payload?.messages) ? payload.messages : [],
      inputDiagnostics: {
        defaultsApplied: {
          userIdGenerated: false,
          chatIdDefaultedToUserId: false,
          placementIdDefaulted: true,
          placementIdResolvedFromDashboardDefault: false,
          placementIdFallbackApplied: true,
        },
      },
    }),
    authorizeRuntimeCredential: async () => ({ ok: true, mode: 'anonymous' }),
    applyRuntimeCredentialScope: (scope) => scope,
    DEFAULT_CONTROL_PLANE_APP_ID: 'sample-client-app',
    normalizeControlPlaneAccountId: () => 'org_demo',
    resolveAccountIdForApp: () => 'org_demo',
    pickPlacementForRequest: () => null,
    PLACEMENT_ID_FROM_ANSWER: 'chat_from_answer_v1',
    evaluateV2BidRequest: async () => {
      const error = new Error('upstream internal error')
      error.code = 'INTERNAL_ERROR'
      error.statusCode = 500
      throw error
    },
    createId: () => 'req_fail_open_001',
    nowIso: () => '2026-02-27T00:00:00.000Z',
  })

  assert.equal(handled, true)
  assert.equal(result.status, 200)
  assert.equal(result.payload?.requestId, 'req_fail_open_001')
  assert.equal(result.payload?.status, 'success')
  assert.equal(result.payload?.message, 'No bid')
  assert.equal(result.payload?.filled, false)
  assert.equal(result.payload?.landingUrl, null)
  assert.equal(result.payload?.decisionTrace?.reasonCode, 'upstream_error')
  assert.equal(result.payload?.diagnostics?.reasonCode, 'upstream_non_2xx')
  assert.equal(result.payload?.diagnostics?.upstreamStatus, 500)
  assert.equal(result.payload?.diagnostics?.failOpenApplied, true)
  assert.equal(result.payload?.data?.bid, null)
  assert.equal(result.payload?.diagnostics?.inputNormalization?.defaultsApplied?.placementIdFallbackApplied, true)
})

test('control-plane routes rejects legacy placementId for integration-token issue with structured error', async () => {
  const { result, sendJson } = createSendJsonCapture()
  const handled = await handleControlPlaneRoutes({
    req: { method: 'POST', headers: {} },
    res: {},
    pathname: '/api/v1/public/agent/integration-token',
    requestUrl: new URL('http://127.0.0.1/api/v1/public/agent/integration-token'),
  }, {
    state: { controlPlane: { integrationTokens: [], agentAccessTokens: [] } },
    sendJson,
    readJsonBody: async () => ({
      appId: 'sample-client-app',
      accountId: 'org_demo',
      environment: 'prod',
      ttlMinutes: 10,
      placementId: 'chat_inline_v1',
    }),
    authorizeDashboardScope: async () => ({
      ok: true,
      scope: { accountId: 'org_demo', appId: 'sample-client-app' },
      user: { appId: 'sample-client-app' },
      session: { appId: 'sample-client-app' },
    }),
    resolveAuthorizedDashboardAccount: () => 'org_demo',
    validateDashboardAccountOwnership: () => ({ ok: true }),
    validateDashboardAppOwnership: async () => ({ ok: true }),
    findLatestAppForAccount: () => ({ appId: 'sample-client-app' }),
    CONTROL_PLANE_ENVIRONMENTS: new Set(['prod']),
    toPositiveInteger: (value, fallback = 0) => {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return fallback
      return Math.floor(n)
    },
    assertPlacementIdNotRenamed,
    normalizePlacementIdWithMigration: (value, fallback = '') => String(value || '').trim() || String(fallback || '').trim(),
    PLACEMENT_ID_FROM_ANSWER: 'chat_from_answer_v1',
  })

  assert.equal(handled, true)
  assert.equal(result.status, 400)
  assert.equal(result.payload?.error?.code, 'PLACEMENT_ID_RENAMED')
  assert.equal(result.payload?.error?.placementId, 'chat_inline_v1')
  assert.equal(result.payload?.error?.replacementPlacementId, 'chat_from_answer_v1')
})
