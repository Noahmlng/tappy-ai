#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildInventoryEmbeddings } from '../../src/runtime/inventory-sync.js'
import { parseArgs, withDbPool } from '../inventory/common.js'
import { __pilotContentInternal } from './enrich-content-cases.js'

const {
  cleanText,
  toBoolean,
  toPositiveInteger,
  nowIso,
  toHttpUrl,
  enrichCaseOffer,
  updateOffer,
  evaluateAcceptance,
} = __pilotContentInternal

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'content-enrichment')

const DEFAULT_NETWORKS = ['house', 'partnerstack']
const DEFAULT_BATCH_SIZE = 500
const DEFAULT_CRAWL_CONCURRENCY = 20
const DEFAULT_LLM_CONCURRENCY = 8
const DEFAULT_FETCH_TIMEOUT_MS = 9000
const DEFAULT_FETCH_RETRIES = 1
const DEFAULT_SOFT_BATCH_TIMEOUT_MS = 20 * 60 * 1000

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function buildRunId() {
  const token = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `full_${token}_${random}`
}

function parseNetworks(value) {
  const raw = cleanText(value)
  if (!raw) return [...DEFAULT_NETWORKS]
  const normalized = raw
    .split(',')
    .map((item) => cleanText(item).toLowerCase())
    .filter(Boolean)
  const dedup = Array.from(new Set(normalized))
  return dedup.filter((item) => item === 'house' || item === 'partnerstack')
}

function createLimiter(maxConcurrency = 1) {
  const max = Math.max(1, toPositiveInteger(maxConcurrency, 1))
  let active = 0
  const queue = []

  async function runNext() {
    if (active >= max) return
    const next = queue.shift()
    if (!next) return
    active += 1
    try {
      const value = await next.fn()
      next.resolve(value)
    } catch (error) {
      next.reject(error)
    } finally {
      active -= 1
      void runNext()
    }
  }

  return async function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      void runNext()
    })
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function appendJsonLines(filePath, rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return
  await ensureDir(path.dirname(filePath))
  const payload = rows.map((row) => JSON.stringify(row)).join('\n')
  await fs.appendFile(filePath, `${payload}\n`, 'utf8')
}

function resolveResumeManifestPath(resumeFrom) {
  const raw = cleanText(resumeFrom)
  if (!raw) return ''
  const resolved = path.resolve(PROJECT_ROOT, raw)
  if (resolved.endsWith('.json')) return resolved
  return path.join(resolved, 'manifest.json')
}

async function loadProcessedSet(filePath) {
  const set = new Set()
  try {
    const content = await fs.readFile(filePath, 'utf8')
    for (const line of content.split('\n')) {
      const text = cleanText(line)
      if (!text) continue
      try {
        const row = JSON.parse(text)
        const network = cleanText(row.network).toLowerCase()
        const offerId = cleanText(row.offer_id || row.offerId)
        if (!network || !offerId) continue
        set.add(`${network}:${offerId}`)
      } catch {
        // Ignore malformed lines.
      }
    }
  } catch {
    // Missing file is fine.
  }
  return set
}

async function fetchBatchRows(pool, network, cursor = '', limit = DEFAULT_BATCH_SIZE) {
  const result = await pool.query(
    `
      SELECT
        offer_id,
        network,
        title,
        description,
        target_url,
        metadata,
        availability,
        updated_at
      FROM offer_inventory_norm
      WHERE network = $1
        AND availability = 'active'
        AND ($2::text = '' OR offer_id > $2::text)
      ORDER BY offer_id ASC
      LIMIT $3
    `,
    [cleanText(network), cleanText(cursor), Math.max(1, toPositiveInteger(limit, DEFAULT_BATCH_SIZE))],
  )
  return ensureArray(result.rows)
}

async function queryCoverage(pool, networks = DEFAULT_NETWORKS) {
  const rows = await pool.query(
    `
      SELECT
        network,
        COUNT(*)::int AS total_active,
        COUNT(*) FILTER (WHERE COALESCE(description, '') <> '')::int AS with_description,
        COUNT(*) FILTER (
          WHERE
            COALESCE(metadata->>'image_url', '') <> ''
            OR COALESCE(metadata->>'imageUrl', '') <> ''
            OR COALESCE(metadata->>'brand_image_url', '') <> ''
            OR COALESCE(metadata->>'brandImageUrl', '') <> ''
            OR COALESCE(metadata->>'icon_url', '') <> ''
            OR COALESCE(metadata->>'iconUrl', '') <> ''
        )::int AS with_image
      FROM offer_inventory_norm
      WHERE availability = 'active'
        AND network = ANY($1::text[])
      GROUP BY network
      ORDER BY network ASC
    `,
    [networks],
  )

  return ensureArray(rows.rows).map((row) => {
    const total = Number(row.total_active || 0)
    const withDescription = Number(row.with_description || 0)
    const withImage = Number(row.with_image || 0)
    const descriptionCoverage = total > 0 ? Number((withDescription / total).toFixed(4)) : 0
    const imageCoverage = total > 0 ? Number((withImage / total).toFixed(4)) : 0
    return {
      network: cleanText(row.network),
      total_active: total,
      with_description: withDescription,
      with_image: withImage,
      description_coverage: descriptionCoverage,
      image_coverage: imageCoverage,
    }
  })
}

function coverageMap(rows = []) {
  return new Map(ensureArray(rows).map((row) => [cleanText(row.network), row]))
}

function computeCoverageDelta(before = [], after = []) {
  const beforeMap = coverageMap(before)
  const afterMap = coverageMap(after)
  const keys = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort()
  return keys.map((network) => {
    const b = beforeMap.get(network) || {}
    const a = afterMap.get(network) || {}
    return {
      network,
      total_active_before: Number(b.total_active || 0),
      total_active_after: Number(a.total_active || 0),
      with_description_before: Number(b.with_description || 0),
      with_description_after: Number(a.with_description || 0),
      with_image_before: Number(b.with_image || 0),
      with_image_after: Number(a.with_image || 0),
      description_coverage_before: Number(b.description_coverage || 0),
      description_coverage_after: Number(a.description_coverage || 0),
      image_coverage_before: Number(b.image_coverage || 0),
      image_coverage_after: Number(a.image_coverage || 0),
    }
  })
}

function makeCaseSpec(network, row = {}) {
  return {
    id: `full_${cleanText(network)}_${cleanText(row.offer_id)}`,
    name: `full-${cleanText(network)}`,
    network: cleanText(network).toLowerCase(),
    query: cleanText(row.title || row.description || row.offer_id),
    imageState: 'any',
    simulateNoImageForPilot: false,
  }
}

async function runBatch(rows = [], options = {}) {
  const {
    network,
    pool,
    llmLimiter,
    processedSet,
    crawlConcurrency,
    fetchTimeoutMs,
    fetchRetries,
    enableLlm,
    dryRun,
    enrichmentVersion,
    softBatchTimeoutMs,
  } = options

  const startedAt = Date.now()
  const timeoutAt = startedAt + softBatchTimeoutMs
  const workers = Math.max(1, toPositiveInteger(crawlConcurrency, DEFAULT_CRAWL_CONCURRENCY))
  let cursor = 0

  const results = []

  async function worker() {
    while (true) {
      if (Date.now() > timeoutAt) {
        const timeoutError = new Error('BATCH_SOFT_TIMEOUT')
        timeoutError.code = 'BATCH_SOFT_TIMEOUT'
        throw timeoutError
      }
      const index = cursor
      cursor += 1
      if (index >= rows.length) return
      const row = rows[index]
      const offerId = cleanText(row?.offer_id)
      const dedupKey = `${cleanText(network)}:${offerId}`
      if (!offerId || processedSet.has(dedupKey)) {
        results.push({
          offer_id: offerId,
          network,
          skipped: true,
          changed: false,
          pass: true,
        })
        continue
      }
      try {
        const caseSpec = makeCaseSpec(network, row)
        const enrichment = await enrichCaseOffer(caseSpec, row, {
          enableLlm,
          fetchTimeoutMs,
          fetchRetries,
          llmLimiter,
          mode: 'full',
          enrichmentVersion,
        })
        if (enrichment.changed) {
          await updateOffer(pool, enrichment.after, { dryRun })
        }
        const acceptance = evaluateAcceptance(caseSpec, enrichment.after, enrichment.evidence)
        results.push({
          offer_id: offerId,
          network,
          skipped: false,
          changed: enrichment.changed === true,
          pass: acceptance.pass === true,
          before: enrichment.before,
          after: enrichment.after,
          evidence: enrichment.evidence,
          acceptance,
        })
      } catch (error) {
        results.push({
          offer_id: offerId,
          network,
          skipped: false,
          changed: false,
          pass: false,
          error: error instanceof Error ? error.message : 'enrichment_failed',
        })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, Math.max(1, rows.length)) }, () => worker()))

  const processed = results.filter((row) => !row.skipped)
  const changedRows = processed.filter((row) => row.changed)
  const failedRows = processed.filter((row) => row.pass !== true || row.error)
  const changedOfferIds = changedRows.map((row) => cleanText(row.offer_id)).filter(Boolean)
  const processedOfferIds = processed.map((row) => cleanText(row.offer_id)).filter(Boolean)

  return {
    ok: true,
    elapsed_ms: Date.now() - startedAt,
    total_rows: rows.length,
    processed_count: processed.length,
    skipped_count: results.length - processed.length,
    changed_count: changedRows.length,
    passed_count: processed.filter((row) => row.pass === true).length,
    failed_count: failedRows.length,
    changed_offer_ids: changedOfferIds,
    processed_offer_ids: processedOfferIds,
    failed_rows: failedRows.slice(0, 50),
    rows: results,
  }
}

function parseRuntimeArgs(rawArgs = {}) {
  const networks = parseNetworks(rawArgs.networks)
  if (networks.length === 0) {
    throw new Error('networks must include at least one of: house,partnerstack')
  }
  return {
    networks,
    batchSize: toPositiveInteger(rawArgs['batch-size'], DEFAULT_BATCH_SIZE),
    crawlConcurrency: toPositiveInteger(rawArgs['concurrency-crawl'], DEFAULT_CRAWL_CONCURRENCY),
    llmConcurrency: toPositiveInteger(rawArgs['concurrency-llm'], DEFAULT_LLM_CONCURRENCY),
    fetchTimeoutMs: toPositiveInteger(rawArgs['fetch-timeout-ms'], DEFAULT_FETCH_TIMEOUT_MS),
    fetchRetries: toPositiveInteger(rawArgs['fetch-retries'], DEFAULT_FETCH_RETRIES),
    softBatchTimeoutMs: toPositiveInteger(rawArgs['soft-batch-timeout-ms'], DEFAULT_SOFT_BATCH_TIMEOUT_MS),
    dryRun: toBoolean(rawArgs['dry-run'], false),
    enableLlm: toBoolean(rawArgs['enable-llm'], true),
    maxOffers: toPositiveInteger(rawArgs['max-offers'], 0),
    resumeFrom: cleanText(rawArgs['resume-from']),
    embedIncremental: toBoolean(rawArgs['embed-incremental'], true),
    enrichmentVersion: cleanText(rawArgs['enrichment-version'] || 'full_v1') || 'full_v1',
  }
}

export async function runFullContentEnrichment(rawArgs = {}) {
  const args = parseRuntimeArgs(rawArgs)
  const resumeManifestPath = resolveResumeManifestPath(args.resumeFrom)

  const runId = resumeManifestPath
    ? cleanText(path.basename(path.dirname(resumeManifestPath)))
    : buildRunId()
  const runDir = resumeManifestPath
    ? path.dirname(resumeManifestPath)
    : path.join(OUTPUT_ROOT, runId)
  const batchesDir = path.join(runDir, 'batches')
  const processedPath = path.join(runDir, 'processed_offer_ids.ndjson')
  const failedBatchesPath = path.join(runDir, 'failed-batches.json')
  const manifestPath = path.join(runDir, 'manifest.json')
  const summaryPath = path.join(runDir, 'summary.json')

  await ensureDir(runDir)
  await ensureDir(batchesDir)

  const processedSet = await loadProcessedSet(processedPath)
  const initialManifest = resumeManifestPath
    ? await readJson(resumeManifestPath)
    : null

  return withDbPool(async (pool) => {
    const coverageBefore = initialManifest?.coverage_before
      || await queryCoverage(pool, args.networks)
    const manifest = initialManifest && typeof initialManifest === 'object'
      ? {
          ...initialManifest,
          status: 'running',
          updated_at: nowIso(),
          args: {
            ...initialManifest.args,
            ...args,
          },
        }
      : {
          run_id: runId,
          created_at: nowIso(),
          updated_at: nowIso(),
          status: 'running',
          args,
          networks: args.networks,
          coverage_before: coverageBefore,
          coverage_after: [],
          coverage_delta: [],
          progress: {},
          totals: {
            scanned: 0,
            processed: 0,
            changed: 0,
            passed: 0,
            failed: 0,
            batches: 0,
            failed_batches: 0,
          },
          outputs: {
            run_dir: path.relative(PROJECT_ROOT, runDir),
            manifest_json: path.relative(PROJECT_ROOT, manifestPath),
            summary_json: path.relative(PROJECT_ROOT, summaryPath),
            failed_batches_json: path.relative(PROJECT_ROOT, failedBatchesPath),
            processed_offer_ids: path.relative(PROJECT_ROOT, processedPath),
          },
        }

    const failedBatches = Array.isArray(initialManifest?.failed_batches) ? [...initialManifest.failed_batches] : []
    const llmLimiter = createLimiter(args.llmConcurrency)

    for (const network of args.networks) {
      const networkProgress = manifest.progress?.[network] && typeof manifest.progress[network] === 'object'
        ? { ...manifest.progress[network] }
        : {
            network,
            cursor: '',
            scanned: 0,
            processed: 0,
            changed: 0,
            passed: 0,
            failed: 0,
            batches: 0,
            failed_batches: 0,
            status: 'running',
          }

      let stopNetwork = false
      while (!stopNetwork) {
        if (args.maxOffers > 0 && networkProgress.scanned >= args.maxOffers) break

        const remaining = args.maxOffers > 0
          ? Math.max(0, args.maxOffers - networkProgress.scanned)
          : args.batchSize
        if (remaining === 0) break

        const currentBatchSize = Math.max(1, Math.min(args.batchSize, remaining))
        const rows = await fetchBatchRows(pool, network, networkProgress.cursor, currentBatchSize)
        if (rows.length === 0) break

        const batchId = `${network}_batch_${String(networkProgress.batches + 1).padStart(4, '0')}`
        const batchOfferIds = rows.map((row) => cleanText(row.offer_id)).filter(Boolean)
        const executeBatch = async () => runBatch(rows, {
          network,
          pool,
          llmLimiter,
          processedSet,
          crawlConcurrency: args.crawlConcurrency,
          fetchTimeoutMs: args.fetchTimeoutMs,
          fetchRetries: args.fetchRetries,
          enableLlm: args.enableLlm,
          dryRun: args.dryRun,
          enrichmentVersion: args.enrichmentVersion,
          softBatchTimeoutMs: args.softBatchTimeoutMs,
        })

        let batchResult = null
        let attempts = 0
        let fatalError = null
        while (attempts < 2) {
          attempts += 1
          try {
            batchResult = await executeBatch()
            break
          } catch (error) {
            fatalError = error
            if (attempts >= 2) break
          }
        }

        if (!batchResult) {
          networkProgress.failed_batches += 1
          failedBatches.push({
            batch_id: batchId,
            network,
            attempt_count: attempts,
            offer_ids: batchOfferIds,
            error: fatalError instanceof Error ? fatalError.message : 'batch_failed',
            failed_at: nowIso(),
          })
          stopNetwork = true
          manifest.totals.failed_batches += 1
          manifest.status = 'partial'
          break
        }

        networkProgress.batches += 1
        networkProgress.scanned += rows.length
        networkProgress.processed += batchResult.processed_count
        networkProgress.changed += batchResult.changed_count
        networkProgress.passed += batchResult.passed_count
        networkProgress.failed += batchResult.failed_count
        networkProgress.cursor = cleanText(rows[rows.length - 1]?.offer_id)

        manifest.totals.batches += 1
        manifest.totals.scanned += rows.length
        manifest.totals.processed += batchResult.processed_count
        manifest.totals.changed += batchResult.changed_count
        manifest.totals.passed += batchResult.passed_count
        manifest.totals.failed += batchResult.failed_count

        const processedRows = batchResult.rows
          .filter((row) => !row.skipped)
          .map((row) => ({
            network,
            offer_id: cleanText(row.offer_id),
            processed_at: nowIso(),
            changed: row.changed === true,
            pass: row.pass === true,
          }))
        for (const row of processedRows) {
          processedSet.add(`${network}:${row.offer_id}`)
        }
        await appendJsonLines(processedPath, processedRows)

        let incrementalEmbedding = null
        if (!args.dryRun && args.embedIncremental && batchResult.changed_offer_ids.length > 0) {
          incrementalEmbedding = await buildInventoryEmbeddings(pool, {
            offerIds: batchResult.changed_offer_ids,
          })
        }

        await writeJson(path.join(batchesDir, `${batchId}.json`), {
          run_id: runId,
          batch_id: batchId,
          network,
          attempt_count: attempts,
          offer_ids: batchOfferIds,
          metrics: batchResult,
          incremental_embedding: incrementalEmbedding,
          generated_at: nowIso(),
        })
      }

      networkProgress.status = networkProgress.failed_batches > 0 ? 'partial' : 'completed'
      manifest.progress[network] = networkProgress
      manifest.updated_at = nowIso()
      await writeJson(manifestPath, manifest)
    }

    if (failedBatches.length > 0) {
      await writeJson(failedBatchesPath, failedBatches)
      manifest.failed_batches = failedBatches
      manifest.status = 'partial'
    } else if (Number(manifest.totals.failed || 0) > 0) {
      manifest.status = 'partial'
    } else {
      manifest.status = 'success'
    }

    const coverageAfter = await queryCoverage(pool, args.networks)
    manifest.coverage_after = coverageAfter
    manifest.coverage_delta = computeCoverageDelta(coverageBefore, coverageAfter)
    manifest.updated_at = nowIso()
    await writeJson(manifestPath, manifest)

    const summary = {
      run_id: runId,
      generated_at: nowIso(),
      status: manifest.status,
      args: manifest.args,
      totals: manifest.totals,
      coverage_before: coverageBefore,
      coverage_after: coverageAfter,
      coverage_delta: manifest.coverage_delta,
      outputs: manifest.outputs,
      progress: manifest.progress,
      failed_batches_count: failedBatches.length,
      failed_batches_file: failedBatches.length > 0 ? manifest.outputs.failed_batches_json : '',
    }
    await writeJson(summaryPath, summary)
    await writeJson(path.join(OUTPUT_ROOT, 'latest-run.json'), summary)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return summary
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await runFullContentEnrichment(args)
}

if (path.resolve(process.argv[1] || '') === __filename) {
  main().catch((error) => {
    console.error('[content-enrich-full] failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export const __fullContentInternal = Object.freeze({
  parseNetworks,
  computeCoverageDelta,
})
