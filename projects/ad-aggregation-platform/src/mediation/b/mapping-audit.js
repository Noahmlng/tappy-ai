function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function normalizeSlotRecord(record, nowFn) {
  const source = isPlainObject(record) ? record : {}
  return {
    semanticSlot: normalizeText(source.semanticSlot),
    rawValue: source.rawValue ?? null,
    normalized: source.normalized ?? null,
    conflictAction: normalizeText(source.conflictAction) || 'none',
    ruleVersion: normalizeText(source.ruleVersion) || 'b_mapping_audit_v1',
    bucketValueOrNA: source.bucketValueOrNA ?? null,
    reasonCode: normalizeText(source.reasonCode),
    source: normalizeText(source.source),
    mappingAction: normalizeText(source.mappingAction),
    auditTimestamp: normalizeText(source.auditTimestamp) || nowIso(nowFn)
  }
}

function assertSnapshotRequiredFields(snapshot) {
  const required = [
    'traceKey',
    'requestKey',
    'bInputContractVersion',
    'mappingProfileVersion',
    'enumDictVersion',
    'conflictPolicyVersion',
    'redactionPolicyVersion',
    'bucketDictVersion'
  ]

  const missing = required.filter((field) => !normalizeText(snapshot[field]))
  if (missing.length > 0) {
    return {
      ok: false,
      reasonCode: 'b_mapping_audit_missing_snapshot_meta',
      missing
    }
  }

  return {
    ok: true,
    reasonCode: 'b_mapping_audit_snapshot_meta_valid',
    missing: []
  }
}

function assertRecordRequiredFields(record) {
  const required = ['semanticSlot', 'conflictAction', 'ruleVersion']
  const missing = required.filter((field) => !normalizeText(record[field]))
  if (missing.length > 0) {
    return {
      ok: false,
      reasonCode: 'b_mapping_audit_missing_record_field',
      missing
    }
  }
  return {
    ok: true,
    reasonCode: 'b_mapping_audit_record_valid',
    missing: []
  }
}

export function createMappingAuditBuilder(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()

  function buildSnapshot(input) {
    const request = isPlainObject(input) ? input : {}
    const traceInitLite = isPlainObject(request.traceInitLite) ? request.traceInitLite : {}

    const snapshot = {
      traceKey: normalizeText(traceInitLite.traceKey),
      requestKey: normalizeText(traceInitLite.requestKey),
      bInputContractVersion: normalizeText(request.bInputContractVersion),
      mappingProfileVersion: normalizeText(request.mappingProfileVersion) || 'b_mapping_profile_v1',
      enumDictVersion: normalizeText(request.enumDictVersion) || 'b_enum_dict_v1',
      conflictPolicyVersion: normalizeText(request.conflictPolicyVersion) || 'b_conflict_policy_v1',
      redactionPolicyVersion: normalizeText(request.redactionPolicyVersion) || 'b_redaction_policy_v1',
      bucketDictVersion: normalizeText(request.bucketDictVersion) || 'b_bucket_dict_v1',
      records: []
    }

    const snapshotValidation = assertSnapshotRequiredFields(snapshot)
    if (!snapshotValidation.ok) {
      return {
        ok: false,
        reasonCode: snapshotValidation.reasonCode,
        missing: snapshotValidation.missing,
        mappingAuditSnapshotLite: null
      }
    }

    const records = Array.isArray(request.records) ? request.records : []
    const normalizedRecords = records
      .map((record) => normalizeSlotRecord(record, nowFn))
      .sort((a, b) => a.semanticSlot.localeCompare(b.semanticSlot))

    for (const record of normalizedRecords) {
      const validation = assertRecordRequiredFields(record)
      if (!validation.ok) {
        return {
          ok: false,
          reasonCode: validation.reasonCode,
          missing: validation.missing,
          mappingAuditSnapshotLite: null
        }
      }
    }

    snapshot.records = normalizedRecords
    return {
      ok: true,
      reasonCode: 'b_mapping_audit_snapshot_ready',
      missing: [],
      mappingAuditSnapshotLite: snapshot
    }
  }

  function buildFromConflictResolution(input) {
    const request = isPlainObject(input) ? input : {}
    const mappingRecords = Array.isArray(request.mappingRecords) ? request.mappingRecords : []
    const conflictSnapshots = Array.isArray(request.conflictResolutionSnapshots)
      ? request.conflictResolutionSnapshots
      : []

    const conflictBySlot = new Map()
    for (const snapshot of conflictSnapshots) {
      const semanticSlot = normalizeText(snapshot?.semanticSlot)
      if (!semanticSlot) continue
      conflictBySlot.set(semanticSlot, snapshot)
    }

    const records = mappingRecords.map((record) => {
      const semanticSlot = normalizeText(record?.semanticSlot)
      const conflictSnapshot = conflictBySlot.get(semanticSlot)
      return {
        semanticSlot,
        rawValue: record?.rawValue ?? null,
        normalized: conflictSnapshot ? conflictSnapshot.selectedValue : record?.normalized ?? null,
        conflictAction: conflictSnapshot ? conflictSnapshot.conflictAction : (record?.conflictAction || 'none'),
        ruleVersion: normalizeText(record?.ruleVersion) || 'b_mapping_audit_v1',
        bucketValueOrNA: record?.bucketValueOrNA ?? null,
        reasonCode: normalizeText(conflictSnapshot?.reasonCode || record?.reasonCode),
        source: normalizeText(record?.source),
        mappingAction: normalizeText(record?.mappingAction),
        auditTimestamp: normalizeText(record?.auditTimestamp)
      }
    })

    return buildSnapshot({
      ...request,
      records
    })
  }

  return {
    buildSnapshot,
    buildFromConflictResolution
  }
}
