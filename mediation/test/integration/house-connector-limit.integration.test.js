import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createHouseConnector } from '../../src/connectors/house/index.js'

function createOfferRow(index) {
  const id = String(index + 1).padStart(4, '0')
  return {
    offer_id: `offer_${id}`,
    campaign_id: `campaign_${id}`,
    brand_id: `brand_${id}`,
    offer_type: 'product',
    market: 'US',
    title: `Product ${id}`,
    description: `Description ${id}`,
    snippet: `Snippet ${id}`,
    target_url: `https://example.com/p/${id}`,
    image_url: `https://cdn.example.com/p/${id}.png`,
    status: 'active',
    language: 'en',
    disclosure: 'Sponsored',
    source_type: 'crawler',
    confidence_score: 0.9,
    freshness_ttl_hours: 72,
    last_verified_at: '2026-03-01T00:00:00.000Z',
    product_id: `product_${id}`,
    merchant: `Merchant ${id}`,
    price: '10.00',
    original_price: '20.00',
    currency: 'USD',
    discount_pct: 50,
    availability: 'in_stock',
    tags_json: ['electronics'],
  }
}

test('house connector supports inventory sync limits above 500', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'house-connector-limit-'))
  const catalogPath = path.join(tmpDir, 'catalog.jsonl')
  const totalRows = 620
  const lines = Array.from({ length: totalRows }, (_, index) => JSON.stringify(createOfferRow(index)))
  await fs.writeFile(catalogPath, `${lines.join('\n')}\n`, 'utf8')

  const connector = createHouseConnector({
    source: 'file',
    productCatalogPath: catalogPath,
  })

  const result = await connector.fetchProductOffersCatalog({
    limit: 20000,
    market: 'US',
    locale: 'en-US',
  })

  assert.equal(Array.isArray(result.offers), true)
  assert.equal(result.offers.length, totalRows)

  const clipped = await connector.fetchProductOffersCatalog({
    limit: 400,
    market: 'US',
    locale: 'en-US',
  })
  assert.equal(clipped.offers.length, 400)

  await fs.rm(tmpDir, { recursive: true, force: true })
})
