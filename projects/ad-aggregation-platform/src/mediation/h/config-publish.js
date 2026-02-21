import crypto from 'node:crypto'

export const H_PUBLISH_REASON_CODES = Object.freeze({
  VALIDATION_FAILED: 'h_publish_validation_failed',
  BASE_VERSION_CONFLICT: 'h_publish_base_version_conflict',
  ATOMIC_COMMIT_FAILED: 'h_publish_atomic_commit_failed',
  COMPENSATION_TRIGGERED: 'h_publish_compensation_triggered',
  COMPENSATION_FAILED: 'h_publish_compensation_failed',
  ROLLBACK_TARGET_NOT_FOUND: 'h_publish_rollback_target_not_found',
  AUTH_CONTEXT_INVALID: 'h_publish_auth_context_invalid',
  AUTH_OPERATOR_MISMATCH: 'h_publish_auth_operator_mismatch',
  AUTHZ_DENIED: 'h_publish_authz_denied',
  AUTHZ_DENIED_SCOPE: 'h_publish_authz_denied_scope',
  DUPLICATE_REUSED_OPERATION: 'h_publish_duplicate_reused_operation',
  IDEMPOTENCY_PAYLOAD_CONFLICT: 'h_publish_idempotency_payload_conflict',
  PUBLISHED: 'h_publish_published',
  ROLLED_BACK: 'h_publish_rolled_back',
  DRY_RUN_VALIDATED: 'h_publish_dry_run_validated'
})

const STATE_DRAFT = 'draft'
const STATE_VALIDATED = 'validated'
const STATE_PUBLISHED = 'published'
const STATE_ROLLBACK = 'rollback'
const STATE_ROLLED_BACK = 'rolled_back'
const STATE_FAILED = 'failed'

const ROLE_SCOPE_MATRIX = Object.freeze({
  global: new Set(['config_admin']),
  app: new Set(['config_admin', 'app_operator']),
  placement: new Set(['config_admin', 'app_operator', 'placement_operator'])
})

const VALID_ACTION_TYPES = new Set(['publish', 'rollback'])
const VALID_TARGET_SCOPES = new Set(['global', 'app', 'placement'])

const REQUIRED_FIELDS = Object.freeze([
  'requestId',
  'operatorId',
  'authContextLite',
  'environment',
  'actionType',
  'targetScope',
  'targetKey',
  'changeSetId',
  'baseVersionSnapshot',
  'publishAt',
  'publishContractVersion'
])

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item))
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = stableClone(value[key])
        return acc
      }, {})
  }

  return value
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value))
}

function parseDateToMs(input) {
  const value = Date.parse(String(input || ''))
  return Number.isFinite(value) ? value : NaN
}

function normalizeVersionSnapshot(input) {
  const snapshot = isPlainObject(input) ? input : {}
  return {
    schemaVersion: String(snapshot.schemaVersion || '').trim(),
    routingStrategyVersion: String(snapshot.routingStrategyVersion || '').trim(),
    placementConfigVersion: String(snapshot.placementConfigVersion || '').trim()
  }
}

function normalizeScopeBindings(input) {
  const bindings = isPlainObject(input) ? input : {}
  const allowedEnvironments = Array.isArray(bindings.allowedEnvironments)
    ? bindings.allowedEnvironments.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    : []

  const allowedAppIdsOrWildcard = bindings.allowedAppIdsOrWildcard === '*'
    ? '*'
    : Array.isArray(bindings.allowedAppIdsOrWildcard)
      ? bindings.allowedAppIdsOrWildcard.map((item) => String(item || '').trim()).filter(Boolean)
      : []

  const allowedPlacementIdsOrWildcard = bindings.allowedPlacementIdsOrWildcard === '*'
    ? '*'
    : Array.isArray(bindings.allowedPlacementIdsOrWildcard)
      ? bindings.allowedPlacementIdsOrWildcard.map((item) => String(item || '').trim()).filter(Boolean)
      : []

  return {
    allowedEnvironments,
    allowedAppIdsOrWildcard,
    allowedPlacementIdsOrWildcard
  }
}

function normalizeAuthContext(input) {
  const auth = isPlainObject(input) ? input : {}
  return {
    actorId: String(auth.actorId || '').trim(),
    role: String(auth.role || '').trim(),
    authMethod: String(auth.authMethod || '').trim(),
    issuedAt: String(auth.issuedAt || '').trim(),
    expiresAt: String(auth.expiresAt || '').trim(),
    scopeBindings: normalizeScopeBindings(auth.scopeBindings),
    authContextVersion: String(auth.authContextVersion || '').trim()
  }
}

function normalizeRequest(input) {
  const request = isPlainObject(input) ? input : {}
  return {
    requestId: String(request.requestId || '').trim(),
    operatorId: String(request.operatorId || '').trim(),
    authContextLite: normalizeAuthContext(request.authContextLite),
    environment: String(request.environment || '').trim().toLowerCase(),
    actionType: String(request.actionType || '').trim(),
    targetScope: String(request.targetScope || '').trim(),
    targetKey: String(request.targetKey || '').trim(),
    changeSetId: String(request.changeSetId || '').trim(),
    baseVersionSnapshot: normalizeVersionSnapshot(request.baseVersionSnapshot),
    targetVersionSnapshot: normalizeVersionSnapshot(request.targetVersionSnapshot),
    rollbackToVersionSnapshot: normalizeVersionSnapshot(request.rollbackToVersionSnapshot),
    publishAt: String(request.publishAt || '').trim(),
    publishContractVersion: String(request.publishContractVersion || '').trim(),
    dryRun: request.dryRun === true,
    publishIdempotencyKeyOrNA: String(request.publishIdempotencyKeyOrNA || '').trim(),
    reason: String(request.reason || '').trim(),
    extensions: isPlainObject(request.extensions) ? stableClone(request.extensions) : undefined
  }
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString()
}

function snapshotComplete(snapshot) {
  return Boolean(snapshot.schemaVersion && snapshot.routingStrategyVersion && snapshot.placementConfigVersion)
}

function snapshotsEqual(a, b) {
  return stableStringify(normalizeVersionSnapshot(a)) === stableStringify(normalizeVersionSnapshot(b))
}

function extractTargetParts(environment, targetScope, targetKey) {
  if (targetScope === 'global') {
    if (targetKey !== environment) return null
    return { appId: '', placementId: '', environment }
  }

  const parts = targetKey.split('|').map((item) => item.trim())
  if (targetScope === 'app') {
    if (parts.length !== 2) return null
    if (parts[1] !== environment) return null
    return { appId: parts[0], placementId: '', environment: parts[1] }
  }

  if (targetScope === 'placement') {
    if (parts.length !== 3) return null
    if (parts[2] !== environment) return null
    return { appId: parts[0], placementId: parts[1], environment: parts[2] }
  }

  return null
}

function isScopeAllowed(bindings, environment, targetParts) {
  if (!bindings.allowedEnvironments.includes(environment)) {
    return false
  }

  if (targetParts.appId) {
    if (bindings.allowedAppIdsOrWildcard !== '*' && !bindings.allowedAppIdsOrWildcard.includes(targetParts.appId)) {
      return false
    }
  }

  if (targetParts.placementId) {
    if (
      bindings.allowedPlacementIdsOrWildcard !== '*' &&
      !bindings.allowedPlacementIdsOrWildcard.includes(targetParts.placementId)
    ) {
      return false
    }
  }

  return true
}

function buildComputedIdempotencyKey(request) {
  const targetSnapshot = request.actionType === 'publish'
    ? request.targetVersionSnapshot
    : request.rollbackToVersionSnapshot

  const seed = [
    request.environment,
    request.actionType,
    request.targetScope,
    request.targetKey,
    request.changeSetId,
    stableStringify(request.baseVersionSnapshot),
    stableStringify(targetSnapshot)
  ].join('|')

  return sha256(seed)
}

function buildPayloadHash(request) {
  return sha256(
    stableStringify({
      operatorId: request.operatorId,
      environment: request.environment,
      actionType: request.actionType,
      targetScope: request.targetScope,
      targetKey: request.targetKey,
      changeSetId: request.changeSetId,
      baseVersionSnapshot: request.baseVersionSnapshot,
      targetVersionSnapshot: request.targetVersionSnapshot,
      rollbackToVersionSnapshot: request.rollbackToVersionSnapshot,
      publishAt: request.publishAt,
      dryRun: request.dryRun,
      reason: request.reason
    })
  )
}

function makeFailedResponse(request, publishOperationId, reasonCode, nowMs, retryable = false) {
  return {
    requestId: request.requestId,
    changeSetId: request.changeSetId,
    actionType: request.actionType,
    publishState: STATE_FAILED,
    ackReasonCode: reasonCode,
    retryable,
    publishOperationId,
    responseAt: nowIso(nowMs),
    publishContractVersion: request.publishContractVersion
  }
}

function makeResponse(request, publishOperationId, publishState, ackReasonCode, nowMs, retryable = false) {
  return {
    requestId: request.requestId,
    changeSetId: request.changeSetId,
    actionType: request.actionType,
    publishState,
    ackReasonCode,
    retryable,
    publishOperationId,
    responseAt: nowIso(nowMs),
    publishContractVersion: request.publishContractVersion
  }
}

function validateRequiredFields(request) {
  for (const field of REQUIRED_FIELDS) {
    if (!request[field]) return false
  }
  return true
}

function validatePublishContract(request) {
  if (!validateRequiredFields(request)) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  if (!VALID_ACTION_TYPES.has(request.actionType)) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  if (!VALID_TARGET_SCOPES.has(request.targetScope)) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  const targetParts = extractTargetParts(request.environment, request.targetScope, request.targetKey)
  if (!targetParts) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  if (!snapshotComplete(request.baseVersionSnapshot)) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  if (request.actionType === 'publish' && !snapshotComplete(request.targetVersionSnapshot)) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  if (request.actionType === 'rollback' && !snapshotComplete(request.rollbackToVersionSnapshot)) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  return null
}

function authorizePublish(request, nowMs) {
  const auth = request.authContextLite
  const targetParts = extractTargetParts(request.environment, request.targetScope, request.targetKey)
  if (!targetParts) {
    return H_PUBLISH_REASON_CODES.VALIDATION_FAILED
  }

  if (!auth.actorId || request.operatorId !== auth.actorId) {
    return H_PUBLISH_REASON_CODES.AUTH_OPERATOR_MISMATCH
  }

  const issuedAtMs = parseDateToMs(auth.issuedAt)
  const expiresAtMs = parseDateToMs(auth.expiresAt)
  const publishAtMs = parseDateToMs(request.publishAt)
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(publishAtMs)) {
    return H_PUBLISH_REASON_CODES.AUTH_CONTEXT_INVALID
  }
  if (publishAtMs < issuedAtMs || publishAtMs > expiresAtMs || nowMs > expiresAtMs) {
    return H_PUBLISH_REASON_CODES.AUTH_CONTEXT_INVALID
  }

  const allowedRoles = ROLE_SCOPE_MATRIX[request.targetScope]
  if (!allowedRoles || !allowedRoles.has(auth.role)) {
    return H_PUBLISH_REASON_CODES.AUTHZ_DENIED
  }

  if (!isScopeAllowed(auth.scopeBindings, request.environment, targetParts)) {
    return H_PUBLISH_REASON_CODES.AUTHZ_DENIED_SCOPE
  }

  return null
}

function createReleaseUnitKey(request) {
  return `${request.environment}|${request.targetScope}|${request.targetKey}`
}

function transition(operation, nextState) {
  const current = operation.publishState
  const allowed = {
    [STATE_DRAFT]: new Set([STATE_VALIDATED]),
    [STATE_VALIDATED]: new Set([STATE_PUBLISHED, STATE_FAILED]),
    [STATE_PUBLISHED]: new Set([STATE_ROLLBACK]),
    [STATE_ROLLBACK]: new Set([STATE_ROLLED_BACK, STATE_FAILED])
  }

  if (!allowed[current] || !allowed[current].has(nextState)) {
    throw new Error(`invalid state transition ${current} -> ${nextState}`)
  }

  operation.publishState = nextState
  operation.stateHistory.push(nextState)
}

export function createConfigPublishService(options = {}) {
  const dedupWindowMs = Number.isFinite(options.publishDedupWindowMs)
    ? options.publishDedupWindowMs
    : 24 * 60 * 60 * 1000
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const shouldFailCommit = typeof options.shouldFailCommit === 'function' ? options.shouldFailCommit : () => false
  const shouldFailCompensation = typeof options.shouldFailCompensation === 'function'
    ? options.shouldFailCompensation
    : () => false

  let opCounter = 0
  const dedupByKey = new Map()
  const operationsById = new Map()
  const releaseUnits = new Map()

  function nextOperationId(nowMs) {
    opCounter += 1
    return `pubop_${nowMs}_${String(opCounter).padStart(4, '0')}`
  }

  function storeDedupRecord(idempotencyKey, payloadHash, nowMs, response) {
    dedupByKey.set(idempotencyKey, {
      idempotencyKey,
      payloadHash,
      createdAtMs: nowMs,
      publishOperationId: response.publishOperationId,
      response: stableClone(response)
    })
  }

  function createOperation(request, publishOperationId, releaseUnitKey, nowMs) {
    const operation = {
      publishOperationId,
      publishState: STATE_DRAFT,
      stateHistory: [STATE_DRAFT],
      request: stableClone(request),
      releaseUnitKey,
      createdAtMs: nowMs
    }
    operationsById.set(publishOperationId, operation)
    return operation
  }

  async function publishConfig(input) {
    const nowMs = nowFn()
    const request = normalizeRequest(input)
    const reasonFromContract = validatePublishContract(request)
    const publishOperationId = nextOperationId(nowMs)

    if (reasonFromContract) {
      return makeFailedResponse(request, publishOperationId, reasonFromContract, nowMs, false)
    }

    const idempotencyKey = request.publishIdempotencyKeyOrNA || buildComputedIdempotencyKey(request)
    const payloadHash = buildPayloadHash(request)
    const dedupRecord = dedupByKey.get(idempotencyKey)
    if (dedupRecord && nowMs - dedupRecord.createdAtMs <= dedupWindowMs) {
      if (dedupRecord.payloadHash === payloadHash) {
        return {
          ...stableClone(dedupRecord.response),
          ackReasonCode: H_PUBLISH_REASON_CODES.DUPLICATE_REUSED_OPERATION,
          retryable: false,
          responseAt: nowIso(nowMs)
        }
      }

      return makeFailedResponse(
        request,
        dedupRecord.publishOperationId,
        H_PUBLISH_REASON_CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
        nowMs,
        false
      )
    }

    const authError = authorizePublish(request, nowMs)
    if (authError) {
      const response = makeFailedResponse(request, publishOperationId, authError, nowMs, false)
      storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
      return response
    }

    const releaseUnitKey = createReleaseUnitKey(request)
    const releaseUnit = releaseUnits.get(releaseUnitKey) || {
      currentSnapshot: null,
      publishedChangeSetIds: new Set()
    }
    releaseUnits.set(releaseUnitKey, releaseUnit)

    const operation = createOperation(request, publishOperationId, releaseUnitKey, nowMs)
    transition(operation, STATE_VALIDATED)

    if (request.actionType === 'publish' && releaseUnit.publishedChangeSetIds.has(request.changeSetId)) {
      transition(operation, STATE_FAILED)
      const response = makeFailedResponse(
        request,
        publishOperationId,
        H_PUBLISH_REASON_CODES.VALIDATION_FAILED,
        nowMs,
        false
      )
      storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
      return response
    }

    if (releaseUnit.currentSnapshot && !snapshotsEqual(releaseUnit.currentSnapshot, request.baseVersionSnapshot)) {
      transition(operation, STATE_FAILED)
      const response = makeFailedResponse(
        request,
        publishOperationId,
        H_PUBLISH_REASON_CODES.BASE_VERSION_CONFLICT,
        nowMs,
        false
      )
      storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
      return response
    }

    if (request.dryRun) {
      const response = makeResponse(
        request,
        publishOperationId,
        STATE_VALIDATED,
        H_PUBLISH_REASON_CODES.DRY_RUN_VALIDATED,
        nowMs,
        false
      )
      storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
      return response
    }

    const baseSnapshot = stableClone(releaseUnit.currentSnapshot || request.baseVersionSnapshot)

    try {
      if (request.actionType === 'publish') {
        if (shouldFailCommit({ request, operation })) {
          throw new Error('commit_failed')
        }

        releaseUnit.currentSnapshot = stableClone(request.targetVersionSnapshot)
        releaseUnit.publishedChangeSetIds.add(request.changeSetId)
        transition(operation, STATE_PUBLISHED)
        const response = makeResponse(
          request,
          publishOperationId,
          STATE_PUBLISHED,
          H_PUBLISH_REASON_CODES.PUBLISHED,
          nowMs,
          false
        )
        storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
        return response
      }

      if (!releaseUnit.currentSnapshot) {
        throw new Error(H_PUBLISH_REASON_CODES.ROLLBACK_TARGET_NOT_FOUND)
      }

      transition(operation, STATE_PUBLISHED)
      transition(operation, STATE_ROLLBACK)

      if (shouldFailCommit({ request, operation })) {
        throw new Error('commit_failed')
      }

      releaseUnit.currentSnapshot = stableClone(request.rollbackToVersionSnapshot)
      transition(operation, STATE_ROLLED_BACK)
      const response = makeResponse(
        request,
        publishOperationId,
        STATE_ROLLED_BACK,
        H_PUBLISH_REASON_CODES.ROLLED_BACK,
        nowMs,
        false
      )
      storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
      return response
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : String(error)

      if (errorCode === H_PUBLISH_REASON_CODES.ROLLBACK_TARGET_NOT_FOUND) {
        transition(operation, STATE_FAILED)
        const response = makeFailedResponse(
          request,
          publishOperationId,
          H_PUBLISH_REASON_CODES.ROLLBACK_TARGET_NOT_FOUND,
          nowMs,
          false
        )
        storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
        return response
      }

      const compensationFail = shouldFailCompensation({ request, operation })
      if (!compensationFail) {
        releaseUnit.currentSnapshot = stableClone(baseSnapshot)
      }

      if (operation.publishState === STATE_VALIDATED) {
        transition(operation, STATE_FAILED)
      } else if (operation.publishState === STATE_ROLLBACK) {
        transition(operation, STATE_FAILED)
      }

      const reasonCode = compensationFail
        ? H_PUBLISH_REASON_CODES.COMPENSATION_FAILED
        : H_PUBLISH_REASON_CODES.COMPENSATION_TRIGGERED
      const response = makeFailedResponse(
        request,
        publishOperationId,
        reasonCode,
        nowMs,
        true
      )
      storeDedupRecord(idempotencyKey, payloadHash, nowMs, response)
      return response
    }
  }

  return {
    publishConfig,
    _debug: {
      dedupByKey,
      operationsById,
      releaseUnits
    }
  }
}
