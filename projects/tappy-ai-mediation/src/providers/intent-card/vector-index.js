const MAX_TAGS_PER_ITEM = 64
const MAX_FACETS = 12
const DEFAULT_TOP_K = 3
const MAX_TOP_K = 20
const MAX_TOKEN_MATCH_REASONS = 3
const MAX_FACET_MATCH_REASONS = 3
const TOKEN_STOPWORDS = new Set([
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
  'www',
  'http',
  'https',
  'com',
  'net',
  'org',
])

const FACET_KEY_SYNONYMS = {
  color: ['color', 'colour', 'tone', 'palette'],
  material: ['material', 'fabric', 'texture'],
  style: ['style', 'design', 'look'],
  brand: ['brand', 'maker'],
  price: ['price', 'budget', 'cost'],
  use_case: ['use_case', 'usage', 'scenario'],
  recipient: ['recipient', 'gift', 'audience'],
}

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function toFiniteNumber(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric === 'number' && Number.isFinite(numeric)) return numeric
  return fallback
}

function clampNumber(value, min, max, fallback) {
  const numeric = toFiniteNumber(value, fallback)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

function toTopK(value) {
  const numeric = toFiniteNumber(value, DEFAULT_TOP_K)
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TOP_K
  return Math.min(MAX_TOP_K, Math.floor(numeric))
}

function normalizeNetwork(value) {
  const text = cleanText(value).toLowerCase()
  if (text === 'partnerstack') return 'partnerstack'
  if (text === 'cj') return 'cj'
  return text
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

function normalizeCategory(value) {
  const text = cleanText(value).toLowerCase()
  if (!text) return 'general'
  const normalized = text.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'general'
}

function tokenizeText(value) {
  const text = cleanText(value).toLowerCase()
  if (!text) return []

  const latinTokens = text.match(/[a-z0-9]{2,}/g) || []
  const cjkTokens = text.match(/[\u4e00-\u9fff]{2,}/g) || []
  return [...latinTokens, ...cjkTokens].filter((token) => !TOKEN_STOPWORDS.has(token))
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

function addWeightedTokens(tokenWeights, tokens, weight) {
  for (const token of tokens) {
    const current = tokenWeights.get(token) || 0
    tokenWeights.set(token, current + weight)
  }
}

function toVectorNorm(tokenWeights) {
  let sum = 0
  for (const value of tokenWeights.values()) {
    sum += value * value
  }
  return Math.sqrt(sum)
}

function toTokenWeightMapFromCatalogItem(item) {
  const tokenWeights = new Map()

  addWeightedTokens(tokenWeights, tokenizeText(item.title), 4.0)
  addWeightedTokens(tokenWeights, tokenizeText(item.category), 2.5)
  addWeightedTokens(tokenWeights, tokenizeText(item.network), 1.5)
  addWeightedTokens(tokenWeights, item.tags.flatMap((tag) => tokenizeText(tag)), 2.0)
  addWeightedTokens(tokenWeights, tokenizeText(item.url), 0.8)

  return tokenWeights
}

function normalizeFacetInput(facets) {
  if (!Array.isArray(facets)) return []

  return facets
    .map((facet) => {
      if (!facet || typeof facet !== 'object') return null
      const facetKey = cleanText(String(facet.facet_key ?? facet.facetKey ?? '')).toLowerCase()
      const facetValue = cleanText(String(facet.facet_value ?? facet.facetValue ?? ''))
      if (!facetKey || !facetValue) return null

      const confidence = clampNumber(facet.confidence, 0, 1, 0.6)
      return {
        facetKey,
        facetValue,
        confidence,
      }
    })
    .filter(Boolean)
    .slice(0, MAX_FACETS)
}

function buildQueryTokenWeights(query, facets) {
  const tokenWeights = new Map()
  addWeightedTokens(tokenWeights, tokenizeText(query), 3.5)

  for (const facet of facets) {
    const baseWeight = 1.5 + facet.confidence * 2.0
    addWeightedTokens(tokenWeights, tokenizeText(facet.facetValue), baseWeight)

    const keySynonyms = FACET_KEY_SYNONYMS[facet.facetKey] || [facet.facetKey]
    addWeightedTokens(tokenWeights, uniqueTokens(keySynonyms), 0.6 + facet.confidence * 0.8)
  }

  return tokenWeights
}

export function normalizeIntentCardCatalogItems(catalog = []) {
  const input = Array.isArray(catalog) ? catalog : []
  const dedupe = new Map()

  for (const rawItem of input) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : null
    if (!item) continue

    const itemId = cleanText(item.item_id || item.itemId)
    const title = cleanText(item.title)
    const url = normalizeUrl(item.url || item.target_url || item.targetUrl)
    const network = normalizeNetwork(item.network)

    if (!itemId || !title || !url || !network) continue

    const category = normalizeCategory(item.category)
    const tags = uniqueTokens(
      Array.isArray(item.tags) ? item.tags.flatMap((tag) => tokenizeText(String(tag || ''))) : []
    ).slice(0, MAX_TAGS_PER_ITEM)

    const normalized = {
      item_id: itemId,
      title,
      url,
      network,
      category,
      tags,
    }

    if (!dedupe.has(itemId)) {
      dedupe.set(itemId, normalized)
      continue
    }

    const existing = dedupe.get(itemId)
    if ((normalized.tags.length || 0) > (existing.tags.length || 0)) {
      dedupe.set(itemId, normalized)
    }
  }

  return Array.from(dedupe.values())
}

export function createIntentCardVectorIndex(catalog = [], options = {}) {
  const items = normalizeIntentCardCatalogItems(catalog)
  const entries = []
  const vocabulary = new Set()

  for (const item of items) {
    const tokenWeights = toTokenWeightMapFromCatalogItem(item)
    const norm = toVectorNorm(tokenWeights)
    if (norm <= 0) continue

    for (const token of tokenWeights.keys()) {
      vocabulary.add(token)
    }

    entries.push({
      item,
      tokenWeights,
      norm,
    })
  }

  return {
    version: cleanText(options.version) || 'intent_card_vector_v1',
    createdAt: new Date().toISOString(),
    items,
    entries,
    vocabularySize: vocabulary.size,
  }
}

function computeCosineSimilarity(queryVector, queryNorm, entry) {
  if (!queryVector || queryNorm <= 0 || !entry || entry.norm <= 0) return 0

  let dot = 0
  for (const [token, weight] of queryVector.entries()) {
    const itemWeight = entry.tokenWeights.get(token)
    if (!itemWeight) continue
    dot += weight * itemWeight
  }

  if (dot <= 0) return 0
  return dot / (queryNorm * entry.norm)
}

function computeFacetBoost(entry, facets) {
  if (!entry || !Array.isArray(facets) || facets.length === 0) return 0

  let boost = 0
  const category = cleanText(entry.item?.category).toLowerCase()
  const tags = new Set((Array.isArray(entry.item?.tags) ? entry.item.tags : []).map((tag) => cleanText(tag).toLowerCase()))
  const titleTokens = new Set(tokenizeText(entry.item?.title))

  for (const facet of facets) {
    const valueTokens = tokenizeText(facet.facetValue)
    const matched = valueTokens.some((token) => tags.has(token) || titleTokens.has(token) || category.includes(token))
    if (matched) {
      boost += 0.04 + facet.confidence * 0.08
    }
  }

  return Math.min(0.25, boost)
}

function buildMatchReasons(entry, queryVector, facets) {
  const reasons = []
  const weightedMatches = []

  for (const [token, weight] of queryVector.entries()) {
    if (!entry.tokenWeights.has(token)) continue
    weightedMatches.push({
      token,
      score: weight * entry.tokenWeights.get(token),
    })
  }

  weightedMatches.sort((a, b) => b.score - a.score)
  for (const item of weightedMatches.slice(0, MAX_TOKEN_MATCH_REASONS)) {
    reasons.push(`token=${item.token}`)
  }

  const tags = new Set((Array.isArray(entry.item?.tags) ? entry.item.tags : []).map((tag) => cleanText(tag).toLowerCase()))
  const titleTokens = new Set(tokenizeText(entry.item?.title))
  for (const facet of facets) {
    const valueTokens = tokenizeText(facet.facetValue)
    const matched = valueTokens.some((token) => tags.has(token) || titleTokens.has(token))
    if (!matched) continue
    reasons.push(`facet:${facet.facetKey}=${facet.facetValue}`)
    if (reasons.length >= MAX_TOKEN_MATCH_REASONS + MAX_FACET_MATCH_REASONS) break
  }

  return reasons.length > 0 ? reasons : ['semantic_match']
}

export function retrieveIntentCardTopK(index, input = {}) {
  const query = cleanText(input.query)
  const facets = normalizeFacetInput(input.facets)
  const topK = toTopK(input.topK)
  const minScore = clampNumber(input.minScore, 0, 1, 0)

  const queryVector = buildQueryTokenWeights(query, facets)
  const queryNorm = toVectorNorm(queryVector)
  if (queryNorm <= 0) {
    return {
      items: [],
      meta: {
        query,
        facets,
        topK,
        minScore,
        candidateCount: Array.isArray(index?.entries) ? index.entries.length : 0,
        indexVersion: cleanText(index?.version) || 'intent_card_vector_v1',
      },
    }
  }

  const scored = []
  for (const entry of Array.isArray(index?.entries) ? index.entries : []) {
    const baseScore = computeCosineSimilarity(queryVector, queryNorm, entry)
    if (baseScore <= 0) continue

    const boost = computeFacetBoost(entry, facets)
    const finalScore = Math.max(0, Math.min(1, baseScore + boost))
    if (finalScore < minScore) continue

    scored.push({
      item: entry.item,
      score: finalScore,
      match_reasons: buildMatchReasons(entry, queryVector, facets),
    })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.item.item_id.localeCompare(b.item.item_id)
  })

  const top = scored.slice(0, topK)
  return {
    items: top.map((item) => ({
      item_id: item.item.item_id,
      title: item.item.title,
      url: item.item.url,
      network: item.item.network,
      category: item.item.category,
      tags: item.item.tags,
      score: Number(item.score.toFixed(6)),
      match_reasons: item.match_reasons,
    })),
    meta: {
      query,
      facets,
      topK,
      minScore,
      candidateCount: scored.length,
      indexVersion: cleanText(index?.version) || 'intent_card_vector_v1',
    },
  }
}
