#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CURATED_ROOT,
  SNAPSHOT_ROOT,
  REPORT_ROOT,
  parseArgs,
  toInteger,
  toBoolean,
  readJsonl,
  writeJson,
  ensureDir,
  cleanText,
  timestampTag,
} from './lib/common.js'

function isValidUrl(value) {
  const text = cleanText(value)
  if (!text) return false
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function missingRequired(obj, required = []) {
  const misses = []
  for (const field of required) {
    const value = obj?.[field]
    if (value === undefined || value === null) {
      misses.push(field)
      continue
    }
    if (typeof value === 'string' && !cleanText(value)) misses.push(field)
    if (Array.isArray(value) && value.length === 0) misses.push(field)
  }
  return misses
}

function validateBrands(brands) {
  const required = ['brand_id', 'brand_name', 'vertical_l1', 'vertical_l2', 'official_domain', 'status']
  const errors = []
  for (const brand of brands) {
    const misses = missingRequired(brand, required)
    if (misses.length > 0) {
      errors.push({ type: 'brand_missing_required', brand_id: brand.brand_id || '', fields: misses })
    }
  }
  return errors
}

function validateLinkCreatives(rows) {
  const required = [
    'creative_id',
    'brand_id',
    'placement_key',
    'title',
    'description',
    'target_url',
    'cta_text',
    'disclosure',
    'language',
    'status',
  ]
  const errors = []
  for (const row of rows) {
    const misses = missingRequired(row, required)
    if (misses.length > 0) {
      errors.push({ type: 'link_missing_required', creative_id: row.creative_id || '', fields: misses })
      continue
    }
    if (!isValidUrl(row.target_url)) {
      errors.push({ type: 'link_invalid_url', creative_id: row.creative_id || '', target_url: row.target_url || '' })
    }
  }
  return errors
}

function validateProductCreatives(rows) {
  const required = [
    'creative_id',
    'brand_id',
    'placement_key',
    'item_id',
    'title',
    'snippet',
    'target_url',
    'merchant_or_network',
    'match_tags',
    'disclosure',
    'language',
    'status',
  ]
  const errors = []
  for (const row of rows) {
    const misses = missingRequired(row, required)
    if (misses.length > 0) {
      errors.push({ type: 'product_missing_required', creative_id: row.creative_id || '', fields: misses })
      continue
    }
    if (!isValidUrl(row.target_url)) {
      errors.push({ type: 'product_invalid_url', creative_id: row.creative_id || '', target_url: row.target_url || '' })
    }
    if (!Array.isArray(row.match_tags) || row.match_tags.length === 0) {
      errors.push({ type: 'product_empty_tags', creative_id: row.creative_id || '' })
    }
  }
  return errors
}

function computeCoverage(brands, linkCreatives, productCreatives) {
  const linkByBrand = new Set(linkCreatives.map((row) => cleanText(row.brand_id)).filter(Boolean))
  const productByBrand = new Set(productCreatives.map((row) => cleanText(row.brand_id)).filter(Boolean))
  const both = []
  const missingLink = []
  const missingProduct = []

  for (const brand of brands) {
    const brandId = cleanText(brand.brand_id)
    const hasLink = linkByBrand.has(brandId)
    const hasProduct = productByBrand.has(brandId)
    if (hasLink && hasProduct) both.push(brandId)
    else if (!hasLink && !hasProduct) {
      missingLink.push(brandId)
      missingProduct.push(brandId)
    } else if (!hasLink) missingLink.push(brandId)
    else missingProduct.push(brandId)
  }

  const verticalSet = new Set(brands.map((row) => cleanText(row.vertical_l1)).filter(Boolean))
  const completeness = brands.length === 0 ? 0 : both.length / brands.length
  return {
    brand_count: brands.length,
    link_creative_count: linkCreatives.length,
    product_creative_count: productCreatives.length,
    brand_with_both_formats: both.length,
    creative_completeness: Number(completeness.toFixed(4)),
    vertical_count: verticalSet.size,
    missing_link_brand_count: missingLink.length,
    missing_product_brand_count: missingProduct.length,
    missing_link_brand_ids: missingLink.slice(0, 100),
    missing_product_brand_ids: missingProduct.slice(0, 100),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const minBrands = toInteger(args['min-brands'], 500)
  const requiredCompleteness = Number(args['required-completeness'] || '1')
  const allowFail = toBoolean(args['allow-fail'], false)
  const tag = timestampTag()

  const brandsPath = path.join(CURATED_ROOT, 'brands.jsonl')
  const linkPath = path.join(CURATED_ROOT, 'link-creatives.jsonl')
  const productPath = path.join(CURATED_ROOT, 'product-creatives.jsonl')

  const [brands, linkCreatives, productCreatives] = await Promise.all([
    readJsonl(brandsPath),
    readJsonl(linkPath),
    readJsonl(productPath),
  ])

  const errors = [
    ...validateBrands(brands),
    ...validateLinkCreatives(linkCreatives),
    ...validateProductCreatives(productCreatives),
  ]
  const coverage = computeCoverage(brands, linkCreatives, productCreatives)

  const quality = {
    generatedAt: new Date().toISOString(),
    validation_error_count: errors.length,
    validation_errors_sample: errors.slice(0, 150),
    pass_rate: Number(
      (1 - errors.length / Math.max(1, brands.length + linkCreatives.length + productCreatives.length)).toFixed(4),
    ),
  }

  await ensureDir(REPORT_ROOT)
  const coveragePath = path.join(REPORT_ROOT, `coverage-${tag}.json`)
  const qualityPath = path.join(REPORT_ROOT, `quality-${tag}.json`)
  await writeJson(coveragePath, coverage)
  await writeJson(qualityPath, quality)

  const hardFailReasons = []
  if (brands.length < minBrands) {
    hardFailReasons.push(`brand_count_lt_${minBrands}`)
  }
  if (coverage.creative_completeness < requiredCompleteness) {
    hardFailReasons.push(`creative_completeness_lt_${requiredCompleteness}`)
  }
  if (errors.length > 0) {
    hardFailReasons.push('validation_errors_present')
  }

  const snapshotDir = path.join(SNAPSHOT_ROOT, tag)
  await ensureDir(snapshotDir)
  await fs.copyFile(brandsPath, path.join(snapshotDir, 'brands.jsonl'))
  await fs.copyFile(linkPath, path.join(snapshotDir, 'link-creatives.jsonl'))
  await fs.copyFile(productPath, path.join(snapshotDir, 'product-creatives.jsonl'))
  await fs.copyFile(coveragePath, path.join(snapshotDir, 'coverage.json'))
  await fs.copyFile(qualityPath, path.join(snapshotDir, 'quality.json'))

  const manifest = {
    snapshot_id: `house_ads_${tag}`,
    generated_at: new Date().toISOString(),
    files: {
      brands: 'brands.jsonl',
      link_creatives: 'link-creatives.jsonl',
      product_creatives: 'product-creatives.jsonl',
      coverage: 'coverage.json',
      quality: 'quality.json',
    },
    metrics: {
      brand_count: coverage.brand_count,
      link_creative_count: coverage.link_creative_count,
      product_creative_count: coverage.product_creative_count,
      creative_completeness: coverage.creative_completeness,
      validation_error_count: quality.validation_error_count,
      vertical_count: coverage.vertical_count,
    },
    status: hardFailReasons.length === 0 ? 'ready' : 'needs_review',
    hard_fail_reasons: hardFailReasons,
  }
  await writeJson(path.join(snapshotDir, 'manifest.json'), manifest)
  await writeJson(path.join(SNAPSHOT_ROOT, 'latest-snapshot.json'), {
    generatedAt: new Date().toISOString(),
    latestSnapshotDir: path.relative(process.cwd(), snapshotDir),
    manifest: path.relative(process.cwd(), path.join(snapshotDir, 'manifest.json')),
  })

  if (hardFailReasons.length > 0 && !allowFail) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          hardFailReasons,
          coveragePath: path.relative(process.cwd(), coveragePath),
          qualityPath: path.relative(process.cwd(), qualityPath),
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        snapshotDir: path.relative(process.cwd(), snapshotDir),
        brandCount: coverage.brand_count,
        creativeCompleteness: coverage.creative_completeness,
        validationErrorCount: quality.validation_error_count,
        hardFailReasons,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[qa-and-publish] failed:', error?.message || error)
  process.exit(1)
})
