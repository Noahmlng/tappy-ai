import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  assertErrorCode,
  assertRequiredFields,
  assertSchemaValid,
  assertSnapshot,
  evaluateRequiredFields,
  readJson,
  validateJsonSchema
} from '../utils/contract-runner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const AD_REQUEST_SCHEMA_PATH = path.join(PROJECT_ROOT, 'schemas', 'ad-request.schema.json')

test('contract-runner: validate schema success path for ad-request', async () => {
  const schema = await readJson(AD_REQUEST_SCHEMA_PATH)
  const payload = {
    appId: 'app_chat_main',
    sessionId: 'sess_001',
    placementId: 'placement_inline',
    context: {
      intentScore: 0.74,
      locale: 'en-US'
    }
  }

  assertSchemaValid(schema, payload)
})

test('contract-runner: report required field violation with stable error code', async () => {
  const schema = await readJson(AD_REQUEST_SCHEMA_PATH)
  const payload = {
    appId: 'app_chat_main',
    sessionId: 'sess_001',
    placementId: 'placement_inline',
    context: {
      locale: 'en-US'
    }
  }

  const result = validateJsonSchema(schema, payload)
  assert.equal(result.ok, false)
  assert.equal(result.errors.length > 0, true)
  assertErrorCode(result.errors[0], 'schema_required_missing', { codePath: 'code' })
  assert.equal(result.errors.some((error) => error.pointer === '$.context.intentScore'), true)
})

test('contract-runner: assert required fields and reason code', () => {
  const payload = {
    requestKey: 'req_001',
    opportunityKey: 'opp_001'
  }

  const evaluated = evaluateRequiredFields(payload, ['requestKey', 'opportunityKey', 'traceKey'])
  assert.equal(evaluated.ok, false)
  assert.deepEqual(evaluated.missing, ['traceKey'])
  assertErrorCode(evaluated, 'required_field_missing')

  assert.throws(() => {
    assertRequiredFields(payload, ['requestKey', 'traceKey'])
  }, /required_field_missing/)
})

test('contract-runner: snapshot assertion is deterministic for contract outputs', () => {
  const actual = {
    reasonCode: 'a_trg_ok',
    ok: true,
    versionAnchorSnapshot: {
      h: 'h_v1',
      a: 'a_v1'
    },
    trace: {
      requestKey: 'req_001',
      traceKey: 'trace_001'
    }
  }

  const expectedSnapshot = {
    ok: true,
    reasonCode: 'a_trg_ok',
    trace: {
      traceKey: 'trace_001',
      requestKey: 'req_001'
    },
    versionAnchorSnapshot: {
      a: 'a_v1',
      h: 'h_v1'
    }
  }

  assertSnapshot(actual, expectedSnapshot)
})
