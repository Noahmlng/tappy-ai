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

async function probeDomain(domain, timeoutMs) {
  if (!domain) return { reachable: false, protocol: '', url: '', title: '' }
  const candidates = [`https://${domain}`, `http://${domain}`]
  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, { timeoutMs })
      if (!response.ok && response.status >= 500) continue
      const html = await response.text().catch(() => '')
      const title = extractHtmlTitle(html)
      return { reachable: true, protocol: url.startsWith('https') ? 'https' : 'http', url, title }
    } catch {
      // continue probing fallback protocol
    }
  }
  return { reachable: false, protocol: '', url: '', title: '' }
}

function scoreSeed(seed, probe) {
  const base = Number(seed.source_confidence) || 0
  const availabilityBoost = probe.reachable ? 0.2 : -0.15
  const titleMatch = tokenMatchScore(seed.brand_name, probe.title || '') * 0.2
  const httpsBoost = probe.protocol === 'https' ? 0.05 : 0
  return Number(Math.max(0, Math.min(1, base + availabilityBoost + titleMatch + httpsBoost)).toFixed(4))
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
    const probe = skipNetwork ? { reachable: true, protocol: 'https', url: `https://${domain}`, title: '' } : await probeDomain(domain, timeoutMs)
    const confidence = scoreSeed(seed, probe)
    return {
      seed,
      domain,
      probe,
      confidence,
    }
  })

  const candidates = inspected
    .filter((item) => item.domain)
    .filter((item) => (strictReachable ? item.probe.reachable : true))
    .map((item) => ({
      brand_id: brandId(item.domain, item.seed.brand_name),
      brand_name: cleanText(item.seed.brand_name) || item.domain,
      vertical_l1: cleanText(item.seed.vertical_l1) || 'unknown',
      vertical_l2: cleanText(item.seed.vertical_l2) || 'unknown',
      market: cleanText(item.seed.market) || 'US',
      official_domain: item.domain,
      source_confidence: item.confidence,
      status: 'active',
      evidence: {
        seed_id: item.seed.seed_id || '',
        search_hit_count: Number(item.seed.search_hit_count) || 0,
        verified_reachable: Boolean(item.probe.reachable),
        homepage_title: cleanText(item.probe.title).slice(0, 180),
        homepage_url: item.probe.url,
      },
    }))
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
