import assert from 'node:assert/strict'
import test from 'node:test'

import { handleControlPlaneRoutes } from '../../src/devtools/mediation/control-plane-routes.js'

function captureSendJson() {
  const result = { status: 0, payload: null }
  const sendJson = (_res, status, payload) => {
    result.status = status
    result.payload = payload
  }
  return { result, sendJson }
}

test('control-plane removed bootstrap route returns 410', async () => {
  const { result, sendJson } = captureSendJson()
  const handled = await handleControlPlaneRoutes({
    req: { method: 'GET', headers: {} },
    res: {},
    pathname: '/api/v1/public/sdk/bootstrap',
    requestUrl: new URL('http://127.0.0.1/api/v1/public/sdk/bootstrap'),
  }, {
    sendJson,
  })

  assert.equal(handled, true)
  assert.equal(result.status, 410)
  assert.equal(result.payload?.error?.code, 'BOOTSTRAP_REMOVED')
})

test('control-plane removed runtime-domain verify route returns 410', async () => {
  const { result, sendJson } = captureSendJson()
  const handled = await handleControlPlaneRoutes({
    req: { method: 'POST', headers: {} },
    res: {},
    pathname: '/api/v1/public/runtime-domain/verify-and-bind',
    requestUrl: new URL('http://127.0.0.1/api/v1/public/runtime-domain/verify-and-bind'),
  }, {
    sendJson,
  })

  assert.equal(handled, true)
  assert.equal(result.status, 410)
  assert.equal(result.payload?.error?.code, 'RUNTIME_BIND_FLOW_REMOVED')
})

test('control-plane removed runtime-domain probe route returns 410', async () => {
  const { result, sendJson } = captureSendJson()
  const handled = await handleControlPlaneRoutes({
    req: { method: 'POST', headers: {} },
    res: {},
    pathname: '/api/v1/public/runtime-domain/probe',
    requestUrl: new URL('http://127.0.0.1/api/v1/public/runtime-domain/probe'),
  }, {
    sendJson,
  })

  assert.equal(handled, true)
  assert.equal(result.status, 410)
  assert.equal(result.payload?.error?.code, 'RUNTIME_BIND_FLOW_REMOVED')
})
