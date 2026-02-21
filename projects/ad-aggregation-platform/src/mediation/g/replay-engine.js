import crypto from 'node:crypto'

export const G_REPLAY_QUERY_MODES = Object.freeze({
  BY_OPPORTUNITY: 'by_opportunity',
  BY_TIME_RANGE: 'by_time_range'
})

export const G_REPLAY_OUTPUT_MODES = Object.freeze({
  SUMMARY: 'summary',
  FULL: 'full'
})

export const G_REPLAY_EXECUTION_MODES = Object.freeze({
  SNAPSHOT_REPLAY: 'snapshot_replay',
  RULE_RECOMPUTE: 'rule_recompute'
})

export const G_REPLAY_DETERMINISM_STATUSES = Object.freeze({
  DETERMINISTIC: 'deterministic',
  NON_DETERMINISTIC: 'non_deterministic',
  NOT_COMPARABLE: 'not_comparable'
})

export const G_REPLAY_DIFF_STATUSES = Object.freeze({
  EXACT_MATCH: 'exact_match',
  SEMANTICALLY_EQUIVALENT: 'semantically_equivalent',
  DIVERGED: 'diverged',
  NOT_COMPARABLE: 'not_comparable'
})

export const G_REPLAY_REASON_CODES = Object.freeze({
  OK: 'g_replay_ok',
  INVALID_QUERY_MODE: 'g_replay_invalid_query_mode',
  INVALID_OUTPUT_MODE: 'g_replay_invalid_output_mode',
  INVALID_TIME_RANGE: 'g_replay_invalid_time_range',
  INVALID_AS_OF_TIME: 'g_replay_invalid_as_of_time',
  INVALID_CURSOR: 'g_replay_invalid_cursor',
  OPPORTUNITY_ALIAS_CONFLICT: 'g_replay_opportunity_alias_conflict',
  MISSING_REQUIRED: 'g_replay_missing_required',
  INVALID_SORT: 'g_replay_invalid_sort',
  INVALID_PAGINATION: 'g_replay_invalid_pagination',
  INVALID_CONTRACT_VERSION: 'g_replay_invalid_contract_version',
  MISSING_VERSION_ANCHOR: 'g_replay_missing_version_anchor',
  VERSION_ANCHOR_CONFLICT: 'g_replay_version_anchor_conflict',
  NOT_FOUND_OPPORTUNITY: 'g_replay_not_found_opportunity',
  NO_RECORD_IN_TIME_RANGE: 'g_replay_no_record_in_time_range',
  FILTERED_OUT: 'g_replay_filtered_out',
  ACCESS_DENIED_SCOPE: 'g_replay_access_denied_scope',
  NOT_EMPTY: 'g_replay_not_empty',
  DIFF_NONE: 'g_replay_diff_none',
  DIFF_NON_KEY_FIELD_CHANGED: 'g_replay_diff_non_key_field_changed',
  DIFF_WINNER_CHANGED: 'g_replay_diff_winner_changed',
  DIFF_TERMINAL_STATUS_CHANGED: 'g_replay_diff_terminal_status_changed',
  DIFF_BILLABLE_FACT_CHANGED: 'g_replay_diff_billable_fact_changed',
  DIFF_REASON_CODE_CHANGED: 'g_replay_diff_reason_code_changed',
  DIFF_MISSING_SNAPSHOT: 'g_replay_diff_missing_snapshot',
  DIFF_VERSION_MISMATCH: 'g_replay_diff_version_mismatch',
  DIFF_NOT_COMPARABLE: 'g_replay_diff_not_comparable'
})

const SORT_FIELDS = new Set(['auditAt', 'outputAt', 'eventAt'])
const SORT_ORDERS = new Set(['asc', 'desc'])
const QUERY_MODES = new Set(Object.values(G_REPLAY_QUERY_MODES))
const OUTPUT_MODES = new Set(Object.values(G_REPLAY_OUTPUT_MODES))
const EXECUTION_MODES = new Set(Object.values(G_REPLAY_EXECUTION_MODES))
const REQUIRED_VERSION_ANCHORS = Object.freeze([
  'schemaVersion',
  'mappingRuleVersion',
  'routingPolicyVersion',
  'policyRuleVersion',
  'deliveryRuleVersion',
  'eventContractVersion',
  'dedupFingerprintVersion'
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeToken(value) {
  const normalized = normalizeText(value)
  return normalized === 'NA' ? '' : normalized
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString()
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map((item) => stableClone(item))
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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function toBase64Url(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url')
}

function fromBase64Url(value) {
  const raw = normalizeText(value)
  if (!raw) return null
  try {
    return Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function parseIsoToMs(value) {
  const normalized = normalizeText(value)
  if (!normalized) return Number.NaN
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : Number.NaN
}

function pickTimeField(record, sortBy) {
  if (sortBy === 'outputAt') return parseIsoToMs(record.outputAt)
  if (sortBy === 'eventAt') return parseIsoToMs(record.eventAt)
  return parseIsoToMs(record.auditAt)
}

function compareTextAsc(left, right) {
  return String(left || '').localeCompare(String(right || ''))
}

function normalizeRecord(input = {}) {
  const auditRecord = isPlainObject(input.auditRecord)
    ? stableClone(input.auditRecord)
    : isPlainObject(input)
      ? stableClone(input)
      : {}

  const archiveRecords = Array.isArray(input.archiveRecords)
    ? input.archiveRecords.map((item) => stableClone(item))
    : []
  const factDecisionAuditLite = Array.isArray(input.factDecisionAuditLite)
    ? input.factDecisionAuditLite.map((item) => stableClone(item))
    : []

  const versionAnchors = {
    schemaVersion: normalizeText(input.versionAnchors?.schemaVersion || auditRecord?.opportunityInputSnapshot?.requestSchemaVersion),
    mappingRuleVersion: normalizeText(input.versionAnchors?.mappingRuleVersion || auditRecord?.mappingRuleVersion),
    routingPolicyVersion: normalizeText(input.versionAnchors?.routingPolicyVersion || auditRecord?.routingPolicyVersion),
    policyRuleVersion: normalizeText(input.versionAnchors?.policyRuleVersion || auditRecord?.policyRuleVersion),
    deliveryRuleVersion: normalizeText(input.versionAnchors?.deliveryRuleVersion || auditRecord?.deliveryRuleVersion),
    eventContractVersion: normalizeText(input.versionAnchors?.eventContractVersion || auditRecord?.eventContractVersion),
    dedupFingerprintVersion: normalizeText(input.versionAnchors?.dedupFingerprintVersion || auditRecord?.dedupFingerprintVersion)
  }

  return {
    auditRecord,
    archiveRecords,
    factDecisionAuditLite,
    rawPayload: input.rawPayload,
    recordStatus: normalizeText(input.recordStatus || 'committed') || 'committed',
    outputAt: normalizeText(input.outputAt || auditRecord.auditAt),
    eventAt: normalizeText(input.eventAt || auditRecord?.keyEventSummary?.terminalEventAtOrNA || auditRecord.auditAt),
    auditAt: normalizeText(auditRecord.auditAt),
    versionAnchors
  }
}

function countByRecordType(records = []) {
  const counts = {
    billable_fact: 0,
    attribution_fact: 0,
    decision_audit: 0
  }

  for (const item of records) {
    const type = normalizeText(item?.recordType)
    if (type in counts) counts[type] += 1
  }

  return counts
}

function normalizeQuery(input = {}, nowMs) {
  const request = isPlainObject(input) ? input : {}
  const queryMode = normalizeText(request.queryMode)
  const outputMode = normalizeText(request.outputMode)
  const replayContractVersion = normalizeText(request.replayContractVersion)
  const replayAsOfAtRaw = normalizeText(request.replayAsOfAt)
  const requestReceivedAt = nowIso(nowMs)
  const resolvedReplayAsOfAt = replayAsOfAtRaw || requestReceivedAt
  const replayExecutionMode = normalizeText(request.replayExecutionMode || G_REPLAY_EXECUTION_MODES.SNAPSHOT_REPLAY)

  const paginationInput = isPlainObject(request.pagination) ? request.pagination : {}
  const sortInput = isPlainObject(request.sort) ? request.sort : {}

  const pageSize = Number(paginationInput.pageSize)
  const pageTokenOrNA = normalizeToken(paginationInput.pageTokenOrNA)
  const cursor = normalizeToken(request.cursor)

  const opportunityKey = normalizeText(request.opportunityKey)
  const opportunityId = normalizeText(request.opportunityId)

  const timeRange = isPlainObject(request.timeRange)
    ? {
        startAt: normalizeText(request.timeRange.startAt),
        endAt: normalizeText(request.timeRange.endAt)
      }
    : null

  return {
    queryMode,
    outputMode,
    replayContractVersion,
    replayAsOfAtRaw,
    resolvedReplayAsOfAt,
    replayExecutionMode,
    pagination: {
      pageSize,
      pageTokenOrNA
    },
    cursor,
    sort: {
      sortBy: normalizeText(sortInput.sortBy || 'auditAt'),
      sortOrder: normalizeText(sortInput.sortOrder || 'desc')
    },
    opportunityKey,
    opportunityId,
    timeRange,
    filters: isPlainObject(request.filters) ? stableClone(request.filters) : {},
    includeRawPayload: request.includeRawPayload === true,
    pinnedVersions: isPlainObject(request.pinnedVersions) ? stableClone(request.pinnedVersions) : {},
    extensions: isPlainObject(request.extensions) ? stableClone(request.extensions) : {},
    requestReceivedAt
  }
}

function reject(reasonCode, message) {
  return {
    ok: false,
    reasonCode,
    message,
    retryable: false
  }
}

function validateQuery(query, supportedContractVersions) {
  if (!query.queryMode || !query.outputMode || !query.replayContractVersion) {
    return reject(G_REPLAY_REASON_CODES.MISSING_REQUIRED, 'missing required query fields')
  }

  if (!QUERY_MODES.has(query.queryMode)) {
    return reject(G_REPLAY_REASON_CODES.INVALID_QUERY_MODE, 'invalid queryMode')
  }

  if (!OUTPUT_MODES.has(query.outputMode)) {
    return reject(G_REPLAY_REASON_CODES.INVALID_OUTPUT_MODE, 'invalid outputMode')
  }

  if (!supportedContractVersions.has(query.replayContractVersion)) {
    return reject(G_REPLAY_REASON_CODES.INVALID_CONTRACT_VERSION, 'unsupported replayContractVersion')
  }

  if (!EXECUTION_MODES.has(query.replayExecutionMode)) {
    return reject(G_REPLAY_REASON_CODES.INVALID_QUERY_MODE, 'invalid replayExecutionMode')
  }

  if (!Number.isInteger(query.pagination.pageSize) || query.pagination.pageSize < 1 || query.pagination.pageSize > 200) {
    return reject(G_REPLAY_REASON_CODES.INVALID_PAGINATION, 'pagination.pageSize must be 1..200')
  }

  if (!SORT_FIELDS.has(query.sort.sortBy) || !SORT_ORDERS.has(query.sort.sortOrder)) {
    return reject(G_REPLAY_REASON_CODES.INVALID_SORT, 'sortBy/sortOrder is invalid')
  }

  if (query.queryMode === G_REPLAY_QUERY_MODES.BY_OPPORTUNITY) {
    if (query.timeRange) {
      return reject(G_REPLAY_REASON_CODES.INVALID_QUERY_MODE, 'timeRange is not allowed in by_opportunity mode')
    }

    if (query.opportunityKey && query.opportunityId && query.opportunityKey !== query.opportunityId) {
      return reject(G_REPLAY_REASON_CODES.OPPORTUNITY_ALIAS_CONFLICT, 'opportunityKey and opportunityId conflict')
    }

    const resolvedOpportunity = query.opportunityKey || query.opportunityId
    if (!resolvedOpportunity) {
      return reject(G_REPLAY_REASON_CODES.MISSING_REQUIRED, 'opportunityKey/opportunityId is required')
    }

    query.opportunityKey = resolvedOpportunity
  }

  if (query.queryMode === G_REPLAY_QUERY_MODES.BY_TIME_RANGE) {
    if (query.opportunityKey || query.opportunityId) {
      return reject(G_REPLAY_REASON_CODES.INVALID_QUERY_MODE, 'opportunityKey/opportunityId is not allowed in by_time_range mode')
    }

    if (!query.timeRange?.startAt || !query.timeRange?.endAt) {
      return reject(G_REPLAY_REASON_CODES.MISSING_REQUIRED, 'timeRange.startAt/endAt is required')
    }

    const startMs = parseIsoToMs(query.timeRange.startAt)
    const endMs = parseIsoToMs(query.timeRange.endAt)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return reject(G_REPLAY_REASON_CODES.INVALID_TIME_RANGE, 'timeRange is invalid')
    }

    const spanMs = endMs - startMs
    if (spanMs > 7 * 24 * 60 * 60 * 1000) {
      return reject(G_REPLAY_REASON_CODES.INVALID_TIME_RANGE, 'timeRange span exceeds 7d')
    }
  }

  const replayAsOfMs = parseIsoToMs(query.resolvedReplayAsOfAt)
  const requestReceivedAtMs = parseIsoToMs(query.requestReceivedAt)
  if (!Number.isFinite(replayAsOfMs) || replayAsOfMs > requestReceivedAtMs) {
    return reject(G_REPLAY_REASON_CODES.INVALID_AS_OF_TIME, 'replayAsOfAt must be <= requestReceivedAt')
  }

  if (query.cursor && query.pagination.pageTokenOrNA && query.cursor !== query.pagination.pageTokenOrNA) {
    return reject(G_REPLAY_REASON_CODES.INVALID_CURSOR, 'cursor and pagination.pageTokenOrNA conflict')
  }

  return {
    ok: true
  }
}

function normalizeFilters(raw = {}) {
  const adapterIdIn = Array.isArray(raw.adapterIdIn)
    ? new Set(raw.adapterIdIn.map((item) => normalizeText(item)).filter(Boolean))
    : null
  const recordTypeIn = Array.isArray(raw.recordTypeIn)
    ? new Set(raw.recordTypeIn.map((item) => normalizeText(item)).filter(Boolean))
    : null
  const recordStatusIn = Array.isArray(raw.recordStatusIn)
    ? new Set(raw.recordStatusIn.map((item) => normalizeText(item)).filter(Boolean))
    : null

  return {
    traceKey: normalizeText(raw.traceKey),
    requestKey: normalizeText(raw.requestKey),
    attemptKey: normalizeText(raw.attemptKey),
    responseReference: normalizeText(raw.responseReference),
    adapterIdIn,
    recordTypeIn,
    recordStatusIn,
    hasTimeoutOnly: raw.hasTimeoutOnly === true,
    hasConflictOnly: raw.hasConflictOnly === true
  }
}

function matchesBaseQuery(record, query, replayAsOfMs) {
  const auditAtMs = parseIsoToMs(record.auditAt)
  if (!Number.isFinite(auditAtMs) || auditAtMs > replayAsOfMs) return false

  if (query.queryMode === G_REPLAY_QUERY_MODES.BY_OPPORTUNITY) {
    return normalizeText(record.auditRecord?.opportunityKey) === query.opportunityKey
  }

  const startMs = parseIsoToMs(query.timeRange.startAt)
  const endMs = parseIsoToMs(query.timeRange.endAt)
  return auditAtMs >= startMs && auditAtMs <= endMs
}

function matchesFilters(record, filters) {
  if (filters.traceKey && normalizeText(record.auditRecord?.traceKey) !== filters.traceKey) return false
  if (filters.requestKey && normalizeText(record.auditRecord?.requestKey) !== filters.requestKey) return false
  if (filters.attemptKey && normalizeText(record.auditRecord?.attemptKey) !== filters.attemptKey) return false
  if (filters.responseReference && normalizeText(record.auditRecord?.responseReferenceOrNA) !== filters.responseReference) return false

  if (filters.adapterIdIn && filters.adapterIdIn.size > 0) {
    const hit = Array.isArray(record.auditRecord?.adapterParticipation)
      && record.auditRecord.adapterParticipation.some((item) => filters.adapterIdIn.has(normalizeText(item?.adapterId)))
    if (!hit) return false
  }

  if (filters.recordTypeIn && filters.recordTypeIn.size > 0) {
    const hasAny = record.archiveRecords.some((item) => filters.recordTypeIn.has(normalizeText(item?.recordType)))
    if (!hasAny) return false
  }

  if (filters.recordStatusIn && filters.recordStatusIn.size > 0 && !filters.recordStatusIn.has(record.recordStatus)) {
    return false
  }

  if (filters.hasTimeoutOnly) {
    const timeout = Array.isArray(record.auditRecord?.adapterParticipation)
      && record.auditRecord.adapterParticipation.some((item) => item?.didTimeout === true || normalizeText(item?.responseStatus) === 'timeout')
    if (!timeout) return false
  }

  if (filters.hasConflictOnly) {
    const conflict = record.recordStatus === 'conflicted' || record.archiveRecords.some((item) => normalizeText(item?.recordStatus) === 'conflicted')
    if (!conflict) return false
  }

  return true
}

function sortRecords(records, sortBy, sortOrder) {
  const order = sortOrder === 'asc' ? 1 : -1

  return [...records].sort((left, right) => {
    const leftTime = pickTimeField(left, sortBy)
    const rightTime = pickTimeField(right, sortBy)
    if (leftTime !== rightTime) {
      if (!Number.isFinite(leftTime)) return 1 * order
      if (!Number.isFinite(rightTime)) return -1 * order
      return leftTime < rightTime ? -1 * order : 1 * order
    }

    const traceCmp = compareTextAsc(left.auditRecord?.traceKey, right.auditRecord?.traceKey)
    if (traceCmp !== 0) return traceCmp

    const requestCmp = compareTextAsc(left.auditRecord?.requestKey, right.auditRecord?.requestKey)
    if (requestCmp !== 0) return requestCmp

    const attemptCmp = compareTextAsc(left.auditRecord?.attemptKey, right.auditRecord?.attemptKey)
    if (attemptCmp !== 0) return attemptCmp

    return compareTextAsc(left.auditRecord?.auditRecordId, right.auditRecord?.auditRecordId)
  })
}

function resolveCursorOffset(token, queryHash, resolvedReplayAsOfAt) {
  if (!token) return { ok: true, offset: 0 }

  const decoded = fromBase64Url(token)
  if (!decoded) {
    return reject(G_REPLAY_REASON_CODES.INVALID_CURSOR, 'cursor decode failed')
  }

  let payload
  try {
    payload = JSON.parse(decoded)
  } catch {
    return reject(G_REPLAY_REASON_CODES.INVALID_CURSOR, 'cursor payload is invalid json')
  }

  if (!isPlainObject(payload) || !Number.isInteger(payload.offset) || payload.offset < 0) {
    return reject(G_REPLAY_REASON_CODES.INVALID_CURSOR, 'cursor offset is invalid')
  }

  if (normalizeText(payload.queryHash) !== queryHash) {
    return reject(G_REPLAY_REASON_CODES.INVALID_CURSOR, 'cursor queryHash mismatch')
  }

  if (normalizeText(payload.resolvedReplayAsOfAt) !== resolvedReplayAsOfAt) {
    return reject(G_REPLAY_REASON_CODES.INVALID_CURSOR, 'cursor replayAsOfAt drifted')
  }

  return {
    ok: true,
    offset: payload.offset
  }
}

function buildCursor({ offset, queryHash, resolvedReplayAsOfAt }) {
  return toBase64Url(
    JSON.stringify({
      offset,
      queryHash,
      resolvedReplayAsOfAt
    })
  )
}

function buildSummaryItem(record) {
  const terminalEventType = normalizeText(record.auditRecord?.keyEventSummary?.terminalEventTypeOrNA)
  const terminalStatus = terminalEventType && terminalEventType !== 'NA' ? terminalEventType : 'open'

  const reasonCodes = new Set()
  const winnerReason = normalizeText(record.auditRecord?.winnerSnapshot?.winnerReasonCode)
  if (winnerReason) reasonCodes.add(winnerReason)

  const renderReason = normalizeText(record.auditRecord?.renderResultSnapshot?.renderReasonCodeOrNA)
  if (renderReason && renderReason !== 'NA') reasonCodes.add(renderReason)

  for (const adapter of record.auditRecord?.adapterParticipation || []) {
    for (const code of adapter?.filterReasonCodes || []) {
      const normalized = normalizeText(code)
      if (normalized) reasonCodes.add(normalized)
    }
  }

  return {
    opportunityKey: normalizeText(record.auditRecord?.opportunityKey),
    traceKey: normalizeText(record.auditRecord?.traceKey),
    responseReferenceOrNA: normalizeText(record.auditRecord?.responseReferenceOrNA) || 'NA',
    terminalStatus,
    winnerAdapterIdOrNA: normalizeText(record.auditRecord?.winnerSnapshot?.winnerAdapterIdOrNA) || 'NA',
    keyReasonCodes: [...reasonCodes],
    recordCountByType: countByRecordType(record.archiveRecords)
  }
}

function buildFullItem(record, includeRawPayload) {
  const item = {
    gAuditRecordLite: stableClone(record.auditRecord),
    fToGArchiveRecordLite: record.archiveRecords.map((entry) => stableClone(entry)),
    factDecisionAuditLite: record.factDecisionAuditLite.map((entry) => stableClone(entry))
  }

  if (includeRawPayload) {
    item.rawPayload = stableClone(record.rawPayload ?? {
      auditRecord: record.auditRecord,
      archiveRecords: record.archiveRecords,
      factDecisionAuditLite: record.factDecisionAuditLite
    })
  }

  return item
}

function missingVersionAnchors(versionAnchors = {}) {
  return REQUIRED_VERSION_ANCHORS.filter((field) => !normalizeText(versionAnchors[field]))
}

function applyPinnedVersionCheck(record, pinnedVersions) {
  if (!isPlainObject(pinnedVersions)) return null

  for (const field of REQUIRED_VERSION_ANCHORS) {
    const expected = normalizeText(pinnedVersions[field])
    if (!expected) continue

    const actual = normalizeText(record.versionAnchors?.[field])
    if (!actual || expected !== actual) {
      return field
    }
  }

  return null
}

function projectComparableFields(record) {
  const summary = buildSummaryItem(record)

  return {
    winnerAdapterIdOrNA: summary.winnerAdapterIdOrNA,
    terminalStatus: summary.terminalStatus,
    billableFactCount: summary.recordCountByType.billable_fact,
    keyReasonCodes: [...summary.keyReasonCodes].sort((a, b) => a.localeCompare(b))
  }
}

function buildDiffSummary({ nowMs, snapshotProjection, recomputedProjection }) {
  const reasons = []
  let fieldDiffCount = 0

  if (!snapshotProjection || !recomputedProjection) {
    return {
      diffStatus: G_REPLAY_DIFF_STATUSES.NOT_COMPARABLE,
      diffReasonCodes: [G_REPLAY_REASON_CODES.DIFF_NOT_COMPARABLE, G_REPLAY_REASON_CODES.DIFF_MISSING_SNAPSHOT],
      fieldDiffCount: 0,
      comparedAt: nowIso(nowMs)
    }
  }

  if (snapshotProjection.winnerAdapterIdOrNA !== recomputedProjection.winnerAdapterIdOrNA) {
    fieldDiffCount += 1
    reasons.push(G_REPLAY_REASON_CODES.DIFF_WINNER_CHANGED)
  }

  if (snapshotProjection.terminalStatus !== recomputedProjection.terminalStatus) {
    fieldDiffCount += 1
    reasons.push(G_REPLAY_REASON_CODES.DIFF_TERMINAL_STATUS_CHANGED)
  }

  if (snapshotProjection.billableFactCount !== recomputedProjection.billableFactCount) {
    fieldDiffCount += 1
    reasons.push(G_REPLAY_REASON_CODES.DIFF_BILLABLE_FACT_CHANGED)
  }

  if (stableStringify(snapshotProjection.keyReasonCodes) !== stableStringify(recomputedProjection.keyReasonCodes)) {
    fieldDiffCount += 1
    reasons.push(G_REPLAY_REASON_CODES.DIFF_REASON_CODE_CHANGED)
  }

  if (fieldDiffCount === 0) {
    return {
      diffStatus: G_REPLAY_DIFF_STATUSES.EXACT_MATCH,
      diffReasonCodes: [G_REPLAY_REASON_CODES.DIFF_NONE],
      fieldDiffCount,
      comparedAt: nowIso(nowMs)
    }
  }

  return {
    diffStatus: G_REPLAY_DIFF_STATUSES.DIVERGED,
    diffReasonCodes: reasons,
    fieldDiffCount,
    comparedAt: nowIso(nowMs)
  }
}

function aggregateDiffSummaries(diffSummaries = [], nowMs) {
  if (diffSummaries.length === 0) {
    return {
      diffStatus: G_REPLAY_DIFF_STATUSES.EXACT_MATCH,
      diffReasonCodes: [G_REPLAY_REASON_CODES.DIFF_NONE],
      fieldDiffCount: 0,
      comparedAt: nowIso(nowMs)
    }
  }

  const fieldDiffCount = diffSummaries.reduce((acc, item) => acc + Number(item.fieldDiffCount || 0), 0)
  const reasonCodeSet = new Set()
  let hasDiverged = false
  let hasSemanticOnly = false
  let hasNotComparable = false

  for (const summary of diffSummaries) {
    for (const code of summary.diffReasonCodes || []) reasonCodeSet.add(code)
    if (summary.diffStatus === G_REPLAY_DIFF_STATUSES.DIVERGED) hasDiverged = true
    if (summary.diffStatus === G_REPLAY_DIFF_STATUSES.SEMANTICALLY_EQUIVALENT) hasSemanticOnly = true
    if (summary.diffStatus === G_REPLAY_DIFF_STATUSES.NOT_COMPARABLE) hasNotComparable = true
  }

  let diffStatus = G_REPLAY_DIFF_STATUSES.EXACT_MATCH
  if (hasNotComparable) diffStatus = G_REPLAY_DIFF_STATUSES.NOT_COMPARABLE
  else if (hasDiverged) diffStatus = G_REPLAY_DIFF_STATUSES.DIVERGED
  else if (hasSemanticOnly) diffStatus = G_REPLAY_DIFF_STATUSES.SEMANTICALLY_EQUIVALENT

  if (reasonCodeSet.size === 0) reasonCodeSet.add(G_REPLAY_REASON_CODES.DIFF_NONE)

  return {
    diffStatus,
    diffReasonCodes: [...reasonCodeSet],
    fieldDiffCount,
    comparedAt: nowIso(nowMs)
  }
}

function emptyResultObject({ isEmpty, queryMode, baseCount, filteredCount }) {
  if (!isEmpty) {
    return {
      isEmpty: false,
      emptyReasonCode: G_REPLAY_REASON_CODES.NOT_EMPTY,
      diagnosticHint: 'matched records found'
    }
  }

  if (baseCount === 0) {
    if (queryMode === G_REPLAY_QUERY_MODES.BY_OPPORTUNITY) {
      return {
        isEmpty: true,
        emptyReasonCode: G_REPLAY_REASON_CODES.NOT_FOUND_OPPORTUNITY,
        diagnosticHint: 'no audit record found for opportunityKey'
      }
    }

    return {
      isEmpty: true,
      emptyReasonCode: G_REPLAY_REASON_CODES.NO_RECORD_IN_TIME_RANGE,
      diagnosticHint: 'no audit record found in time range'
    }
  }

  if (filteredCount === 0) {
    return {
      isEmpty: true,
      emptyReasonCode: G_REPLAY_REASON_CODES.FILTERED_OUT,
      diagnosticHint: 'records exist but were filtered out'
    }
  }

  return {
    isEmpty: true,
    emptyReasonCode: G_REPLAY_REASON_CODES.ACCESS_DENIED_SCOPE,
    diagnosticHint: 'scope denied'
  }
}

function createReplayRunId(query) {
  const entropy = sha256(`${query.queryMode}|${query.outputMode}|${query.resolvedReplayAsOfAt}`).slice(0, 12)
  return `replay_${entropy}`
}

function defaultLoadRecords() {
  return []
}

export function createReplayEngine(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const loadRecords = typeof options.loadRecords === 'function' ? options.loadRecords : defaultLoadRecords
  const supportedContractVersions = new Set(
    (options.supportedReplayContractVersions || ['g_replay_v1'])
      .map((item) => normalizeText(item))
      .filter(Boolean)
  )
  const recomputeProjector = typeof options.recomputeProjector === 'function'
    ? options.recomputeProjector
    : (record) => projectComparableFields(record)

  function replay(queryInput = {}) {
    const nowMs = nowFn()
    const query = normalizeQuery(queryInput, nowMs)
    const validation = validateQuery(query, supportedContractVersions)
    if (!validation.ok) return validation

    const replayAsOfMs = parseIsoToMs(query.resolvedReplayAsOfAt)

    const queryEchoBase = {
      queryMode: query.queryMode,
      outputMode: query.outputMode,
      opportunityKey: query.queryMode === G_REPLAY_QUERY_MODES.BY_OPPORTUNITY ? query.opportunityKey : undefined,
      timeRange: query.queryMode === G_REPLAY_QUERY_MODES.BY_TIME_RANGE ? query.timeRange : undefined,
      filters: stableClone(query.filters),
      includeRawPayload: query.includeRawPayload,
      sort: stableClone(query.sort),
      replayContractVersion: query.replayContractVersion,
      replayExecutionMode: query.replayExecutionMode,
      pinnedVersions: stableClone(query.pinnedVersions),
      resolvedReplayAsOfAt: query.resolvedReplayAsOfAt,
      pagination: {
        pageSize: query.pagination.pageSize,
        pageTokenOrNA: 'NA'
      }
    }

    const queryHash = sha256(stableStringify(queryEchoBase))
    const resolvedCursor = query.cursor || query.pagination.pageTokenOrNA
    const cursorCheck = resolveCursorOffset(resolvedCursor, queryHash, query.resolvedReplayAsOfAt)
    if (!cursorCheck.ok) return cursorCheck

    const allRecords = (loadRecords(query) || []).map((item) => normalizeRecord(item))
    const baseMatched = allRecords.filter((item) => matchesBaseQuery(item, query, replayAsOfMs))

    const filters = normalizeFilters(query.filters)
    const filtered = baseMatched.filter((item) => matchesFilters(item, filters))
    const sorted = sortRecords(filtered, query.sort.sortBy, query.sort.sortOrder)

    const offset = cursorCheck.offset
    const pageSize = query.pagination.pageSize
    const paged = sorted.slice(offset, offset + pageSize)
    const hasMore = offset + pageSize < sorted.length
    const nextCursorOrNA = hasMore
      ? buildCursor({
          offset: offset + pageSize,
          queryHash,
          resolvedReplayAsOfAt: query.resolvedReplayAsOfAt
        })
      : 'NA'

    const items = paged.map((record) => (
      query.outputMode === G_REPLAY_OUTPUT_MODES.SUMMARY
        ? buildSummaryItem(record)
        : buildFullItem(record, query.includeRawPayload)
    ))

    let determinismStatus = G_REPLAY_DETERMINISM_STATUSES.DETERMINISTIC
    let replayDiffSummaryLite = null

    if (query.replayExecutionMode === G_REPLAY_EXECUTION_MODES.SNAPSHOT_REPLAY) {
      const hasMissingAnchor = paged.some((record) => missingVersionAnchors(record.versionAnchors).length > 0)
      determinismStatus = hasMissingAnchor
        ? G_REPLAY_DETERMINISM_STATUSES.NOT_COMPARABLE
        : G_REPLAY_DETERMINISM_STATUSES.DETERMINISTIC
    }

    if (query.replayExecutionMode === G_REPLAY_EXECUTION_MODES.RULE_RECOMPUTE) {
      for (const record of paged) {
        const missing = missingVersionAnchors(record.versionAnchors)
        if (missing.length > 0) {
          return reject(
            G_REPLAY_REASON_CODES.MISSING_VERSION_ANCHOR,
            `missing version anchors: ${missing.join(', ')}`
          )
        }

        const conflictField = applyPinnedVersionCheck(record, query.pinnedVersions)
        if (conflictField) {
          return reject(
            G_REPLAY_REASON_CODES.VERSION_ANCHOR_CONFLICT,
            `pinned version mismatch on ${conflictField}`
          )
        }
      }

      const diffSummaries = paged.map((record) => {
        const snapshotProjection = projectComparableFields(record)
        const recomputedProjection = recomputeProjector(record, query)
        return buildDiffSummary({
          nowMs,
          snapshotProjection,
          recomputedProjection
        })
      })

      replayDiffSummaryLite = aggregateDiffSummaries(diffSummaries, nowMs)
      determinismStatus = replayDiffSummaryLite.diffStatus === G_REPLAY_DIFF_STATUSES.DIVERGED
        ? G_REPLAY_DETERMINISM_STATUSES.NON_DETERMINISTIC
        : G_REPLAY_DETERMINISM_STATUSES.DETERMINISTIC
    }

    const queryEcho = {
      ...queryEchoBase,
      pagination: {
        pageSize,
        pageTokenOrNA: resolvedCursor || 'NA'
      }
    }

    const emptyResult = emptyResultObject({
      isEmpty: sorted.length === 0,
      queryMode: query.queryMode,
      baseCount: baseMatched.length,
      filteredCount: filtered.length
    })

    const response = {
      ok: true,
      queryEcho,
      resultMeta: {
        totalMatched: sorted.length,
        returnedCount: items.length,
        hasMore,
        nextCursorOrNA,
        replayRunId: createReplayRunId(query),
        replayExecutionMode: query.replayExecutionMode,
        determinismStatus,
        snapshotCutoffAt: query.resolvedReplayAsOfAt
      },
      items,
      emptyResult,
      generatedAt: nowIso(nowMs)
    }

    if (query.replayExecutionMode === G_REPLAY_EXECUTION_MODES.RULE_RECOMPUTE) {
      response.replayDiffSummaryLite = replayDiffSummaryLite || {
        diffStatus: G_REPLAY_DIFF_STATUSES.EXACT_MATCH,
        diffReasonCodes: [G_REPLAY_REASON_CODES.DIFF_NONE],
        fieldDiffCount: 0,
        comparedAt: nowIso(nowMs)
      }
    }

    return response
  }

  return {
    replay
  }
}
