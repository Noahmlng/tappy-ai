import assert from 'node:assert/strict'
import test from 'node:test'

import { __fullContentInternal } from '../../scripts/pilot/enrich-content-full.js'

test('content enrich full: parses network list with dedup and validation', () => {
  assert.deepEqual(
    __fullContentInternal.parseNetworks('house,partnerstack,house,cj'),
    ['house', 'partnerstack'],
  )
  assert.deepEqual(
    __fullContentInternal.parseNetworks(''),
    ['house', 'partnerstack'],
  )
})

test('content enrich full: computes coverage delta per network', () => {
  const delta = __fullContentInternal.computeCoverageDelta(
    [
      { network: 'house', total_active: 10, with_description: 7, with_image: 2, description_coverage: 0.7, image_coverage: 0.2 },
    ],
    [
      { network: 'house', total_active: 10, with_description: 9, with_image: 4, description_coverage: 0.9, image_coverage: 0.4 },
      { network: 'partnerstack', total_active: 5, with_description: 5, with_image: 3, description_coverage: 1, image_coverage: 0.6 },
    ],
  )

  assert.equal(delta.length, 2)
  assert.deepEqual(delta[0], {
    network: 'house',
    total_active_before: 10,
    total_active_after: 10,
    with_description_before: 7,
    with_description_after: 9,
    with_image_before: 2,
    with_image_after: 4,
    description_coverage_before: 0.7,
    description_coverage_after: 0.9,
    image_coverage_before: 0.2,
    image_coverage_after: 0.4,
  })
  assert.deepEqual(delta[1], {
    network: 'partnerstack',
    total_active_before: 0,
    total_active_after: 5,
    with_description_before: 0,
    with_description_after: 5,
    with_image_before: 0,
    with_image_after: 3,
    description_coverage_before: 0,
    description_coverage_after: 1,
    image_coverage_before: 0,
    image_coverage_after: 0.6,
  })
})
