#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CURATED_ROOT,
  REPORT_ROOT,
  parseArgs,
  toBoolean,
  cleanText,
  readJsonl,
  writeJson,
  writeJsonl,
  ensureDir,
  timestampTag,
  registrableDomain,
  domainToBrandName,
} from './lib/common.js'

const INSTITUTIONAL_TLDS = new Set(['gov', 'edu', 'mil', 'int'])
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
  'is.gd',
  'buff.ly',
  'rb.gy',
  'shorturl.at',
])
const HOSTING_HINTS = [
  'github.io',
  'pages.dev',
  'netlify.app',
  'vercel.app',
  'blogspot.',
  'wordpress.com',
  'wixsite.com',
  'wixstatic.com',
  'appspot.com',
  'azurewebsites.net',
  'herokuapp.com',
  'amazonaws.com',
  'cloudfront.net',
  'googleusercontent.com',
]
const PUBLISHER_HINTS = [
  'news',
  'times',
  'post',
  'journal',
  'media',
  'tribune',
  'herald',
  'daily',
  'magazine',
  'press',
]
const GENERIC_BUCKET_ROOTS = new Set([
  'www',
  'home',
  'index',
  'page',
  'site',
  'official',
  'web',
  'online',
  'generic',
  'example',
  'demo',
])
const BLOCKED_ROOTS = new Set(['gov', 'edu', 'mil', 'int'])
const NOISY_TITLE_HINTS = [
  '是什么意思',
  '什么意思',
  '翻译',
  '用法',
  '例句',
  '怎么读',
  '百度知道',
  '问答',
  '教程',
  '指南',
  '攻略',
  '论坛',
  '帖子',
  'forum',
  'thread',
  'tutorial',
  'guide',
  'how to',
  'wiki',
  'dictionary',
  'lexicon',
]
const PARKED_OR_INTERSTITIAL_HINTS = [
  'domain for sale',
  'this domain may be for sale',
  'buy this domain',
  'sedo',
  'hugedomains',
  'parkingcrew',
  'just a moment',
  'attention required',
  'cloudflare',
  'access denied',
  '403 forbidden',
]
const GENERIC_BRAND_WORDS = new Set([
  'home',
  'official',
  'service',
  'services',
  'platform',
  'portal',
  'global',
  'group',
  'digital',
  'technology',
  'brand',
  'store',
  'shop',
  'mall',
  'site',
  'gov',
  'edu',
])

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeName(value) {
  return cleanText(String(value || ''))
    .replace(/[“”"']/g, '')
    .replace(/[_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactAlphaNum(value) {
  return normalizeName(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function tokenize(value) {
  return normalizeName(value).split(/\s+/g).filter(Boolean)
}

function punctuationRatio(value) {
  const text = normalizeName(value)
  if (!text) return 1
  const punctuation = (text.match(/[^\p{L}\p{N}\s]/gu) || []).length
  return punctuation / Math.max(1, text.length)
}

function isNumericName(value) {
  const text = compactAlphaNum(value)
  return Boolean(text) && /^\d+$/.test(text)
}

function hasNoisyHint(value) {
  const lower = normalizeName(value).toLowerCase()
  if (!lower) return false
  return NOISY_TITLE_HINTS.some((hint) => lower.includes(hint))
}

function isValidDomainSyntax(domain = '') {
  const host = cleanText(domain).toLowerCase()
  if (!host) return false
  if (host.length > 253) return false
  const labels = host.split('.').filter(Boolean)
  if (labels.length < 2) return false
  const tld = labels[labels.length - 1]
  if (!/^[a-z]{2,24}$/.test(tld)) return false
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}

function classifyDomain(domain = '') {
  const host = registrableDomain(domain)
  if (!host) return { domain_entity_type: 'generic-bucket', reason: 'missing_domain' }
  if (SHORTLINK_DOMAINS.has(host)) return { domain_entity_type: 'shortlink', reason: 'known_shortlink_domain' }
  if (HOSTING_HINTS.some((hint) => host.includes(hint))) {
    return { domain_entity_type: 'infra-hosting', reason: 'hosting_or_infra_domain' }
  }
  const labels = host.split('.')
  const root = labels[0] || ''
  const tld = labels[labels.length - 1] || ''
  if (INSTITUTIONAL_TLDS.has(tld)) return { domain_entity_type: 'institution', reason: 'institutional_tld' }
  if (BLOCKED_ROOTS.has(root)) return { domain_entity_type: 'institution', reason: 'institutional_root' }
  if (!root || root.length <= 1 || GENERIC_BUCKET_ROOTS.has(root)) {
    return { domain_entity_type: 'generic-bucket', reason: 'generic_root' }
  }
  if (PUBLISHER_HINTS.some((hint) => root.includes(hint))) {
    return { domain_entity_type: 'publisher', reason: 'publisher_like_root' }
  }
  return { domain_entity_type: 'commercial', reason: '' }
}

function collectCanonicalSignalConsensus(evidence = {}) {
  const signals = evidence.site_signals || {}
  const candidates = [
    ['og:site_name', signals.og_site_name],
    ['schema_org:Organization.name', signals.schema_org_name],
    ['title_brand_segment', signals.title_brand_segment],
    ['logo_alt', signals.logo_alt],
  ]
  const buckets = new Map()
  for (const [source, rawValue] of candidates) {
    const value = normalizeName(rawValue)
    const key = compactAlphaNum(value)
    if (!key || key.length < 2) continue
    if (!buckets.has(key)) buckets.set(key, { value, sources: [] })
    const bucket = buckets.get(key)
    bucket.sources.push(source)
    if (value.length < bucket.value.length) bucket.value = value
  }
  const winner = [...buckets.values()].sort((a, b) => b.sources.length - a.sources.length)[0]
  if (!winner) return { canonical_name: '', source_count: 0, sources: [] }
  return {
    canonical_name: winner.value,
    source_count: winner.sources.length,
    sources: winner.sources,
  }
}

function parkedOrInterstitialTitle(title = '') {
  const lower = cleanText(title).toLowerCase()
  if (!lower) return false
  return PARKED_OR_INTERSTITIAL_HINTS.some((hint) => lower.includes(hint))
}

function nameDomainAligned(name, domainRoot) {
  const nameKey = compactAlphaNum(name)
  const rootKey = compactAlphaNum(domainRoot)
  if (!nameKey || !rootKey) return false
  return nameKey.includes(rootKey) || rootKey.includes(nameKey)
}

function chooseCanonicalName(brand, consensus) {
  const canonicalFromField = normalizeName(brand.canonical_brand_name)
  if (canonicalFromField) return { canonical_name: canonicalFromField, source: 'canonical_brand_name' }
  if (consensus.source_count >= 2 && !hasNoisyHint(consensus.canonical_name)) {
    return { canonical_name: consensus.canonical_name, source: 'site_signal_consensus' }
  }
  const original = normalizeName(brand.brand_name)
  if (original && !hasNoisyHint(original)) return { canonical_name: original, source: 'brand_name' }
  const fallback = normalizeName(domainToBrandName(brand.official_domain))
  return { canonical_name: fallback, source: 'domain_fallback' }
}

function isGenericBrandName(name) {
  const tokens = tokenize(name).map((token) => token.toLowerCase())
  if (tokens.length === 0) return true
  if (tokens.length === 1 && GENERIC_BRAND_WORDS.has(tokens[0])) return true
  if (tokens.every((token) => GENERIC_BRAND_WORDS.has(token))) return true
  return false
}

function shouldRejectBrand(brand, options) {
  const reasons = []
  const domain = registrableDomain(brand.official_domain)
  const evidence = brand.evidence || {}
  const domainInfo = classifyDomain(domain)
  const domainRoot = domain.split('.')[0] || ''
  const sourceTitle = normalizeName(brand.source_title || evidence.source_title || '')
  const consensus = collectCanonicalSignalConsensus(evidence)
  const canonicalPick = chooseCanonicalName(brand, consensus)
  const canonical = canonicalPick.canonical_name
  const cleanScore = toNumber(evidence.cleaning?.final_score, NaN)
  const kbMatched = Boolean(evidence.kb_alignment?.matched)
  const canonicalConfirmed = Boolean(evidence.canonical_confirmed || normalizeName(brand.canonical_brand_name))
  const strongEvidence = canonicalConfirmed || kbMatched || consensus.source_count >= 2
  const sourceNameInvalid = Boolean(evidence.source_name_invalid)
  const reachable = Boolean(evidence.verified_reachable)
  const validRedirect = Boolean(evidence.valid_redirect)
  const redirectDomain = registrableDomain(evidence.redirect_final_domain || evidence.redirect_final_url || '')
  const redirectType = redirectDomain ? classifyDomain(redirectDomain).domain_entity_type : ''

  if (!domain || !isValidDomainSyntax(domain)) reasons.push('invalid_domain_syntax')
  if (
    ['institution', 'shortlink', 'infra-hosting', 'generic-bucket'].includes(domainInfo.domain_entity_type)
  ) {
    reasons.push(`domain_type_blocked:${domainInfo.domain_entity_type}`)
  }
  if (domainInfo.domain_entity_type === 'publisher' && !options.allowPublisher) {
    reasons.push('publisher_not_allowed')
  }
  if (!reachable && !validRedirect) reasons.push('unreachable_or_invalid_redirect')
  if (validRedirect && redirectDomain && ['institution', 'shortlink', 'infra-hosting', 'generic-bucket'].includes(redirectType)) {
    reasons.push(`invalid_redirect_target:${redirectType}`)
  }
  if (parkedOrInterstitialTitle(evidence.homepage_title || '')) reasons.push('parked_or_interstitial')

  if (sourceNameInvalid && !strongEvidence) reasons.push('polluted_source_name')
  if (hasNoisyHint(canonical)) reasons.push('brand_name_noise')
  if (hasNoisyHint(sourceTitle) && !strongEvidence) reasons.push('brand_name_noise')
  if (!canonical) reasons.push('empty_canonical_name')
  if (isNumericName(canonical)) reasons.push('numeric_brand_name')

  const tokenLen = tokenize(canonical).length
  if (tokenLen > options.maxNameTokens) reasons.push('too_many_tokens')
  if (punctuationRatio(canonical) > options.maxPunctuationRatio) reasons.push('high_punctuation_ratio')
  if (canonical.length > options.maxNameLength) reasons.push('name_too_long')
  if (isGenericBrandName(canonical) && !strongEvidence) reasons.push('generic_brand_name')
  if (!strongEvidence && !nameDomainAligned(canonical, domainRoot)) reasons.push('weak_name_domain_mismatch')

  if (Number.isFinite(cleanScore) && cleanScore < options.minCleanScore) reasons.push('low_cleaning_score')
  if (!Number.isFinite(cleanScore) && !strongEvidence) reasons.push('missing_cleaning_score')

  return {
    reject: reasons.length > 0,
    reasons: [...new Set(reasons)],
    domain_entity_type: domainInfo.domain_entity_type,
    canonical_name: canonical,
    canonical_source: canonicalPick.source,
    strong_evidence: strongEvidence,
    clean_score: Number.isFinite(cleanScore) ? cleanScore : null,
    source_name_invalid: sourceNameInvalid,
    kb_matched: kbMatched,
    canonical_confirmed: canonicalConfirmed,
    site_consensus_count: consensus.source_count,
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

async function writeCsv(filePath, rows = []) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, toCsv(rows), 'utf8')
}

function reasonDistribution(items = []) {
  const dist = {}
  for (const item of items) {
    for (const reason of item.reasons || []) {
      dist[reason] = (dist[reason] || 0) + 1
    }
  }
  return Object.fromEntries(Object.entries(dist).sort((a, b) => b[1] - a[1]))
}

function categoryDistribution(brands = []) {
  const map = new Map()
  for (const brand of brands) {
    const l1 = cleanText(brand.vertical_l1) || 'unknown'
    const l2 = cleanText(brand.vertical_l2) || 'unknown'
    const key = `${l1}::${l2}`
    if (!map.has(key)) map.set(key, { vertical_l1: l1, vertical_l2: l2, brand_count: 0 })
    map.get(key).brand_count += 1
  }
  return [...map.values()].sort((a, b) => b.brand_count - a.brand_count || a.vertical_l1.localeCompare(b.vertical_l1))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const tag = timestampTag()
  const inputPath = path.resolve(process.cwd(), cleanText(args['input-file']) || path.join(CURATED_ROOT, 'brands.jsonl'))
  const outputPath = path.resolve(process.cwd(), cleanText(args['output-file']) || path.join(CURATED_ROOT, 'brands.jsonl'))
  const dryRun = toBoolean(args['dry-run'], false)
  const options = {
    allowPublisher: toBoolean(args['allow-publisher'], false),
    minCleanScore: toNumber(args['min-clean-score'], 0.78),
    maxNameTokens: Math.max(2, Math.floor(toNumber(args['max-name-tokens'], 4))),
    maxNameLength: Math.max(24, Math.floor(toNumber(args['max-name-length'], 48))),
    maxPunctuationRatio: Math.max(0.1, Math.min(0.5, toNumber(args['max-punctuation-ratio'], 0.2))),
  }

  const brands = await readJsonl(inputPath)
  const decisions = brands.map((brand) => ({ brand, ...shouldRejectBrand(brand, options) }))
  const accepted = decisions.filter((row) => !row.reject)
  const rejected = decisions.filter((row) => row.reject)

  const acceptedBrands = accepted.map((row) => ({
    ...row.brand,
    brand_name: row.canonical_name || row.brand.brand_name,
    status: 'active',
    evidence: {
      ...(row.brand.evidence || {}),
      strict_admission: {
        admitted: true,
        domain_entity_type: row.domain_entity_type,
        canonical_source: row.canonical_source,
        strong_evidence: row.strong_evidence,
        clean_score: row.clean_score,
        checked_at: new Date().toISOString(),
      },
    },
  }))

  const rejectedRows = rejected.map((row) => ({
    brand_id: row.brand.brand_id,
    brand_name: row.brand.brand_name,
    canonical_candidate: row.canonical_name,
    official_domain: row.brand.official_domain,
    vertical_l1: row.brand.vertical_l1,
    vertical_l2: row.brand.vertical_l2,
    domain_entity_type: row.domain_entity_type,
    strong_evidence: row.strong_evidence,
    clean_score: row.clean_score ?? '',
    source_name_invalid: row.source_name_invalid,
    kb_matched: row.kb_matched,
    canonical_confirmed: row.canonical_confirmed,
    site_consensus_count: row.site_consensus_count,
    reasons: row.reasons.join('|'),
  }))

  const acceptedRows = accepted.map((row) => ({
    brand_id: row.brand.brand_id,
    brand_name: row.canonical_name || row.brand.brand_name,
    official_domain: row.brand.official_domain,
    vertical_l1: row.brand.vertical_l1,
    vertical_l2: row.brand.vertical_l2,
    domain_entity_type: row.domain_entity_type,
    strong_evidence: row.strong_evidence,
    clean_score: row.clean_score ?? '',
    canonical_source: row.canonical_source,
  }))

  const categoryRows = categoryDistribution(acceptedBrands)
  const summary = {
    generated_at: new Date().toISOString(),
    input_file: path.relative(process.cwd(), inputPath),
    output_file: path.relative(process.cwd(), outputPath),
    admission_standard: {
      hard_gate: [
        'valid domain syntax required',
        'domain entity must not be institution/shortlink/infra-hosting/generic-bucket',
        'publisher domains are blocked by default',
        'must be reachable or have valid redirect target',
        'redirect target cannot be blocked domain entity',
      ],
      quality_gate: [
        'polluted source title without strong evidence is rejected',
        'brand/name noise (dictionary/tutorial/forum/wiki patterns) is rejected',
        'name-domain mismatch without strong evidence is rejected',
        `cleaning score must be >= ${options.minCleanScore}`,
        'generic or ambiguous brand names without strong evidence are rejected',
      ],
      strong_evidence_definition:
        'canonical_confirmed OR kb_alignment.matched OR >=2 site-level signals (og:site_name/schema org/title brand/logo alt)一致',
    },
    options,
    total_brands: brands.length,
    admitted_brands: acceptedBrands.length,
    rejected_brands: rejected.length,
    admitted_ratio: Number((acceptedBrands.length / Math.max(1, brands.length)).toFixed(4)),
    rejected_reason_distribution: reasonDistribution(rejected),
    domain_entity_distribution_admitted: reasonDistribution(
      accepted.map((item) => ({ reasons: [`domain:${item.domain_entity_type}`] })),
    ),
    output_files: {
      admitted_brands_jsonl: path.relative(process.cwd(), outputPath),
      admitted_list_csv: `data/house-ads/reports/house-ads-strict-approved-brand-list-${tag}.csv`,
      rejected_list_csv: `data/house-ads/reports/house-ads-strict-rejected-brand-list-${tag}.csv`,
      category_distribution_csv: `data/house-ads/reports/house-ads-strict-category-distribution-${tag}.csv`,
      summary_json: `data/house-ads/reports/house-ads-strict-admission-summary-${tag}.json`,
      rejected_snapshot_jsonl: `data/house-ads/curated/brands-rejected-${tag}.jsonl`,
      backup_before_prune_jsonl: `data/house-ads/curated/brands-before-strict-${tag}.jsonl`,
    },
  }

  const backupPath = path.join(CURATED_ROOT, `brands-before-strict-${tag}.jsonl`)
  const rejectedSnapshotPath = path.join(CURATED_ROOT, `brands-rejected-${tag}.jsonl`)
  const admittedCsvPath = path.join(REPORT_ROOT, `house-ads-strict-approved-brand-list-${tag}.csv`)
  const rejectedCsvPath = path.join(REPORT_ROOT, `house-ads-strict-rejected-brand-list-${tag}.csv`)
  const categoryCsvPath = path.join(REPORT_ROOT, `house-ads-strict-category-distribution-${tag}.csv`)
  const summaryPath = path.join(REPORT_ROOT, `house-ads-strict-admission-summary-${tag}.json`)
  const latestAdmittedCsvPath = path.join(REPORT_ROOT, 'house-ads-strict-approved-brand-list-latest.csv')
  const latestRejectedCsvPath = path.join(REPORT_ROOT, 'house-ads-strict-rejected-brand-list-latest.csv')
  const latestCategoryCsvPath = path.join(REPORT_ROOT, 'house-ads-strict-category-distribution-latest.csv')
  const latestSummaryPath = path.join(REPORT_ROOT, 'house-ads-strict-admission-summary-latest.json')

  await ensureDir(CURATED_ROOT)
  await ensureDir(REPORT_ROOT)

  await writeJsonl(backupPath, brands)
  await writeJsonl(rejectedSnapshotPath, rejected.map((row) => ({ ...row.brand, rejection_reasons: row.reasons })))
  await writeCsv(admittedCsvPath, acceptedRows)
  await writeCsv(rejectedCsvPath, rejectedRows)
  await writeCsv(categoryCsvPath, categoryRows)
  await writeJson(summaryPath, summary)

  if (!dryRun) {
    await writeJsonl(outputPath, acceptedBrands)
  }

  await fs.copyFile(admittedCsvPath, latestAdmittedCsvPath)
  await fs.copyFile(rejectedCsvPath, latestRejectedCsvPath)
  await fs.copyFile(categoryCsvPath, latestCategoryCsvPath)
  await fs.copyFile(summaryPath, latestSummaryPath)

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        inputBrands: brands.length,
        admittedBrands: acceptedBrands.length,
        rejectedBrands: rejected.length,
        summary: path.relative(process.cwd(), summaryPath),
        admittedOutput: path.relative(process.cwd(), outputPath),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[strict-brand-admission] failed:', error?.message || error)
  process.exit(1)
})
