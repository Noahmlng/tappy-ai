import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { runProductCoverageAudit, __coverageProductsInternal } from '../../scripts/inventory/coverage-products.js'

function buildBatchPayload(rows = []) {
  return {
    metrics: {
      rows,
    },
  }
}

test('inventory coverage products: detectProductHits finds meyka/deepai terms', () => {
  const hits = __coverageProductsInternal.detectProductHits({
    title: 'Best DeepAI alternatives',
    description: 'Meyka style finance assistant',
    target_url: 'https://meyka.com/compare',
    metadata: {},
  })
  assert.equal(Array.isArray(hits.meyka), true)
  assert.equal(Array.isArray(hits.deepai), true)
  assert.equal(hits.meyka.includes('meyka'), true)
  assert.equal(hits.deepai.includes('deepai'), true)
})

test('inventory coverage products: batch mode reports brand_hit and category_gap', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-coverage-'))
  const batchPath = path.join(tmpDir, 'batch.json')
  const outputPath = path.join(tmpDir, 'report.json')

  const payload = buildBatchPayload([
    {
      skipped: false,
      network: 'house',
      after: {
        offer_id: 'meyka_offer_1',
        network: 'house',
        title: 'Meyka investment insights',
        description: 'finance planning tools',
        target_url: 'https://meyka.com/plans',
        metadata: {
          vertical_l1: 'finance',
          vertical_l2: 'digital_banking',
        },
      },
    },
    {
      skipped: false,
      network: 'partnerstack',
      after: {
        offer_id: 'deepai_offer_1',
        network: 'partnerstack',
        title: 'DeepAI API access',
        description: 'developer toolkit',
        target_url: 'https://deepai.com/pricing',
        metadata: {
          vertical_l1: 'developer_tools',
          vertical_l2: 'dev_platform',
        },
      },
    },
    {
      skipped: false,
      network: 'house',
      after: {
        offer_id: 'generic_offer_1',
        network: 'house',
        title: 'General shopping offer',
        description: 'discounts and deals',
        target_url: 'https://example.com/deals',
        metadata: {
          vertical_l1: 'fashion',
          vertical_l2: 'apparel',
        },
      },
    },
  ])
  await fs.writeFile(batchPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const report = await runProductCoverageAudit({
    'batch-files': batchPath,
    'output-file': outputPath,
    'sample-size': '20',
    'target-per-category': '1',
    'meyka-categories': 'finance::digital_banking',
    'deepai-categories': 'developer_tools::dev_platform',
  })

  assert.equal(report.mode, 'batch_files')
  assert.equal(report.summary.total_rows, 3)
  assert.equal(report.summary.brand_hit_count, 2)
  assert.equal(report.summary.brand_hits_by_product.meyka, 1)
  assert.equal(report.summary.brand_hits_by_product.deepai, 1)
  assert.equal(report.category_gap.meyka[0].gap, 0)
  assert.equal(report.category_gap.deepai[0].gap, 0)

  const saved = JSON.parse(await fs.readFile(outputPath, 'utf8'))
  assert.equal(saved.summary.brand_hit_count, 2)
  assert.equal(saved.rows_hit_sample.length, 2)
  assert.equal(saved.rows_hit_sample.every((row) => row.brand_hit === true), true)
})

