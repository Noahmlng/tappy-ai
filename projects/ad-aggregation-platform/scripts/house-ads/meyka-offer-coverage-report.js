#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CURATED_ROOT,
  parseArgs,
  cleanText,
  readJsonl,
  writeJson,
  ensureDir,
  timestampTag,
} from './lib/common.js'

const OFFERS_ROOT = path.resolve(process.cwd(), 'data/house-ads/offers')
const OFFERS_CURATED_DIR = path.join(OFFERS_ROOT, 'curated')
const OFFERS_REPORT_DIR = path.join(OFFERS_ROOT, 'reports')

const DEFAULT_MEYKA_CSV = '/Users/zeming/Downloads/Brands and Commissions Collected fit for Meyka.csv'
const DEFAULT_P1_CATEGORIES = [
  'finance::digital_banking',
  'education::online_learning',
  'saas::productivity',
  'developer_tools::dev_platform',
]

const CATEGORY_MAP = {
  'broker / trading': 'finance::digital_banking',
  'crypto exchange': 'finance::digital_banking',
  'crypto wallet': 'finance::digital_banking',
  'personal finance': 'finance::digital_banking',
  'research / analysis tools': 'saas::productivity',
  'online education': 'education::online_learning',
  books: 'education::online_learning',
}

function normKey(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '')
}

function parseCsvLine(line = '') {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((item) => cleanText(item))
}

async function readCsvRows(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  const lines = raw.split('\n').map((line) => line.replace(/\r$/, '')).filter(Boolean)
  if (lines.length <= 1) return []
  const headers = parseCsvLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i])
    const row = {}
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = cols[j] || ''
    }
    rows.push(row)
  }
  return rows
}

function brandKeyVariants(name = '') {
  const raw = cleanText(name)
  const base = normKey(raw)
  const variants = new Set([base])
  const lowerRaw = raw.toLowerCase()
  const tokens = lowerRaw
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/g)
    .filter(Boolean)
  const stopwords = new Set([
    'invest',
    'investment',
    'research',
    'pro',
    'books',
    'wallet',
    'exchange',
    'trading',
    'finance',
    'simplifi',
    'com',
  ])
  const compactNoStop = tokens.filter((token) => !stopwords.has(token)).join('')
  if (compactNoStop) variants.add(compactNoStop)

  // Phrase-level cleanup variants for common Meyka label patterns.
  const phraseVariants = [
    base.replace(/investmentresearch/g, ''),
    base.replace(/investment/g, ''),
    base.replace(/research/g, ''),
    base.replace(/invest/g, ''),
    base.replace(/pro/g, ''),
    base.replace(/books/g, ''),
    base.replace(/wallet/g, ''),
    base.replace(/exchange/g, ''),
    base.replace(/trading/g, ''),
    base.replace(/finance/g, ''),
    base.replace(/simplifi/g, ''),
  ]
  for (const candidate of phraseVariants) {
    const cleaned = candidate.replace(/[^a-z0-9]+/g, '')
    if (cleaned) variants.add(cleaned)
  }

  if (base.includes('quicken') || lowerRaw.includes('simplifi')) {
    variants.add('quicken')
    variants.add('simplifi')
  }
  if (base.includes('crypto')) variants.add('crypto')
  return [...variants].filter(Boolean)
}

function mapMeykaCategory(raw = '') {
  const key = cleanText(raw).toLowerCase()
  return CATEGORY_MAP[key] || ''
}

function toCsv(rows = []) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (value) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(','))
  return `${lines.join('\n')}\n`
}

async function writeCsv(filePath, rows) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, toCsv(rows), 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const tag = timestampTag()
  const meykaCsv = cleanText(args['meyka-csv']) || DEFAULT_MEYKA_CSV
  const offersFile = path.resolve(process.cwd(), cleanText(args['offers-file']) || path.join(OFFERS_CURATED_DIR, 'offers.jsonl'))
  const brandsFile = path.resolve(process.cwd(), cleanText(args['brands-file']) || path.join(CURATED_ROOT, 'brands.jsonl'))
  const p1Categories = cleanText(args['p1-categories'])
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean)
  const p1List = p1Categories.length > 0 ? p1Categories : DEFAULT_P1_CATEGORIES
  const p1Set = new Set(p1List.map((item) => item.toLowerCase()))
  const p1TargetDensity = Number(args['p1-target-density'] || 8)

  const [meykaRows, offers, brands] = await Promise.all([readCsvRows(meykaCsv), readJsonl(offersFile), readJsonl(brandsFile)])

  const offerStatsByBrand = new Map()
  const offerStatsByCategory = new Map()
  for (const offer of offers) {
    const brandId = cleanText(offer.brand_id)
    if (!offerStatsByBrand.has(brandId)) {
      offerStatsByBrand.set(brandId, { total: 0, product: 0, link: 0 })
    }
    const b = offerStatsByBrand.get(brandId)
    b.total += 1
    if (cleanText(offer.offer_type) === 'product') b.product += 1
    if (cleanText(offer.offer_type) === 'link') b.link += 1

    const ckey = `${cleanText(offer.vertical_l1)}::${cleanText(offer.vertical_l2)}`
    if (!offerStatsByCategory.has(ckey)) {
      offerStatsByCategory.set(ckey, { total: 0, product: 0, link: 0, brands: new Set(), productByBrand: new Map() })
    }
    const c = offerStatsByCategory.get(ckey)
    c.total += 1
    c.brands.add(brandId)
    if (cleanText(offer.offer_type) === 'product') {
      c.product += 1
      c.productByBrand.set(brandId, (c.productByBrand.get(brandId) || 0) + 1)
    }
    if (cleanText(offer.offer_type) === 'link') c.link += 1
  }

  const brandsByNameKey = new Map()
  for (const brand of brands) {
    const key = normKey(brand.brand_name)
    if (!key) continue
    if (!brandsByNameKey.has(key)) brandsByNameKey.set(key, [])
    brandsByNameKey.get(key).push(brand)
  }

  const coverageRows = []
  let matchedCount = 0
  let coveredCount = 0

  for (const row of meykaRows) {
    const meykaCategory = row.Category || ''
    const meykaBrand = row.Brand || ''
    const mappedCategory = mapMeykaCategory(meykaCategory)
    const variants = brandKeyVariants(meykaBrand)

    let matched = []
    let matchMethod = ''
    for (const key of variants) {
      const hits = brandsByNameKey.get(key) || []
      if (hits.length > 0) {
        matched = hits
        matchMethod = key === variants[0] ? 'exact_name' : 'name_variant'
        break
      }
    }

    let picked = null
    if (matched.length > 0) {
      picked = [...matched].sort((a, b) => {
        const as = offerStatsByBrand.get(cleanText(a.brand_id))?.total || 0
        const bs = offerStatsByBrand.get(cleanText(b.brand_id))?.total || 0
        if (as !== bs) return bs - as
        return cleanText(a.brand_id).localeCompare(cleanText(b.brand_id))
      })[0]
      matchedCount += 1
    }

    const stats = picked ? (offerStatsByBrand.get(cleanText(picked.brand_id)) || { total: 0, product: 0, link: 0 }) : { total: 0, product: 0, link: 0 }
    if (stats.total > 0) coveredCount += 1

    coverageRows.push({
      meyka_category: meykaCategory,
      meyka_brand: meykaBrand,
      mapped_vertical: mappedCategory,
      match_method: matchMethod,
      matched_brand_id: cleanText(picked?.brand_id),
      matched_brand_name: cleanText(picked?.brand_name),
      matched_domain: cleanText(picked?.official_domain),
      offers_total: stats.total,
      offers_product: stats.product,
      offers_link: stats.link,
      coverage_status: stats.total > 0 ? 'covered' : 'not_covered',
    })
  }

  const categoryGapRows = []
  for (const key of p1List) {
    const c = offerStatsByCategory.get(key) || { total: 0, product: 0, link: 0, brands: new Set(), productByBrand: new Map() }
    const brandCount = c.brands.size
    const productCount = c.product
    const targetTotal = Math.ceil(p1TargetDensity * brandCount)
    const gapOffers = Math.max(0, targetTotal - productCount)
    let brandsBelowTarget = 0
    for (const brandId of c.brands) {
      const brandProducts = c.productByBrand.get(brandId) || 0
      if (brandProducts < p1TargetDensity) brandsBelowTarget += 1
    }
    const density = brandCount > 0 ? productCount / brandCount : 0
    categoryGapRows.push({
      category_key: key,
      brand_count: brandCount,
      product_offers: productCount,
      link_offers: c.link,
      total_offers: c.total,
      current_product_density: Number(density.toFixed(4)),
      target_product_density: p1TargetDensity,
      target_total_product_offers: targetTotal,
      gap_product_offers: gapOffers,
      brands_below_target: brandsBelowTarget,
      p1_status: gapOffers === 0 ? 'met' : 'need_fill',
    })
  }

  const summary = {
    generated_at: new Date().toISOString(),
    meyka_csv: meykaCsv,
    offers_file: path.relative(process.cwd(), offersFile),
    brands_file: path.relative(process.cwd(), brandsFile),
    p1_categories: p1List,
    p1_target_density: p1TargetDensity,
    meyka_rows: meykaRows.length,
    meyka_brand_matched: matchedCount,
    meyka_brand_covered: coveredCount,
    meyka_coverage_ratio: Number((coveredCount / Math.max(1, meykaRows.length)).toFixed(4)),
    p1_all_met: categoryGapRows.every((row) => row.p1_status === 'met'),
    p1_gap_total: categoryGapRows.reduce((sum, row) => sum + Number(row.gap_product_offers || 0), 0),
    output_files: {
      meyka_coverage_csv: `data/house-ads/offers/reports/meyka-offer-coverage-${tag}.csv`,
      category_gap_csv: `data/house-ads/offers/reports/category-gap-${tag}.csv`,
      summary_json: `data/house-ads/offers/reports/meyka-offer-summary-${tag}.json`,
      latest_meyka_coverage_csv: 'data/house-ads/offers/reports/meyka-offer-coverage-latest.csv',
      latest_category_gap_csv: 'data/house-ads/offers/reports/category-gap-latest.csv',
      latest_summary_json: 'data/house-ads/offers/reports/meyka-offer-summary-latest.json',
    },
  }

  const coveragePath = path.join(OFFERS_REPORT_DIR, `meyka-offer-coverage-${tag}.csv`)
  const gapPath = path.join(OFFERS_REPORT_DIR, `category-gap-${tag}.csv`)
  const summaryPath = path.join(OFFERS_REPORT_DIR, `meyka-offer-summary-${tag}.json`)
  const latestCoveragePath = path.join(OFFERS_REPORT_DIR, 'meyka-offer-coverage-latest.csv')
  const latestGapPath = path.join(OFFERS_REPORT_DIR, 'category-gap-latest.csv')
  const latestSummaryPath = path.join(OFFERS_REPORT_DIR, 'meyka-offer-summary-latest.json')

  await ensureDir(OFFERS_REPORT_DIR)
  await writeCsv(coveragePath, coverageRows)
  await writeCsv(gapPath, categoryGapRows)
  await writeJson(summaryPath, summary)
  await fs.copyFile(coveragePath, latestCoveragePath)
  await fs.copyFile(gapPath, latestGapPath)
  await fs.copyFile(summaryPath, latestSummaryPath)

  console.log(
    JSON.stringify(
      {
        ok: true,
        meykaRows: meykaRows.length,
        matchedCount,
        coveredCount,
        p1AllMet: summary.p1_all_met,
        p1GapTotal: summary.p1_gap_total,
        coverageFile: path.relative(process.cwd(), coveragePath),
        gapFile: path.relative(process.cwd(), gapPath),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[meyka-offer-coverage-report] failed:', error?.message || error)
  process.exit(1)
})
