import { createHash } from 'node:crypto'

const MAX_TAGS_PER_ITEM = 24
const TEXT_TAG_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'be',
  'best',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
])
const URL_TOKEN_STOPWORDS = new Set([
  'com',
  'net',
  'org',
  'www',
  'http',
  'https',
  'html',
  'htm',
  'php',
  'asp',
])
const CATEGORY_RULES = [
  {
    category: 'fashion',
    keywords: ['fashion', 'apparel', 'clothing', 'dress', 'bag', 'shoe', 'jewelry', 'jewellery'],
  },
  {
    category: 'beauty',
    keywords: ['beauty', 'cosmetic', 'makeup', 'skincare', 'fragrance'],
  },
  {
    category: 'electronics',
    keywords: ['electronic', 'phone', 'mobile', 'laptop', 'tablet', 'camera', 'headphone'],
  },
  {
    category: 'home',
    keywords: ['home', 'furniture', 'decor', 'kitchen', 'bedding', 'appliance'],
  },
  {
    category: 'travel',
    keywords: ['travel', 'flight', 'hotel', 'trip', 'vacation', 'tour'],
  },
  {
    category: 'software',
    keywords: ['software', 'saas', 'cloud', 'ai', 'productivity', 'developer', 'tool'],
  },
]

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const text = cleanText(value)
      if (text) return text
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ''
}

function normalizeUrl(value) {
  const text = cleanText(value)
  if (!text) return ''

  try {
    const url = new URL(text)
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function normalizeNetwork(value) {
  const text = cleanText(value).toLowerCase()
  if (text === 'partnerstack') return 'partnerstack'
  if (text === 'cj') return 'cj'
  return text
}

function normalizeCategory(value) {
  const text = cleanText(value).toLowerCase()
  if (!text) return ''
  const normalized = text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized
}

function tokenizeText(value) {
  const text = cleanText(value).toLowerCase()
  if (!text) return []

  const latin = text.match(/[a-z0-9]{2,}/g) || []
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) || []

  return [...latin, ...cjk].filter((token) => !TEXT_TAG_STOPWORDS.has(token))
}

function tokenizeUrl(value) {
  const text = cleanText(value)
  if (!text) return []

  try {
    const url = new URL(text)
    const hostnameTokens = url.hostname
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(Boolean)
      .filter((token) => !URL_TOKEN_STOPWORDS.has(token))
    const pathTokens = decodeURIComponent(url.pathname || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/g)
      .filter((token) => token.length >= 2)
      .filter((token) => !URL_TOKEN_STOPWORDS.has(token))

    return [...hostnameTokens, ...pathTokens]
  } catch {
    return []
  }
}

function uniqueTokens(values = []) {
  const seen = new Set()
  const output = []

  for (const value of values) {
    const token = cleanText(String(value || '')).toLowerCase()
    if (!token) continue
    if (seen.has(token)) continue
    seen.add(token)
    output.push(token)
  }

  return output
}

function inferCategoryFromText(value) {
  const text = cleanText(value).toLowerCase()
  if (!text) return ''

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.category
    }
  }

  return ''
}

function deriveCategory(offer) {
  const candidate = normalizeCategory(
    pickFirst(
      offer?.category,
      offer?.metadata?.category,
      offer?.metadata?.vertical,
      offer?.raw?.category,
      offer?.raw?.['category-name'],
      offer?.raw?.['product-category'],
      offer?.raw?.vertical,
    ),
  )
  if (candidate) return candidate

  const inferred = inferCategoryFromText(
    [offer?.title, offer?.description, offer?.entityText, offer?.merchantName, offer?.productName]
      .map((item) => cleanText(item))
      .filter(Boolean)
      .join(' '),
  )
  if (inferred) return inferred

  if (cleanText(offer?.sourceType).toLowerCase() === 'product') {
    return 'product'
  }

  return 'general'
}

function buildTags(offer, category, url) {
  const baseTokens = [
    ...tokenizeText(offer?.title),
    ...tokenizeText(offer?.description),
    ...tokenizeText(offer?.entityText),
    ...tokenizeText(offer?.merchantName),
    ...tokenizeText(offer?.productName),
    ...tokenizeText(offer?.market),
    ...tokenizeText(offer?.currency),
    ...tokenizeText(offer?.sourceType),
    ...tokenizeText(offer?.entityType),
    ...tokenizeText(category),
    ...tokenizeUrl(url),
  ]

  return uniqueTokens(baseTokens).slice(0, MAX_TAGS_PER_ITEM)
}

function buildItemId(offer, network, url, title) {
  const explicit = pickFirst(offer?.metadata?.intentCardItemId, offer?.offerId)
  if (explicit) return explicit

  const digest = createHash('sha1')
    .update([network, url, title].join('|'))
    .digest('hex')
    .slice(0, 16)

  return `${network || 'affiliate'}:${digest}`
}

function normalizeIntentCardCatalogItem(offer) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) return null

  const title = pickFirst(offer.title, offer.productName, offer.entityText, offer.merchantName)
  const url = normalizeUrl(pickFirst(offer.canonicalTargetUrl, offer.targetUrl, offer.url))
  const network = normalizeNetwork(pickFirst(offer.sourceNetwork, offer.network))
  if (!title || !url || !network) return null

  const category = deriveCategory(offer)
  const tags = buildTags(offer, category, url)
  const sourceOfferId = pickFirst(offer.offerId)

  return {
    item_id: buildItemId(offer, network, url, title),
    title,
    url,
    network,
    category,
    tags,
    source_offer_id: sourceOfferId || '',
  }
}

function pickPreferredItem(current, candidate) {
  if (!current) return candidate
  const currentTagCount = Array.isArray(current.tags) ? current.tags.length : 0
  const candidateTagCount = Array.isArray(candidate.tags) ? candidate.tags.length : 0

  if (candidateTagCount !== currentTagCount) {
    return candidateTagCount > currentTagCount ? candidate : current
  }
  if (candidate.title.length !== current.title.length) {
    return candidate.title.length > current.title.length ? candidate : current
  }
  return current
}

export function normalizeIntentCardCatalog(offers = []) {
  const input = Array.isArray(offers) ? offers : []
  const deduped = new Map()

  for (const offer of input) {
    const normalized = normalizeIntentCardCatalogItem(offer)
    if (!normalized) continue
    const key = normalized.item_id
    deduped.set(key, pickPreferredItem(deduped.get(key), normalized))
  }

  return Array.from(deduped.values())
}

function mapCatalogBySource(catalog = []) {
  const bySourceOfferId = new Map()
  const byUrl = new Map()

  for (const item of catalog) {
    if (!item || typeof item !== 'object') continue

    const sourceOfferId = cleanText(item.source_offer_id)
    if (sourceOfferId && !bySourceOfferId.has(sourceOfferId)) {
      bySourceOfferId.set(sourceOfferId, item)
    }

    const url = cleanText(item.url)
    if (url && !byUrl.has(url)) {
      byUrl.set(url, item)
    }
  }

  return { bySourceOfferId, byUrl }
}

function resolveCatalogItem(offer, lookup) {
  const offerId = cleanText(offer?.offerId)
  if (offerId && lookup.bySourceOfferId.has(offerId)) {
    return lookup.bySourceOfferId.get(offerId)
  }

  const canonicalTargetUrl = cleanText(offer?.canonicalTargetUrl)
  if (canonicalTargetUrl && lookup.byUrl.has(canonicalTargetUrl)) {
    return lookup.byUrl.get(canonicalTargetUrl)
  }

  const targetUrl = cleanText(offer?.targetUrl)
  if (targetUrl && lookup.byUrl.has(targetUrl)) {
    return lookup.byUrl.get(targetUrl)
  }

  return null
}

export function enrichOffersWithIntentCardCatalog(offers = [], catalog = []) {
  const input = Array.isArray(offers) ? offers : []
  const lookup = mapCatalogBySource(catalog)

  return input.map((offer) => {
    if (!offer || typeof offer !== 'object') return offer
    const catalogItem = resolveCatalogItem(offer, lookup)
    if (!catalogItem) return offer

    const metadata =
      offer.metadata && typeof offer.metadata === 'object' && !Array.isArray(offer.metadata)
        ? offer.metadata
        : {}

    return {
      ...offer,
      metadata: {
        ...metadata,
        intentCardCatalog: {
          item_id: catalogItem.item_id,
          title: catalogItem.title,
          url: catalogItem.url,
          network: catalogItem.network,
          category: catalogItem.category,
          tags: Array.isArray(catalogItem.tags) ? [...catalogItem.tags] : [],
        },
      },
    }
  })
}

export function summarizeIntentCardCatalog(catalog = []) {
  const input = Array.isArray(catalog) ? catalog : []
  const categoryCounts = {}
  const tagSet = new Set()

  for (const item of input) {
    const category = cleanText(item?.category) || 'general'
    categoryCounts[category] = (categoryCounts[category] || 0) + 1

    const tags = Array.isArray(item?.tags) ? item.tags : []
    for (const tag of tags) {
      const normalizedTag = cleanText(String(tag || '')).toLowerCase()
      if (normalizedTag) tagSet.add(normalizedTag)
    }
  }

  return {
    itemCount: input.length,
    categoryCounts,
    tagVocabularySize: tagSet.size,
  }
}
