#!/usr/bin/env node
import path from 'node:path'
import {
  CURATED_ROOT,
  RAW_ROOT,
  parseArgs,
  toInteger,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl,
  cleanText,
  normalizeUrl,
  hashId,
  timestampTag,
} from './lib/common.js'

const CRAWL_SIGNALS_ROOT = path.join(RAW_ROOT, 'crawl-signals')

const CTA_BY_VERTICAL = {
  finance: 'Get Offer',
  travel_hospitality: 'Plan Trip',
  saas: 'Start Free Trial',
  developer_tools: 'Try Platform',
  default: 'View Details',
}

function pickCta(verticalL1) {
  const key = cleanText(verticalL1)
  if (!key) return CTA_BY_VERTICAL.default
  return CTA_BY_VERTICAL[key] || CTA_BY_VERTICAL.default
}

function safeArray(input) {
  return Array.isArray(input) ? input : []
}

function pickFirstNonEmpty(values = []) {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return ''
}

async function resolveSignalDir(args) {
  const explicit = cleanText(args['signal-dir'])
  if (explicit) return path.resolve(process.cwd(), explicit)
  const latestMetaPath = path.join(CRAWL_SIGNALS_ROOT, 'latest-crawl-run.json')
  const latestMeta = await readJson(latestMetaPath, null)
  if (latestMeta?.signalDir) return path.resolve(process.cwd(), latestMeta.signalDir)
  throw new Error('No crawl signal directory found. Run crawl-brand-pages first.')
}

async function loadBrandSignal(signalDir, brandId) {
  const filePath = path.join(signalDir, `${brandId}.json`)
  return readJson(filePath, {
    brand_id: brandId,
    unresolved: true,
    titles: [],
    descriptions: [],
    keywords: [],
    price_hints: [],
    landing_pages: [],
  })
}

function buildLinkCreative(brand, signal) {
  const landingPage = normalizeUrl(pickFirstNonEmpty([...safeArray(signal.landing_pages), `https://${brand.official_domain}`]))
  const title = pickFirstNonEmpty([
    ...safeArray(signal.titles),
    `${brand.brand_name} Official`,
  ])
  const description = pickFirstNonEmpty([
    ...safeArray(signal.descriptions),
    `${brand.brand_name} curated sponsored destination.`,
  ])
  return {
    creative_id: `link_${brand.brand_id}_${hashId(landingPage || brand.official_domain, 8)}`,
    brand_id: brand.brand_id,
    placement_key: 'attach.post_answer_render',
    title: title.slice(0, 80),
    description: description.slice(0, 180),
    target_url: landingPage || `https://${brand.official_domain}`,
    cta_text: pickCta(brand.vertical_l1),
    disclosure: 'Sponsored',
    language: 'en-US',
    status: 'active',
  }
}

function buildProductCreative(brand, signal, linkCreative) {
  const fallbackTitle = `${brand.brand_name} Featured Picks`
  const title = pickFirstNonEmpty([...safeArray(signal.titles).slice(1), safeArray(signal.titles)[0], fallbackTitle])
  const snippet = pickFirstNonEmpty([
    ...safeArray(signal.descriptions),
    `${brand.brand_name} recommended products and services.`,
  ])
  const tags = [
    brand.vertical_l1,
    brand.vertical_l2,
    ...safeArray(signal.keywords).slice(0, 10),
  ]
    .map((item) => cleanText(item).toLowerCase())
    .filter((item) => item.length >= 2)
  const dedupedTags = [...new Set(tags)].slice(0, 12)
  const targetUrl = normalizeUrl(
    pickFirstNonEmpty([...safeArray(signal.landing_pages), linkCreative.target_url, `https://${brand.official_domain}`]),
  )
  const itemId = `item_${brand.brand_id}_${hashId(targetUrl || brand.official_domain, 10)}`
  return {
    creative_id: `product_${brand.brand_id}_${hashId(itemId, 8)}`,
    brand_id: brand.brand_id,
    placement_key: 'next_step.intent_card',
    item_id: itemId,
    title: title.slice(0, 90),
    snippet: snippet.slice(0, 180),
    target_url: targetUrl || `https://${brand.official_domain}`,
    merchant_or_network: brand.brand_name,
    price_hint: pickFirstNonEmpty(safeArray(signal.price_hints)).slice(0, 20),
    match_tags: dedupedTags,
    disclosure: 'Sponsored',
    language: 'en-US',
    status: 'active',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const maxBrands = toInteger(args['max-brands'], 500)
  const tag = timestampTag()
  const brandsPath = cleanText(args['brands-file']) || path.join(CURATED_ROOT, 'brands.jsonl')
  const signalDir = await resolveSignalDir(args)
  const brands = (await readJsonl(path.resolve(process.cwd(), brandsPath))).slice(0, Math.max(1, maxBrands))

  const linkCreatives = []
  const productCreatives = []
  for (const brand of brands) {
    const signal = await loadBrandSignal(signalDir, brand.brand_id)
    const linkCreative = buildLinkCreative(brand, signal)
    const productCreative = buildProductCreative(brand, signal, linkCreative)
    linkCreatives.push(linkCreative)
    productCreatives.push(productCreative)
  }

  const linkPath = path.join(CURATED_ROOT, 'link-creatives.jsonl')
  const productPath = path.join(CURATED_ROOT, 'product-creatives.jsonl')
  const summaryPath = path.join(CURATED_ROOT, `creatives-${tag}.summary.json`)

  await writeJsonl(linkPath, linkCreatives)
  await writeJsonl(productPath, productCreatives)
  await writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    brands: brands.length,
    linkCreatives: linkCreatives.length,
    productCreatives: productCreatives.length,
    signalDir: path.relative(process.cwd(), signalDir),
    outputs: {
      link: path.relative(process.cwd(), linkPath),
      product: path.relative(process.cwd(), productPath),
    },
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        brands: brands.length,
        linkCreatives: linkCreatives.length,
        productCreatives: productCreatives.length,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[generate-creatives] failed:', error?.message || error)
  process.exit(1)
})
