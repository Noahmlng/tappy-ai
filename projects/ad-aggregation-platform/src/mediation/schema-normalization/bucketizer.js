export const B_BUCKET_REASON_CODES = Object.freeze({
  MAPPED_COMPLETE: 'b_bucket_mapped_complete',
  UNKNOWN_VALUE: 'b_bucket_unknown_value',
  OUTLIER_VALUE: 'b_bucket_outlier_value',
  DICT_MISSING_OR_INVALID: 'b_bucket_dict_missing_or_invalid',
  SLOT_UNDEFINED: 'b_bucket_slot_undefined'
})

export const B_BUCKET_ACTIONS = Object.freeze({
  MAPPED: 'bucket_mapped',
  UNKNOWN: 'bucket_unknown',
  OUTLIER: 'bucket_outlier'
})

export const DEFAULT_BUCKET_DICT_LITE = Object.freeze({
  bucketDictVersion: 'b_bucket_dict_v1',
  numericSlots: Object.freeze([
    Object.freeze({
      slotName: 'intentScore',
      valueType: 'float',
      minInclusive: 0,
      maxInclusive: 1,
      buckets: Object.freeze([
        Object.freeze({ bucketValue: 'intent_vlow', minInclusive: 0.0, maxExclusive: 0.2 }),
        Object.freeze({ bucketValue: 'intent_low', minInclusive: 0.2, maxExclusive: 0.4 }),
        Object.freeze({ bucketValue: 'intent_mid', minInclusive: 0.4, maxExclusive: 0.7 }),
        Object.freeze({ bucketValue: 'intent_high', minInclusive: 0.7, maxExclusive: 0.9 }),
        Object.freeze({ bucketValue: 'intent_vhigh', minInclusive: 0.9, maxInclusive: 1.0 })
      ])
    }),
    Object.freeze({
      slotName: 'devicePerfScore',
      valueType: 'float',
      minInclusive: 0,
      maxInclusive: 100,
      buckets: Object.freeze([
        Object.freeze({ bucketValue: 'perf_p0', minInclusive: 0, maxExclusive: 20 }),
        Object.freeze({ bucketValue: 'perf_p1', minInclusive: 20, maxExclusive: 40 }),
        Object.freeze({ bucketValue: 'perf_p2', minInclusive: 40, maxExclusive: 70 }),
        Object.freeze({ bucketValue: 'perf_p3', minInclusive: 70, maxExclusive: 90 }),
        Object.freeze({ bucketValue: 'perf_p4', minInclusive: 90, maxInclusive: 100 })
      ])
    }),
    Object.freeze({
      slotName: 'sessionDepth',
      valueType: 'int',
      minInclusive: 0,
      maxInclusive: 200,
      buckets: Object.freeze([
        Object.freeze({ bucketValue: 'sess_d0', exact: 0 }),
        Object.freeze({ bucketValue: 'sess_d1_3', minInclusive: 1, maxInclusive: 3 }),
        Object.freeze({ bucketValue: 'sess_d4_10', minInclusive: 4, maxInclusive: 10 }),
        Object.freeze({ bucketValue: 'sess_d11_30', minInclusive: 11, maxInclusive: 30 }),
        Object.freeze({ bucketValue: 'sess_d31p', minInclusive: 31, maxInclusive: 200 })
      ])
    })
  ]),
  unknownBucketRules: Object.freeze([
    Object.freeze({ slotName: 'intentScore', unknownBucketValue: 'intent_unknown' }),
    Object.freeze({ slotName: 'devicePerfScore', unknownBucketValue: 'perf_unknown' }),
    Object.freeze({ slotName: 'sessionDepth', unknownBucketValue: 'session_unknown' })
  ]),
  outlierRules: Object.freeze([
    Object.freeze({ slotName: 'intentScore', outlierLowBucketValue: 'intent_outlier_low', outlierHighBucketValue: 'intent_outlier_high' }),
    Object.freeze({ slotName: 'devicePerfScore', outlierLowBucketValue: 'perf_outlier_low', outlierHighBucketValue: 'perf_outlier_high' }),
    Object.freeze({ slotName: 'sessionDepth', outlierLowBucketValue: 'session_outlier_low', outlierHighBucketValue: 'session_outlier_high' })
  ]),
  bucketFailureMode: 'reject'
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function nowIso(nowFn) {
  return new Date(nowFn()).toISOString()
}

function parseFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : NaN
  }
  return NaN
}

function validateDict(dict) {
  if (!isPlainObject(dict)) return false
  if (!normalizeText(dict.bucketDictVersion)) return false
  if (!Array.isArray(dict.numericSlots) || dict.numericSlots.length === 0) return false
  if (!Array.isArray(dict.unknownBucketRules) || !Array.isArray(dict.outlierRules)) return false
  return true
}

function buildSlotMaps(dict) {
  const slotMap = new Map()
  for (const slot of dict.numericSlots) {
    if (!isPlainObject(slot) || !normalizeText(slot.slotName)) continue
    slotMap.set(slot.slotName, slot)
  }

  const unknownMap = new Map()
  for (const rule of dict.unknownBucketRules) {
    if (!isPlainObject(rule) || !normalizeText(rule.slotName)) continue
    unknownMap.set(rule.slotName, normalizeText(rule.unknownBucketValue))
  }

  const outlierMap = new Map()
  for (const rule of dict.outlierRules) {
    if (!isPlainObject(rule) || !normalizeText(rule.slotName)) continue
    outlierMap.set(rule.slotName, {
      low: normalizeText(rule.outlierLowBucketValue),
      high: normalizeText(rule.outlierHighBucketValue)
    })
  }

  return { slotMap, unknownMap, outlierMap }
}

function pickBucketByRange(slotDef, value) {
  for (const bucket of slotDef.buckets || []) {
    if (!isPlainObject(bucket) || !normalizeText(bucket.bucketValue)) continue

    if (Number.isFinite(bucket.exact)) {
      if (value === bucket.exact) return bucket.bucketValue
      continue
    }

    const minInclusive = Number.isFinite(bucket.minInclusive) ? bucket.minInclusive : Number.NEGATIVE_INFINITY
    const hasMaxExclusive = Number.isFinite(bucket.maxExclusive)
    const hasMaxInclusive = Number.isFinite(bucket.maxInclusive)
    const maxExclusive = hasMaxExclusive ? bucket.maxExclusive : Number.POSITIVE_INFINITY
    const maxInclusive = hasMaxInclusive ? bucket.maxInclusive : Number.POSITIVE_INFINITY

    const leftOk = value >= minInclusive
    const rightOk = hasMaxExclusive ? value < maxExclusive : value <= maxInclusive
    if (leftOk && rightOk) return bucket.bucketValue
  }
  return ''
}

export function createBucketizerService(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const defaultDict = validateDict(options.bucketDictLite) ? options.bucketDictLite : DEFAULT_BUCKET_DICT_LITE

  function bucketize(input = {}) {
    const trace = isPlainObject(input.traceInitLite) ? input.traceInitLite : {}
    const numericSignals = isPlainObject(input.numericSignals) ? input.numericSignals : {}
    const dict = validateDict(input.bucketDictLite) ? input.bucketDictLite : defaultDict

    if (!validateDict(dict)) {
      return {
        ok: false,
        bucketAction: 'reject',
        reasonCode: B_BUCKET_REASON_CODES.DICT_MISSING_OR_INVALID,
        bucketedValues: {},
        bucketAuditSnapshotLite: null
      }
    }

    const { slotMap, unknownMap, outlierMap } = buildSlotMaps(dict)
    const declaredSlots = new Set(slotMap.keys())
    const providedSlots = Object.keys(numericSignals)

    for (const providedSlot of providedSlots) {
      if (!declaredSlots.has(providedSlot)) {
        return {
          ok: false,
          bucketAction: 'reject',
          reasonCode: B_BUCKET_REASON_CODES.SLOT_UNDEFINED,
          bucketedValues: {},
          bucketAuditSnapshotLite: null
        }
      }
    }

    const slotDecisions = []
    const bucketedValues = {}
    let hasDegrade = false
    let firstDegradeReason = ''

    for (const [slotName, slotDef] of slotMap.entries()) {
      const rawValue = numericSignals[slotName]
      const unknownBucketValue = unknownMap.get(slotName)
      const outlierRule = outlierMap.get(slotName)
      if (!unknownBucketValue || !outlierRule?.low || !outlierRule?.high) {
        return {
          ok: false,
          bucketAction: 'reject',
          reasonCode: B_BUCKET_REASON_CODES.DICT_MISSING_OR_INVALID,
          bucketedValues: {},
          bucketAuditSnapshotLite: null
        }
      }

      const parsedValue = parseFiniteNumber(rawValue)
      if (!Number.isFinite(parsedValue)) {
        hasDegrade = true
        if (!firstDegradeReason) firstDegradeReason = B_BUCKET_REASON_CODES.UNKNOWN_VALUE
        bucketedValues[slotName] = unknownBucketValue
        slotDecisions.push({
          slotName,
          rawValue: rawValue ?? null,
          bucketValue: unknownBucketValue,
          bucketAction: B_BUCKET_ACTIONS.UNKNOWN,
          reasonCode: B_BUCKET_REASON_CODES.UNKNOWN_VALUE
        })
        continue
      }

      if (slotDef.valueType === 'int' && !Number.isInteger(parsedValue)) {
        hasDegrade = true
        if (!firstDegradeReason) firstDegradeReason = B_BUCKET_REASON_CODES.UNKNOWN_VALUE
        bucketedValues[slotName] = unknownBucketValue
        slotDecisions.push({
          slotName,
          rawValue: rawValue,
          bucketValue: unknownBucketValue,
          bucketAction: B_BUCKET_ACTIONS.UNKNOWN,
          reasonCode: B_BUCKET_REASON_CODES.UNKNOWN_VALUE
        })
        continue
      }

      if (parsedValue < slotDef.minInclusive) {
        hasDegrade = true
        if (!firstDegradeReason) firstDegradeReason = B_BUCKET_REASON_CODES.OUTLIER_VALUE
        bucketedValues[slotName] = outlierRule.low
        slotDecisions.push({
          slotName,
          rawValue: parsedValue,
          bucketValue: outlierRule.low,
          bucketAction: B_BUCKET_ACTIONS.OUTLIER,
          reasonCode: B_BUCKET_REASON_CODES.OUTLIER_VALUE
        })
        continue
      }

      if (parsedValue > slotDef.maxInclusive) {
        hasDegrade = true
        if (!firstDegradeReason) firstDegradeReason = B_BUCKET_REASON_CODES.OUTLIER_VALUE
        bucketedValues[slotName] = outlierRule.high
        slotDecisions.push({
          slotName,
          rawValue: parsedValue,
          bucketValue: outlierRule.high,
          bucketAction: B_BUCKET_ACTIONS.OUTLIER,
          reasonCode: B_BUCKET_REASON_CODES.OUTLIER_VALUE
        })
        continue
      }

      const mappedBucket = pickBucketByRange(slotDef, parsedValue)
      if (!mappedBucket) {
        return {
          ok: false,
          bucketAction: 'reject',
          reasonCode: B_BUCKET_REASON_CODES.DICT_MISSING_OR_INVALID,
          bucketedValues: {},
          bucketAuditSnapshotLite: null
        }
      }

      bucketedValues[slotName] = mappedBucket
      slotDecisions.push({
        slotName,
        rawValue: parsedValue,
        bucketValue: mappedBucket,
        bucketAction: B_BUCKET_ACTIONS.MAPPED,
        reasonCode: B_BUCKET_REASON_CODES.MAPPED_COMPLETE
      })
    }

    return {
      ok: true,
      bucketAction: hasDegrade ? 'degrade' : 'continue',
      reasonCode: hasDegrade ? firstDegradeReason : B_BUCKET_REASON_CODES.MAPPED_COMPLETE,
      bucketDictVersion: dict.bucketDictVersion,
      bucketedValues,
      bucketAuditSnapshotLite: {
        traceKey: normalizeText(trace.traceKey) || 'NA',
        requestKey: normalizeText(trace.requestKey) || 'NA',
        attemptKey: normalizeText(trace.attemptKey) || 'NA',
        bucketDictVersion: dict.bucketDictVersion,
        slotDecisions,
        generatedAt: nowIso(nowFn)
      }
    }
  }

  return {
    bucketize
  }
}
