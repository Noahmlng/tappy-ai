#!/usr/bin/env node
import path from 'node:path'
import {
  RAW_ROOT,
  CURATED_ROOT,
  parseArgs,
  toInteger,
  readJsonl,
  ensureDir,
  fetchWithTimeout,
  cleanText,
  normalizeUrl,
  extractHtmlTitle,
  extractMetaDescription,
  extractH1,
  stripHtmlText,
  asyncPool,
  timestampTag,
  writeJson,
  writeJsonl,
  hashId,
} from './lib/common.js'

const CRAWL_PAGES_ROOT = path.join(RAW_ROOT, 'crawl-pages')
const CRAWL_SIGNALS_ROOT = path.join(RAW_ROOT, 'crawl-signals')

const ENTRY_PATHS = ['/', '/shop', '/products', '/collections', '/category', '/pricing', '/plans', '/deals', '/offers', '/sale']

function extractInternalLinks(html, baseUrl, domain) {
  const links = []
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi
  let match = regex.exec(html)
  while (match) {
    const href = cleanText(match[1] || '')
    if (!href) {
      match = regex.exec(html)
      continue
    }
    try {
      const resolved = new URL(href, baseUrl).toString()
      const parsed = new URL(resolved)
      if (parsed.hostname !== domain && !parsed.hostname.endsWith(`.${domain}`)) {
        match = regex.exec(html)
        continue
      }
      const normalized = normalizeUrl(parsed.toString())
      if (normalized) links.push(normalized)
    } catch {
      // ignore invalid url
    }
    match = regex.exec(html)
  }
  return [...new Set(links)]
}

function extractPriceHints(text = '') {
  const matches = text.match(/(?:\$|USD\s?)(\d{1,4}(?:\.\d{2})?)/gi) || []
  const values = []
  for (const match of matches) {
    const normalized = cleanText(match.replace(/^USD\s?/i, '$'))
    if (normalized) values.push(normalized)
    if (values.length >= 4) break
  }
  return values
}

function toKeywordTokens(text = '') {
  const tokens = cleanText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4)
  return [...new Set(tokens)].slice(0, 24)
}

function buildEntryUrls(domain) {
  const urls = []
  for (const pathname of ENTRY_PATHS) {
    const full = normalizeUrl(`https://${domain}${pathname}`)
    if (full) urls.push(full)
  }
  return [...new Set(urls)]
}

async function crawlBrand(brand, options) {
  const domain = cleanText(brand.official_domain)
  if (!domain) {
    return {
      brand,
      pages: [],
      signal: {
        brand_id: brand.brand_id,
        official_domain: '',
        unresolved: true,
        reason: 'missing_domain',
      },
    }
  }

  const maxPages = options.maxPagesPerBrand
  const maxAttempts = options.maxAttemptsPerBrand
  const timeoutMs = options.timeoutMs
  const queue = buildEntryUrls(domain)
  const visited = new Set()
  const pages = []
  let attempts = 0

  while (queue.length > 0 && pages.length < maxPages && attempts < maxAttempts) {
    const url = queue.shift()
    if (!url || visited.has(url)) continue
    visited.add(url)
    attempts += 1
    try {
      const response = await fetchWithTimeout(url, { timeoutMs })
      if (!response.ok || response.status >= 500) continue
      const contentType = cleanText(response.headers.get('content-type') || '').toLowerCase()
      if (!contentType.includes('text/html')) continue
      const html = await response.text()
      const title = extractHtmlTitle(html)
      const description = extractMetaDescription(html)
      const h1 = extractH1(html)
      const text = stripHtmlText(html)
      const links = extractInternalLinks(html, url, domain).slice(0, 8)
      for (const link of links) {
        if (!visited.has(link) && queue.length < maxPages * 3) queue.push(link)
      }
      pages.push({
        page_id: `page_${hashId(`${brand.brand_id}|${url}`)}`,
        brand_id: brand.brand_id,
        url,
        fetched_at: new Date().toISOString(),
        status_code: response.status,
        title: cleanText(title).slice(0, 180),
        description: cleanText(description).slice(0, 280),
        h1: cleanText(h1).slice(0, 180),
        text_excerpt: cleanText(text).slice(0, 320),
        price_hints: extractPriceHints(text),
        discovered_links: links.slice(0, 6),
      })
    } catch {
      // ignore request error and continue
    }
  }

  if (pages.length === 0) {
    return {
      brand,
      pages: [],
      signal: {
        brand_id: brand.brand_id,
        official_domain: domain,
        unresolved: true,
        reason: 'crawl_no_pages',
      },
    }
  }

  const titles = [...new Set(pages.map((page) => cleanText(page.title)).filter(Boolean))].slice(0, 8)
  const descriptions = [...new Set(pages.map((page) => cleanText(page.description)).filter(Boolean))].slice(0, 8)
  const keywords = toKeywordTokens(
    pages.map((page) => `${page.title} ${page.h1} ${page.description} ${page.text_excerpt}`).join(' '),
  )
  const priceHints = [...new Set(pages.flatMap((page) => page.price_hints || []))].slice(0, 6)
  const landingPages = [...new Set(pages.map((page) => page.url))].slice(0, 12)

  return {
    brand,
    pages,
    signal: {
      brand_id: brand.brand_id,
      official_domain: domain,
      crawled_page_count: pages.length,
      unresolved: false,
      titles,
      descriptions,
      keywords,
      price_hints: priceHints,
      landing_pages: landingPages,
      updated_at: new Date().toISOString(),
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const maxBrands = toInteger(args['max-brands'], 500)
  const maxPagesPerBrand = toInteger(args['max-pages-per-brand'], 3)
  const maxAttemptsPerBrand = toInteger(args['max-attempts-per-brand'], 4)
  const concurrency = toInteger(args.concurrency, 8)
  const timeoutMs = toInteger(args['timeout-ms'], 9000)
  const tag = timestampTag()

  const brandsPath = cleanText(args['brands-file']) || path.join(CURATED_ROOT, 'brands.jsonl')
  const brands = (await readJsonl(path.resolve(process.cwd(), brandsPath))).slice(0, Math.max(1, maxBrands))

  const pageDir = path.join(CRAWL_PAGES_ROOT, tag)
  const signalDir = path.join(CRAWL_SIGNALS_ROOT, tag)
  await ensureDir(pageDir)
  await ensureDir(signalDir)

  const results = await asyncPool(concurrency, brands, (brand) =>
    crawlBrand(brand, {
      maxPagesPerBrand,
      maxAttemptsPerBrand,
      timeoutMs,
    }),
  )

  let unresolvedCount = 0
  let pageCount = 0
  for (const item of results) {
    if (item.signal.unresolved) unresolvedCount += 1
    pageCount += item.pages.length
    const pagePath = path.join(pageDir, `${item.brand.brand_id}.jsonl`)
    const signalPath = path.join(signalDir, `${item.brand.brand_id}.json`)
    await writeJsonl(pagePath, item.pages)
    await writeJson(signalPath, item.signal)
  }

  const latestMetaPath = path.join(CRAWL_SIGNALS_ROOT, 'latest-crawl-run.json')
  await writeJson(latestMetaPath, {
    generatedAt: new Date().toISOString(),
    tag,
    pageDir: path.relative(process.cwd(), pageDir),
    signalDir: path.relative(process.cwd(), signalDir),
    brandsProcessed: brands.length,
    unresolvedCount,
    pageCount,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        brandsProcessed: brands.length,
        unresolvedCount,
        pageCount,
        signalDir: path.relative(process.cwd(), signalDir),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[crawl-brand-pages] failed:', error?.message || error)
  process.exit(1)
})
