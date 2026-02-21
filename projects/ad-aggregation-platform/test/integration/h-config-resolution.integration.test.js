import assert from 'node:assert/strict'
import test from 'node:test'

import {
  H_CONFIG_RESOLUTION_REASON_CODES,
  H_CONFIG_RESOLUTION_STATUSES,
  resolveConfig
} from '../../src/mediation/h/config-resolution.js'

function baseContext() {
  return {
    requestKey: 'req_h_001',
    traceKey: 'trace_h_001',
    appId: 'app_chat_main',
    placementId: 'chat_inline_v1',
    environment: 'prod',
    schemaVersion: 'schema_v1',
    resolveAt: '2026-02-21T12:00:00.000Z',
    configResolutionContractVersion: 'h_cfg_resolution_v1',
    routingStrategyVersion: 'route_v3'
  }
}

function baseGlobalConfig() {
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
    }
  }
}

test('h-config-resolution: merge precedence and provenance are deterministic', () => {
  const globalScope = baseGlobalConfig()
  const appScope = {
    configVersion: 'app_v20',
    schemaVersion: 'schema_v1',
    config: {
      routePolicyRef: 'route/app/v5',
      adapterMinVersionMap: {
        cj: '2.2.0'
      },
      experimentTagList: ['app_only']
    }
  }
  const placementScope = {
    configVersion: 'placement_v31',
    placementSourceVersion: 'placement_source_v31',
    schemaVersion: 'schema_v1',
    config: {
      ttlSec: 120,
      adapterMinVersionMap: {
        inhouse: '1.0.0'
      }
    }
  }

  const snapshotA = resolveConfig(globalScope, appScope, placementScope, baseContext())
  const snapshotB = resolveConfig(globalScope, appScope, placementScope, baseContext())

  assert.deepEqual(snapshotA, snapshotB)
  assert.equal(snapshotA.resolutionStatus, H_CONFIG_RESOLUTION_STATUSES.RESOLVED)
  assert.equal(snapshotA.effectiveConfig.routePolicyRef, 'route/app/v5')
  assert.equal(snapshotA.effectiveConfig.ttlSec, 120)
  assert.deepEqual(snapshotA.effectiveConfig.experimentTagList, ['app_only'])
  assert.deepEqual(snapshotA.effectiveConfig.adapterMinVersionMap, {
    cj: '2.2.0',
    inhouse: '1.0.0',
    partnerstack: '2.0.0'
  })
  assert.equal(snapshotA.reasonCodes.length, 0)

  const routeProvenance = snapshotA.fieldProvenance.find((item) => item.fieldPath === 'routePolicyRef')
  const adapterCjProvenance = snapshotA.fieldProvenance.find((item) => item.fieldPath === 'adapterMinVersionMap.cj')
  const adapterPartnerProvenance = snapshotA.fieldProvenance.find((item) => item.fieldPath === 'adapterMinVersionMap.partnerstack')

  assert.equal(routeProvenance?.winnerScope, 'app')
  assert.equal(routeProvenance?.winnerVersion, 'app_v20')
  assert.equal(adapterCjProvenance?.winnerScope, 'app')
  assert.equal(adapterPartnerProvenance?.winnerScope, 'global')
})

test('h-config-resolution: invalid high-priority value falls back with stable reason code', () => {
  const globalScope = baseGlobalConfig()
  const appScope = {
    configVersion: 'app_v20',
    schemaVersion: 'schema_v1',
    config: {
      ttlSec: 180
    }
  }
  const placementScope = {
    configVersion: 'placement_v31',
    schemaVersion: 'schema_v1',
    config: {
      ttlSec: -1
    }
  }

  const snapshot = resolveConfig(globalScope, appScope, placementScope, baseContext())

  assert.equal(snapshot.resolutionStatus, H_CONFIG_RESOLUTION_STATUSES.DEGRADED)
  assert.equal(snapshot.effectiveConfig.ttlSec, 180)
  assert.equal(snapshot.reasonCodes.includes(H_CONFIG_RESOLUTION_REASON_CODES.INVALID_RANGE), true)
})

test('h-config-resolution: unknown field is dropped and explicit null can trigger required-missing reject', () => {
  const globalScope = baseGlobalConfig()
  const appScope = {
    configVersion: 'app_v20',
    schemaVersion: 'schema_v1',
    config: {}
  }
  const placementScope = {
    configVersion: 'placement_v31',
    schemaVersion: 'schema_v1',
    config: {
      sdkMinVersion: null,
      unknownShadowField: 'drop_me'
    }
  }

  const snapshot = resolveConfig(globalScope, appScope, placementScope, baseContext())

  assert.equal(snapshot.resolutionStatus, H_CONFIG_RESOLUTION_STATUSES.REJECTED)
  assert.equal(snapshot.reasonCodes.includes(H_CONFIG_RESOLUTION_REASON_CODES.UNKNOWN_FIELD_DROPPED), true)
  assert.equal(snapshot.reasonCodes.includes(H_CONFIG_RESOLUTION_REASON_CODES.MISSING_REQUIRED_AFTER_MERGE), true)
})

test('h-config-resolution: global unavailable is fail-closed rejected', () => {
  const appScope = {
    configVersion: 'app_v20',
    schemaVersion: 'schema_v1',
    config: {
      routePolicyRef: 'route/app/v5'
    }
  }
  const placementScope = {
    configVersion: 'placement_v31',
    schemaVersion: 'schema_v1',
    config: {
      ttlSec: 100
    }
  }

  const snapshot = resolveConfig(null, appScope, placementScope, baseContext())

  assert.equal(snapshot.resolutionStatus, H_CONFIG_RESOLUTION_STATUSES.REJECTED)
  assert.equal(
    snapshot.reasonCodes.includes(H_CONFIG_RESOLUTION_REASON_CODES.GLOBAL_UNAVAILABLE_FAIL_CLOSED),
    true
  )
})
