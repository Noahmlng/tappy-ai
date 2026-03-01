import assert from 'node:assert/strict'
import test from 'node:test'

import { __combinedContentInternal } from '../../scripts/pilot/generate-content-enrichment-combined-report.js'

test('content enrich combined report: parse run ids', () => {
  assert.deepEqual(
    __combinedContentInternal.parseRunIds('run_a, run_b , ,run_c'),
    ['run_a', 'run_b', 'run_c'],
  )
})

test('content enrich combined report: merge coverage summaries by network', () => {
  const merged = __combinedContentInternal.mergeCoverageSummaries([
    {
      coverage_before: [
        { network: 'house', total_active: 10, with_description: 6, with_image: 2, description_coverage: 0.6, image_coverage: 0.2 },
      ],
      coverage_after: [
        { network: 'house', total_active: 10, with_description: 9, with_image: 5, description_coverage: 0.9, image_coverage: 0.5 },
      ],
    },
    {
      coverage_before: [
        { network: 'partnerstack', total_active: 5, with_description: 1, with_image: 0, description_coverage: 0.2, image_coverage: 0 },
      ],
      coverage_after: [
        { network: 'partnerstack', total_active: 5, with_description: 5, with_image: 3, description_coverage: 1, image_coverage: 0.6 },
      ],
    },
  ])

  assert.deepEqual(merged.networks, ['house', 'partnerstack'])
  assert.equal(merged.coverage_delta.length, 2)
  const house = merged.coverage_delta.find((row) => row.network === 'house')
  const partnerstack = merged.coverage_delta.find((row) => row.network === 'partnerstack')
  assert.equal(house?.with_image_after, 5)
  assert.equal(partnerstack?.with_description_after, 5)
})
