#!/usr/bin/env node
import path from 'node:path'
import {
  parseArgs,
  toInteger,
  cleanText,
  normalizeUrl,
  readJsonl,
  writeJson,
  writeJsonl,
  ensureDir,
  hashId,
  timestampTag,
} from './lib/common.js'

const OFFERS_ROOT = path.resolve(process.cwd(), 'data/house-ads/offers')
const OFFERS_CURATED_DIR = path.join(OFFERS_ROOT, 'curated')

const LINK_PLACEMENT_KEY = 'attach.post_answer_render'
const PRODUCT_PLACEMENT_KEY = 'next_step.intent_card'

function normalizeLanguage(value = '') {
  const text = cleanText(value || '').toLowerCase()
  if (!text) return 'en-US'
  if (text === 'en') return 'en-US'
  return text
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function safeUrl(value) {
  const url = normalizeUrl(value || '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) return ''
  return url
}

function toPriceHint(offer) {
  const price = toNumber(offer.price, NaN)
  const currency = cleanText(offer.currency || '').toUpperCase()
  if (!Number.isFinite(price) || price <= 0) return ''
  if (/^[A-Z]{3}$/.test(currency)) return `${currency} ${price.toFixed(2)}`
  return `USD ${price.toFixed(2)}`
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) return []
  const out = []
  const seen = new Set()
  for (const raw of tags) {
    const text = cleanText(raw).toLowerCase()
    if (!text) continue
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text.slice(0, 40))
  }
  return out
}

function linkCreativeFromOffer(offer, index) {
  const targetUrl = safeUrl(offer.target_url)
  if (!targetUrl) return null
  const title = cleanText(offer.title).slice(0, 80)
  const description = cleanText(offer.description).slice(0, 180)
  const ctaText = cleanText(offer.cta_text || 'View Offer').slice(0, 40)
  if (!title || !description || !ctaText) return null

  const creativeId = `link_${cleanText(offer.offer_id) || hashId(`link|${targetUrl}|${index}`, 12)}`
  return {
    creative_id: creativeId,
    offer_id: cleanText(offer.offer_id),
    campaign_id: cleanText(offer.campaign_id),
    brand_id: cleanText(offer.brand_id),
    placement_key: LINK_PLACEMENT_KEY,
    title,
    description,
    target_url: targetUrl,
    cta_text: ctaText,
    disclosure: cleanText(offer.disclosure || 'Sponsored').slice(0, 120),
    language: normalizeLanguage(offer.language),
    status: 'active',
    source_type: cleanText(offer.source_type),
    confidence_score: toNumber(offer.confidence_score, 0),
    market: cleanText(offer.market),
    vertical_l1: cleanText(offer.vertical_l1),
    vertical_l2: cleanText(offer.vertical_l2),
    tags: normalizeTags(offer.tags),
  }
}

function productCreativeFromOffer(offer, index) {
  const targetUrl = safeUrl(offer.target_url)
  if (!targetUrl) return null
  const title = cleanText(offer.title).slice(0, 90)
  const snippet = cleanText(offer.snippet || offer.description).slice(0, 180)
  const itemId = cleanText(offer.product_id || '')
  if (!title || !snippet || !itemId) return null

  const creativeId = `product_${cleanText(offer.offer_id) || hashId(`product|${targetUrl}|${index}`, 12)}`
  return {
    creative_id: creativeId,
    offer_id: cleanText(offer.offer_id),
    campaign_id: cleanText(offer.campaign_id),
    brand_id: cleanText(offer.brand_id),
    placement_key: PRODUCT_PLACEMENT_KEY,
    item_id: itemId,
    title,
    snippet,
    target_url: targetUrl,
    merchant_or_network: cleanText(offer.merchant || offer.brand_id),
    price_hint: toPriceHint(offer),
    price: toNumber(offer.price, 0),
    original_price: toNumber(offer.original_price, 0),
    currency: cleanText(offer.currency || 'USD').toUpperCase(),
    discount_pct: toNumber(offer.discount_pct, 0),
    availability: cleanText(offer.availability || 'unknown'),
    match_tags: normalizeTags(offer.tags),
    disclosure: cleanText(offer.disclosure || 'Sponsored').slice(0, 120),
    language: normalizeLanguage(offer.language),
    status: 'active',
    source_type: cleanText(offer.source_type),
    confidence_score: toNumber(offer.confidence_score, 0),
    market: cleanText(offer.market),
    vertical_l1: cleanText(offer.vertical_l1),
    vertical_l2: cleanText(offer.vertical_l2),
  }
}

function validateLinkCreative(row) {
  const required = ['creative_id', 'offer_id', 'campaign_id', 'brand_id', 'placement_key', 'title', 'description', 'target_url', 'cta_text', 'disclosure', 'language', 'status']
  const reasons = []
  for (const field of required) {
    if (!(field in row) || !cleanText(row[field])) reasons.push(`missing_${field}`)
  }
  if (row.placement_key !== LINK_PLACEMENT_KEY) reasons.push('invalid_placement_key')
  if (!/^https?:\/\//i.test(String(row.target_url || ''))) reasons.push('invalid_target_url')
  return reasons
}

function validateProductCreative(row) {
  const required = ['creative_id', 'offer_id', 'campaign_id', 'brand_id', 'placement_key', 'item_id', 'title', 'snippet', 'target_url', 'merchant_or_network', 'match_tags', 'disclosure', 'language', 'status']
  const reasons = []
  for (const field of required) {
    if (!(field in row)) reasons.push(`missing_${field}`)
    else if (typeof row[field] === 'string' && !cleanText(row[field])) reasons.push(`empty_${field}`)
  }
  if (row.placement_key !== PRODUCT_PLACEMENT_KEY) reasons.push('invalid_placement_key')
  if (!/^https?:\/\//i.test(String(row.target_url || ''))) reasons.push('invalid_target_url')
  if (!Array.isArray(row.match_tags) || row.match_tags.length === 0) reasons.push('invalid_match_tags')
  return reasons
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const maxOffers = toInteger(args['max-offers'], 0)
  const tag = timestampTag()
  const inputFile = path.resolve(
    process.cwd(),
    cleanText(args['offers-file']) || path.join(OFFERS_CURATED_DIR, 'offers.jsonl'),
  )

  const offers = await readJsonl(inputFile)
  const scoped = maxOffers > 0 ? offers.slice(0, Math.max(1, maxOffers)) : offers
  const active = scoped.filter((row) => cleanText(row.status) === 'active')

  const linkRows = []
  const productRows = []
  const dropped = []

  let idx = 0
  for (const offer of active) {
    idx += 1
    const type = cleanText(offer.offer_type).toLowerCase()
    if (type === 'link') {
      const row = linkCreativeFromOffer(offer, idx)
      if (!row) {
        dropped.push({ offer_id: cleanText(offer.offer_id), offer_type: type, reason: 'normalize_failed' })
        continue
      }
      const reasons = validateLinkCreative(row)
      if (reasons.length > 0) {
        dropped.push({ offer_id: cleanText(offer.offer_id), offer_type: type, reason: reasons.join('|') })
        continue
      }
      linkRows.push(row)
    } else if (type === 'product') {
      const row = productCreativeFromOffer(offer, idx)
      if (!row) {
        dropped.push({ offer_id: cleanText(offer.offer_id), offer_type: type, reason: 'normalize_failed' })
        continue
      }
      const reasons = validateProductCreative(row)
      if (reasons.length > 0) {
        dropped.push({ offer_id: cleanText(offer.offer_id), offer_type: type, reason: reasons.join('|') })
        continue
      }
      productRows.push(row)
    } else {
      dropped.push({ offer_id: cleanText(offer.offer_id), offer_type: type || 'unknown', reason: 'unsupported_offer_type' })
    }
  }

  const linkPath = path.join(OFFERS_CURATED_DIR, 'link-offers.jsonl')
  const productPath = path.join(OFFERS_CURATED_DIR, 'product-offers.jsonl')
  const summaryPath = path.join(OFFERS_CURATED_DIR, `offer-publish-summary-${tag}.json`)
  const latestSummaryPath = path.join(OFFERS_CURATED_DIR, 'offer-publish-summary-latest.json')
  const latestMetaPath = path.join(OFFERS_CURATED_DIR, 'latest-published-offers.json')

  const summary = {
    generatedAt: new Date().toISOString(),
    inputFile: path.relative(process.cwd(), inputFile),
    inputOffers: scoped.length,
    activeOffers: active.length,
    output: {
      link_offers: path.relative(process.cwd(), linkPath),
      product_offers: path.relative(process.cwd(), productPath),
    },
    counts: {
      link_offers: linkRows.length,
      product_offers: productRows.length,
      dropped: dropped.length,
    },
    dropped_sample: dropped.slice(0, 50),
  }

  await ensureDir(OFFERS_CURATED_DIR)
  await writeJsonl(linkPath, linkRows)
  await writeJsonl(productPath, productRows)
  await writeJson(summaryPath, summary)
  await writeJson(latestSummaryPath, summary)
  await writeJson(latestMetaPath, {
    generatedAt: new Date().toISOString(),
    linkOffers: path.relative(process.cwd(), linkPath),
    productOffers: path.relative(process.cwd(), productPath),
    latestSummary: path.relative(process.cwd(), summaryPath),
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputOffers: scoped.length,
        linkOffers: linkRows.length,
        productOffers: productRows.length,
        dropped: dropped.length,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[publish-offer-creatives] failed:', error?.message || error)
  process.exit(1)
})
