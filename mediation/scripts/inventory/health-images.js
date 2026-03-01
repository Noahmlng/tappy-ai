#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, printJson, withDbPool } from './common.js'
import {
  cleanText,
  splitCsv,
  timestampTag,
  toPositiveInteger,
  writeJson,
  readRowsFromBatchFiles,
  queryOfferRows,
} from './audit-common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'inventory-audit')
const DEFAULT_LIMIT = 5000
const DEFAULT_CONCURRENCY = 20
const DEFAULT_TIMEOUT_MS = 12000

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)(\?|#|$)/i

function classifyHttpStatus(status = 0) {
  const code = Number(status)
  if (!Number.isFinite(code) || code <= 0) return 'none'
  if (code >= 200 && code < 300) return '2xx'
  if (code >= 300 && code < 400) return '3xx'
  if (code >= 400 && code < 500) return '4xx'
  if (code >= 500 && code < 600) return '5xx'
  return 'other_http'
}

function classifyFetchError(error) {
  const message = cleanText(error?.message || String(error || '')).toLowerCase()
  const name = cleanText(error?.name || '').toLowerCase()
  if (name.includes('abort') || message.includes('abort') || message.includes('timeout')) {
    return 'timeout'
  }
  if (
    message.includes('enotfound')
    || message.includes('getaddrinfo')
    || message.includes('dns')
    || message.includes('eai_again')
  ) {
    return 'dns'
  }
  return 'request_error'
}

function normalizeContentType(value = '') {
  return cleanText(value).toLowerCase().split(';')[0]
}

function isImageContentType(value = '') {
  return normalizeContentType(value).startsWith('image/')
}

function hasImageExtension(url = '') {
  return IMAGE_EXT_RE.test(cleanText(url))
}

function isLikelyLandingPage(contentType = '', url = '') {
  const type = normalizeContentType(contentType)
  if (!type) return !hasImageExtension(url)
  if (type.includes('text/html') || type.includes('application/xhtml')) return true
  if (isImageContentType(type)) return false
  return !hasImageExtension(url)
}

function summarizeStatusClasses(rows = []) {
  const counts = {}
  for (const row of rows) {
    const key = cleanText(row.status_class) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function summarizeContentTypes(rows = [], limit = 20) {
  const counts = new Map()
  for (const row of rows) {
    const type = cleanText(row.content_type) || '(empty)'
    counts.set(type, (counts.get(type) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([content_type, count]) => ({ content_type, count }))
    .sort((a, b) => b.count - a.count || a.content_type.localeCompare(b.content_type))
    .slice(0, Math.max(1, limit))
}

function createLimiter(maxConcurrency = DEFAULT_CONCURRENCY) {
  const concurrency = Math.max(1, toPositiveInteger(maxConcurrency, DEFAULT_CONCURRENCY))
  let active = 0
  const queue = []

  async function runNext() {
    if (active >= concurrency) return
    const item = queue.shift()
    if (!item) return
    active += 1
    try {
      const value = await item.fn()
      item.resolve(value)
    } catch (error) {
      item.reject(error)
    } finally {
      active -= 1
      void runNext()
    }
  }

  return async function limit(fn) {
    return await new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      void runNext()
    })
  }
}

async function fetchImageProbe(url, method, timeoutMs) {
  const response = await fetch(url, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': 'inventory-health-images/1.0',
    },
  })
  return {
    status: Number(response.status) || 0,
    final_url: cleanText(response.url || url),
    content_type: normalizeContentType(response.headers.get('content-type') || ''),
  }
}

async function checkImageUrl(imageUrl, options = {}) {
  const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  try {
    let probe = await fetchImageProbe(imageUrl, 'HEAD', timeoutMs)
    if ([403, 405].includes(probe.status)) {
      probe = await fetchImageProbe(imageUrl, 'GET', timeoutMs)
    }
    const statusClass = classifyHttpStatus(probe.status)
    const imageType = isImageContentType(probe.content_type)
    const landingLike = isLikelyLandingPage(probe.content_type, probe.final_url || imageUrl)
    return {
      ok: probe.status >= 200 && probe.status < 400,
      status: probe.status,
      status_class: statusClass,
      final_url: cleanText(probe.final_url || imageUrl),
      content_type: probe.content_type,
      is_image_content_type: imageType,
      is_landing_like: landingLike,
      valid_image: probe.status >= 200 && probe.status < 400 && imageType && !landingLike,
      error_class: '',
      error_message: '',
    }
  } catch (error) {
    const errorClass = classifyFetchError(error)
    return {
      ok: false,
      status: 0,
      status_class: errorClass,
      final_url: cleanText(imageUrl),
      content_type: '',
      is_image_content_type: false,
      is_landing_like: false,
      valid_image: false,
      error_class: errorClass,
      error_message: cleanText(error?.message || String(error)),
    }
  }
}

async function auditRows(rows = [], options = {}) {
  const limiter = createLimiter(options.concurrency)
  const tasks = rows.map((row) => limiter(async () => {
    const imageUrl = cleanText(row.image_url)
    if (!imageUrl) {
      return {
        offer_id: cleanText(row.offer_id),
        network: cleanText(row.network),
        target_url: cleanText(row.target_url),
        image_url: '',
        ok: false,
        status: 0,
        status_class: 'missing_image_url',
        final_url: '',
        content_type: '',
        is_image_content_type: false,
        is_landing_like: false,
        valid_image: false,
        error_class: 'missing_image_url',
        error_message: 'missing_image_url',
        source_file: cleanText(row.source_file),
      }
    }

    const imageCheck = await checkImageUrl(imageUrl, options)
    return {
      offer_id: cleanText(row.offer_id),
      network: cleanText(row.network),
      target_url: cleanText(row.target_url),
      image_url: imageUrl,
      ok: imageCheck.ok === true,
      status: imageCheck.status,
      status_class: imageCheck.status_class,
      final_url: cleanText(imageCheck.final_url),
      content_type: cleanText(imageCheck.content_type),
      is_image_content_type: imageCheck.is_image_content_type === true,
      is_landing_like: imageCheck.is_landing_like === true,
      valid_image: imageCheck.valid_image === true,
      error_class: cleanText(imageCheck.error_class),
      error_message: cleanText(imageCheck.error_message),
      source_file: cleanText(row.source_file),
    }
  }))
  return await Promise.all(tasks)
}

async function loadRows(args = {}) {
  const batchFiles = splitCsv(args['batch-files'])
  const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT)
  const networks = splitCsv(args.networks).map((item) => item.toLowerCase())

  if (batchFiles.length > 0) {
    const rows = await readRowsFromBatchFiles(batchFiles, { preferAfter: true })
    const scoped = rows
      .filter((row) => (networks.length > 0 ? networks.includes(cleanText(row.network).toLowerCase()) : true))
      .slice(0, limit)
    return {
      mode: 'batch_files',
      rows: scoped,
      batch_files: batchFiles,
    }
  }

  const rows = await withDbPool(async (pool) => await queryOfferRows(pool, { limit, networks }))
  return {
    mode: 'postgres',
    rows,
    batch_files: [],
  }
}

export async function runImageHealthAudit(rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
  const startedAt = Date.now()
  const timeoutMs = toPositiveInteger(args['timeout-ms'], DEFAULT_TIMEOUT_MS)
  const concurrency = toPositiveInteger(args.concurrency, DEFAULT_CONCURRENCY)
  const sampleSize = toPositiveInteger(args['sample-size'], 200)
  const tag = timestampTag()
  const outputFile = path.resolve(
    PROJECT_ROOT,
    cleanText(args['output-file']) || path.join(OUTPUT_ROOT, `image-health-${tag}.json`),
  )

  const loaded = await loadRows(args)
  const auditedRows = await auditRows(loaded.rows, {
    timeoutMs,
    concurrency,
  })

  const report = {
    generated_at: new Date().toISOString(),
    mode: loaded.mode,
    inputs: {
      rows: loaded.rows.length,
      timeout_ms: timeoutMs,
      concurrency,
      batch_files: loaded.batch_files,
    },
    summary: {
      total_rows: auditedRows.length,
      valid_image_count: auditedRows.filter((row) => row.valid_image === true).length,
      missing_image_count: auditedRows.filter((row) => row.status_class === 'missing_image_url').length,
      landing_like_count: auditedRows.filter((row) => row.is_landing_like === true).length,
      status_class: summarizeStatusClasses(auditedRows),
      content_type_top: summarizeContentTypes(auditedRows, 20),
      elapsed_ms: Date.now() - startedAt,
    },
    rows_sample: auditedRows.slice(0, sampleSize),
    output_file: path.relative(PROJECT_ROOT, outputFile),
  }

  await writeJson(outputFile, report)
  return report
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await runImageHealthAudit(args)
  printJson({
    ok: true,
    mode: report.mode,
    totalRows: report.summary.total_rows,
    validImageCount: report.summary.valid_image_count,
    missingImageCount: report.summary.missing_image_count,
    landingLikeCount: report.summary.landing_like_count,
    statusClass: report.summary.status_class,
    outputFile: report.output_file,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[inventory-health-images] failed:', error?.message || error)
    process.exit(1)
  })
}

export const __imagesHealthInternal = Object.freeze({
  classifyHttpStatus,
  classifyFetchError,
  isImageContentType,
  isLikelyLandingPage,
})
