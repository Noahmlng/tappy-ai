import assert from 'node:assert/strict'
import test from 'node:test'

import {
  B_CONFLICT_REASON_CODES,
  createConflictResolver
} from '../../src/mediation/schema-normalization/conflict-resolver.js'
import { createMappingAuditBuilder } from '../../src/mediation/schema-normalization/mapping-audit.js'

test('b-conflict: override by source priority is deterministic', () => {
  const resolver = createConflictResolver()

  const result = resolver.resolveFieldConflict({
    semanticSlot: 'placementType',
    candidates: [
      {
        source: 'defaultPolicy',
        rawValue: 'workflow_step',
        normalizedValue: 'workflow_checkpoint'
      },
      {
        source: 'placementConfig',
        rawValue: 'tool_output',
        normalizedValue: 'tool_result'
      },
      {
        source: 'appExplicit',
        rawValue: 'chat-inline',
        normalizedValue: 'chat_inline'
      }
    ]
  })

  assert.equal(result.conflictAction, 'override')
  assert.equal(result.selectedValue, 'chat_inline')
  assert.equal(result.reasonCode, B_CONFLICT_REASON_CODES.OVERRIDE_BY_PRIORITY)
  assert.equal(result.tieBreakRule, '')
})

test('b-conflict: tie-break chooses non-unknown first on same priority', () => {
  const resolver = createConflictResolver()

  const result = resolver.resolveFieldConflict({
    semanticSlot: 'actorType',
    candidates: [
      {
        source: 'appExplicit',
        rawValue: 'alien_actor',
        normalizedValue: 'unknown_actor_type',
        inputUpdatedAt: '2026-02-21T22:30:00.000Z',
        sourceSequence: 5
      },
      {
        source: 'appExplicit',
        rawValue: 'human_user',
        normalizedValue: 'human',
        inputUpdatedAt: '2026-02-21T22:20:00.000Z',
        sourceSequence: 1
      }
    ]
  })

  assert.equal(result.conflictAction, 'override')
  assert.equal(result.selectedValue, 'human')
  assert.equal(result.reasonCode, B_CONFLICT_REASON_CODES.OVERRIDE_BY_TIE_BREAK)
  assert.equal(result.tieBreakRule, 'prefer_non_unknown')
})

test('b-conflict: gating slot conflict is rejected hard', () => {
  const resolver = createConflictResolver()

  const result = resolver.resolveFieldConflict({
    semanticSlot: 'decisionOutcome',
    candidates: [
      {
        source: 'appExplicit',
        rawValue: 'eligible',
        normalizedValue: 'opportunity_eligible'
      },
      {
        source: 'placementConfig',
        rawValue: 'ineligible',
        normalizedValue: 'opportunity_ineligible'
      }
    ]
  })

  assert.equal(result.conflictAction, 'reject')
  assert.equal(result.selectedValue, null)
  assert.equal(result.reasonCode, B_CONFLICT_REASON_CODES.REJECT_GATING_HARD)
})

test('b-conflict: set_like field supports merge union', () => {
  const resolver = createConflictResolver({
    setLikeSemanticSlots: ['restrictedCategoryFlags']
  })

  const result = resolver.resolveFieldConflict({
    semanticSlot: 'restrictedCategoryFlags',
    candidates: [
      {
        source: 'appExplicit',
        rawValue: ['finance', 'health'],
        normalizedValue: ['finance', 'health']
      },
      {
        source: 'placementConfig',
        rawValue: ['health', 'gambling'],
        normalizedValue: ['health', 'gambling']
      }
    ]
  })

  assert.equal(result.conflictAction, 'merge')
  assert.deepEqual(result.selectedValue, ['finance', 'gambling', 'health'])
  assert.equal(result.reasonCode, B_CONFLICT_REASON_CODES.MERGE_UNION)
})

test('b-conflict: invalid set_like candidate is rejected as unmergeable', () => {
  const resolver = createConflictResolver({
    setLikeSemanticSlots: ['restrictedCategoryFlags']
  })

  const result = resolver.resolveFieldConflict({
    semanticSlot: 'restrictedCategoryFlags',
    candidates: [
      {
        source: 'appExplicit',
        rawValue: ['finance'],
        normalizedValue: ['finance']
      },
      {
        source: 'placementConfig',
        rawValue: { key: 'bad-shape' },
        normalizedValue: { key: 'bad-shape' }
      }
    ]
  })

  assert.equal(result.conflictAction, 'reject')
  assert.equal(result.selectedValue, null)
  assert.equal(result.reasonCode, B_CONFLICT_REASON_CODES.REJECT_UNMERGEABLE)
})

test('b-conflict: same input yields same result across multiple runs', () => {
  const resolver = createConflictResolver()
  const input = {
    semanticSlot: 'channelType',
    candidates: [
      {
        source: 'placementConfig',
        rawValue: 'sdk_http',
        normalizedValue: 'sdk_server',
        inputUpdatedAt: '2026-02-21T22:05:00.000Z',
        sourceSequence: 1
      },
      {
        source: 'placementConfig',
        rawValue: 'sdk_mobile',
        normalizedValue: 'sdk_client',
        inputUpdatedAt: '2026-02-21T22:05:00.000Z',
        sourceSequence: 1
      }
    ]
  }

  const expected = resolver.resolveFieldConflict(input)
  for (let i = 0; i < 10; i += 1) {
    const actual = resolver.resolveFieldConflict(input)
    assert.deepEqual(actual, expected)
  }
})

test('b-conflict: mapping audit snapshot contains required meta and deterministic records', () => {
  const resolver = createConflictResolver()
  const auditBuilder = createMappingAuditBuilder({
    nowFn: () => Date.parse('2026-02-21T22:40:00.000Z')
  })

  const conflictResolutionSnapshots = [
    resolver.resolveFieldConflict({
      semanticSlot: 'placementType',
      candidates: [
        { source: 'placementConfig', rawValue: 'tool_output', normalizedValue: 'tool_result' },
        { source: 'appExplicit', rawValue: 'chat-inline', normalizedValue: 'chat_inline' }
      ]
    }),
    resolver.resolveFieldConflict({
      semanticSlot: 'channelType',
      candidates: [
        { source: 'appExplicit', rawValue: 'rest', normalizedValue: 'sdk_server' }
      ]
    })
  ]

  const mappingRecords = [
    {
      semanticSlot: 'channelType',
      rawValue: 'rest',
      normalized: 'sdk_server',
      conflictAction: 'none',
      ruleVersion: 'b_mapping_v1',
      bucketValueOrNA: null,
      reasonCode: 'b_input_mapped_complete',
      source: 'appExplicit',
      mappingAction: 'alias_map'
    },
    {
      semanticSlot: 'placementType',
      rawValue: ['tool_output', 'chat-inline'],
      normalized: 'tool_result',
      conflictAction: 'override',
      ruleVersion: 'b_mapping_v1',
      bucketValueOrNA: null,
      reasonCode: 'b_input_mapped_complete',
      source: 'multi',
      mappingAction: 'alias_map'
    }
  ]

  const first = auditBuilder.buildFromConflictResolution({
    traceInitLite: {
      traceKey: 'trace_b_conflict_001',
      requestKey: 'req_b_conflict_001'
    },
    bInputContractVersion: 'b_input_contract_v1',
    mappingProfileVersion: 'b_mapping_profile_v1',
    enumDictVersion: 'b_enum_dict_v1',
    conflictPolicyVersion: 'b_conflict_policy_v1',
    redactionPolicyVersion: 'b_redaction_policy_v1',
    bucketDictVersion: 'b_bucket_dict_v1',
    mappingRecords,
    conflictResolutionSnapshots
  })

  const second = auditBuilder.buildFromConflictResolution({
    traceInitLite: {
      traceKey: 'trace_b_conflict_001',
      requestKey: 'req_b_conflict_001'
    },
    bInputContractVersion: 'b_input_contract_v1',
    mappingProfileVersion: 'b_mapping_profile_v1',
    enumDictVersion: 'b_enum_dict_v1',
    conflictPolicyVersion: 'b_conflict_policy_v1',
    redactionPolicyVersion: 'b_redaction_policy_v1',
    bucketDictVersion: 'b_bucket_dict_v1',
    mappingRecords,
    conflictResolutionSnapshots
  })

  assert.equal(first.ok, true)
  assert.equal(first.reasonCode, 'b_mapping_audit_snapshot_ready')
  assert.equal(first.mappingAuditSnapshotLite.traceKey, 'trace_b_conflict_001')
  assert.equal(first.mappingAuditSnapshotLite.requestKey, 'req_b_conflict_001')
  assert.equal(first.mappingAuditSnapshotLite.records.length, 2)

  const placementRecord = first.mappingAuditSnapshotLite.records.find((entry) => entry.semanticSlot === 'placementType')
  assert.equal(placementRecord.conflictAction, 'override')
  assert.equal(placementRecord.normalized, 'chat_inline')
  assert.equal(placementRecord.reasonCode, B_CONFLICT_REASON_CODES.OVERRIDE_BY_PRIORITY)

  assert.deepEqual(second, first)
})
