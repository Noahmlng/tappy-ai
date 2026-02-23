import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeUnifiedOffers } from '../../offers/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const DEFAULT_CURATED_DIR = path.join(PROJECT_ROOT, 'data', 'house-ads', 'offers', 'curated')
const DEFAULT_PRODUCT_CATALOG_PATH = path.join(DEFAULT_CURATED_DIR, 'product-offers.jsonl')
const DEFAULT_LATEST_META_PATH = path.join(DEFAULT_CURATED_DIR, 'latest-published-offers.json')
const DEFAULT_LIMIT = 120
const MAX_LIMIT = 500
const ACTIVE_STATUSES = new Set(['active', 'available', 'in_stock', 'limited', 'preorder', 'unknown'])
const KEYWORD_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'best',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'our',
  'the',
  'this',
  'to',
  'we',
  'with',
  'you',
  'your'
])

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeLocale(value) {
  return cleanText(value).toLowerCase().replace(/_/g, '-')
}

function normalizeMarket(value) {
  return cleanText(value).toUpperCase()
}

function toBoundedLimit(value, fallback = DEFAULT_LIMIT) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(numeric)))
}

function tokenizeKeywords(value = '') {
  const text = cleanText(value).toLowerCase()
  if (!text) return []

  const tokens = text
    .split(/[^a-z0-9\u4e00-\u9fff]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .filter((item) => !KEYWORD_STOPWORDS.has(item))

  return [...new Set(tokens)]
}

function compareCatalogEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score
  if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore
  if (b.discountScore !== a.discountScore) return b.discountScore - a.discountScore
  return 0
}

function computeKeywordScore(corpus = '', keywordTokens = []) {
  if (!corpus || keywordTokens.length === 0) return 0
  let score = 0
  for (const token of keywordTokens) {
    if (corpus.includes(token)) {
      score += token.length
    }
  }
  return score
}

function normalizeStatus(status, availability) {
  const normalizedStatus = cleanText(status).toLowerCase()
  const normalizedAvailability = cleanText(availability).toLowerCase()

  if (ACTIVE_STATUSES.has(normalizedStatus)) return normalizedStatus
  if (ACTIVE_STATUSES.has(normalizedAvailability)) return normalizedAvailability
  if (!normalizedStatus && !normalizedAvailability) return 'active'
  return normalizedStatus || normalizedAvailability
}

function toNumber(value, fallback = 0) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric === 'number' && Number.isFinite(numeric)) return numeric
  return fallback
}

function parseJsonl(content = '') {
  const rows = []
  let parseErrorCount = 0
  const lines = String(content || '').split('\n')
  for (const line of lines) {
    const text = line.trim()
    if (!text) continue
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rows.push(parsed)
      }
    } catch {
      parseErrorCount += 1
    }
  }
  return { rows, parseErrorCount }
}

function createCatalogEntry(row) {
  const item = row && typeof row === 'object' ? row : null
  if (!item) return null

  const placementKey = cleanText(item.placement_key || item.placementKey)
  if (placementKey && placementKey !== 'next_step.intent_card') return null

  const title = cleanText(item.title)
  const description = cleanText(item.snippet || item.description)
  const targetUrl = cleanText(item.target_url || item.targetUrl)
  if (!title || !targetUrl) return null

  const status = normalizeStatus(item.status, item.availability)
  if (status && !ACTIVE_STATUSES.has(status)) return null

  const itemId = cleanText(item.item_id || item.itemId)
  const offerId = cleanText(item.offer_id || item.offerId) || itemId
  const sourceId = itemId || offerId || cleanText(item.creative_id)
  if (!sourceId) return null

  const matchTags = Array.isArray(item.match_tags) ? item.match_tags.map((tag) => cleanText(String(tag || ''))) : []
  const verticalL1 = cleanText(item.vertical_l1)
  const verticalL2 = cleanText(item.vertical_l2)
  const qualityScore = toNumber(item.confidence_score, 0)
  const discountScore = toNumber(item.discount_pct, 0)

  const corpus = [
    title,
    description,
    cleanText(item.merchant_or_network),
    targetUrl,
    verticalL1,
    verticalL2,
    ...matchTags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return {
    locale: normalizeLocale(item.language),
    market: normalizeMarket(item.market),
    qualityScore,
    discountScore,
    corpus,
    offer: {
      sourceNetwork: 'house',
      sourceType: 'product',
      sourceId,
      offerId: `house:product:${sourceId}`,
      title,
      description,
      targetUrl,
      trackingUrl: targetUrl,
      merchantName: cleanText(item.merchant_or_network),
      productName: title,
      entityText: cleanText(item.merchant_or_network) || title,
      entityType: 'product',
      locale: cleanText(item.language),
      market: cleanText(item.market),
      currency: cleanText(item.currency),
      availability: status || 'active',
      qualityScore,
      bidValue: discountScore,
      metadata: {
        intentCardItemId: itemId,
        campaignId: cleanText(item.campaign_id),
        creativeId: cleanText(item.creative_id),
        brandId: cleanText(item.brand_id),
        category: verticalL2 || verticalL1,
        verticalL1,
        verticalL2,
        matchTags,
        sourceType: cleanText(item.source_type),
        placementKey: placementKey || 'next_step.intent_card',
        disclosure: cleanText(item.disclosure),
      },
      raw: item,
    },
  }
}

async function resolveCatalogPath(options = {}) {
  const explicitPath = cleanText(options.productCatalogPath)
  if (explicitPath) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(PROJECT_ROOT, explicitPath)
  }

  const latestMetaPath = cleanText(options.latestMetaPath) || DEFAULT_LATEST_META_PATH
  try {
    const content = await fs.readFile(latestMetaPath, 'utf8')
    const payload = JSON.parse(content)
    const productOffersPath = cleanText(payload?.productOffers || payload?.product_offers)
    if (productOffersPath) {
      return path.isAbsolute(productOffersPath)
        ? productOffersPath
        : path.resolve(PROJECT_ROOT, productOffersPath)
    }
  } catch {
    // Use default path when latest metadata cannot be read.
  }

  return DEFAULT_PRODUCT_CATALOG_PATH
}

export function createHouseConnector(options = {}) {
  let catalogState = {
    catalogPath: '',
    mtimeMs: -1,
    parseErrorCount: 0,
    entries: [],
  }
  const catalogPathPromise = resolveCatalogPath(options)

  async function loadCatalogEntries() {
    const catalogPath = await catalogPathPromise
    const stats = await fs.stat(catalogPath)
    if (catalogState.catalogPath === catalogPath && catalogState.mtimeMs === stats.mtimeMs) {
      return {
        catalogPath,
        entries: catalogState.entries,
        parseErrorCount: catalogState.parseErrorCount,
        cacheHit: true,
      }
    }

    const content = await fs.readFile(catalogPath, 'utf8')
    const { rows, parseErrorCount } = parseJsonl(content)
    const entries = rows.map(createCatalogEntry).filter(Boolean)

    catalogState = {
      catalogPath,
      mtimeMs: stats.mtimeMs,
      parseErrorCount,
      entries,
    }

    return {
      catalogPath,
      entries,
      parseErrorCount,
      cacheHit: false,
    }
  }

  async function fetchProductOffersCatalog(params = {}) {
    const { catalogPath, entries, parseErrorCount, cacheHit } = await loadCatalogEntries()
    const limit = toBoundedLimit(params.limit, DEFAULT_LIMIT)
    const keywordTokens = tokenizeKeywords(params.keywords || params.search || params.query)
    const locale = normalizeLocale(params.locale)
    const localePrefix = locale ? locale.split('-')[0] : ''
    const market = normalizeMarket(params.market)

    const localeFiltered = entries.filter((entry) => {
      if (!locale) return true
      if (!entry.locale) return true
      if (entry.locale === locale) return true
      return localePrefix ? entry.locale.startsWith(`${localePrefix}-`) || entry.locale === localePrefix : false
    })
    const marketFiltered = localeFiltered.filter((entry) => {
      if (!market) return true
      if (!entry.market) return true
      return entry.market === market
    })

    const scored = marketFiltered.map((entry) => ({
      ...entry,
      score: computeKeywordScore(entry.corpus, keywordTokens),
    }))

    const matched = keywordTokens.length > 0 ? scored.filter((entry) => entry.score > 0) : scored
    const selectedSource = (matched.length > 0 ? matched : scored).sort(compareCatalogEntries).slice(0, limit)
    const offers = normalizeUnifiedOffers(selectedSource.map((entry) => entry.offer))

    return {
      offers,
      debug: {
        mode: 'house_product_offers_catalog',
        catalogPath: path.relative(PROJECT_ROOT, catalogPath),
        catalogEntries: entries.length,
        localeFilteredEntries: localeFiltered.length,
        marketFilteredEntries: marketFiltered.length,
        keywordTokenCount: keywordTokens.length,
        keywordMatchedEntries: matched.length,
        selectedEntries: offers.length,
        parseErrorCount,
        cacheHit,
      },
    }
  }

  async function healthCheck() {
    try {
      const { entries } = await loadCatalogEntries()
      if (entries.length === 0) {
        return {
          ok: false,
          network: 'house',
          errorCode: 'EMPTY_CATALOG',
          message: '[house] product offers catalog is empty',
        }
      }

      return {
        ok: true,
        network: 'house',
        errorCode: '',
        message: '',
      }
    } catch (error) {
      return {
        ok: false,
        network: 'house',
        errorCode: 'CATALOG_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'catalog_unavailable',
      }
    }
  }

  return {
    fetchOffers: fetchProductOffersCatalog,
    fetchProductOffersCatalog,
    healthCheck,
  }
}
