import { buildQueryEmbedding, vectorToSqlLiteral } from './embedding.js'
import { normalizeUnifiedOffers } from '../offers/index.js'

const DEFAULT_LEXICAL_TOP_K = 30
const DEFAULT_VECTOR_TOP_K = 30
const DEFAULT_FINAL_TOP_K = 24
const DEFAULT_RRF_K = 60

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function toPositiveInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function normalizeNetworkFilters(value = []) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((item) => cleanText(item).toLowerCase())
    .filter((item) => item === 'partnerstack' || item === 'cj' || item === 'house')))
}

function normalizeFilters(filters = {}) {
  const input = filters && typeof filters === 'object' ? filters : {}
  return {
    networks: normalizeNetworkFilters(input.networks),
    market: cleanText(input.market).toUpperCase(),
    language: cleanText(input.language),
  }
}

function createQueryTextExpression(alias = 'n') {
  return `to_tsvector('simple', coalesce(${alias}.title, '') || ' ' || coalesce(${alias}.description, '') || ' ' || coalesce(array_to_string(${alias}.tags, ' '), ''))`
}

function tokenize(value = '') {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/g)
    .filter((item) => item.length >= 2)
}

function overlapScore(queryTokens = [], candidateTokens = []) {
  if (!Array.isArray(queryTokens) || queryTokens.length === 0) return 0
  if (!Array.isArray(candidateTokens) || candidateTokens.length === 0) return 0
  const querySet = new Set(queryTokens)
  const candidateSet = new Set(candidateTokens)
  let hit = 0
  for (const token of querySet) {
    if (candidateSet.has(token)) hit += 1
  }
  return hit / querySet.size
}

function normalizeQuality(value) {
  const n = toFiniteNumber(value, 0)
  if (n <= 0) return 0
  if (n <= 1) return Math.min(1, n)
  return Math.min(1, n / 100)
}

function toFallbackCandidate(offer = {}, query = '') {
  const metadata = offer?.metadata && typeof offer.metadata === 'object' ? offer.metadata : {}
  const tags = Array.isArray(metadata.matchTags)
    ? metadata.matchTags
    : (Array.isArray(metadata.tags) ? metadata.tags : [])
  const title = cleanText(offer.title)
  const description = cleanText(offer.description)
  const corpus = `${title} ${description} ${tags.join(' ')}`
  const queryTokens = tokenize(query)
  const candidateTokens = tokenize(corpus)
  const lexicalScore = overlapScore(queryTokens, candidateTokens)
  const quality = normalizeQuality(offer.qualityScore)
  const bidHint = Math.max(0, toFiniteNumber(offer.bidValue, 0))
  const bidBoost = bidHint > 0 ? Math.min(0.2, bidHint / 100) : 0
  const vectorScore = Math.min(1, lexicalScore * 0.8 + quality * 0.2)
  const fusedScore = Math.min(1, lexicalScore * 0.55 + vectorScore * 0.35 + bidBoost * 0.1)

  return {
    offerId: cleanText(offer.offerId),
    network: cleanText(offer.sourceNetwork || metadata.sourceNetwork || ''),
    upstreamOfferId: cleanText(offer.sourceId),
    title,
    description,
    targetUrl: cleanText(offer.targetUrl || offer.trackingUrl),
    market: cleanText(offer.market || 'US'),
    language: cleanText(offer.locale || 'en-US'),
    availability: cleanText(offer.availability || 'active') || 'active',
    quality: toFiniteNumber(offer.qualityScore, 0),
    bidHint,
    policyWeight: toFiniteNumber(metadata.policyWeight, 0),
    freshnessAt: cleanText(offer.updatedAt),
    tags,
    metadata,
    updatedAt: cleanText(offer.updatedAt),
    lexicalScore: toFiniteNumber(lexicalScore, 0),
    vectorScore: toFiniteNumber(vectorScore, 0),
    fusedScore: toFiniteNumber(fusedScore, 0),
  }
}

function createFallbackCandidatesFromOffers(offers = [], input = {}) {
  const normalized = normalizeUnifiedOffers(offers)
  const query = cleanText(input.query)
  const filters = normalizeFilters(input.filters)

  const candidates = normalized
    .map((offer) => toFallbackCandidate(offer, query))
    .filter((item) => item.offerId && item.title && item.targetUrl)
    .filter((item) => cleanText(item.availability || 'active').toLowerCase() === 'active')
    .filter((item) => {
      if (filters.networks.length > 0 && !filters.networks.includes(cleanText(item.network).toLowerCase())) return false
      if (filters.market && cleanText(item.market).toUpperCase() !== filters.market) return false
      if (filters.language && cleanText(item.language).toLowerCase() !== filters.language.toLowerCase()) return false
      return true
    })
    .sort((a, b) => {
      if (b.fusedScore !== a.fusedScore) return b.fusedScore - a.fusedScore
      if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore
      if (b.bidHint !== a.bidHint) return b.bidHint - a.bidHint
      return a.offerId.localeCompare(b.offerId)
    })
    .map((candidate, index) => ({
      ...candidate,
      lexicalRank: index + 1,
      vectorRank: index + 1,
    }))

  return candidates
}

async function fetchLexicalCandidates(pool, query, filters = {}, topK = DEFAULT_LEXICAL_TOP_K) {
  const trimmedQuery = cleanText(query)
  if (!trimmedQuery) return []

  const normalizedFilters = normalizeFilters(filters)
  const sql = `
    WITH q AS (
      SELECT websearch_to_tsquery('simple', $1) AS tsq
    )
    SELECT
      n.offer_id,
      n.network,
      n.upstream_offer_id,
      n.title,
      n.description,
      n.target_url,
      n.market,
      n.language,
      n.availability,
      n.quality,
      n.bid_hint,
      n.policy_weight,
      n.freshness_at,
      n.tags,
      n.metadata,
      n.updated_at,
      ts_rank_cd(${createQueryTextExpression('n')}, q.tsq) AS lexical_score
    FROM offer_inventory_norm n
    CROSS JOIN q
    WHERE n.availability = 'active'
      AND q.tsq <> ''::tsquery
      AND ${createQueryTextExpression('n')} @@ q.tsq
      AND ($2::text[] IS NULL OR n.network = ANY($2::text[]))
      AND ($3::text IS NULL OR upper(n.market) = upper($3::text))
      AND ($4::text IS NULL OR lower(n.language) = lower($4::text))
    ORDER BY lexical_score DESC, n.updated_at DESC
    LIMIT $5
  `

  const result = await pool.query(sql, [
    trimmedQuery,
    normalizedFilters.networks.length > 0 ? normalizedFilters.networks : null,
    normalizedFilters.market || null,
    normalizedFilters.language || null,
    toPositiveInteger(topK, DEFAULT_LEXICAL_TOP_K),
  ])

  return Array.isArray(result.rows) ? result.rows : []
}

async function fetchVectorCandidates(pool, query, filters = {}, topK = DEFAULT_VECTOR_TOP_K) {
  const trimmedQuery = cleanText(query)
  if (!trimmedQuery) return []

  const embedding = buildQueryEmbedding(trimmedQuery)
  const normalizedFilters = normalizeFilters(filters)

  const sql = `
    SELECT
      n.offer_id,
      n.network,
      n.upstream_offer_id,
      n.title,
      n.description,
      n.target_url,
      n.market,
      n.language,
      n.availability,
      n.quality,
      n.bid_hint,
      n.policy_weight,
      n.freshness_at,
      n.tags,
      n.metadata,
      n.updated_at,
      1 - (e.embedding <=> $1::vector) AS vector_score
    FROM offer_inventory_embeddings e
    INNER JOIN offer_inventory_norm n ON n.offer_id = e.offer_id
    WHERE n.availability = 'active'
      AND ($2::text[] IS NULL OR n.network = ANY($2::text[]))
      AND ($3::text IS NULL OR upper(n.market) = upper($3::text))
      AND ($4::text IS NULL OR lower(n.language) = lower($4::text))
    ORDER BY e.embedding <=> $1::vector ASC
    LIMIT $5
  `

  const result = await pool.query(sql, [
    vectorToSqlLiteral(embedding.vector),
    normalizedFilters.networks.length > 0 ? normalizedFilters.networks : null,
    normalizedFilters.market || null,
    normalizedFilters.language || null,
    toPositiveInteger(topK, DEFAULT_VECTOR_TOP_K),
  ])

  return Array.isArray(result.rows) ? result.rows : []
}

function mergeCandidate(base = {}, override = {}) {
  return {
    offerId: cleanText(override.offer_id || base.offerId),
    network: cleanText(override.network || base.network),
    upstreamOfferId: cleanText(override.upstream_offer_id || base.upstreamOfferId),
    title: cleanText(override.title || base.title),
    description: cleanText(override.description || base.description),
    targetUrl: cleanText(override.target_url || base.targetUrl),
    market: cleanText(override.market || base.market),
    language: cleanText(override.language || base.language),
    availability: cleanText(override.availability || base.availability),
    quality: toFiniteNumber(override.quality ?? base.quality, 0),
    bidHint: toFiniteNumber(override.bid_hint ?? base.bidHint, 0),
    policyWeight: toFiniteNumber(override.policy_weight ?? base.policyWeight, 0),
    freshnessAt: cleanText(override.freshness_at || base.freshnessAt || override.updated_at || base.updatedAt),
    tags: Array.isArray(override.tags)
      ? override.tags
      : (Array.isArray(base.tags) ? base.tags : []),
    metadata: override.metadata && typeof override.metadata === 'object'
      ? override.metadata
      : (base.metadata && typeof base.metadata === 'object' ? base.metadata : {}),
    updatedAt: cleanText(override.updated_at || base.updatedAt),
    lexicalScore: toFiniteNumber(override.lexical_score ?? base.lexicalScore, 0),
    vectorScore: toFiniteNumber(override.vector_score ?? base.vectorScore, 0),
    fusedScore: toFiniteNumber(override.fusedScore ?? base.fusedScore, 0),
    lexicalRank: toPositiveInteger(override.lexicalRank ?? base.lexicalRank, 0),
    vectorRank: toPositiveInteger(override.vectorRank ?? base.vectorRank, 0),
  }
}

function rrfFuse(lexicalRows = [], vectorRows = [], options = {}) {
  const k = Math.max(1, toPositiveInteger(options.rrfK, DEFAULT_RRF_K))
  const merged = new Map()

  lexicalRows.forEach((row, index) => {
    const offerId = cleanText(row?.offer_id)
    if (!offerId) return
    const rank = index + 1
    const current = merged.get(offerId) || {}
    const next = mergeCandidate(current, {
      ...row,
      lexicalRank: rank,
      fusedScore: toFiniteNumber(current.fusedScore, 0) + (1 / (k + rank)),
    })
    merged.set(offerId, next)
  })

  vectorRows.forEach((row, index) => {
    const offerId = cleanText(row?.offer_id)
    if (!offerId) return
    const rank = index + 1
    const current = merged.get(offerId) || {}
    const next = mergeCandidate(current, {
      ...row,
      vectorRank: rank,
      fusedScore: toFiniteNumber(current.fusedScore, 0) + (1 / (k + rank)),
    })
    merged.set(offerId, next)
  })

  return [...merged.values()].sort((a, b) => {
    if (b.fusedScore !== a.fusedScore) return b.fusedScore - a.fusedScore
    if (b.vectorScore !== a.vectorScore) return b.vectorScore - a.vectorScore
    if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore
    return a.offerId.localeCompare(b.offerId)
  })
}

export async function retrieveOpportunityCandidates(input = {}, options = {}) {
  const startedAt = Date.now()
  const query = cleanText(input.query)
  const filters = normalizeFilters(input.filters)
  const lexicalTopK = toPositiveInteger(input.lexicalTopK, DEFAULT_LEXICAL_TOP_K)
  const vectorTopK = toPositiveInteger(input.vectorTopK, DEFAULT_VECTOR_TOP_K)
  const finalTopK = toPositiveInteger(input.finalTopK, DEFAULT_FINAL_TOP_K)
  const pool = options.pool
  if (!pool) {
    const fallbackEnabled = options.enableFallbackWhenInventoryUnavailable !== false
    const fallbackProvider = typeof options.fallbackProvider === 'function'
      ? options.fallbackProvider
      : null
    if (fallbackEnabled && fallbackProvider) {
      try {
        const fallbackResult = await fallbackProvider({
          query,
          filters,
          lexicalTopK,
          vectorTopK,
          finalTopK,
        })
        const fallbackCandidates = Array.isArray(fallbackResult?.candidates)
          ? fallbackResult.candidates
          : createFallbackCandidatesFromOffers(
            Array.isArray(fallbackResult?.offers) ? fallbackResult.offers : [],
            { query, filters },
          )
        const sliced = fallbackCandidates.slice(0, finalTopK)
        if (sliced.length > 0) {
          return {
            candidates: sliced,
            debug: {
              lexicalHitCount: sliced.filter((item) => toFiniteNumber(item?.lexicalScore, 0) > 0).length,
              vectorHitCount: sliced.filter((item) => toFiniteNumber(item?.vectorScore, 0) > 0).length,
              fusedHitCount: sliced.length,
              filters,
              query,
              mode: String(fallbackResult?.debug?.mode || 'connector_live_fallback'),
              fallbackMeta: fallbackResult?.debug && typeof fallbackResult.debug === 'object'
                ? fallbackResult.debug
                : {},
              retrievalMs: Math.max(0, Date.now() - startedAt),
            },
          }
        }
        return {
          candidates: [],
          debug: {
            lexicalHitCount: 0,
            vectorHitCount: 0,
            fusedHitCount: 0,
            filters,
            query,
            mode: String(fallbackResult?.debug?.mode || 'connector_live_fallback_empty'),
            fallbackMeta: fallbackResult?.debug && typeof fallbackResult.debug === 'object'
              ? fallbackResult.debug
              : {},
            retrievalMs: Math.max(0, Date.now() - startedAt),
          },
        }
      } catch (error) {
        return {
          candidates: [],
          debug: {
            lexicalHitCount: 0,
            vectorHitCount: 0,
            fusedHitCount: 0,
            filters,
            query,
            mode: 'connector_live_fallback_error',
            fallbackError: error instanceof Error ? error.message : 'fallback_failed',
            retrievalMs: Math.max(0, Date.now() - startedAt),
          },
        }
      }
    }
    return {
      candidates: [],
      debug: {
        lexicalHitCount: 0,
        vectorHitCount: 0,
        fusedHitCount: 0,
        filters,
        query,
        mode: 'inventory_store_unavailable',
        retrievalMs: Math.max(0, Date.now() - startedAt),
      },
    }
  }

  const [lexicalRows, vectorRows] = await Promise.all([
    fetchLexicalCandidates(pool, query, filters, lexicalTopK),
    fetchVectorCandidates(pool, query, filters, vectorTopK),
  ])

  const fused = rrfFuse(lexicalRows, vectorRows, {
    rrfK: toPositiveInteger(input.rrfK, DEFAULT_RRF_K),
  }).slice(0, finalTopK)

  return {
    candidates: fused,
    debug: {
      lexicalHitCount: lexicalRows.length,
      vectorHitCount: vectorRows.length,
      fusedHitCount: fused.length,
      filters,
      query,
      retrievalMs: Math.max(0, Date.now() - startedAt),
    },
  }
}

export { rrfFuse }
