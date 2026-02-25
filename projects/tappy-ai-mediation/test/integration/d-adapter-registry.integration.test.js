import assert from 'node:assert/strict'
import test from 'node:test'

import { createCjAdapter } from '../../src/adapters/cj-adapter.js'
import { createPartnerstackAdapter } from '../../src/adapters/partnerstack-adapter.js'
import {
  D_ADAPTER_REGISTRY_REASON_CODES,
  createAdapterRegistry
} from '../../src/mediation/supply-routing/adapter-registry.js'

function createFakeConnector(network) {
  return {
    async fetchOffers() {
      return {
        offers: [
          {
            id: `${network}_offer_001`,
            title: `${network} offer`,
            clickUrl: `https://${network}.example.com/click`,
            payout: 1.2,
            currency: 'USD'
          }
        ],
        debug: {
          mode: `${network}_fake`
        }
      }
    },
    async healthCheck() {
      return {
        ok: true,
        network
      }
    }
  }
}

function buildOrchestrationInput(overrides = {}) {
  return {
    opportunityKey: 'opp_d_001',
    traceKey: 'trace_d_001',
    requestKey: 'req_d_001',
    attemptKey: 'att_d_001',
    placementType: 'chat_inline',
    channelType: 'sdk_server',
    actorType: 'human',
    finalPolicyAction: 'allow',
    primaryPolicyReasonCode: 'c_policy_pass',
    policySnapshotId: 'ps_d_001',
    policySnapshotVersion: 'ps_v1',
    configSnapshotLite: {
      configSnapshotId: 'cfg_snap_001',
      resolvedConfigRef: 'resolve_001',
      configHash: 'cfg_hash_001',
      effectiveAt: '2026-02-22T02:20:00.000Z'
    },
    constraintsLite: {
      categoryConstraints: {
        bcat: ['cat_x'],
        badv: []
      },
      personalizationConstraints: {
        nonPersonalizedOnly: false
      },
      renderConstraints: {
        disallowRenderModes: ['webview']
      },
      sourceConstraints: {
        sourceSelectionMode: 'all_except_blocked',
        allowedSourceIds: ['source_cj_primary'],
        blockedSourceIds: []
      }
    },
    routeContext: {
      routePath: 'primary',
      routeHop: 1,
      routingPolicyVersion: 'd_route_policy_v1',
      strategyType: 'waterfall',
      dispatchMode: 'sequential'
    },
    remainingRouteBudgetMs: 2500,
    ...overrides
  }
}

test('d-adapter-registry: registers adapters and exposes active routable pool', () => {
  const registry = createAdapterRegistry({
    nowFn: () => Date.parse('2026-02-22T02:10:00.000Z')
  })
  const cjAdapter = createCjAdapter({
    connector: createFakeConnector('cj')
  })
  const partnerstackAdapter = createPartnerstackAdapter({
    connector: createFakeConnector('partnerstack')
  })

  const cjRegistered = registry.registerAdapter(cjAdapter.buildRegistryEntry(), cjAdapter)
  const psRegistered = registry.registerAdapter(partnerstackAdapter.buildRegistryEntry(), partnerstackAdapter)
  assert.equal(cjRegistered.ok, true)
  assert.equal(psRegistered.ok, true)

  const routable = registry.listRoutableAdapters({ placementType: 'chat_inline' })
  assert.equal(routable.length, 2)
  assert.equal(routable.every((item) => item.status === 'active'), true)
  assert.equal(routable.every((item) => item.supportedCapabilities.includes('request_adapt')), true)
})

test('d-adapter-registry: rejects registration without minimal capabilities', () => {
  const registry = createAdapterRegistry()
  const cjAdapter = createCjAdapter({
    connector: createFakeConnector('cj')
  })

  const badEntry = cjAdapter.buildRegistryEntry({
    sourceId: 'source_cj_bad_cap',
    supportedCapabilities: ['request_adapt', 'candidate_normalize']
  })
  const result = registry.registerAdapter(badEntry, cjAdapter)
  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, D_ADAPTER_REGISTRY_REASON_CODES.MIN_CAPABILITY_MISSING)
})

test('d-adapter-registry: status semantics block non-active source from new routing', () => {
  const registry = createAdapterRegistry({
    nowFn: () => Date.parse('2026-02-22T02:12:00.000Z')
  })
  const cjAdapter = createCjAdapter({
    connector: createFakeConnector('cj')
  })
  const entry = cjAdapter.buildRegistryEntry({
    sourceId: 'source_cj_state_test'
  })
  assert.equal(registry.registerAdapter(entry, cjAdapter).ok, true)

  const paused = registry.updateAdapterStatus('source_cj_state_test', 'paused', 'maintenance_window')
  assert.equal(paused.ok, true)
  const pausedRoute = registry.resolveAdapterForRoute('source_cj_state_test', 'chat_inline')
  assert.equal(pausedRoute.ok, false)
  assert.equal(pausedRoute.reasonCode, D_ADAPTER_REGISTRY_REASON_CODES.STATUS_NOT_ACTIVE)

  const draining = registry.updateAdapterStatus('source_cj_state_test', 'draining', 'drain_inflight')
  assert.equal(draining.ok, true)
  const drainingRoute = registry.resolveAdapterForRoute('source_cj_state_test', 'chat_inline')
  assert.equal(drainingRoute.ok, false)
  assert.equal(drainingRoute.reasonCode, D_ADAPTER_REGISTRY_REASON_CODES.STATUS_NOT_ACTIVE)

  const activeAgain = registry.updateAdapterStatus('source_cj_state_test', 'active', 'drain_complete')
  assert.equal(activeAgain.ok, true)
  const activeRoute = registry.resolveAdapterForRoute('source_cj_state_test', 'chat_inline')
  assert.equal(activeRoute.ok, true)
})

test('d-adapter-registry: start/stop affects routability and snapshots are queryable', async () => {
  const registry = createAdapterRegistry({
    nowFn: () => Date.parse('2026-02-22T02:13:00.000Z')
  })
  const adapter = createCjAdapter({
    connector: createFakeConnector('cj'),
    sourceId: 'source_cj_lifecycle_test'
  })
  assert.equal(registry.registerAdapter(adapter.buildRegistryEntry(), adapter).ok, true)

  const stopResult = await registry.stopAdapter('source_cj_lifecycle_test')
  assert.equal(stopResult.ok, true)
  const stoppedRoute = registry.resolveAdapterForRoute('source_cj_lifecycle_test', 'chat_inline')
  assert.equal(stoppedRoute.ok, false)
  assert.equal(stoppedRoute.reasonCode, D_ADAPTER_REGISTRY_REASON_CODES.NOT_RUNNING)

  const startResult = await registry.startAdapter('source_cj_lifecycle_test')
  assert.equal(startResult.ok, true)
  const startedRoute = registry.resolveAdapterForRoute('source_cj_lifecycle_test', 'chat_inline')
  assert.equal(startedRoute.ok, true)

  const snapshot = registry.getAdapterSnapshot('source_cj_lifecycle_test')
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.adapterSnapshot.registryEntry.sourceId, 'source_cj_lifecycle_test')
  assert.equal(snapshot.adapterSnapshot.lifecycleState, 'running')
})

test('d-adapter-registry: wraps connector into D request_adapt contract', async () => {
  const registry = createAdapterRegistry({
    nowFn: () => Date.parse('2026-02-22T02:14:00.000Z')
  })
  const cjAdapter = createCjAdapter({
    connector: createFakeConnector('cj'),
    sourceId: 'source_cj_contract_test',
    timeoutPolicyMs: 1800
  })
  const entry = cjAdapter.buildRegistryEntry()
  assert.equal(registry.registerAdapter(entry, cjAdapter).ok, true)

  const result = await registry.adaptRequest('source_cj_contract_test', buildOrchestrationInput({
    remainingRouteBudgetMs: 2500
  }))
  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, D_ADAPTER_REGISTRY_REASON_CODES.REQUEST_ADAPT_OK)

  const req = result.sourceRequestLite
  assert.equal(req.sourceId, 'source_cj_contract_test')
  assert.equal(req.opportunityKey, 'opp_d_001')
  assert.equal(req.traceKey, 'trace_d_001')
  assert.equal(req.requestKey, 'req_d_001')
  assert.equal(req.attemptKey, 'att_d_001')
  assert.equal(req.placementType, 'chat_inline')
  assert.equal(req.policyDecision.finalPolicyAction, 'allow')
  assert.equal(req.policyDecision.policyDecisionReasonCode, 'c_policy_pass')
  assert.equal(req.policySnapshot.policySnapshotId, 'ps_d_001')
  assert.equal(req.policySnapshot.policySnapshotVersion, 'ps_v1')
  assert.equal(req.configSnapshot.configSnapshotId, 'cfg_snap_001')
  assert.equal(req.routeContext.routePath, 'primary')
  assert.equal(req.routeContext.routeHop, 1)
  assert.equal(req.timeoutBudgetMs, 1800)
  assert.equal(req.adapterContractVersion, 'd_adapter_contract_v1')
})

test('d-adapter-registry: unsupported placement is rejected', async () => {
  const registry = createAdapterRegistry()
  const adapter = createPartnerstackAdapter({
    connector: createFakeConnector('partnerstack'),
    sourceId: 'source_partnerstack_placement_test',
    supportedPlacementTypes: ['tool_result']
  })
  assert.equal(registry.registerAdapter(adapter.buildRegistryEntry(), adapter).ok, true)

  const result = await registry.adaptRequest(
    'source_partnerstack_placement_test',
    buildOrchestrationInput({
      placementType: 'chat_inline'
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, D_ADAPTER_REGISTRY_REASON_CODES.PLACEMENT_NOT_SUPPORTED)
})
