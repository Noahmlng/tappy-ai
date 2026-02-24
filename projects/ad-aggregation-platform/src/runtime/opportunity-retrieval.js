import { buildQueryEmbedding, vectorToSqlLiteral } from './embedding.js'

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
  const pool = options.pool
  if (!pool) {
    return {
      candidates: [],
      debug: {
        lexicalHitCount: 0,
        vectorHitCount: 0,
        mode: 'inventory_store_unavailable',
        retrievalMs: 0,
      },
    }
  }

  const query = cleanText(input.query)
  const filters = normalizeFilters(input.filters)
  const lexicalTopK = toPositiveInteger(input.lexicalTopK, DEFAULT_LEXICAL_TOP_K)
  const vectorTopK = toPositiveInteger(input.vectorTopK, DEFAULT_VECTOR_TOP_K)
  const finalTopK = toPositiveInteger(input.finalTopK, DEFAULT_FINAL_TOP_K)

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
