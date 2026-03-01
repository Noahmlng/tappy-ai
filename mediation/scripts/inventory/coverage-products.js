#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, printJson, withDbPool } from './common.js'
import {
  cleanText,
  splitCsv,
  timestampTag,
  toPositiveInteger,
  writeJson,
  readRowsFromBatchFiles,
  queryOfferRows,
} from './audit-common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'inventory-audit')
const DEFAULT_LIMIT = 5000

const DEFAULT_PRODUCT_CONFIG = Object.freeze({
  meyka: {
    keywords: ['meyka', 'meyka.com'],
    categories: [
      'finance::digital_banking',
      'education::online_learning',
      'saas::productivity',
      'developer_tools::dev_platform',
    ],
  },
  deepai: {
    keywords: ['deepai', 'deep ai', 'deep-ai', 'deepai.com'],
    categories: [
      'saas::productivity',
      'developer_tools::dev_platform',
      'education::online_learning',
    ],
  },
})

function parseKeywords(value = '', fallback = []) {
  const output = splitCsv(value)
  if (output.length <= 0) return [...fallback]
  return output.map((item) => item.toLowerCase())
}

function parseCategories(value = '', fallback = []) {
  const output = splitCsv(value)
  if (output.length <= 0) return [...fallback]
  return output.map((item) => item.toLowerCase())
}

function toCorpus(row = {}) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  return cleanText([
    row.offer_id,
    row.title,
    row.description,
    row.target_url,
    row.image_url,
    metadata.brand_id,
    metadata.brandId,
    metadata.brand_name,
    metadata.brandName,
    metadata.merchant,
    metadata.merchantName,
    metadata.partnerName,
  ].join(' ')).toLowerCase()
}

function findKeywordHits(corpus = '', keywords = []) {
  if (!corpus) return []
  const hits = []
  for (const keyword of keywords) {
    const token = cleanText(keyword).toLowerCase()
    if (!token) continue
    if (corpus.includes(token)) hits.push(token)
  }
  return [...new Set(hits)]
}

export function detectProductHits(row = {}, productConfig = DEFAULT_PRODUCT_CONFIG) {
  const corpus = toCorpus(row)
  const hits = {}
  for (const [product, config] of Object.entries(productConfig)) {
    const keywords = Array.isArray(config?.keywords) ? config.keywords : []
    const matched = findKeywordHits(corpus, keywords)
    if (matched.length > 0) {
      hits[product] = matched
    }
  }
  return hits
}

export function computeCategoryGap(rows = [], productConfig = DEFAULT_PRODUCT_CONFIG, targetPerCategory = 1) {
  const target = Math.max(1, toPositiveInteger(targetPerCategory, 1))
  const counts = {}
  for (const key of Object.keys(productConfig)) {
    counts[key] = new Map()
  }

  for (const row of rows) {
    const hitProducts = Array.isArray(row.hit_products) ? row.hit_products : []
    const categoryKey = cleanText(row.category_key).toLowerCase() || '(unknown)'
    for (const product of hitProducts) {
      if (!counts[product]) continue
      counts[product].set(categoryKey, (counts[product].get(categoryKey) || 0) + 1)
    }
  }

  const gap = {}
  for (const [product, config] of Object.entries(productConfig)) {
    const required = Array.isArray(config?.categories) ? config.categories : []
    const countMap = counts[product] || new Map()
    gap[product] = required.map((category) => {
      const key = cleanText(category).toLowerCase()
      const current = countMap.get(key) || 0
      return {
        category: key,
        current_count: current,
        target_count: target,
        gap: Math.max(0, target - current),
      }
    })
  }
  return gap
}

async function loadRows(args = {}) {
  const batchFiles = splitCsv(args['batch-files'])
  const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT)
  const networks = splitCsv(args.networks).map((item) => item.toLowerCase())

  if (batchFiles.length > 0) {
    const rows = await readRowsFromBatchFiles(batchFiles, { preferAfter: true })
    const scoped = rows
      .filter((row) => (networks.length > 0 ? networks.includes(cleanText(row.network).toLowerCase()) : true))
      .slice(0, limit)
    return {
      mode: 'batch_files',
      rows: scoped,
      batch_files: batchFiles,
    }
  }

  const rows = await withDbPool(async (pool) => await queryOfferRows(pool, { limit, networks }))
  return {
    mode: 'postgres',
    rows,
    batch_files: [],
  }
}

export async function runProductCoverageAudit(rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
  const startedAt = Date.now()
  const sampleSize = toPositiveInteger(args['sample-size'], 200)
  const targetPerCategory = toPositiveInteger(args['target-per-category'], 1)
  const productConfig = {
    meyka: {
      keywords: parseKeywords(args['meyka-keywords'], DEFAULT_PRODUCT_CONFIG.meyka.keywords),
      categories: parseCategories(args['meyka-categories'], DEFAULT_PRODUCT_CONFIG.meyka.categories),
    },
    deepai: {
      keywords: parseKeywords(args['deepai-keywords'], DEFAULT_PRODUCT_CONFIG.deepai.keywords),
      categories: parseCategories(args['deepai-categories'], DEFAULT_PRODUCT_CONFIG.deepai.categories),
    },
  }

  const tag = timestampTag()
  const outputFile = path.resolve(
    PROJECT_ROOT,
    cleanText(args['output-file']) || path.join(OUTPUT_ROOT, `product-coverage-${tag}.json`),
  )

  const loaded = await loadRows(args)
  const evaluatedRows = loaded.rows.map((row) => {
    const hits = detectProductHits(row, productConfig)
    const hitProducts = Object.keys(hits)
    return {
      offer_id: cleanText(row.offer_id),
      network: cleanText(row.network),
      title: cleanText(row.title),
      target_url: cleanText(row.target_url),
      category_key: cleanText(row.category_key),
      brand_hit: hitProducts.length > 0,
      hit_products: hitProducts,
      hit_keywords: hits,
      source_file: cleanText(row.source_file),
    }
  })

  const brandHitsByProduct = {
    meyka: evaluatedRows.filter((row) => row.hit_products.includes('meyka')).length,
    deepai: evaluatedRows.filter((row) => row.hit_products.includes('deepai')).length,
  }
  const categoryGap = computeCategoryGap(evaluatedRows, productConfig, targetPerCategory)

  const report = {
    generated_at: new Date().toISOString(),
    mode: loaded.mode,
    inputs: {
      rows: loaded.rows.length,
      batch_files: loaded.batch_files,
      target_per_category: targetPerCategory,
      products: productConfig,
    },
    summary: {
      total_rows: evaluatedRows.length,
      brand_hit_count: evaluatedRows.filter((row) => row.brand_hit).length,
      brand_hit_ratio: Number(
        (
          evaluatedRows.filter((row) => row.brand_hit).length
          / Math.max(1, evaluatedRows.length)
        ).toFixed(4),
      ),
      brand_hits_by_product: brandHitsByProduct,
      elapsed_ms: Date.now() - startedAt,
    },
    category_gap: categoryGap,
    rows_sample: evaluatedRows.slice(0, sampleSize),
    rows_hit_sample: evaluatedRows.filter((row) => row.brand_hit).slice(0, sampleSize),
    output_file: path.relative(PROJECT_ROOT, outputFile),
  }

  await writeJson(outputFile, report)
  await writeJson(path.join(OUTPUT_ROOT, 'latest-product-coverage.json'), {
    generated_at: new Date().toISOString(),
    report_json: path.relative(PROJECT_ROOT, outputFile),
  })
  return report
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await runProductCoverageAudit(args)
  printJson({
    ok: true,
    mode: report.mode,
    totalRows: report.summary.total_rows,
    brandHitCount: report.summary.brand_hit_count,
    brandHitsByProduct: report.summary.brand_hits_by_product,
    outputFile: report.output_file,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[inventory-coverage-products] failed:', error?.message || error)
    process.exit(1)
  })
}

export const __coverageProductsInternal = Object.freeze({
  detectProductHits,
  computeCategoryGap,
})
