import { createHash } from 'node:crypto'

import { loadRuntimeConfig } from '../config/runtime-config.js'
import { createCjConnector } from '../connectors/cj/index.js'
import { createHouseConnector } from '../connectors/house/index.js'
import { createPartnerStackConnector } from '../connectors/partnerstack/index.js'
import { normalizeUnifiedOffers } from '../offers/index.js'
import { buildTextEmbedding, vectorToSqlLiteral } from './embedding.js'

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function sha256(text = '') {
  return createHash('sha256').update(String(text)).digest('hex')
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((item) => cleanText(item).toLowerCase())
      .filter(Boolean),
  ))
}

function makeRawRecordId(network, offer = {}) {
  const seed = `${network}|${cleanText(offer.offerId)}|${cleanText(offer.sourceId)}|${cleanText(offer.targetUrl)}`
  return `raw_${sha256(seed).slice(0, 24)}`
}

function toRawPayload(offer = {}) {
  return offer?.raw && typeof offer.raw === 'object' ? offer.raw : offer
}

function toNormalizedInventoryRow(network, offer = {}) {
  const metadata = offer?.metadata && typeof offer.metadata === 'object' ? offer.metadata : {}
  const tags = normalizeTags([
    ...(Array.isArray(metadata.matchTags) ? metadata.matchTags : []),
    ...(Array.isArray(metadata.tags) ? metadata.tags : []),
    cleanText(metadata.category),
    cleanText(offer.entityText),
  ])

  return {
    offerId: cleanText(offer.offerId),
    network,
    upstreamOfferId: cleanText(offer.sourceId),
    sourceType: cleanText(offer.sourceType || 'offer') || 'offer',
    title: cleanText(offer.title),
    description: cleanText(offer.description),
    targetUrl: cleanText(offer.targetUrl),
    market: cleanText(offer.market || 'US') || 'US',
    language: cleanText(offer.locale || 'en-US') || 'en-US',
    availability: cleanText(offer.availability || 'active') || 'active',
    quality: toFiniteNumber(offer.qualityScore, 0),
    bidHint: Math.max(0, toFiniteNumber(offer.bidValue, 0)),
    policyWeight: toFiniteNumber(metadata.policyWeight, 0),
    freshnessAt: cleanText(offer.updatedAt) || null,
    tags,
    metadata,
  }
}

async function upsertSyncRun(pool, row = {}) {
  await pool.query(
    `
      INSERT INTO offer_inventory_sync_runs (
        run_id,
        network,
        status,
        fetched_count,
        upserted_count,
        error_count,
        started_at,
        finished_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::jsonb)
      ON CONFLICT (run_id) DO UPDATE
      SET
        status = EXCLUDED.status,
        fetched_count = EXCLUDED.fetched_count,
        upserted_count = EXCLUDED.upserted_count,
        error_count = EXCLUDED.error_count,
        finished_at = EXCLUDED.finished_at,
        metadata = EXCLUDED.metadata
    `,
    [
      cleanText(row.runId),
      cleanText(row.network),
      cleanText(row.status),
      Math.max(0, Math.floor(toFiniteNumber(row.fetchedCount, 0))),
      Math.max(0, Math.floor(toFiniteNumber(row.upsertedCount, 0))),
      Math.max(0, Math.floor(toFiniteNumber(row.errorCount, 0))),
      cleanText(row.startedAt) || nowIso(),
      cleanText(row.finishedAt) || null,
      JSON.stringify(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
    ],
  )
}

async function upsertInventoryRows(pool, network, offers = [], options = {}) {
  const normalized = normalizeUnifiedOffers(offers)
  const rows = normalized
    .map((offer) => toNormalizedInventoryRow(network, offer))
    .filter((item) => item.offerId && item.title && item.targetUrl)

  let upsertedCount = 0
  const errors = []
  const fetchedAt = cleanText(options.fetchedAt) || nowIso()

  for (const row of rows) {
    try {
      const rawPayload = toRawPayload(normalized.find((item) => cleanText(item.offerId) === row.offerId) || row)
      const payloadDigest = sha256(JSON.stringify(rawPayload))
      const rawRecordId = makeRawRecordId(network, row)

      await pool.query(
        `
          INSERT INTO offer_inventory_raw (
            raw_record_id,
            network,
            upstream_offer_id,
            fetched_at,
            payload_digest,
            payload_json,
            created_at
          )
          VALUES ($1, $2, $3, $4::timestamptz, $5, $6::jsonb, NOW())
          ON CONFLICT (raw_record_id) DO UPDATE
          SET
            fetched_at = EXCLUDED.fetched_at,
            payload_digest = EXCLUDED.payload_digest,
            payload_json = EXCLUDED.payload_json
        `,
        [
          rawRecordId,
          network,
          row.upstreamOfferId,
          fetchedAt,
          payloadDigest,
          JSON.stringify(rawPayload),
        ],
      )

      await pool.query(
        `
          INSERT INTO offer_inventory_norm (
            offer_id,
            network,
            upstream_offer_id,
            source_type,
            title,
            description,
            target_url,
            market,
            language,
            availability,
            quality,
            bid_hint,
            policy_weight,
            freshness_at,
            tags,
            metadata,
            raw_record_id,
            imported_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13,
            $14::timestamptz, $15::text[], $16::jsonb, $17, NOW(), NOW()
          )
          ON CONFLICT (offer_id) DO UPDATE
          SET
            network = EXCLUDED.network,
            upstream_offer_id = EXCLUDED.upstream_offer_id,
            source_type = EXCLUDED.source_type,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            target_url = EXCLUDED.target_url,
            market = EXCLUDED.market,
            language = EXCLUDED.language,
            availability = EXCLUDED.availability,
            quality = EXCLUDED.quality,
            bid_hint = EXCLUDED.bid_hint,
            policy_weight = EXCLUDED.policy_weight,
            freshness_at = EXCLUDED.freshness_at,
            tags = EXCLUDED.tags,
            metadata = EXCLUDED.metadata,
            raw_record_id = EXCLUDED.raw_record_id,
            updated_at = NOW()
        `,
        [
          row.offerId,
          row.network,
          row.upstreamOfferId,
          row.sourceType,
          row.title,
          row.description,
          row.targetUrl,
          row.market,
          row.language,
          row.availability,
          row.quality,
          row.bidHint,
          row.policyWeight,
          row.freshnessAt,
          row.tags,
          JSON.stringify(row.metadata),
          rawRecordId,
        ],
      )

      upsertedCount += 1
    } catch (error) {
      errors.push({
        offerId: row.offerId,
        message: error instanceof Error ? error.message : 'inventory_upsert_failed',
      })
    }
  }

  return {
    fetchedCount: offers.length,
    normalizedCount: rows.length,
    upsertedCount,
    errorCount: errors.length,
    errors,
  }
}

async function fetchNetworkOffers(network, runtimeConfig, options = {}) {
  if (network === 'partnerstack') {
    const connector = createPartnerStackConnector({
      runtimeConfig,
      timeoutMs: Math.max(1500, Math.floor(toFiniteNumber(options.timeoutMs, 8000))),
      maxRetries: 1,
    })
    const result = await connector.fetchOffers({
      limit: Math.max(20, Math.floor(toFiniteNumber(options.limit, 240))),
      limitPartnerships: Math.max(20, Math.floor(toFiniteNumber(options.limit, 240))),
      limitLinksPerPartnership: Math.max(20, Math.floor(toFiniteNumber(options.linkLimit, 40))),
      search: cleanText(options.search),
    })
    return Array.isArray(result?.offers) ? result.offers : []
  }

  if (network === 'cj') {
    const connector = createCjConnector({
      runtimeConfig,
      timeoutMs: Math.max(1500, Math.floor(toFiniteNumber(options.timeoutMs, 8000))),
      maxRetries: 1,
    })
    const result = await connector.fetchOffers({
      keywords: cleanText(options.search),
      limit: Math.max(20, Math.floor(toFiniteNumber(options.limit, 200))),
      page: 1,
    })
    return Array.isArray(result?.offers) ? result.offers : []
  }

  if (network === 'house') {
    const connector = createHouseConnector({ runtimeConfig })
    const result = await connector.fetchProductOffersCatalog({
      keywords: cleanText(options.search),
      limit: Math.max(80, Math.floor(toFiniteNumber(options.limit, 2000))),
      locale: cleanText(options.language || 'en-US') || 'en-US',
      market: cleanText(options.market || 'US') || 'US',
    })
    return Array.isArray(result?.offers) ? result.offers : []
  }

  return []
}

async function syncOneNetwork(pool, network, options = {}) {
  const runId = createId(`invsync_${network}`)
  const startedAt = nowIso()
  await upsertSyncRun(pool, {
    runId,
    network,
    status: 'running',
    fetchedCount: 0,
    upsertedCount: 0,
    errorCount: 0,
    startedAt,
    metadata: {
      trigger: cleanText(options.trigger) || 'manual',
    },
  })

  try {
    const runtimeConfig = options.runtimeConfig || loadRuntimeConfig(process.env, { strict: false })
    const offers = await fetchNetworkOffers(network, runtimeConfig, options)
    const stats = await upsertInventoryRows(pool, network, offers, {
      fetchedAt: startedAt,
    })

    const status = stats.errorCount > 0 ? 'partial' : 'success'
    await upsertSyncRun(pool, {
      runId,
      network,
      status,
      fetchedCount: stats.fetchedCount,
      upsertedCount: stats.upsertedCount,
      errorCount: stats.errorCount,
      startedAt,
      finishedAt: nowIso(),
      metadata: {
        normalizedCount: stats.normalizedCount,
        errors: stats.errors.slice(0, 25),
      },
    })

    return {
      runId,
      network,
      status,
      ...stats,
    }
  } catch (error) {
    await upsertSyncRun(pool, {
      runId,
      network,
      status: 'failed',
      fetchedCount: 0,
      upsertedCount: 0,
      errorCount: 1,
      startedAt,
      finishedAt: nowIso(),
      metadata: {
        message: error instanceof Error ? error.message : 'sync_failed',
      },
    })

    return {
      runId,
      network,
      status: 'failed',
      fetchedCount: 0,
      normalizedCount: 0,
      upsertedCount: 0,
      errorCount: 1,
      errors: [{ message: error instanceof Error ? error.message : 'sync_failed' }],
    }
  }
}

export async function syncInventoryNetworks(pool, input = {}) {
  if (!pool) {
    throw new Error('syncInventoryNetworks requires a postgres pool')
  }
  const networks = Array.isArray(input.networks) && input.networks.length > 0
    ? input.networks
    : ['partnerstack', 'cj', 'house']

  const results = []
  for (const network of networks) {
    const normalized = cleanText(network).toLowerCase()
    if (!['partnerstack', 'cj', 'house'].includes(normalized)) continue
    const result = await syncOneNetwork(pool, normalized, input)
    results.push(result)
  }

  return {
    ok: results.every((item) => item.status === 'success' || item.status === 'partial'),
    results,
    syncedAt: nowIso(),
  }
}

export async function buildInventoryEmbeddings(pool, input = {}) {
  if (!pool) {
    throw new Error('buildInventoryEmbeddings requires a postgres pool')
  }

  const limit = Math.max(1, Math.floor(toFiniteNumber(input.limit, 5000)))
  const result = await pool.query(
    `
      SELECT offer_id, title, description, tags
      FROM offer_inventory_norm
      WHERE availability = 'active'
      ORDER BY updated_at DESC
      LIMIT $1
    `,
    [limit],
  )
  const rows = Array.isArray(result.rows) ? result.rows : []

  let upserted = 0
  for (const row of rows) {
    const embedding = buildTextEmbedding({
      title: row.title,
      description: row.description,
      tags: Array.isArray(row.tags) ? row.tags : [],
    })

    await pool.query(
      `
        INSERT INTO offer_inventory_embeddings (
          offer_id,
          embedding_model,
          embedding,
          embedding_updated_at,
          created_at
        )
        VALUES ($1, $2, $3::vector, NOW(), NOW())
        ON CONFLICT (offer_id) DO UPDATE
        SET
          embedding_model = EXCLUDED.embedding_model,
          embedding = EXCLUDED.embedding,
          embedding_updated_at = NOW()
      `,
      [
        cleanText(row.offer_id),
        embedding.model,
        vectorToSqlLiteral(embedding.vector),
      ],
    )
    upserted += 1
  }

  return {
    ok: true,
    scanned: rows.length,
    upserted,
    embeddedAt: nowIso(),
  }
}

export async function materializeServingSnapshot(pool) {
  if (!pool) {
    throw new Error('materializeServingSnapshot requires a postgres pool')
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS offer_inventory_serving_snapshot (
      offer_id TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      target_url TEXT NOT NULL,
      market TEXT NOT NULL,
      language TEXT NOT NULL,
      availability TEXT NOT NULL,
      quality NUMERIC(8, 4) NOT NULL,
      bid_hint NUMERIC(12, 6) NOT NULL,
      policy_weight NUMERIC(8, 4) NOT NULL,
      tags TEXT[] NOT NULL DEFAULT '{}'::text[],
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      embedding_model TEXT NOT NULL DEFAULT '',
      embedding vector(512),
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query('BEGIN')
  try {
    await pool.query('TRUNCATE TABLE offer_inventory_serving_snapshot')
    await pool.query(`
      INSERT INTO offer_inventory_serving_snapshot (
        offer_id,
        network,
        title,
        description,
        target_url,
        market,
        language,
        availability,
        quality,
        bid_hint,
        policy_weight,
        tags,
        metadata,
        embedding_model,
        embedding,
        refreshed_at
      )
      SELECT
        n.offer_id,
        n.network,
        n.title,
        n.description,
        n.target_url,
        n.market,
        n.language,
        n.availability,
        n.quality,
        n.bid_hint,
        n.policy_weight,
        n.tags,
        n.metadata,
        coalesce(e.embedding_model, ''),
        e.embedding,
        NOW()
      FROM offer_inventory_norm n
      LEFT JOIN offer_inventory_embeddings e ON e.offer_id = n.offer_id
      WHERE n.availability = 'active'
    `)
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK')
    throw error
  }

  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM offer_inventory_serving_snapshot')
  const count = Number(countResult.rows?.[0]?.count || 0)

  return {
    ok: true,
    rows: count,
    refreshedAt: nowIso(),
  }
}

export async function getInventoryStatus(pool) {
  if (!pool) {
    return {
      ok: false,
      mode: 'inventory_store_unavailable',
      counts: [],
      latestRuns: [],
    }
  }

  const [countResult, runResult] = await Promise.all([
    pool.query(`
      SELECT network, COUNT(*)::int AS offer_count
      FROM offer_inventory_norm
      GROUP BY network
      ORDER BY network ASC
    `),
    pool.query(`
      SELECT run_id, network, status, fetched_count, upserted_count, error_count, started_at, finished_at, metadata
      FROM offer_inventory_sync_runs
      ORDER BY started_at DESC
      LIMIT 20
    `),
  ])

  return {
    ok: true,
    mode: 'postgres',
    counts: Array.isArray(countResult.rows) ? countResult.rows : [],
    latestRuns: Array.isArray(runResult.rows) ? runResult.rows : [],
    checkedAt: nowIso(),
  }
}
