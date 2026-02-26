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

test('runtime-routes rejects legacy placementId for /api/v2/bid with structured error', async () => {
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
      userId: 'user_001',
      chatId: 'chat_001',
      placementId: 'chat_inline_v1',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    normalizeV2BidPayload: (payload) => ({
      userId: String(payload?.userId || '').trim(),
      chatId: String(payload?.chatId || '').trim(),
      placementId: assertPlacementIdNotRenamed(payload?.placementId, 'placementId'),
      messages: Array.isArray(payload?.messages) ? payload.messages : [],
    }),
  })

  assert.equal(handled, true)
  assert.equal(result.status, 400)
  assert.equal(result.payload?.error?.code, 'PLACEMENT_ID_RENAMED')
  assert.equal(result.payload?.error?.placementId, 'chat_inline_v1')
  assert.equal(result.payload?.error?.replacementPlacementId, 'chat_from_answer_v1')
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
