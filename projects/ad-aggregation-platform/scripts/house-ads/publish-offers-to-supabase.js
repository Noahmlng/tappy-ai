#!/usr/bin/env node
import path from 'node:path'
import {
  cleanText,
  parseArgs,
  readJsonl,
  toBoolean,
} from './lib/common.js'
import {
  chunk,
  countRows,
  withSupabaseClient,
  withTransaction,
} from './lib/supabase-db.js'

const OFFERS_ROOT = path.resolve(process.cwd(), 'data/house-ads/offers')
const OFFERS_CURATED_DIR = path.join(OFFERS_ROOT, 'curated')
const DEFAULT_OFFERS_FILE = path.join(OFFERS_CURATED_DIR, 'offers.jsonl')

const VALID_OFFER_TYPES = new Set(['link', 'product'])
const VALID_SOURCE_TYPES = new Set(['real', 'partner', 'synthetic'])
const VALID_STATUS = new Set(['active', 'paused', 'archived'])

function toNumber(value, fallback = null) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function toTimestamp(value) {
  const text = cleanText(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const raw of value) {
    const tag = cleanText(raw).toLowerCase()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

function normalizeOffer(row) {
  const offerType = cleanText(row.offer_type).toLowerCase()
  const sourceType = cleanText(row.source_type).toLowerCase()
  const status = cleanText(row.status).toLowerCase()

  return {
    offer_id: cleanText(row.offer_id),
    campaign_id: cleanText(row.campaign_id),
    brand_id: cleanText(row.brand_id),
    offer_type: offerType,
    vertical_l1: cleanText(row.vertical_l1),
    vertical_l2: cleanText(row.vertical_l2),
    market: cleanText(row.market) || 'US',
    title: cleanText(row.title),
    description: cleanText(row.description),
    snippet: cleanText(row.snippet),
    target_url: cleanText(row.target_url),
    image_url: cleanText(row.image_url),
    cta_text: cleanText(row.cta_text),
    status: status || 'active',
    language: cleanText(row.language) || 'en-US',
    disclosure: cleanText(row.disclosure) || 'Sponsored',
    source_type: sourceType,
    confidence_score: toNumber(row.confidence_score, 0),
    freshness_ttl_hours: Math.max(1, Math.floor(toNumber(row.freshness_ttl_hours, 48))),
    last_verified_at: toTimestamp(row.last_verified_at),
    product_id: cleanText(row.product_id),
    merchant: cleanText(row.merchant),
    price: toNumber(row.price),
    original_price: toNumber(row.original_price),
    currency: cleanText(row.currency).toUpperCase(),
    discount_pct: toNumber(row.discount_pct),
    availability: cleanText(row.availability),
    tags_json: normalizeTags(row.tags),
  }
}

function isStructurallyValid(row) {
  if (!row.offer_id || !row.campaign_id || !row.brand_id) return false
  if (!row.title || !row.target_url || !row.vertical_l1 || !row.vertical_l2) return false
  if (!VALID_OFFER_TYPES.has(row.offer_type)) return false
  if (!VALID_SOURCE_TYPES.has(row.source_type)) return false
  if (!VALID_STATUS.has(row.status)) return false
  return true
}

async function loadBrandIds(client) {
  const result = await client.query('SELECT brand_id FROM house_ads_brands')
  return new Set((result.rows || []).map((row) => cleanText(row.brand_id)).filter(Boolean))
}

async function insertOfferBatch(client, rows) {
  const sql = `
    INSERT INTO house_ads_offers (
      offer_id,
      campaign_id,
      brand_id,
      offer_type,
      vertical_l1,
      vertical_l2,
      market,
      title,
      description,
      snippet,
      target_url,
      image_url,
      cta_text,
      status,
      language,
      disclosure,
      source_type,
      confidence_score,
      freshness_ttl_hours,
      last_verified_at,
      product_id,
      merchant,
      price,
      original_price,
      currency,
      discount_pct,
      availability,
      tags_json,
      imported_at,
      updated_at
    )
    SELECT
      x.offer_id,
      x.campaign_id,
      x.brand_id,
      x.offer_type,
      x.vertical_l1,
      x.vertical_l2,
      COALESCE(x.market, 'US'),
      x.title,
      COALESCE(x.description, ''),
      COALESCE(x.snippet, ''),
      x.target_url,
      COALESCE(x.image_url, ''),
      COALESCE(x.cta_text, ''),
      COALESCE(x.status, 'active'),
      COALESCE(x.language, 'en-US'),
      COALESCE(x.disclosure, 'Sponsored'),
      x.source_type,
      COALESCE(x.confidence_score, 0),
      COALESCE(x.freshness_ttl_hours, 48),
      x.last_verified_at,
      COALESCE(x.product_id, ''),
      COALESCE(x.merchant, ''),
      x.price,
      x.original_price,
      COALESCE(x.currency, ''),
      x.discount_pct,
      COALESCE(x.availability, ''),
      COALESCE(x.tags_json, '[]'::jsonb),
      NOW(),
      NOW()
    FROM jsonb_to_recordset($1::jsonb) AS x(
      offer_id TEXT,
      campaign_id TEXT,
      brand_id TEXT,
      offer_type TEXT,
      vertical_l1 TEXT,
      vertical_l2 TEXT,
      market TEXT,
      title TEXT,
      description TEXT,
      snippet TEXT,
      target_url TEXT,
      image_url TEXT,
      cta_text TEXT,
      status TEXT,
      language TEXT,
      disclosure TEXT,
      source_type TEXT,
      confidence_score NUMERIC,
      freshness_ttl_hours INTEGER,
      last_verified_at TIMESTAMPTZ,
      product_id TEXT,
      merchant TEXT,
      price NUMERIC,
      original_price NUMERIC,
      currency TEXT,
      discount_pct NUMERIC,
      availability TEXT,
      tags_json JSONB
    )
    ON CONFLICT (offer_id) DO UPDATE SET
      campaign_id = EXCLUDED.campaign_id,
      brand_id = EXCLUDED.brand_id,
      offer_type = EXCLUDED.offer_type,
      vertical_l1 = EXCLUDED.vertical_l1,
      vertical_l2 = EXCLUDED.vertical_l2,
      market = EXCLUDED.market,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      snippet = EXCLUDED.snippet,
      target_url = EXCLUDED.target_url,
      image_url = EXCLUDED.image_url,
      cta_text = EXCLUDED.cta_text,
      status = EXCLUDED.status,
      language = EXCLUDED.language,
      disclosure = EXCLUDED.disclosure,
      source_type = EXCLUDED.source_type,
      confidence_score = EXCLUDED.confidence_score,
      freshness_ttl_hours = EXCLUDED.freshness_ttl_hours,
      last_verified_at = EXCLUDED.last_verified_at,
      product_id = EXCLUDED.product_id,
      merchant = EXCLUDED.merchant,
      price = EXCLUDED.price,
      original_price = EXCLUDED.original_price,
      currency = EXCLUDED.currency,
      discount_pct = EXCLUDED.discount_pct,
      availability = EXCLUDED.availability,
      tags_json = EXCLUDED.tags_json,
      updated_at = NOW()
  `
  await client.query(sql, [JSON.stringify(rows)])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputFile = path.resolve(process.cwd(), cleanText(args['input-file']) || DEFAULT_OFFERS_FILE)
  const force = toBoolean(args.force, false)
  const batchSize = Math.max(1, Number(args['batch-size'] || 400))

  const raw = await readJsonl(inputFile)
  let beforeOffers = 0
  let validBrands = 0
  const counters = {
    dropped_inactive: 0,
    dropped_invalid: 0,
    dropped_brand_missing: 0,
  }

  await withSupabaseClient(async (client) => {
    await withTransaction(client, async () => {
      beforeOffers = await countRows(client, 'house_ads_offers')
      if (beforeOffers > 0 && !force) {
        throw new Error(`target table is not empty: offers=${beforeOffers}. Use --force=true to continue.`)
      }
      if (force && beforeOffers > 0) {
        await client.query('TRUNCATE TABLE house_ads_offers')
      }

      const brandIds = await loadBrandIds(client)
      validBrands = brandIds.size
      const dedupe = new Map()

      for (const item of raw) {
        const normalized = normalizeOffer(item)
        if (normalized.status !== 'active') {
          counters.dropped_inactive += 1
          continue
        }
        if (!brandIds.has(normalized.brand_id)) {
          counters.dropped_brand_missing += 1
          continue
        }
        if (!isStructurallyValid(normalized)) {
          counters.dropped_invalid += 1
          continue
        }
        dedupe.set(normalized.offer_id, normalized)
      }

      const rows = [...dedupe.values()]
      const batches = chunk(rows, batchSize)
      for (const batch of batches) {
        await insertOfferBatch(client, batch)
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            inputFile: path.relative(process.cwd(), inputFile),
            inputRows: raw.length,
            importedRows: rows.length,
            beforeOffers,
            validBrands,
            dropped: counters,
            force,
          },
          null,
          2,
        ),
      )
    })
  })
}

main().catch((error) => {
  console.error('[publish-offers-to-supabase] failed:', error?.message || error)
  process.exit(1)
})
