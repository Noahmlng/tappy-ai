import crypto from 'node:crypto'

export const B_REDACTION_REASON_CODES = Object.freeze({
  REDACTION_APPLIED: 'b_redaction_applied',
  POLICY_MISSING_OR_INVALID: 'b_redaction_policy_missing_or_invalid',
  ACTION_VIOLATION: 'b_redaction_action_violation',
  EXECUTION_FAILED: 'b_redaction_execution_failed',
  BEFORE_AUDIT_VIOLATION: 'b_redaction_before_audit_violation'
})

export const DEFAULT_REDACTION_POLICY_LITE = Object.freeze({
  redactionPolicyVersion: 'b_redaction_policy_v1',
  fieldClassRules: Object.freeze([
    Object.freeze({
      fieldPath: 'UserContext.sessionKey',
      sensitivityClass: 'S2_identifier',
      defaultAction: 'hash'
    }),
    Object.freeze({
      fieldPath: 'RequestMeta.requestTimestamp',
      sensitivityClass: 'S1_quasi_identifier',
      defaultAction: 'coarsen'
    }),
    Object.freeze({
      fieldPath: 'device.id',
      sensitivityClass: 'S2_identifier',
      defaultAction: 'hash'
    }),
    Object.freeze({
      fieldPath: 'user.ext.actor_type',
      sensitivityClass: 'S0_public',
      defaultAction: 'pass'
    }),
    Object.freeze({
      fieldPath: 'PolicyContext.restrictedCategoryFlags',
      sensitivityClass: 'S3_sensitive_content',
      defaultAction: 'drop'
    })
  ]),
  hashRule: Object.freeze({
    algorithm: 'sha256',
    saltKeyRef: 'salt_ref_redaction_v1'
  }),
  coarsenRules: Object.freeze([
    Object.freeze({
      fieldPath: 'RequestMeta.requestTimestamp',
      coarsenMethod: 'time_bucket'
    }),
    Object.freeze({
      fieldPath: 'RequestMeta.devicePerfScore',
      coarsenMethod: 'range_bucket'
    })
  ]),
  redactionFailureMode: 'reject'
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

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function hashValue(input, hashRule) {
  if (!isPlainObject(hashRule) || normalizeText(hashRule.algorithm) !== 'sha256') {
    throw new Error('invalid hash rule')
  }

  const salt = normalizeText(hashRule.saltKeyRef)
  return digest(`${salt}|${String(input)}`)
}

function coarsenValue(value, method) {
  if (method === 'time_bucket') {
    const ms = Date.parse(String(value || ''))
    if (!Number.isFinite(ms)) throw new Error('invalid time value')
    const date = new Date(ms)
    date.setUTCMinutes(0, 0, 0)
    return date.toISOString()
  }

  if (method === 'range_bucket') {
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) throw new Error('invalid numeric value')
    const lower = Math.floor(numeric / 10) * 10
    const upper = lower + 9
    return `${lower}-${upper}`
  }

  if (method === 'prefix_mask') {
    const text = String(value || '')
    if (!text) return ''
    const keep = text.slice(0, Math.min(3, text.length))
    return `${keep}***`
  }

  throw new Error('unknown coarsen method')
}

function normalizePolicy(policy) {
  const candidate = isPlainObject(policy) ? policy : DEFAULT_REDACTION_POLICY_LITE
  if (
    !normalizeText(candidate.redactionPolicyVersion) ||
    !Array.isArray(candidate.fieldClassRules) ||
    !isPlainObject(candidate.hashRule) ||
    !Array.isArray(candidate.coarsenRules) ||
    normalizeText(candidate.redactionFailureMode) !== 'reject'
  ) {
    return null
  }
  return candidate
}

function fieldRuleByPath(policy) {
  const map = new Map()
  for (const rule of policy.fieldClassRules) {
    if (!isPlainObject(rule)) continue
    const path = normalizeText(rule.fieldPath)
    if (!path) continue
    map.set(path, {
      sensitivityClass: normalizeText(rule.sensitivityClass) || 'S0_public',
      defaultAction: normalizeText(rule.defaultAction) || 'pass'
    })
  }
  return map
}

function coarsenRuleByPath(policy) {
  const map = new Map()
  for (const rule of policy.coarsenRules) {
    if (!isPlainObject(rule)) continue
    const path = normalizeText(rule.fieldPath)
    if (!path) continue
    map.set(path, normalizeText(rule.coarsenMethod))
  }
  return map
}

function previewOutput(action, value) {
  if (action === 'drop') return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return String(text || '').slice(0, 20)
}

export function createRedactionService(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now()
  const defaultPolicy = normalizePolicy(options.redactionPolicyLite || DEFAULT_REDACTION_POLICY_LITE)

  function applyRedaction(input = {}) {
    const trace = isPlainObject(input.traceInitLite) ? input.traceInitLite : {}
    const valuesByPath = isPlainObject(input.valuesByPath) ? input.valuesByPath : {}
    const policy = normalizePolicy(input.redactionPolicyLite || defaultPolicy)

    if (!policy) {
      return {
        ok: false,
        reasonCode: B_REDACTION_REASON_CODES.POLICY_MISSING_OR_INVALID,
        redactedValuesByPath: {},
        redactionSnapshotLite: null
      }
    }

    const fieldRules = fieldRuleByPath(policy)
    const coarsenRules = coarsenRuleByPath(policy)
    const redactedValuesByPath = {}
    const fieldDecisions = []
    const actionSummary = {
      passCount: 0,
      hashCount: 0,
      coarsenCount: 0,
      dropCount: 0
    }

    try {
      const sortedPaths = Object.keys(valuesByPath).sort((a, b) => a.localeCompare(b))
      for (const fieldPath of sortedPaths) {
        const rawValue = valuesByPath[fieldPath]
        const rule = fieldRules.get(fieldPath) || {
          sensitivityClass: 'S0_public',
          defaultAction: 'pass'
        }

        const sensitivityClass = rule.sensitivityClass
        const action = rule.defaultAction

        if ((sensitivityClass === 'S2_identifier' || sensitivityClass === 'S3_sensitive_content') && action === 'pass') {
          return {
            ok: false,
            reasonCode: B_REDACTION_REASON_CODES.ACTION_VIOLATION,
            redactedValuesByPath: {},
            redactionSnapshotLite: null
          }
        }

        let outputValue = rawValue
        if (action === 'hash') {
          outputValue = hashValue(rawValue, policy.hashRule)
          actionSummary.hashCount += 1
        } else if (action === 'coarsen') {
          const method = coarsenRules.get(fieldPath) || 'prefix_mask'
          outputValue = coarsenValue(rawValue, method)
          actionSummary.coarsenCount += 1
        } else if (action === 'drop') {
          outputValue = null
          actionSummary.dropCount += 1
        } else {
          actionSummary.passCount += 1
        }

        redactedValuesByPath[fieldPath] = outputValue
        fieldDecisions.push({
          fieldPath,
          sensitivityClass,
          action,
          inputDigest: digest(rawValue === undefined ? 'null' : rawValue),
          outputPreviewOrNA: previewOutput(action, outputValue),
          reasonCode: B_REDACTION_REASON_CODES.REDACTION_APPLIED
        })
      }
    } catch {
      return {
        ok: false,
        reasonCode: B_REDACTION_REASON_CODES.EXECUTION_FAILED,
        redactedValuesByPath: {},
        redactionSnapshotLite: null
      }
    }

    return {
      ok: true,
      reasonCode: B_REDACTION_REASON_CODES.REDACTION_APPLIED,
      redactedValuesByPath,
      redactionSnapshotLite: {
        traceKey: normalizeText(trace.traceKey) || 'NA',
        requestKey: normalizeText(trace.requestKey) || 'NA',
        attemptKey: normalizeText(trace.attemptKey) || 'NA',
        redactionPolicyVersion: policy.redactionPolicyVersion,
        beforeAuditEnforced: true,
        fieldDecisions,
        actionSummary,
        generatedAt: nowIso(nowFn)
      }
    }
  }

  return {
    applyRedaction
  }
}
