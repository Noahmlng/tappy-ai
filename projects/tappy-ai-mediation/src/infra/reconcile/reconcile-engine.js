const DIFF_REASON_CODES = Object.freeze({
  ARCHIVE_MISSING: 'RECON_ARCHIVE_MISSING',
  BILLING_MISSING: 'RECON_BILLING_MISSING',
  BILLABLE_MISMATCH: 'RECON_BILLABLE_MISMATCH',
  AMOUNT_MISMATCH: 'RECON_AMOUNT_MISMATCH',
  ANCHOR_MISMATCH: 'RECON_ANCHOR_MISMATCH'
})

function toSafeMicros(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n)
}

function normalizeRecord(raw = {}, source = 'archive') {
  const record = raw && typeof raw === 'object' ? raw : {}
  return {
    source,
    recordKey: String(record.recordKey || '').trim(),
    responseReference: String(record.responseReference || '').trim(),
    renderAttemptId: String(record.renderAttemptId || '').trim(),
    billable: Boolean(record.billable),
    amountMicros: toSafeMicros(record.amountMicros),
    anchorHash: String(record.anchorHash || '').trim(),
    versionAnchorSnapshotRef: String(record.versionAnchorSnapshotRef || '').trim(),
    payloadDigest: String(record.payloadDigest || '').trim(),
    payload: record.payload || {}
  }
}

function indexByRecordKey(records = [], source) {
  const index = new Map()

  for (const raw of records) {
    const normalized = normalizeRecord(raw, source)
    if (!normalized.recordKey) continue
    index.set(normalized.recordKey, normalized)
  }

  return index
}

function buildDiff(reasonCode, archiveRecord, billingRecord, meta = {}) {
  return {
    reasonCode,
    recordKey: archiveRecord?.recordKey || billingRecord?.recordKey || '',
    responseReference: archiveRecord?.responseReference || billingRecord?.responseReference || '',
    renderAttemptId: archiveRecord?.renderAttemptId || billingRecord?.renderAttemptId || '',
    archive: archiveRecord || null,
    billing: billingRecord || null,
    versionAnchorSnapshotRef:
      archiveRecord?.versionAnchorSnapshotRef || billingRecord?.versionAnchorSnapshotRef || '',
    anchorHash: archiveRecord?.anchorHash || billingRecord?.anchorHash || '',
    meta
  }
}

function reconcileFactSets(input = {}, options = {}) {
  const archiveRecords = Array.isArray(input.archiveRecords) ? input.archiveRecords : []
  const billingRecords = Array.isArray(input.billingRecords) ? input.billingRecords : []

  const archiveIndex = indexByRecordKey(archiveRecords, 'archive')
  const billingIndex = indexByRecordKey(billingRecords, 'billing')

  const amountToleranceMicros = toSafeMicros(options.amountToleranceMicros)
  const allKeys = new Set([...archiveIndex.keys(), ...billingIndex.keys()])

  const diffs = []
  let matchedCount = 0

  for (const recordKey of allKeys) {
    const archiveRecord = archiveIndex.get(recordKey)
    const billingRecord = billingIndex.get(recordKey)

    if (!archiveRecord) {
      diffs.push(buildDiff(DIFF_REASON_CODES.ARCHIVE_MISSING, null, billingRecord))
      continue
    }

    if (!billingRecord) {
      diffs.push(buildDiff(DIFF_REASON_CODES.BILLING_MISSING, archiveRecord, null))
      continue
    }

    if (archiveRecord.anchorHash && billingRecord.anchorHash && archiveRecord.anchorHash !== billingRecord.anchorHash) {
      diffs.push(
        buildDiff(DIFF_REASON_CODES.ANCHOR_MISMATCH, archiveRecord, billingRecord, {
          archiveAnchorHash: archiveRecord.anchorHash,
          billingAnchorHash: billingRecord.anchorHash
        })
      )
      continue
    }

    if (archiveRecord.billable !== billingRecord.billable) {
      diffs.push(
        buildDiff(DIFF_REASON_CODES.BILLABLE_MISMATCH, archiveRecord, billingRecord, {
          archiveBillable: archiveRecord.billable,
          billingBillable: billingRecord.billable
        })
      )
      continue
    }

    const amountDiff = Math.abs(archiveRecord.amountMicros - billingRecord.amountMicros)
    if (amountDiff > amountToleranceMicros) {
      diffs.push(
        buildDiff(DIFF_REASON_CODES.AMOUNT_MISMATCH, archiveRecord, billingRecord, {
          archiveAmountMicros: archiveRecord.amountMicros,
          billingAmountMicros: billingRecord.amountMicros,
          amountDiffMicros: amountDiff,
          toleranceMicros: amountToleranceMicros
        })
      )
      continue
    }

    matchedCount += 1
  }

  return {
    totalArchiveRecords: archiveIndex.size,
    totalBillingRecords: billingIndex.size,
    matchedCount,
    diffCount: diffs.length,
    pass: diffs.length === 0,
    diffs
  }
}

function buildReplayRequestFromDiff(diff = {}, options = {}) {
  const timestamp = new Date().toISOString()
  const replayMode = String(options.replayMode || 'deterministic').trim() || 'deterministic'

  return {
    replayJobId: String(options.replayJobId || `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    replayMode,
    queryMode: 'recordKey',
    queryPayload: {
      recordKey: String(diff.recordKey || ''),
      responseReference: String(diff.responseReference || ''),
      renderAttemptId: String(diff.renderAttemptId || ''),
      versionAnchorSnapshotRef: String(diff.versionAnchorSnapshotRef || ''),
      anchorHash: String(diff.anchorHash || '')
    },
    reasonCode: String(diff.reasonCode || ''),
    createdAt: timestamp
  }
}

export {
  DIFF_REASON_CODES,
  buildReplayRequestFromDiff,
  normalizeRecord,
  reconcileFactSets
}
