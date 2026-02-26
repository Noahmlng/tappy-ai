import assert from 'node:assert/strict'
import test from 'node:test'

import {
  migrateLegacyPlacementIdsInSupabase,
  normalizeAgentAccessTokenRecord,
  normalizeIntegrationTokenRecord,
  normalizePlacementIdWithMigration,
} from '../../src/devtools/mediation/mediation-gateway.js'

const LEGACY_PLACEMENT_IDS = new Set(['chat_inline_v1', 'chat_followup_v1'])
const MIGRATION_TABLES = [
  'control_plane_integration_tokens',
  'control_plane_agent_access_tokens',
  'mediation_runtime_decision_logs',
  'mediation_runtime_event_logs',
  'mediation_settlement_conversion_facts',
]

function createMockPlacementMigrationPool(seed = {}) {
  const tables = Object.fromEntries(MIGRATION_TABLES.map((table) => {
    const rows = Array.isArray(seed[table]) ? seed[table].map((row) => ({ ...row })) : []
    return [table, rows]
  }))

  return {
    tables,
    async query(sql, params = []) {
      const normalizedSql = String(sql || '').trim().replace(/\s+/g, ' ')
      const match = normalizedSql.match(/^UPDATE ([a-zA-Z0-9_]+) SET ([a-zA-Z0-9_]+) = \$1 WHERE \2 = \$2$/)
      if (!match) {
        throw new Error(`Unsupported SQL in mock pool: ${normalizedSql}`)
      }
      const table = String(match[1] || '').trim()
      const column = String(match[2] || '').trim()
      const replacement = String(params?.[0] || '').trim()
      const legacy = String(params?.[1] || '').trim()
      const rows = Array.isArray(tables[table]) ? tables[table] : []
      let rowCount = 0
      for (const row of rows) {
        if (String(row?.[column] || '').trim() !== legacy) continue
        row[column] = replacement
        rowCount += 1
      }
      return { rowCount }
    },
  }
}

function tableHasLegacyPlacementId(rows = []) {
  return rows.some((row) => LEGACY_PLACEMENT_IDS.has(String(row?.placement_id || '').trim()))
}

test('token normalization maps legacy placement ids to canonical ids during record load', () => {
  const integration = normalizeIntegrationTokenRecord({
    token_id: 'itk_test_001',
    app_id: 'sample-client-app',
    account_id: 'org_demo',
    environment: 'prod',
    placement_id: 'chat_inline_v1',
    token_hash: 'hash_itk_001',
    status: 'active',
    scope: {},
    issued_at: '2026-02-24T12:00:00.000Z',
    expires_at: '2026-02-24T12:10:00.000Z',
    updated_at: '2026-02-24T12:00:00.000Z',
  })
  assert.equal(integration?.placementId, 'chat_from_answer_v1')

  const agent = normalizeAgentAccessTokenRecord({
    token_id: 'atk_test_001',
    app_id: 'sample-client-app',
    account_id: 'org_demo',
    environment: 'prod',
    placement_id: 'chat_followup_v1',
    source_token_id: 'itk_test_001',
    token_hash: 'hash_atk_001',
    status: 'active',
    scope: {},
    issued_at: '2026-02-24T12:00:00.000Z',
    expires_at: '2026-02-24T12:05:00.000Z',
    updated_at: '2026-02-24T12:00:00.000Z',
  })
  assert.equal(agent?.placementId, 'chat_intent_recommendation_v1')
  assert.equal(normalizePlacementIdWithMigration('chat_inline_v1'), 'chat_from_answer_v1')
  assert.equal(normalizePlacementIdWithMigration('chat_followup_v1'), 'chat_intent_recommendation_v1')
})

test('placement id migration updates all target tables once and stays idempotent on rerun', async () => {
  const pool = createMockPlacementMigrationPool({
    control_plane_integration_tokens: [
      { placement_id: 'chat_inline_v1' },
      { placement_id: 'chat_followup_v1' },
      { placement_id: 'chat_from_answer_v1' },
    ],
    control_plane_agent_access_tokens: [
      { placement_id: 'chat_inline_v1' },
    ],
    mediation_runtime_decision_logs: [
      { placement_id: 'chat_followup_v1' },
    ],
    mediation_runtime_event_logs: [
      { placement_id: 'chat_inline_v1' },
      { placement_id: 'chat_inline_v1' },
    ],
    mediation_settlement_conversion_facts: [
      { placement_id: 'chat_followup_v1' },
    ],
  })

  const firstRun = await migrateLegacyPlacementIdsInSupabase(pool)
  assert.equal(firstRun.executed, true)
  assert.equal(firstRun.totalUpdatedRows, 7)
  assert.equal(firstRun.updatedRowsByTable.control_plane_integration_tokens.updatedRows, 2)
  assert.equal(firstRun.updatedRowsByTable.control_plane_agent_access_tokens.updatedRows, 1)
  assert.equal(firstRun.updatedRowsByTable.mediation_runtime_decision_logs.updatedRows, 1)
  assert.equal(firstRun.updatedRowsByTable.mediation_runtime_event_logs.updatedRows, 2)
  assert.equal(firstRun.updatedRowsByTable.mediation_settlement_conversion_facts.updatedRows, 1)

  for (const table of MIGRATION_TABLES) {
    assert.equal(
      tableHasLegacyPlacementId(pool.tables[table]),
      false,
      `legacy placement ids should be removed from ${table}`,
    )
  }

  const secondRun = await migrateLegacyPlacementIdsInSupabase(pool)
  assert.equal(secondRun.executed, true)
  assert.equal(secondRun.totalUpdatedRows, 0)
  for (const table of MIGRATION_TABLES) {
    assert.equal(secondRun.updatedRowsByTable[table].updatedRows, 0, `${table} should be idempotent`)
  }
})
