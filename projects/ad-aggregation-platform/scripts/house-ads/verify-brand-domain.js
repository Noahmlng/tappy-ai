#!/usr/bin/env node
import path from 'node:path'
import {
  RAW_ROOT,
  CURATED_ROOT,
  parseArgs,
  toInteger,
  toBoolean,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl,
  findLatestFile,
  ensureDir,
  cleanText,
  slugify,
  hashId,
  fetchWithTimeout,
  extractHtmlTitle,
  asyncPool,
  registrableDomain,
  timestampTag,
  domainToBrandName,
} from './lib/common.js'

const BRAND_SEEDS_DIR = path.join(RAW_ROOT, 'brand-seeds')

function brandId(domain, brandName) {
  const slug = slugify(domain || brandName || 'brand')
  return `brand_${slug}_${hashId(`${domain}|${brandName}`, 8)}`
}

function pickSeedDomain(seed) {
  const candidates = Array.isArray(seed?.candidate_domains) ? seed.candidate_domains : []
  for (const item of candidates) {
    const domain = registrableDomain(item)
    if (domain) return domain
  }
  return ''
}

function tokenMatchScore(brandName, title) {
  const brandTokens = cleanText(brandName)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3)
  if (brandTokens.length === 0) return 0
  const titleLower = cleanText(title).toLowerCase()
  const matched = brandTokens.filter((token) => titleLower.includes(token))
  return matched.length / brandTokens.length
}

function sourceTitleLooksWeak(sourceTitle = '') {
  const value = cleanText(sourceTitle).toLowerCase()
  if (!value) return true
  const weakHints = [
    '什么意思',
    '是什么意思',
    '怎么读',
    '翻译',
    '用法',
    '例句',
    'forum',
    'thread',
    'rating',
    'guide',
    'tips',
    'review',
    'hidden',
    'future of',
    'popular with',
    '百度知道',
  ]
  if (weakHints.some((hint) => value.includes(hint))) return true
  if (value.length > 48) return true
  if (value.split(/\s+/g).filter(Boolean).length > 6) return true
  return false
}

function canonicalBrandNameFromDomain(domain = '') {
  const candidate = cleanText(domainToBrandName(domain))
  if (!candidate) return ''
  return candidate
}

function normalizeBrandKey(name = '') {
  return cleanText(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function titleBrandSegment(title = '') {
  const cleaned = cleanText(title)
  if (!cleaned) return ''
  const parts = cleaned
    .split(/\s*[|\-:·•]\s*/g)
    .map((part) => cleanText(part))
    .filter(Boolean)
  if (parts.length === 0) return cleaned
  return parts.reduce((picked, current) => {
    if (!picked) return current
    const currentScore = current.length
    const pickedScore = picked.length
    return currentScore < pickedScore ? current : picked
  }, '')
}

function extractMetaContent(html = '', propertyOrName = '') {
  if (!html || !propertyOrName) return ''
  const escaped = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      'i',
    ),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return cleanText(match[1])
  }
  return ''
}

function extractSchemaOrgOrganizationNames(html = '') {
  if (!html) return []
  const names = []
  const scriptMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const match of scriptMatches) {
    const payload = cleanText(match[1])
    if (!payload) continue
    try {
      const parsed = JSON.parse(payload)
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed]
      while (queue.length > 0) {
        const node = queue.shift()
        if (!node || typeof node !== 'object') continue
        const graph = node['@graph']
        if (Array.isArray(graph)) {
          for (const item of graph) queue.push(item)
        }
        const typeValue = node['@type']
        const types = Array.isArray(typeValue) ? typeValue : [typeValue]
        const isOrganization = types.some((type) => String(type || '').toLowerCase().includes('organization'))
        if (isOrganization && typeof node.name === 'string') {
          names.push(cleanText(node.name))
        }
      }
    } catch {
      // ignore malformed json-ld
    }
  }
  return [...new Set(names.filter(Boolean))]
}

function extractLogoAltCandidate(html = '') {
  if (!html) return ''
  const logoTagMatch = html.match(/<img[^>]+(?:id|class)=["'][^"']*logo[^"']*["'][^>]*>/i)
  if (logoTagMatch) {
    const altMatch = logoTagMatch[0].match(/\salt=["']([^"']+)["']/i)
    if (altMatch) return cleanText(altMatch[1])
  }
  const firstAlt = html.match(/<img[^>]+\salt=["']([^"']+)["'][^>]*>/i)
  if (firstAlt) return cleanText(firstAlt[1])
  return ''
}

function resolveCanonicalFromSiteSignals(probe, domain) {
  const signals = {
    og_site_name: cleanText(probe.siteSignals?.og_site_name),
    schema_org_name: cleanText(probe.siteSignals?.schema_org_name),
    title_brand_segment: cleanText(probe.siteSignals?.title_brand_segment),
    logo_alt: cleanText(probe.siteSignals?.logo_alt),
  }
  const buckets = new Map()
  for (const [source, value] of Object.entries(signals)) {
    const normalized = normalizeBrandKey(value)
    if (!normalized || normalized.length < 2) continue
    if (!buckets.has(normalized)) buckets.set(normalized, { sources: [], value })
    buckets.get(normalized).sources.push(source)
    if (value.length < buckets.get(normalized).value.length) buckets.get(normalized).value = value
  }
  const consensus = [...buckets.values()].sort((a, b) => b.sources.length - a.sources.length)[0]
  const canonicalBrand = consensus && consensus.sources.length >= 2 ? consensus.value : ''
  const canonicalConfirmed = Boolean(canonicalBrand)
  return {
    canonicalBrand,
    canonicalConfirmed,
    canonicalSources: canonicalConfirmed ? consensus.sources : [],
    domainFallbackBrand: canonicalBrandNameFromDomain(domain) || domain,
    signals,
  }
}

async function probeDomain(domain, timeoutMs) {
  if (!domain) return { reachable: false, protocol: '', url: '', title: '', siteSignals: {} }
  const candidates = [`https://${domain}`, `http://${domain}`]
  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, { timeoutMs })
      if (!response.ok && response.status >= 500) continue
      const html = await response.text().catch(() => '')
      const title = extractHtmlTitle(html)
      const ogSiteName = extractMetaContent(html, 'og:site_name')
      const schemaNames = extractSchemaOrgOrganizationNames(html)
      const siteSignals = {
        og_site_name: ogSiteName,
        schema_org_name: schemaNames[0] || '',
        title_brand_segment: titleBrandSegment(title),
        logo_alt: extractLogoAltCandidate(html),
      }
      return { reachable: true, protocol: url.startsWith('https') ? 'https' : 'http', url, title, siteSignals }
    } catch {
      // continue probing fallback protocol
    }
  }
  return { reachable: false, protocol: '', url: '', title: '', siteSignals: {} }
}

function scoreSeed(seed, probe, resolvedCanonical) {
  const base = Number(seed.source_confidence) || 0
  const availabilityBoost = probe.reachable ? 0.2 : -0.15
  const canonicalHint = resolvedCanonical.canonicalBrand || resolvedCanonical.domainFallbackBrand
  const titleMatch = tokenMatchScore(canonicalHint, probe.title || '') * 0.2
  const canonicalConsensusBoost = resolvedCanonical.canonicalConfirmed ? 0.08 : -0.05
  const httpsBoost = probe.protocol === 'https' ? 0.05 : 0
  return Number(
    Math.max(0, Math.min(1, base + availabilityBoost + titleMatch + httpsBoost + canonicalConsensusBoost)).toFixed(
      4,
    ),
  )
}

function roundRobinSelect(items, maxBrands) {
  const byVertical = new Map()
  for (const item of items) {
    const key = cleanText(item.vertical_l1) || 'unknown'
    if (!byVertical.has(key)) byVertical.set(key, [])
    byVertical.get(key).push(item)
  }
  const buckets = [...byVertical.entries()]
    .map(([vertical, rows]) => ({
      vertical,
      rows: rows.sort((a, b) => b.source_confidence - a.source_confidence),
      idx: 0,
    }))
    .sort((a, b) => a.vertical.localeCompare(b.vertical))

  const selected = []
  while (selected.length < maxBrands) {
    let pickedInRound = 0
    for (const bucket of buckets) {
      if (selected.length >= maxBrands) break
      if (bucket.idx >= bucket.rows.length) continue
      selected.push(bucket.rows[bucket.idx])
      bucket.idx += 1
      pickedInRound += 1
    }
    if (pickedInRound === 0) break
  }
  return selected
}

async function loadSeeds(args) {
  const explicit = cleanText(args['seed-file'])
  if (explicit) return readJsonl(path.resolve(process.cwd(), explicit))
  const latestMetaPath = path.join(BRAND_SEEDS_DIR, 'latest-brand-seeds.json')
  const latestMeta = await readJson(latestMetaPath, null)
  if (latestMeta?.latestSeedsJsonl) {
    return readJsonl(path.resolve(process.cwd(), latestMeta.latestSeedsJsonl))
  }
  const latestFile = await findLatestFile(BRAND_SEEDS_DIR, '.jsonl')
  if (!latestFile) throw new Error('No brand seeds found. Run merge-search-results first.')
  return readJsonl(latestFile)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const maxBrands = toInteger(args['max-brands'], 500)
  const concurrency = toInteger(args.concurrency, 16)
  const timeoutMs = toInteger(args['timeout-ms'], 8000)
  const skipNetwork = toBoolean(args['skip-network'], false)
  const strictReachable = toBoolean(args['strict-reachable'], false)
  const tag = timestampTag()

  await ensureDir(CURATED_ROOT)
  const seeds = await loadSeeds(args)

  const inspected = await asyncPool(concurrency, seeds, async (seed) => {
    const domain = pickSeedDomain(seed)
    const probe = skipNetwork
      ? { reachable: true, protocol: 'https', url: `https://${domain}`, title: '', siteSignals: {} }
      : await probeDomain(domain, timeoutMs)
    const resolvedCanonical = resolveCanonicalFromSiteSignals(probe, domain)
    const confidence = scoreSeed(seed, probe, resolvedCanonical)
    return {
      seed,
      domain,
      probe,
      resolvedCanonical,
      confidence,
    }
  })

  const candidates = inspected
    .filter((item) => item.domain)
    .filter((item) => (strictReachable ? item.probe.reachable : true))
    .map((item) => {
      const sourceTitle = cleanText(item.seed.brand_name)
      const canonicalBrandName = item.resolvedCanonical.canonicalBrand
      const brandName = canonicalBrandName || item.resolvedCanonical.domainFallbackBrand
      return {
        brand_id: brandId(item.domain, brandName),
        brand_name: brandName,
        canonical_brand_name: canonicalBrandName,
        source_title: sourceTitle,
        vertical_l1: cleanText(item.seed.vertical_l1) || 'unknown',
        vertical_l2: cleanText(item.seed.vertical_l2) || 'unknown',
        market: cleanText(item.seed.market) || 'US',
        official_domain: item.domain,
        source_confidence: item.confidence,
        status: 'active',
        evidence: {
          seed_id: item.seed.seed_id || '',
          search_hit_count: Number(item.seed.search_hit_count) || 0,
          source_title: sourceTitle,
          source_title_is_weak: sourceTitleLooksWeak(sourceTitle),
          canonical_confirmed: Boolean(canonicalBrandName),
          canonical_sources: item.resolvedCanonical.canonicalSources,
          site_signals: item.resolvedCanonical.signals,
          verified_reachable: Boolean(item.probe.reachable),
          homepage_title: cleanText(item.probe.title).slice(0, 180),
          homepage_url: item.probe.url,
        },
      }
    })
    .sort((a, b) => b.source_confidence - a.source_confidence)

  const selected = roundRobinSelect(candidates, Math.max(1, maxBrands))
  const brandsPath = path.join(CURATED_ROOT, 'brands.jsonl')
  const summaryPath = path.join(CURATED_ROOT, `brands-${tag}.summary.json`)

  await writeJsonl(brandsPath, selected)
  await writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    inspectedSeeds: seeds.length,
    candidateBrands: candidates.length,
    selectedBrands: selected.length,
    maxBrands,
    skipNetwork,
    strictReachable,
    output: path.relative(process.cwd(), brandsPath),
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        inspectedSeeds: seeds.length,
        selectedBrands: selected.length,
        output: path.relative(process.cwd(), brandsPath),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[verify-brand-domain] failed:', error?.message || error)
  process.exit(1)
})
