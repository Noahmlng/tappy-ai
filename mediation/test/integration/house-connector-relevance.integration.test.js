import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createHouseConnector } from '../../src/connectors/house/index.js'

function buildCatalogRow(input = {}) {
  const id = String(input.id || 'offer_default').trim()
  return {
    offer_id: id,
    campaign_id: `campaign_${id}`,
    brand_id: `brand_${id}`,
    offer_type: 'product',
    market: input.market || 'US',
    title: input.title || 'Untitled Offer',
    description: input.description || '',
    snippet: input.snippet || input.description || '',
    target_url: input.targetUrl || `https://example.com/${id}`,
    image_url: `https://cdn.example.com/${id}.png`,
    status: 'active',
    language: input.language || 'en',
    disclosure: 'Sponsored',
    source_type: 'crawler',
    confidence_score: Number.isFinite(input.confidenceScore) ? input.confidenceScore : 0.8,
    freshness_ttl_hours: 72,
    last_verified_at: '2026-03-01T00:00:00.000Z',
    product_id: `product_${id}`,
    merchant_or_network: input.merchant || 'merchant',
    currency: 'USD',
    discount_pct: Number.isFinite(input.discountPct) ? input.discountPct : 0,
    availability: 'in_stock',
    vertical_l1: input.verticalL1 || '',
    vertical_l2: input.verticalL2 || '',
    match_tags: Array.isArray(input.matchTags) ? input.matchTags : [],
  }
}

async function withTempCatalog(rows, fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'house-relevance-'))
  const catalogPath = path.join(tmpDir, 'catalog.jsonl')
  await fs.writeFile(catalogPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')

  try {
    const connector = createHouseConnector({
      source: 'file',
      productCatalogPath: catalogPath,
    })
    await fn(connector)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

test('house connector: camera query should not fall back to travel-only offers', async () => {
  await withTempCatalog([
    buildCatalogRow({
      id: 'travel_fuji',
      title: 'Mount Fuji Travel Service',
      description: 'Book your Japan travel package',
      targetUrl: 'https://travel.example.com/fuji',
      merchant: 'TravelGo',
      confidenceScore: 0.99,
      verticalL1: 'travel',
      verticalL2: 'travel_service',
      matchTags: ['travel', 'tour', 'japan'],
    }),
  ], async (connector) => {
    const query = 'nikon 和 fuji 哪个相机好'
    const result = await connector.fetchProductOffersCatalog({
      query,
      keywords: query,
      market: 'US',
      locale: 'en-US',
      limit: 5,
    })

    assert.equal(result.offers.length, 0)
    assert.equal(result.debug.queryCategoryHint, 'electronics')
    assert.equal(result.debug.categoryFilteredEntries, 0)
    assert.equal(result.debug.keywordMatchedEntries, 0)
  })
})

test('house connector: camera category hint should keep electronics fallback when keyword exact match is absent', async () => {
  await withTempCatalog([
    buildCatalogRow({
      id: 'travel_fuji',
      title: 'Fuji Sunrise Tour',
      description: 'Travel experience around Mount Fuji',
      targetUrl: 'https://travel.example.com/fuji-tour',
      merchant: 'TravelGo',
      confidenceScore: 0.98,
      verticalL1: 'travel',
      verticalL2: 'travel_service',
      matchTags: ['travel', 'tour'],
    }),
    buildCatalogRow({
      id: 'camera_entry',
      title: 'Entry Camera Kit',
      description: 'Starter camera bundle for beginners',
      targetUrl: 'https://shop.example.com/camera-kit',
      merchant: 'CamLab',
      confidenceScore: 0.91,
      verticalL1: 'electronics',
      verticalL2: 'camera',
      matchTags: ['electronics', 'camera'],
    }),
  ], async (connector) => {
    const query = '哪个相机更值得买'
    const result = await connector.fetchProductOffersCatalog({
      query,
      keywords: query,
      market: 'US',
      locale: 'en-US',
      limit: 5,
    })

    assert.equal(result.offers.length, 1)
    assert.equal(result.offers[0].title, 'Entry Camera Kit')
    assert.equal(result.debug.queryCategoryHint, 'electronics')
    assert.equal(result.debug.categoryFilteredEntries, 1)
  })
})
