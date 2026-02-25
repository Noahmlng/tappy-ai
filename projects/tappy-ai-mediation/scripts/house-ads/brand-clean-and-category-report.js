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
  writeJsonl,
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

const PUBLISHER_DOMAINS = new Set([
  'bbc.com',
  'cnn.com',
  'nytimes.com',
  'washingtonpost.com',
  'reuters.com',
  'forbes.com',
  'theguardian.com',
  'wsj.com',
  'bloomberg.com',
  'cnbc.com',
  'huffpost.com',
  'techcrunch.com',
  'wired.com',
  'apnews.com',
  'latimes.com',
  'npr.org',
  'usatoday.com',
  'foxnews.com',
  'aljazeera.com',
  'digitalspy.com',
  'msn.com',
])

const PUBLISHER_ROOT_HINTS = [
  'news',
  'media',
  'times',
  'post',
  'journal',
  'press',
  'tribune',
  'herald',
  'daily',
]

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
  if (!host) return { domain_entity_type: 'generic-bucket', domain_score: 0, reasons: ['missing_domain'] }
  if (SHORTLINK_DOMAINS.has(host)) {
    return { domain_entity_type: 'shortlink', domain_score: 0.25, reasons: ['known_shortlink_domain'] }
  }
  if (INSTITUTIONAL_TLDS.has(meta.tld)) {
    return { domain_entity_type: 'institution', domain_score: 0.5, reasons: ['institutional_tld'] }
  }
  if (HOSTING_HINTS.some((hint) => host.includes(hint))) {
    return { domain_entity_type: 'infra-hosting', domain_score: 0.3, reasons: ['hosting_or_infra_hint'] }
  }
  if (GENERIC_DOMAINS.has(host)) {
    return { domain_entity_type: 'generic-bucket', domain_score: 0.2, reasons: ['generic_bucket_domain'] }
  }
  if (GENERIC_ROOTS.has(root)) {
    return { domain_entity_type: 'generic-bucket', domain_score: 0.35, reasons: ['generic_domain_root'] }
  }
  if (root.length <= 1) {
    return { domain_entity_type: 'generic-bucket', domain_score: 0.32, reasons: ['domain_root_too_short'] }
  }
  if (
    PUBLISHER_DOMAINS.has(host)
    || PUBLISHER_ROOT_HINTS.some((hint) => root.includes(hint))
  ) {
    return { domain_entity_type: 'publisher', domain_score: 0.62, reasons: ['publisher_domain_pattern'] }
  }
  return { domain_entity_type: 'commercial', domain_score: 0.82, reasons: [] }
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
  const hardGate =
    domain.domain_entity_type === 'institution'
    || domain.domain_entity_type === 'shortlink'
    || domain.domain_entity_type === 'infra-hosting'

  let entityDecision = 'brand_ad_eligible'
  const reasons = [...new Set([...name.reasons, ...domain.reasons])]

  if (!cleanedName) {
    entityDecision = 'non_brand_entity'
    reasons.push('empty_cleaned_name')
  } else if (hardGate) {
    entityDecision = 'non_brand_entity'
    reasons.push('domain_hard_gate_blocked')
  } else if (queryContaminatedName) {
    entityDecision = 'non_brand_entity'
    reasons.push('query_title_not_brand')
  } else if (domain.domain_entity_type === 'commercial' && finalScore >= 0.6) {
    entityDecision = 'brand_ad_eligible'
  } else if (domain.domain_entity_type === 'publisher' && finalScore >= 0.55) {
    entityDecision = 'brand_ad_eligible'
  } else if (domain.domain_entity_type === 'generic-bucket') {
    entityDecision = 'non_brand_entity'
    reasons.push('generic_domain_not_brand')
  } else if (domain.domain_entity_type === 'commercial' && finalScore >= 0.45) {
    entityDecision = 'brand_suspect'
  } else if (finalScore < 0.45) {
    entityDecision = 'non_brand_entity'
    reasons.push('low_final_score')
  } else {
    entityDecision = 'brand_suspect'
  }

  return {
    cleaned_brand_name: cleanedName,
    selected_source: useOriginal ? 'original_name' : 'domain_candidate',
    domain_entity_type: domain.domain_entity_type,
    domain_hard_gate: hardGate,
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
      domain_entity_type: picked.domain_entity_type,
      domain_hard_gate: picked.domain_hard_gate,
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
        domain_type_commercial: 0,
        domain_type_publisher: 0,
        domain_type_institution: 0,
        domain_type_infra_hosting: 0,
        domain_type_shortlink: 0,
        domain_type_generic_bucket: 0,
        sample_ad_eligible: [],
        sample_non_brand: [],
      })
    }
    const bucket = categoryMap.get(key)
    bucket.total_records += 1
    if (row.domain_entity_type === 'commercial') bucket.domain_type_commercial += 1
    else if (row.domain_entity_type === 'publisher') bucket.domain_type_publisher += 1
    else if (row.domain_entity_type === 'institution') bucket.domain_type_institution += 1
    else if (row.domain_entity_type === 'infra-hosting') bucket.domain_type_infra_hosting += 1
    else if (row.domain_entity_type === 'shortlink') bucket.domain_type_shortlink += 1
    else if (row.domain_entity_type === 'generic-bucket') bucket.domain_type_generic_bucket += 1

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

  const identifiedByBrandId = new Map(identifiedRows.map((row) => [row.brand_id, row]))
  const approvedBrands = brands
    .filter((brand) => identifiedByBrandId.get(brand.brand_id)?.entity_decision === 'brand_ad_eligible')
    .map((brand) => {
      const identified = identifiedByBrandId.get(brand.brand_id)
      return {
        ...brand,
        brand_name: identified?.cleaned_brand_name || brand.brand_name,
        status: 'active',
        evidence: {
          ...(brand.evidence || {}),
          cleaning: {
            entity_decision: identified?.entity_decision || '',
            final_score: identified?.final_score || 0,
            domain_entity_type: identified?.domain_entity_type || '',
            reasons: identified?.reasons || '',
          },
        },
      }
    })

  const approvedBrandRows = approvedBrands.map((brand) => {
    const identified = identifiedByBrandId.get(brand.brand_id)
    return {
      brand_id: brand.brand_id,
      brand_name: brand.brand_name,
      official_domain: brand.official_domain,
      vertical_l1: brand.vertical_l1,
      vertical_l2: brand.vertical_l2,
      final_score: identified?.final_score || 0,
      domain_entity_type: identified?.domain_entity_type || '',
      reasons: identified?.reasons || '',
    }
  })

  const avgEligibleTarget = Math.max(
    30,
    Math.round(categoryRows.reduce((sum, row) => sum + row.ad_eligible_brands, 0) / Math.max(1, categoryRows.length)),
  )
  const categoryGapRows = categoryRows
    .map((row) => ({
      vertical_l1: row.vertical_l1,
      vertical_l2: row.vertical_l2,
      ad_eligible_brands: row.ad_eligible_brands,
      target_brands: avgEligibleTarget,
      brands_to_fill: Math.max(0, avgEligibleTarget - row.ad_eligible_brands),
      non_brand_entities: row.non_brand_entities,
      ad_eligible_ratio: row.ad_eligible_ratio,
    }))
    .sort((a, b) => b.brands_to_fill - a.brands_to_fill || a.vertical_l1.localeCompare(b.vertical_l1))

  const summary = {
    generated_at: new Date().toISOString(),
    total_records: identifiedRows.length,
    ad_eligible_brands: identifiedRows.filter((row) => row.entity_decision === 'brand_ad_eligible').length,
    suspect_brands: identifiedRows.filter((row) => row.entity_decision === 'brand_suspect').length,
    non_brand_entities: identifiedRows.filter((row) => row.entity_decision === 'non_brand_entity').length,
    hard_gate_blocked_count: identifiedRows.filter((row) => row.domain_hard_gate).length,
    domain_entity_type_distribution: {
      commercial: identifiedRows.filter((row) => row.domain_entity_type === 'commercial').length,
      publisher: identifiedRows.filter((row) => row.domain_entity_type === 'publisher').length,
      institution: identifiedRows.filter((row) => row.domain_entity_type === 'institution').length,
      'infra-hosting': identifiedRows.filter((row) => row.domain_entity_type === 'infra-hosting').length,
      shortlink: identifiedRows.filter((row) => row.domain_entity_type === 'shortlink').length,
      'generic-bucket': identifiedRows.filter((row) => row.domain_entity_type === 'generic-bucket').length,
    },
    categories: categoryRows.length,
    category_fill_target_per_vertical: avgEligibleTarget,
    pruned_out_brands: identifiedRows.length - approvedBrands.length,
    output_files: {
      identified_brand_list_csv: `data/house-ads/reports/house-ads-brand-identified-list-${tag}.csv`,
      category_report_csv: `data/house-ads/reports/house-ads-brand-category-report-${tag}.csv`,
      summary_json: `data/house-ads/reports/house-ads-brand-category-summary-${tag}.json`,
      approved_brand_list_csv: `data/house-ads/reports/house-ads-approved-brand-list-${tag}.csv`,
      category_gap_report_csv: `data/house-ads/reports/house-ads-category-gap-report-${tag}.csv`,
      latest_identified_brand_list_csv: 'data/house-ads/reports/house-ads-brand-identified-list-latest.csv',
      latest_category_report_csv: 'data/house-ads/reports/house-ads-brand-category-report-latest.csv',
      latest_summary_json: 'data/house-ads/reports/house-ads-brand-category-summary-latest.json',
      latest_approved_brand_list_csv: 'data/house-ads/reports/house-ads-approved-brand-list-latest.csv',
      latest_category_gap_report_csv: 'data/house-ads/reports/house-ads-category-gap-report-latest.csv',
      curated_approved_brands_jsonl: 'data/house-ads/curated/brands.jsonl',
    },
  }

  const identifiedPath = path.join(REPORT_ROOT, `house-ads-brand-identified-list-${tag}.csv`)
  const categoryPath = path.join(REPORT_ROOT, `house-ads-brand-category-report-${tag}.csv`)
  const summaryPath = path.join(REPORT_ROOT, `house-ads-brand-category-summary-${tag}.json`)
  const approvedPath = path.join(REPORT_ROOT, `house-ads-approved-brand-list-${tag}.csv`)
  const gapPath = path.join(REPORT_ROOT, `house-ads-category-gap-report-${tag}.csv`)
  const latestIdentifiedPath = path.join(REPORT_ROOT, 'house-ads-brand-identified-list-latest.csv')
  const latestCategoryPath = path.join(REPORT_ROOT, 'house-ads-brand-category-report-latest.csv')
  const latestSummaryPath = path.join(REPORT_ROOT, 'house-ads-brand-category-summary-latest.json')
  const latestApprovedPath = path.join(REPORT_ROOT, 'house-ads-approved-brand-list-latest.csv')
  const latestGapPath = path.join(REPORT_ROOT, 'house-ads-category-gap-report-latest.csv')

  await writeCsv(identifiedPath, identifiedRows)
  await writeCsv(categoryPath, categoryRows)
  await writeCsv(approvedPath, approvedBrandRows)
  await writeCsv(gapPath, categoryGapRows)
  await writeJson(summaryPath, summary)
  await writeJsonl(BRANDS_FILE, approvedBrands)

  await fs.copyFile(identifiedPath, latestIdentifiedPath)
  await fs.copyFile(categoryPath, latestCategoryPath)
  await fs.copyFile(approvedPath, latestApprovedPath)
  await fs.copyFile(gapPath, latestGapPath)
  await fs.copyFile(summaryPath, latestSummaryPath)

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error('[brand-clean-and-category-report] failed:', error?.message || error)
  process.exit(1)
})
