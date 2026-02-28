import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAuthHeaders } from '../../scripts/pilot/fetch-content-api-samples.js'

test('content enrich api samples: runtime key falls back to bearer authorization', () => {
  const headers = buildAuthHeaders({ runtimeKey: 'sk_prod_123' })
  assert.equal(headers['x-runtime-key'], 'sk_prod_123')
  assert.equal(headers.authorization, 'Bearer sk_prod_123')
})

test('content enrich api samples: explicit auth header has priority', () => {
  const headers = buildAuthHeaders({
    runtimeKey: 'sk_prod_123',
    authHeader: 'Bearer custom_token',
  })
  assert.equal(headers['x-runtime-key'], 'sk_prod_123')
  assert.equal(headers.authorization, 'Bearer custom_token')
})

test('content enrich api samples: empty input returns empty auth headers', () => {
  const headers = buildAuthHeaders({})
  assert.deepEqual(headers, {})
})
