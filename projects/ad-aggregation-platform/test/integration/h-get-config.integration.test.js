import assert from 'node:assert/strict'
import test from 'node:test'

import {
  H_CONFIG_CACHE_DECISIONS,
  H_CONFIG_CACHE_REASON_CODES
} from '../../src/mediation/h/config-cache.js'
import { resolveConfig } from '../../src/mediation/h/config-resolution.js'
import { createConfigController } from '../../src/mediation/api/config-controller.js'

function buildContext(nowMs) {
  return {
    requestKey: `req_${nowMs}`,
    traceKey: `trace_${nowMs}`,
    appId: 'app_chat_main',
    placementId: 'chat_inline_v1',
    environment: 'prod',
    schemaVersion: 'schema_v1',
    resolveAt: new Date(nowMs).toISOString(),
    configResolutionContractVersion: 'h_cfg_resolution_v1',
    routingStrategyVersion: 'route_v1'
  }
}

function buildScopes({ ttlSec = 5, routePolicyRef = 'route/global/v1' } = {}) {
  const globalScope = {
    configVersion: 'global_v12',
    schemaVersion: 'schema_v1',
    config: {
      policyThresholdsRef: 'policy/global/v3',
      routePolicyRef,
      templateWhitelistRef: 'tpl/global/v7',
      blackWhiteListRef: 'bw/global/v2',
      sdkMinVersion: '1.8.0',
      missingMinVersionPolicy: 'reject',
      adapterMinVersionMap: {
        cj: '2.1.0',
        partnerstack: '2.0.0'
      },
      ttlSec
    }
  }

  const appScope = {
    configVersion: 'app_v20',
    schemaVersion: 'schema_v1',
    config: {}
  }

  const placementScope = {
    configVersion: 'placement_v31',
    placementSourceVersion: 'placement_source_v31',
    schemaVersion: 'schema_v1',
    config: {}
  }

  return { globalScope, appScope, placementScope }
}

function createResolver(clock) {
  let shouldFail = false
  let routePolicyRef = 'route/global/v1'
  let callCount = 0

  return {
    setFail(next) {
      shouldFail = next
    },
    setRoutePolicyRef(next) {
      routePolicyRef = next
    },
    getCallCount() {
      return callCount
    },
    async resolve() {
      callCount += 1
      if (shouldFail) {
        throw new Error('config upstream unavailable')
      }

      const { globalScope, appScope, placementScope } = buildScopes({
        ttlSec: 5,
        routePolicyRef
      })

      return resolveConfig(globalScope, appScope, placementScope, buildContext(clock.nowMs))
    }
  }
}

function buildRequest(nowMs, overrides = {}) {
  return {
    appId: 'app_chat_main',
    placementId: 'chat_inline_v1',
    environment: 'prod',
    schemaVersion: 'schema_v1',
    sdkVersion: '1.0.0',
    requestAt: new Date(nowMs).toISOString(),
    ...overrides
  }
}

test('h-get-config: ETag match returns 304 and sdkVersion does not alter snapshot selection', async () => {
  const clock = { nowMs: Date.parse('2026-02-21T13:00:00.000Z') }
  const resolver = createResolver(clock)
  const controller = createConfigController({
    nowFn: () => clock.nowMs,
    resolveLatestConfigSnapshot: resolver.resolve
  })

  const first = await controller.handleGetConfig(buildRequest(clock.nowMs, { sdkVersion: '1.0.0' }))
  assert.equal(first.statusCode, 200)
  assert.equal(first.body.cacheDecision, H_CONFIG_CACHE_DECISIONS.MISS)
  assert.equal(first.body.reasonCodes.includes(H_CONFIG_CACHE_REASON_CODES.MISS), true)

  const firstSnapshot = first.body.resolvedConfigSnapshot
  const firstEtagHeader = first.headers.ETag
  assert.equal(typeof firstEtagHeader, 'string')
  assert.equal(firstEtagHeader.startsWith('"') && firstEtagHeader.endsWith('"'), true)

  const second = await controller.handleGetConfig(
    buildRequest(clock.nowMs + 1000, {
      sdkVersion: '9.9.9',
      ifNoneMatch: firstEtagHeader
    })
  )

  assert.equal(second.statusCode, 304)
  assert.equal(second.body, null)
  assert.equal(second.headers.ETag, firstEtagHeader)
  assert.equal(resolver.getCallCount(), 1)

  const third = await controller.handleGetConfig(buildRequest(clock.nowMs + 1500, { sdkVersion: '2.0.0' }))
  assert.equal(third.statusCode, 200)
  assert.equal(third.body.cacheDecision, H_CONFIG_CACHE_DECISIONS.REVALIDATED_NOT_MODIFIED)
  assert.equal(third.body.reasonCodes.includes(H_CONFIG_CACHE_REASON_CODES.HIT_FRESH), true)
  assert.deepEqual(third.body.resolvedConfigSnapshot, firstSnapshot)
})

test('h-get-config: expired revalidate failure supports stale_grace then fail-closed', async () => {
  const clock = { nowMs: Date.parse('2026-02-21T14:00:00.000Z') }
  const resolver = createResolver(clock)
  const controller = createConfigController({
    nowFn: () => clock.nowMs,
    staleGraceWindowSec: 60,
    resolveLatestConfigSnapshot: resolver.resolve
  })

  const first = await controller.handleGetConfig(buildRequest(clock.nowMs))
  assert.equal(first.statusCode, 200)
  assert.equal(first.body.ttlSec, 5)

  resolver.setFail(true)

  clock.nowMs += 6 * 1000
  const staleGraceHit = await controller.handleGetConfig(buildRequest(clock.nowMs))
  assert.equal(staleGraceHit.statusCode, 200)
  assert.equal(staleGraceHit.body.cacheDecision, H_CONFIG_CACHE_DECISIONS.STALE_SERVED)
  assert.equal(
    staleGraceHit.body.reasonCodes.includes(H_CONFIG_CACHE_REASON_CODES.STALE_GRACE_SERVED),
    true
  )

  clock.nowMs += 65 * 1000
  const hardExpired = await controller.handleGetConfig(buildRequest(clock.nowMs))
  assert.equal(hardExpired.statusCode, 503)
  assert.equal(hardExpired.body.reasonCode, H_CONFIG_CACHE_REASON_CODES.EXPIRED_REVALIDATE_FAILED)
})

test('h-get-config: invalid If-None-Match format is treated as missing and recorded', async () => {
  const clock = { nowMs: Date.parse('2026-02-21T15:00:00.000Z') }
  const resolver = createResolver(clock)
  const controller = createConfigController({
    nowFn: () => clock.nowMs,
    resolveLatestConfigSnapshot: resolver.resolve
  })

  const result = await controller.handleGetConfig(
    buildRequest(clock.nowMs, {
      ifNoneMatch: 'W/"weak-etag-format-not-allowed"'
    })
  )

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.cacheDecision, H_CONFIG_CACHE_DECISIONS.MISS)
  assert.equal(result.body.reasonCodes.includes(H_CONFIG_CACHE_REASON_CODES.INVALID_ETAG_FORMAT), true)
})
