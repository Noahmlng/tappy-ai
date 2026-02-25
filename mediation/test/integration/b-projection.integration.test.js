import assert from 'node:assert/strict'
import test from 'node:test'

import {
  B_BUCKET_REASON_CODES,
  createBucketizerService
} from '../../src/mediation/schema-normalization/bucketizer.js'
import {
  B_REDACTION_REASON_CODES,
  createRedactionService
} from '../../src/mediation/schema-normalization/redaction.js'
import {
  B_PROJECTION_REASON_CODES,
  createOpenrtbProjectionService
} from '../../src/mediation/schema-normalization/openrtb-projection.js'

function buildTrace() {
  return {
    traceKey: 'trace_b_proj_001',
    requestKey: 'req_b_proj_001',
    attemptKey: 'att_b_proj_001'
  }
}

function buildCanonical(overrides = {}) {
  return {
    RequestMeta: {
      requestKey: 'req_b_proj_001',
      requestTimestamp: '2026-02-21T23:00:00.000Z',
      channelType: 'sdk_server'
    },
    PlacementMeta: {
      placementKey: 'plc_inline_001',
      placementSurface: 'chat_inline_surface',
      placementType: 'chat_inline'
    },
    UserContext: {
      sessionKey: 'session-raw-001',
      actorType: 'human'
    },
    OpportunityContext: {
      triggerDecision: 'opportunity_eligible',
      decisionOutcome: 'opportunity_eligible',
      hitType: 'explicit_hit'
    },
    PolicyContext: {
      consentScope: 'consent_granted',
      policyGateHint: 'allow',
      restrictedCategoryFlags: []
    },
    TraceContext: buildTrace(),
    ...overrides
  }
}

function buildSourceBundle(overrides = {}) {
  return {
    appExplicit: {
      appId: 'app_chat_main',
      app_context: {
        device_performance_tier: 'perf_p2'
      }
    },
    placementConfig: {},
    defaultPolicy: {},
    ...overrides
  }
}

test('b-projection: mapped pipeline outputs projection/redaction/bucket snapshots', () => {
  const traceInitLite = buildTrace()
  const bucketizer = createBucketizerService({
    nowFn: () => Date.parse('2026-02-21T23:00:02.000Z')
  })
  const redaction = createRedactionService({
    nowFn: () => Date.parse('2026-02-21T23:00:03.000Z')
  })
  const projection = createOpenrtbProjectionService({
    nowFn: () => Date.parse('2026-02-21T23:00:04.000Z')
  })

  const bucketResult = bucketizer.bucketize({
    traceInitLite,
    numericSignals: {
      intentScore: 0.75,
      devicePerfScore: 72,
      sessionDepth: 12
    }
  })
  assert.equal(bucketResult.ok, true)
  assert.equal(bucketResult.bucketAction, 'continue')
  assert.equal(Boolean(bucketResult.bucketAuditSnapshotLite), true)

  const redactionResult = redaction.applyRedaction({
    traceInitLite,
    valuesByPath: {
      'UserContext.sessionKey': 'session-raw-001',
      'RequestMeta.requestTimestamp': '2026-02-21T23:00:00.000Z',
      'device.id': 'dev-raw-abc'
    }
  })
  assert.equal(redactionResult.ok, true)
  assert.equal(Boolean(redactionResult.redactionSnapshotLite), true)
  assert.equal(redactionResult.redactionSnapshotLite.beforeAuditEnforced, true)

  const projectionResult = projection.project({
    traceInitLite,
    sixBlockCanonical: buildCanonical(),
    sourceInputBundleLite: buildSourceBundle(),
    redactionResult,
    bucketResult,
    openrtbProjectionVersion: 'b_openrtb_projection_v1'
  })

  assert.equal(projectionResult.ok, true)
  assert.equal(projectionResult.projectionDisposition, 'mapped')
  assert.equal(projectionResult.projectionAction, 'continue')
  assert.equal(projectionResult.projectionReasonCode, B_PROJECTION_REASON_CODES.MAPPED_COMPLETE)
  assert.equal(Boolean(projectionResult.openrtbProjectionLite), true)
  assert.equal(Boolean(projectionResult.projectionAuditSnapshotLite), true)
  assert.equal(projectionResult.openrtbProjectionLite.id, 'req_b_proj_001')
  assert.equal(projectionResult.openrtbProjectionLite.app.id, 'app_chat_main')
  assert.equal(projectionResult.openrtbProjectionLite.user.id.length, 64)
  assert.equal(projectionResult.openrtbProjectionLite.device.ext.performance_tier, 'perf_p3')
})

test('b-projection: partial when optional targets are missing', () => {
  const traceInitLite = buildTrace()
  const bucketizer = createBucketizerService()
  const redaction = createRedactionService()
  const projection = createOpenrtbProjectionService()

  const bucketResult = bucketizer.bucketize({
    traceInitLite,
    numericSignals: {
      intentScore: 0.5,
      devicePerfScore: undefined,
      sessionDepth: 2
    }
  })

  const redactionResult = redaction.applyRedaction({
    traceInitLite,
    valuesByPath: {
      'UserContext.sessionKey': 'session-raw-001'
    }
  })

  const projectionResult = projection.project({
    traceInitLite,
    sixBlockCanonical: buildCanonical({
      RequestMeta: {
        requestKey: 'req_b_proj_001',
        requestTimestamp: '',
        channelType: ''
      },
      UserContext: {
        sessionKey: 'session-raw-001',
        actorType: ''
      },
      PolicyContext: {
        consentScope: 'consent_granted',
        policyGateHint: '',
        restrictedCategoryFlags: []
      }
    }),
    sourceInputBundleLite: buildSourceBundle(),
    redactionResult,
    bucketResult
  })

  assert.equal(projectionResult.ok, true)
  assert.equal(projectionResult.projectionDisposition, 'partial')
  assert.equal(projectionResult.projectionAction, 'degrade')
  assert.equal(projectionResult.projectionReasonCode, B_PROJECTION_REASON_CODES.PARTIAL_OPTIONAL_MISSING)
})

test('b-projection: unmapped when required targets are missing', () => {
  const traceInitLite = buildTrace()
  const redaction = createRedactionService()
  const projection = createOpenrtbProjectionService()

  const redactionResult = redaction.applyRedaction({
    traceInitLite,
    valuesByPath: {
      'UserContext.sessionKey': ''
    }
  })

  const projectionResult = projection.project({
    traceInitLite,
    sixBlockCanonical: buildCanonical({
      PlacementMeta: {
        placementKey: '',
        placementSurface: '',
        placementType: ''
      }
    }),
    sourceInputBundleLite: buildSourceBundle({
      appExplicit: {},
      placementConfig: {},
      defaultPolicy: {}
    }),
    redactionResult,
    bucketResult: {
      bucketedValues: {}
    }
  })

  assert.equal(projectionResult.ok, false)
  assert.equal(projectionResult.projectionDisposition, 'unmapped')
  assert.equal(projectionResult.projectionAction, 'reject')
  assert.equal(projectionResult.projectionReasonCode, B_PROJECTION_REASON_CODES.UNMAPPED_REQUIRED_MISSING)
})

test('b-projection: invalid required value is unmapped_invalid_value', () => {
  const traceInitLite = buildTrace()
  const redaction = createRedactionService()
  const projection = createOpenrtbProjectionService()

  const redactionResult = redaction.applyRedaction({
    traceInitLite,
    valuesByPath: {
      'UserContext.sessionKey': 'session-raw-001'
    }
  })

  const projectionResult = projection.project({
    traceInitLite,
    sixBlockCanonical: buildCanonical({
      PolicyContext: {
        consentScope: 'consent_granted',
        policyGateHint: 'allow',
        restrictedCategoryFlags: 'not-array'
      }
    }),
    sourceInputBundleLite: buildSourceBundle(),
    redactionResult,
    bucketResult: {
      bucketedValues: {}
    }
  })

  assert.equal(projectionResult.ok, false)
  assert.equal(projectionResult.projectionDisposition, 'unmapped')
  assert.equal(projectionResult.projectionReasonCode, B_PROJECTION_REASON_CODES.UNMAPPED_INVALID_VALUE)
})

test('b-projection: reject when redaction is not enforced before audit', () => {
  const projection = createOpenrtbProjectionService()

  const result = projection.project({
    traceInitLite: buildTrace(),
    sixBlockCanonical: buildCanonical(),
    sourceInputBundleLite: buildSourceBundle(),
    redactionResult: {
      ok: true,
      redactedValuesByPath: {
        'UserContext.sessionKey': 'session-raw-001'
      },
      redactionSnapshotLite: {
        beforeAuditEnforced: false
      }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.projectionAction, 'reject')
  assert.equal(result.projectionReasonCode, B_REDACTION_REASON_CODES.BEFORE_AUDIT_VIOLATION)
})

test('b-projection: bucketizer handles unknown and outlier with stable reason codes', () => {
  const bucketizer = createBucketizerService({
    nowFn: () => Date.parse('2026-02-21T23:10:00.000Z')
  })

  const result = bucketizer.bucketize({
    traceInitLite: buildTrace(),
    numericSignals: {
      intentScore: undefined,
      devicePerfScore: 130,
      sessionDepth: -1
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.bucketAction, 'degrade')
  assert.equal(result.reasonCode, B_BUCKET_REASON_CODES.UNKNOWN_VALUE)
  assert.equal(result.bucketedValues.intentScore, 'intent_unknown')
  assert.equal(result.bucketedValues.devicePerfScore, 'perf_outlier_high')
  assert.equal(result.bucketedValues.sessionDepth, 'session_outlier_low')
  assert.equal(result.bucketAuditSnapshotLite.slotDecisions.length, 3)
})

test('b-projection: bucketizer rejects undefined numeric slot', () => {
  const bucketizer = createBucketizerService()
  const result = bucketizer.bucketize({
    traceInitLite: buildTrace(),
    numericSignals: {
      intentScore: 0.2,
      customScore: 10
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, B_BUCKET_REASON_CODES.SLOT_UNDEFINED)
})
