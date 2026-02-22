#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CURATED_ROOT,
  REPORT_ROOT,
  cleanText,
  domainToBrandName,
  readJsonl,
  writeJson,
  timestampTag,
} from './lib/common.js'

const BRANDS_FILE = path.join(CURATED_ROOT, 'brands.jsonl')
const NON_BRAND_HINTS = [
  '是什么意思',
  '怎么读',
  '什么是',
  '怎么',
  '如何',
  '翻译',
  '用法',
  '例句',
  '词典',
  '百度知道',
  '盘点',
  '热门',
  '第几个',
  '教程',
  '官网',
  'thread',
  'forum',
  'rating',
  'hidden',
  'future of',
  'guide',
  'tips',
  'review',
  'popular with',
  'part ',
  '首页',
]
const GENERIC_ROOTS = new Set([
  'www',
  'home',
  'index',
  'page',
  'forum',
  'thread',
  'blog',
  'news',
  'help',
  'support',
  'store',
  'shop',
  'web',
  'online',
  'official',
  'app',
  'api',
  'site',
])

function decodeBasicHtmlEntities(text) {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function normalizeBrandName(name) {
  const raw = decodeBasicHtmlEntities(cleanText(name))
    .replace(/[_|]+/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const trimmed = raw
    .replace(/^[\[\]【】()（）\-\s]+/, '')
    .replace(/[\[\]【】()（）\-\s]+$/, '')
    .trim()
  return cleanText(trimmed)
}

function punctuationRatio(text) {
  if (!text) return 1
  const punctuation = (text.match(/[^\p{L}\p{N}\s]/gu) || []).length
  return punctuation / text.length
}

function tokenCount(text) {
  return text.split(/\s+/g).filter(Boolean).length
}

function containsHint(text) {
  const lower = text.toLowerCase()
  return NON_BRAND_HINTS.some((hint) => lower.includes(hint))
}

function domainRoot(domain = '') {
  const root = cleanText(domain).toLowerCase().split('.')[0] || ''
  return root.replace(/[^a-z0-9-]/g, '')
}

function scoreOriginalName(name) {
  const value = normalizeBrandName(name)
  if (!value) return { score: 0, reasons: ['empty_name'], normalized: '' }
  let score = 1
  const reasons = []
  const len = value.length
  const tokens = tokenCount(value)
  const punct = punctuationRatio(value)
  const cjkChars = (value.match(/[\u4e00-\u9fff]/g) || []).length

  if (len < 2) {
    score -= 0.6
    reasons.push('too_short')
  }
  if (len > 48) {
    score -= 0.35
    reasons.push('too_long')
  }
  if (tokens > 4) {
    score -= 0.3
    reasons.push('too_many_tokens')
  }
  if (containsHint(value)) {
    score -= 0.45
    reasons.push('non_brand_hint')
  }
  if (/[?？!！:：。]/.test(value)) {
    score -= 0.3
    reasons.push('sentence_punctuation')
  }
  if (cjkChars >= 6 && /(什么|如何|怎么|之间|用法|翻译|例句|盘点|热门)/.test(value)) {
    score -= 0.4
    reasons.push('cjk_sentence_pattern')
  }
  if (cjkChars >= 10) {
    score -= 0.2
    reasons.push('cjk_too_long_for_brand')
  }
  if (value.includes('...')) {
    score -= 0.15
    reasons.push('ellipsis')
  }
  if (punct > 0.2) {
    score -= 0.25
    reasons.push('high_punctuation_ratio')
  }
  const normalizedScore = Number(Math.max(0, Math.min(1, score)).toFixed(4))
  return { score: normalizedScore, reasons, normalized: value }
}

function scoreDomainCandidate(domain = '') {
  const root = domainRoot(domain)
  const candidate = domainToBrandName(domain)
  let score = 0.75
  const reasons = []
  if (!root || !candidate) return { score: 0, reasons: ['invalid_domain_candidate'], candidate: '' }
  if (GENERIC_ROOTS.has(root)) {
    score -= 0.45
    reasons.push('generic_domain_root')
  }
  if (root.length <= 1) {
    score -= 0.35
    reasons.push('domain_root_too_short')
  }
  if (root.length >= 30) {
    score -= 0.2
    reasons.push('domain_root_too_long')
  }
  if (/^\d+$/.test(root)) {
    score -= 0.4
    reasons.push('numeric_domain_root')
  }
  return {
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    reasons,
    candidate,
  }
}

function chooseBrandName(brand) {
  const original = scoreOriginalName(brand.brand_name)
  const domain = scoreDomainCandidate(brand.official_domain)
  const useOriginal = original.score >= 0.72
  const cleanedBrandName = useOriginal ? original.normalized : domain.candidate || original.normalized
  const finalScore = Number(((useOriginal ? original.score : domain.score) * 0.7 + Number(brand.source_confidence || 0) * 0.3).toFixed(4))

  let quality = 'valid'
  if (!cleanedBrandName) {
    quality = 'invalid'
  } else if (finalScore < 0.45) {
    quality = 'invalid'
  } else if (finalScore < 0.65 || (!useOriginal && domain.score < 0.5)) {
    quality = 'suspect'
  }

  return {
    cleaned_brand_name: cleanedBrandName,
    selected_source: useOriginal ? 'original_brand_name' : 'domain_candidate',
    original_name_score: original.score,
    domain_candidate_score: domain.score,
    final_brand_score: finalScore,
    brand_quality: quality,
    reasons: [...new Set([...original.reasons, ...domain.reasons])],
  }
}

function toCsv(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (value) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','))
  }
  return `${lines.join('\n')}\n`
}

async function writeCsv(filePath, rows) {
  await fs.writeFile(filePath, toCsv(rows), 'utf8')
}

async function main() {
  const brands = await readJsonl(BRANDS_FILE)
  const tag = timestampTag()

  const cleaned = brands.map((brand) => {
    const result = chooseBrandName(brand)
    return {
      brand_id: brand.brand_id,
      official_domain: brand.official_domain,
      vertical_l1: brand.vertical_l1,
      vertical_l2: brand.vertical_l2,
      original_brand_name: brand.brand_name,
      cleaned_brand_name: result.cleaned_brand_name,
      selected_source: result.selected_source,
      brand_quality: result.brand_quality,
      final_brand_score: result.final_brand_score,
      original_name_score: result.original_name_score,
      domain_candidate_score: result.domain_candidate_score,
      reasons: result.reasons.join('|'),
    }
  })

  const byCategory = new Map()
  for (const row of cleaned) {
    const key = `${row.vertical_l1}::${row.vertical_l2}`
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        vertical_l1: row.vertical_l1,
        vertical_l2: row.vertical_l2,
        total_brands: 0,
        valid_brands: 0,
        suspect_brands: 0,
        invalid_brands: 0,
        sample_brands: [],
      })
    }
    const bucket = byCategory.get(key)
    bucket.total_brands += 1
    if (row.brand_quality === 'valid') bucket.valid_brands += 1
    else if (row.brand_quality === 'suspect') bucket.suspect_brands += 1
    else bucket.invalid_brands += 1
    if (bucket.sample_brands.length < 12 && row.cleaned_brand_name) {
      bucket.sample_brands.push(row.cleaned_brand_name)
    }
  }

  const categoryRows = [...byCategory.values()]
    .sort((a, b) => {
      if (a.vertical_l1 !== b.vertical_l1) return a.vertical_l1.localeCompare(b.vertical_l1)
      return a.vertical_l2.localeCompare(b.vertical_l2)
    })
    .map((row) => ({
      ...row,
      valid_ratio: Number((row.valid_brands / Math.max(1, row.total_brands)).toFixed(4)),
      suspect_ratio: Number((row.suspect_brands / Math.max(1, row.total_brands)).toFixed(4)),
      invalid_ratio: Number((row.invalid_brands / Math.max(1, row.total_brands)).toFixed(4)),
      sample_brands: row.sample_brands.join(' | '),
    }))

  const summary = {
    generated_at: new Date().toISOString(),
    total_brands: cleaned.length,
    valid_brands: cleaned.filter((row) => row.brand_quality === 'valid').length,
    suspect_brands: cleaned.filter((row) => row.brand_quality === 'suspect').length,
    invalid_brands: cleaned.filter((row) => row.brand_quality === 'invalid').length,
    category_count: categoryRows.length,
    output_files: {
      cleaned_brand_list_csv: `data/house-ads/reports/house-ads-cleaned-brand-list-${tag}.csv`,
      category_report_csv: `data/house-ads/reports/house-ads-brand-category-report-${tag}.csv`,
      summary_json: `data/house-ads/reports/house-ads-brand-category-summary-${tag}.json`,
      latest_cleaned_brand_list_csv: 'data/house-ads/reports/house-ads-cleaned-brand-list-latest.csv',
      latest_category_report_csv: 'data/house-ads/reports/house-ads-brand-category-report-latest.csv',
      latest_summary_json: 'data/house-ads/reports/house-ads-brand-category-summary-latest.json',
    },
  }

  const cleanedCsvPath = path.join(REPORT_ROOT, `house-ads-cleaned-brand-list-${tag}.csv`)
  const categoryCsvPath = path.join(REPORT_ROOT, `house-ads-brand-category-report-${tag}.csv`)
  const summaryJsonPath = path.join(REPORT_ROOT, `house-ads-brand-category-summary-${tag}.json`)
  const latestCleaned = path.join(REPORT_ROOT, 'house-ads-cleaned-brand-list-latest.csv')
  const latestCategory = path.join(REPORT_ROOT, 'house-ads-brand-category-report-latest.csv')
  const latestSummary = path.join(REPORT_ROOT, 'house-ads-brand-category-summary-latest.json')

  await writeCsv(cleanedCsvPath, cleaned)
  await writeCsv(categoryCsvPath, categoryRows)
  await writeJson(summaryJsonPath, summary)

  await fs.copyFile(cleanedCsvPath, latestCleaned)
  await fs.copyFile(categoryCsvPath, latestCategory)
  await fs.copyFile(summaryJsonPath, latestSummary)

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error('[brand-clean-and-category-report] failed:', error?.message || error)
  process.exit(1)
})
