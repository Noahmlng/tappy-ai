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
  registrableDomain,
} from './lib/common.js'

const BRANDS_FILE = path.join(CURATED_ROOT, 'brands.jsonl')

const NON_BRAND_NAME_HINTS = [
  '什么意思',
  '是什么意思',
  '怎么读',
  '怎么',
  '如何',
  '翻译',
  '用法',
  '例句',
  '词典',
  '百度知道',
  '盘点',
  '热门',
  '教程',
  'thread',
  'forum',
  'rating',
  'guide',
  'tips',
  'review',
  'future of',
  'popular with',
  'hidden',
]

const INSTITUTIONAL_TLDS = new Set(['gov', 'edu', 'mil', 'int'])
const GENERIC_DOMAINS = new Set([
  'com.pl',
  'com.cn',
  'com.hk',
  'co.uk',
  'co.jp',
])

const SHORTLINK_DOMAINS = new Set([
  't.co',
  't.me',
  'wa.me',
  'm.me',
  'g.co',
  'g.page',
  'a.co',
  't.cn',
  't.ly',
  'bit.ly',
  'lnkd.in',
  'tinyurl.com',
  'ow.ly',
  'goo.gl',
])

const HOSTING_HINTS = [
  'cloudfront',
  'googleusercontent',
  'googletagmanager',
  'appspot',
  'blogspot',
  'github.io',
  'wordpress.com',
  'wixsite',
  'wixstatic',
  'azurewebsites',
  'amazonaws',
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
  'online',
  'official',
  'site',
  'api',
  'web',
])

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function normalizeName(value) {
  return cleanText(
    decodeHtmlEntities(cleanText(value))
      .replace(/[_|]+/g, ' ')
      .replace(/[“”"']/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function normalizedAlphaNum(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function tokenCount(value) {
  return normalizeName(value)
    .split(/\s+/g)
    .filter(Boolean).length
}

function punctuationRatio(value) {
  const text = normalizeName(value)
  if (!text) return 1
  const punctuation = (text.match(/[^\p{L}\p{N}\s]/gu) || []).length
  return punctuation / Math.max(1, text.length)
}

function cjkSentenceLike(value) {
  const text = normalizeName(value)
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
  if (cjkCount < 6) return false
  return /(什么|如何|怎么|之间|用法|翻译|例句|盘点|热门)/.test(text)
}

function nameHasHint(value) {
  const lower = normalizeName(value).toLowerCase()
  if (!lower) return false
  return NON_BRAND_NAME_HINTS.some((hint) => lower.includes(hint))
}

function getDomainMeta(domain) {
  const host = registrableDomain(domain || '')
  const parts = host.split('.').filter(Boolean)
  const root = parts[0] || ''
  const tld = parts[parts.length - 1] || ''
  return {
    host,
    root,
    tld,
    brandCandidate: domainToBrandName(host),
  }
}

function classifyDomain(meta) {
  const host = meta.host.toLowerCase()
  const root = meta.root.toLowerCase()
  if (!host) return { domain_class: 'invalid_domain', domain_score: 0, reasons: ['missing_domain'] }
  if (SHORTLINK_DOMAINS.has(host)) {
    return { domain_class: 'shortlink_redirect', domain_score: 0.25, reasons: ['known_shortlink_domain'] }
  }
  if (GENERIC_DOMAINS.has(host)) {
    return { domain_class: 'generic_domain_bucket', domain_score: 0.2, reasons: ['generic_bucket_domain'] }
  }
  if (INSTITUTIONAL_TLDS.has(meta.tld)) {
    return { domain_class: 'institutional_domain', domain_score: 0.5, reasons: ['institutional_tld'] }
  }
  if (HOSTING_HINTS.some((hint) => host.includes(hint))) {
    return { domain_class: 'hosting_or_infra_domain', domain_score: 0.3, reasons: ['hosting_or_infra_hint'] }
  }
  if (GENERIC_ROOTS.has(root)) {
    return { domain_class: 'generic_domain_root', domain_score: 0.35, reasons: ['generic_domain_root'] }
  }
  if (root.length <= 1) {
    return { domain_class: 'weak_domain_root', domain_score: 0.32, reasons: ['domain_root_too_short'] }
  }
  return { domain_class: 'commercial_domain', domain_score: 0.82, reasons: [] }
}

function scoreName(name, domainRoot) {
  const normalized = normalizeName(name)
  const compactName = normalizedAlphaNum(normalized)
  const compactRoot = normalizedAlphaNum(domainRoot)
  let score = 1
  const reasons = []

  if (!normalized) {
    return { name_score: 0, normalized_name: '', reasons: ['empty_name'] }
  }
  if (normalized.length < 2) {
    score -= 0.55
    reasons.push('too_short')
  }
  if (normalized.length > 48) {
    score -= 0.3
    reasons.push('too_long')
  }
  if (tokenCount(normalized) > 4) {
    score -= 0.25
    reasons.push('too_many_tokens')
  }
  if (punctuationRatio(normalized) > 0.2) {
    score -= 0.22
    reasons.push('high_punctuation_ratio')
  }
  if (nameHasHint(normalized)) {
    score -= 0.45
    reasons.push('non_brand_hint')
  }
  if (cjkSentenceLike(normalized)) {
    score -= 0.35
    reasons.push('cjk_sentence_like')
  }
  if (/[?？!！:：。]/.test(normalized)) {
    score -= 0.25
    reasons.push('sentence_punctuation')
  }
  if (normalized.includes('...')) {
    score -= 0.1
    reasons.push('ellipsis')
  }

  // Name/domain consistency: if name has no overlap with domain root, reduce confidence.
  if (compactName && compactRoot && !(compactName.includes(compactRoot) || compactRoot.includes(compactName))) {
    score -= 0.22
    reasons.push('name_domain_mismatch')
  }

  return {
    name_score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    normalized_name: normalized,
    reasons,
  }
}

function chooseEntity(brand) {
  const meta = getDomainMeta(brand.official_domain)
  const domain = classifyDomain(meta)
  const name = scoreName(brand.brand_name, meta.root)

  const useOriginal = name.name_score >= 0.72
  const cleanedName = useOriginal ? name.normalized_name : meta.brandCandidate
  const finalScore = Number((name.name_score * 0.3 + domain.domain_score * 0.5 + Number(brand.source_confidence || 0) * 0.2).toFixed(4))
  const queryContaminatedName = name.reasons.includes('non_brand_hint') && name.name_score <= 0.2

  let entityDecision = 'brand_ad_eligible'
  const reasons = [...new Set([...name.reasons, ...domain.reasons])]

  if (!cleanedName) {
    entityDecision = 'non_brand_entity'
    reasons.push('empty_cleaned_name')
  } else if (queryContaminatedName) {
    entityDecision = 'non_brand_entity'
    reasons.push('query_title_not_brand')
  } else if (domain.domain_class === 'commercial_domain' && finalScore >= 0.6) {
    entityDecision = 'brand_ad_eligible'
  } else if (domain.domain_class === 'institutional_domain') {
    entityDecision = 'non_brand_entity'
    reasons.push('institutional_not_ad_brand')
  } else if (domain.domain_class === 'shortlink_redirect' || domain.domain_class === 'hosting_or_infra_domain') {
    entityDecision = 'non_brand_entity'
    reasons.push('infra_or_redirect_not_brand')
  } else if (domain.domain_class === 'generic_domain_bucket' || domain.domain_class === 'generic_domain_root') {
    entityDecision = 'non_brand_entity'
    reasons.push('generic_domain_not_brand')
  } else if (domain.domain_class === 'weak_domain_root') {
    entityDecision = 'brand_suspect'
    reasons.push('weak_domain_root')
  } else if (finalScore < 0.45) {
    entityDecision = 'non_brand_entity'
    reasons.push('low_final_score')
  } else {
    entityDecision = 'brand_suspect'
  }

  return {
    cleaned_brand_name: cleanedName,
    selected_source: useOriginal ? 'original_name' : 'domain_candidate',
    domain_class: domain.domain_class,
    name_score: name.name_score,
    domain_score: domain.domain_score,
    final_score: finalScore,
    entity_decision: entityDecision,
    reasons: [...new Set(reasons)],
  }
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
  for (const row of rows) {
    lines.push(headers.map((header) => esc(row[header])).join(','))
  }
  return `${lines.join('\n')}\n`
}

async function writeCsv(filePath, rows) {
  await fs.writeFile(filePath, toCsv(rows), 'utf8')
}

async function main() {
  const brands = await readJsonl(BRANDS_FILE)
  const tag = timestampTag()

  const identifiedRows = brands.map((brand) => {
    const picked = chooseEntity(brand)
    return {
      brand_id: brand.brand_id,
      official_domain: brand.official_domain,
      vertical_l1: brand.vertical_l1,
      vertical_l2: brand.vertical_l2,
      original_brand_name: brand.brand_name,
      cleaned_brand_name: picked.cleaned_brand_name,
      selected_source: picked.selected_source,
      domain_class: picked.domain_class,
      entity_decision: picked.entity_decision,
      final_score: picked.final_score,
      name_score: picked.name_score,
      domain_score: picked.domain_score,
      reasons: picked.reasons.join('|'),
    }
  })

  const categoryMap = new Map()
  for (const row of identifiedRows) {
    const key = `${row.vertical_l1}::${row.vertical_l2}`
    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        vertical_l1: row.vertical_l1,
        vertical_l2: row.vertical_l2,
        total_records: 0,
        ad_eligible_brands: 0,
        suspect_brands: 0,
        non_brand_entities: 0,
        sample_ad_eligible: [],
        sample_non_brand: [],
      })
    }
    const bucket = categoryMap.get(key)
    bucket.total_records += 1
    if (row.entity_decision === 'brand_ad_eligible') {
      bucket.ad_eligible_brands += 1
      if (bucket.sample_ad_eligible.length < 10) bucket.sample_ad_eligible.push(row.cleaned_brand_name)
    } else if (row.entity_decision === 'brand_suspect') {
      bucket.suspect_brands += 1
    } else {
      bucket.non_brand_entities += 1
      if (bucket.sample_non_brand.length < 10) {
        bucket.sample_non_brand.push(`${row.original_brand_name} -> ${row.cleaned_brand_name}`)
      }
    }
  }

  const categoryRows = [...categoryMap.values()]
    .sort((a, b) => {
      if (a.vertical_l1 !== b.vertical_l1) return a.vertical_l1.localeCompare(b.vertical_l1)
      return a.vertical_l2.localeCompare(b.vertical_l2)
    })
    .map((row) => ({
      ...row,
      ad_eligible_ratio: Number((row.ad_eligible_brands / Math.max(1, row.total_records)).toFixed(4)),
      non_brand_ratio: Number((row.non_brand_entities / Math.max(1, row.total_records)).toFixed(4)),
      sample_ad_eligible: row.sample_ad_eligible.join(' | '),
      sample_non_brand: row.sample_non_brand.join(' | '),
    }))

  const summary = {
    generated_at: new Date().toISOString(),
    total_records: identifiedRows.length,
    ad_eligible_brands: identifiedRows.filter((row) => row.entity_decision === 'brand_ad_eligible').length,
    suspect_brands: identifiedRows.filter((row) => row.entity_decision === 'brand_suspect').length,
    non_brand_entities: identifiedRows.filter((row) => row.entity_decision === 'non_brand_entity').length,
    categories: categoryRows.length,
    output_files: {
      identified_brand_list_csv: `data/house-ads/reports/house-ads-brand-identified-list-${tag}.csv`,
      category_report_csv: `data/house-ads/reports/house-ads-brand-category-report-${tag}.csv`,
      summary_json: `data/house-ads/reports/house-ads-brand-category-summary-${tag}.json`,
      latest_identified_brand_list_csv: 'data/house-ads/reports/house-ads-brand-identified-list-latest.csv',
      latest_category_report_csv: 'data/house-ads/reports/house-ads-brand-category-report-latest.csv',
      latest_summary_json: 'data/house-ads/reports/house-ads-brand-category-summary-latest.json',
    },
  }

  const identifiedPath = path.join(REPORT_ROOT, `house-ads-brand-identified-list-${tag}.csv`)
  const categoryPath = path.join(REPORT_ROOT, `house-ads-brand-category-report-${tag}.csv`)
  const summaryPath = path.join(REPORT_ROOT, `house-ads-brand-category-summary-${tag}.json`)
  const latestIdentifiedPath = path.join(REPORT_ROOT, 'house-ads-brand-identified-list-latest.csv')
  const latestCategoryPath = path.join(REPORT_ROOT, 'house-ads-brand-category-report-latest.csv')
  const latestSummaryPath = path.join(REPORT_ROOT, 'house-ads-brand-category-summary-latest.json')

  await writeCsv(identifiedPath, identifiedRows)
  await writeCsv(categoryPath, categoryRows)
  await writeJson(summaryPath, summary)

  await fs.copyFile(identifiedPath, latestIdentifiedPath)
  await fs.copyFile(categoryPath, latestCategoryPath)
  await fs.copyFile(summaryPath, latestSummaryPath)

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error('[brand-clean-and-category-report] failed:', error?.message || error)
  process.exit(1)
})
