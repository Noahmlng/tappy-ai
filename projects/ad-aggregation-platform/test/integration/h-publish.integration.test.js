import assert from 'node:assert/strict'
import test from 'node:test'

import { createConfigPublishController } from '../../src/mediation/api/config-publish-controller.js'
import { createConfigPublishService, H_PUBLISH_REASON_CODES } from '../../src/mediation/h/config-publish.js'

function buildAuthContext() {
  return {
    actorId: 'operator_1',
    role: 'config_admin',
    authMethod: 'token',
    issuedAt: '2026-02-21T10:00:00.000Z',
    expiresAt: '2026-02-21T12:00:00.000Z',
    scopeBindings: {
      allowedEnvironments: ['prod', 'staging'],
      allowedAppIdsOrWildcard: '*',
      allowedPlacementIdsOrWildcard: '*'
    },
    authContextVersion: 'auth_v1'
  }
}

function buildBaseRequest(overrides = {}) {
  return {
    requestId: 'req_pub_001',
    operatorId: 'operator_1',
    authContextLite: buildAuthContext(),
    environment: 'prod',
    actionType: 'publish',
    targetScope: 'placement',
    targetKey: 'app_chat_main|chat_inline_v1|prod',
    changeSetId: 'changeset_001',
    baseVersionSnapshot: {
      schemaVersion: 'schema_v1',
      routingStrategyVersion: 'route_v1',
      placementConfigVersion: 'placement_v1'
    },
    targetVersionSnapshot: {
      schemaVersion: 'schema_v1',
      routingStrategyVersion: 'route_v2',
      placementConfigVersion: 'placement_v2'
    },
    publishAt: '2026-02-21T11:00:00.000Z',
    publishContractVersion: 'h_publish_v1',
    ...overrides
  }
}

test('h-publish: publish follows draft -> validated -> published', async () => {
  const clock = { nowMs: Date.parse('2026-02-21T11:00:05.000Z') }
  const publishService = createConfigPublishService({
    nowFn: () => clock.nowMs
  })
  const controller = createConfigPublishController({ publishService })

  const result = await controller.handlePostConfigPublish(buildBaseRequest())

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.publishState, 'published')
  assert.equal(result.body.ackReasonCode, H_PUBLISH_REASON_CODES.PUBLISHED)

  const operation = publishService._debug.operationsById.get(result.body.publishOperationId)
  assert.deepEqual(operation.stateHistory, ['draft', 'validated', 'published'])
})

test('h-publish: duplicate reuses operation id while payload conflict is rejected', async () => {
  const clock = { nowMs: Date.parse('2026-02-21T11:10:00.000Z') }
  const publishService = createConfigPublishService({
    nowFn: () => clock.nowMs
  })
  const controller = createConfigPublishController({ publishService })

  const initial = await controller.handlePostConfigPublish(
    buildBaseRequest({
      requestId: 'req_pub_dup_1',
      publishIdempotencyKeyOrNA: 'idem-key-1'
    })
  )

  assert.equal(initial.statusCode, 200)
  assert.equal(initial.body.publishState, 'published')

  clock.nowMs += 10_000
  const duplicate = await controller.handlePostConfigPublish(
    buildBaseRequest({
      requestId: 'req_pub_dup_2',
      publishIdempotencyKeyOrNA: 'idem-key-1'
    })
  )

  assert.equal(duplicate.statusCode, 200)
  assert.equal(duplicate.body.publishOperationId, initial.body.publishOperationId)
  assert.equal(duplicate.body.ackReasonCode, H_PUBLISH_REASON_CODES.DUPLICATE_REUSED_OPERATION)

  clock.nowMs += 10_000
  const conflict = await controller.handlePostConfigPublish(
    buildBaseRequest({
      requestId: 'req_pub_dup_3',
      publishIdempotencyKeyOrNA: 'idem-key-1',
      changeSetId: 'changeset_conflict'
    })
  )

  assert.equal(conflict.statusCode, 409)
  assert.equal(conflict.body.publishState, 'failed')
  assert.equal(conflict.body.ackReasonCode, H_PUBLISH_REASON_CODES.IDEMPOTENCY_PAYLOAD_CONFLICT)
})

test('h-publish: auth failure returns h_publish_auth_* and never enters draft', async () => {
  const clock = { nowMs: Date.parse('2026-02-21T11:20:00.000Z') }
  const publishService = createConfigPublishService({
    nowFn: () => clock.nowMs
  })
  const controller = createConfigPublishController({ publishService })

  const result = await controller.handlePostConfigPublish(
    buildBaseRequest({
      operatorId: 'operator_mismatch'
    })
  )

  assert.equal(result.statusCode, 403)
  assert.equal(result.body.publishState, 'failed')
  assert.equal(result.body.ackReasonCode, H_PUBLISH_REASON_CODES.AUTH_OPERATOR_MISMATCH)
  assert.equal(publishService._debug.operationsById.size, 0)
})

test('h-publish: rollback follows published -> rollback -> rolled_back', async () => {
  const clock = { nowMs: Date.parse('2026-02-21T11:30:00.000Z') }
  const publishService = createConfigPublishService({
    nowFn: () => clock.nowMs
  })
  const controller = createConfigPublishController({ publishService })

  const published = await controller.handlePostConfigPublish(
    buildBaseRequest({
      requestId: 'req_pub_rb_1',
      changeSetId: 'changeset_rb_1'
    })
  )

  assert.equal(published.statusCode, 200)
  assert.equal(published.body.publishState, 'published')

  clock.nowMs += 5_000
  const rollback = await controller.handlePostConfigPublish(
    buildBaseRequest({
      requestId: 'req_pub_rb_2',
      actionType: 'rollback',
      changeSetId: 'changeset_rb_2',
      baseVersionSnapshot: {
        schemaVersion: 'schema_v1',
        routingStrategyVersion: 'route_v2',
        placementConfigVersion: 'placement_v2'
      },
      rollbackToVersionSnapshot: {
        schemaVersion: 'schema_v1',
        routingStrategyVersion: 'route_v1',
        placementConfigVersion: 'placement_v1'
      },
      targetVersionSnapshot: undefined
    })
  )

  assert.equal(rollback.statusCode, 200)
  assert.equal(rollback.body.publishState, 'rolled_back')
  assert.equal(rollback.body.ackReasonCode, H_PUBLISH_REASON_CODES.ROLLED_BACK)

  const rollbackOp = publishService._debug.operationsById.get(rollback.body.publishOperationId)
  assert.deepEqual(rollbackOp.stateHistory, ['draft', 'validated', 'published', 'rollback', 'rolled_back'])
})
