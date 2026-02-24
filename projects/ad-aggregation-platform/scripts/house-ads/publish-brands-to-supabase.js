#!/usr/bin/env node
import path from 'node:path'
import {
  CURATED_ROOT,
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

const DEFAULT_BRANDS_FILE = path.join(CURATED_ROOT, 'brands.jsonl')

function toNumber(value, fallback = 0) {
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

function isEligibleBrand(row) {
  const status = cleanText(row?.status).toLowerCase()
  const admitted = row?.evidence?.strict_admission?.admitted === true
  return status === 'active' && admitted
}

function normalizeBrand(row) {
  const evidence = row?.evidence && typeof row.evidence === 'object' ? row.evidence : {}
  const strict = evidence?.strict_admission && typeof evidence.strict_admission === 'object'
    ? evidence.strict_admission
    : {}
  const cleaning = evidence?.cleaning && typeof evidence.cleaning === 'object' ? evidence.cleaning : {}

  return {
    brand_id: cleanText(row.brand_id),
    brand_name: cleanText(row.brand_name),
    canonical_brand_name: cleanText(row.canonical_brand_name),
    official_domain: cleanText(row.official_domain).toLowerCase(),
    vertical_l1: cleanText(row.vertical_l1),
    vertical_l2: cleanText(row.vertical_l2),
    market: cleanText(row.market) || 'US',
    status: cleanText(row.status).toLowerCase() || 'active',
    source_confidence: toNumber(row.source_confidence, 0),
    alignment_status: cleanText(row.alignment_status),
    alignment_source: cleanText(row.alignment_source),
    strict_admitted: strict.admitted === true,
    strong_evidence: strict.strong_evidence === true,
    clean_score: toNumber(strict.clean_score, toNumber(cleaning.final_score, 0)),
    canonical_source: cleanText(strict.canonical_source),
    checked_at: toTimestamp(strict.checked_at),
    evidence_json: evidence,
  }
}

async function insertBrandBatch(client, rows) {
  const sql = `
    INSERT INTO house_ads_brands (
      brand_id,
      brand_name,
      canonical_brand_name,
      official_domain,
      vertical_l1,
      vertical_l2,
      market,
      status,
      source_confidence,
      alignment_status,
      alignment_source,
      strict_admitted,
      strong_evidence,
      clean_score,
      canonical_source,
      checked_at,
      evidence_json,
      imported_at,
      updated_at
    )
    SELECT
      x.brand_id,
      x.brand_name,
      COALESCE(x.canonical_brand_name, ''),
      x.official_domain,
      x.vertical_l1,
      x.vertical_l2,
      COALESCE(x.market, 'US'),
      COALESCE(x.status, 'active'),
      COALESCE(x.source_confidence, 0),
      COALESCE(x.alignment_status, ''),
      COALESCE(x.alignment_source, ''),
      COALESCE(x.strict_admitted, FALSE),
      COALESCE(x.strong_evidence, FALSE),
      COALESCE(x.clean_score, 0),
      COALESCE(x.canonical_source, ''),
      x.checked_at,
      COALESCE(x.evidence_json, '{}'::jsonb),
      NOW(),
      NOW()
    FROM jsonb_to_recordset($1::jsonb) AS x(
      brand_id TEXT,
      brand_name TEXT,
      canonical_brand_name TEXT,
      official_domain TEXT,
      vertical_l1 TEXT,
      vertical_l2 TEXT,
      market TEXT,
      status TEXT,
      source_confidence NUMERIC,
      alignment_status TEXT,
      alignment_source TEXT,
      strict_admitted BOOLEAN,
      strong_evidence BOOLEAN,
      clean_score NUMERIC,
      canonical_source TEXT,
      checked_at TIMESTAMPTZ,
      evidence_json JSONB
    )
    ON CONFLICT (brand_id) DO UPDATE SET
      brand_name = EXCLUDED.brand_name,
      canonical_brand_name = EXCLUDED.canonical_brand_name,
      official_domain = EXCLUDED.official_domain,
      vertical_l1 = EXCLUDED.vertical_l1,
      vertical_l2 = EXCLUDED.vertical_l2,
      market = EXCLUDED.market,
      status = EXCLUDED.status,
      source_confidence = EXCLUDED.source_confidence,
      alignment_status = EXCLUDED.alignment_status,
      alignment_source = EXCLUDED.alignment_source,
      strict_admitted = EXCLUDED.strict_admitted,
      strong_evidence = EXCLUDED.strong_evidence,
      clean_score = EXCLUDED.clean_score,
      canonical_source = EXCLUDED.canonical_source,
      checked_at = EXCLUDED.checked_at,
      evidence_json = EXCLUDED.evidence_json,
      updated_at = NOW()
  `
  await client.query(sql, [JSON.stringify(rows)])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputFile = path.resolve(process.cwd(), cleanText(args['input-file']) || DEFAULT_BRANDS_FILE)
  const force = toBoolean(args.force, false)
  const batchSize = Math.max(1, Number(args['batch-size'] || 300))

  const raw = await readJsonl(inputFile)
  const eligible = raw.filter(isEligibleBrand)
  const byBrandId = new Map()
  for (const row of eligible) {
    const normalized = normalizeBrand(row)
    if (!normalized.brand_id || !normalized.brand_name || !normalized.official_domain) continue
    const prev = byBrandId.get(normalized.brand_id)
    if (!prev || normalized.source_confidence > prev.source_confidence) {
      byBrandId.set(normalized.brand_id, normalized)
    }
  }
  const rows = [...byBrandId.values()]

  let beforeBrands = 0
  let beforeOffers = 0

  await withSupabaseClient(async (client) => {
    await withTransaction(client, async () => {
      beforeBrands = await countRows(client, 'house_ads_brands')
      beforeOffers = await countRows(client, 'house_ads_offers')
      if ((beforeBrands > 0 || beforeOffers > 0) && !force) {
        throw new Error(
          `target tables are not empty: brands=${beforeBrands}, offers=${beforeOffers}. Use --force=true to continue.`,
        )
      }
      if (force && (beforeBrands > 0 || beforeOffers > 0)) {
        await client.query('TRUNCATE TABLE house_ads_offers, house_ads_brands')
      }

      const batches = chunk(rows, batchSize)
      for (const batch of batches) {
        await insertBrandBatch(client, batch)
      }
    })
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputFile: path.relative(process.cwd(), inputFile),
        inputRows: raw.length,
        eligibleRows: eligible.length,
        importedRows: rows.length,
        before: {
          brands: beforeBrands,
          offers: beforeOffers,
        },
        force,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[publish-brands-to-supabase] failed:', error?.message || error)
  process.exit(1)
})
