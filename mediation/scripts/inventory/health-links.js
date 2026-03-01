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

function toUrlDomain(url = '') {
  try {
    return cleanText(new URL(url).hostname).toLowerCase()
  } catch {
    return ''
  }
}

function summarizeStatusClasses(rows = []) {
  const counts = {}
  for (const row of rows) {
    const key = cleanText(row.status_class) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function summarizeByNetwork(rows = []) {
  const result = {}
  for (const row of rows) {
    const network = cleanText(row.network).toLowerCase() || 'unknown'
    if (!result[network]) {
      result[network] = {
        total: 0,
        ok: 0,
        status_class: {},
      }
    }
    const bucket = result[network]
    bucket.total += 1
    if (row.ok === true) bucket.ok += 1
    const cls = cleanText(row.status_class) || 'unknown'
    bucket.status_class[cls] = (bucket.status_class[cls] || 0) + 1
  }
  return result
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

async function checkLink(targetUrl, options = {}) {
  const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'inventory-health-links/1.0',
      },
    })
    const statusClass = classifyHttpStatus(response.status)
    return {
      ok: response.status >= 200 && response.status < 400,
      status: Number(response.status) || 0,
      status_class: statusClass,
      final_url: cleanText(response.url || targetUrl),
      error_class: '',
      error_message: '',
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      status_class: classifyFetchError(error),
      final_url: cleanText(targetUrl),
      error_class: classifyFetchError(error),
      error_message: cleanText(error?.message || String(error)),
    }
  }
}

async function auditRows(rows = [], options = {}) {
  const limiter = createLimiter(options.concurrency)
  const tasks = rows.map((row) => limiter(async () => {
    const targetUrl = cleanText(row.target_url)
    if (!targetUrl) {
      return {
        offer_id: cleanText(row.offer_id),
        network: cleanText(row.network),
        target_url: '',
        domain: '',
        ok: false,
        status: 0,
        status_class: 'invalid_url',
        final_url: '',
        error_class: 'invalid_url',
        error_message: 'missing_target_url',
        source_file: cleanText(row.source_file),
      }
    }
    const linkCheck = await checkLink(targetUrl, options)
    return {
      offer_id: cleanText(row.offer_id),
      network: cleanText(row.network),
      target_url: targetUrl,
      domain: toUrlDomain(targetUrl),
      ok: linkCheck.ok === true,
      status: linkCheck.status,
      status_class: linkCheck.status_class,
      final_url: cleanText(linkCheck.final_url),
      error_class: cleanText(linkCheck.error_class),
      error_message: cleanText(linkCheck.error_message),
      source_file: cleanText(row.source_file),
    }
  }))
  return await Promise.all(tasks)
}

function topDomains(rows = [], limit = 20) {
  const buckets = new Map()
  for (const row of rows) {
    const domain = cleanText(row.domain).toLowerCase()
    if (!domain) continue
    const current = buckets.get(domain) || { domain, total: 0, errors: 0 }
    current.total += 1
    if (!(row.ok === true)) current.errors += 1
    buckets.set(domain, current)
  }
  return [...buckets.values()]
    .sort((a, b) => b.errors - a.errors || b.total - a.total || a.domain.localeCompare(b.domain))
    .slice(0, Math.max(1, limit))
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

export async function runLinkHealthAudit(rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
  const startedAt = Date.now()
  const timeoutMs = toPositiveInteger(args['timeout-ms'], DEFAULT_TIMEOUT_MS)
  const concurrency = toPositiveInteger(args.concurrency, DEFAULT_CONCURRENCY)
  const sampleSize = toPositiveInteger(args['sample-size'], 200)
  const tag = timestampTag()
  const outputFile = path.resolve(
    PROJECT_ROOT,
    cleanText(args['output-file']) || path.join(OUTPUT_ROOT, `link-health-${tag}.json`),
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
      ok_count: auditedRows.filter((row) => row.ok === true).length,
      error_count: auditedRows.filter((row) => row.ok !== true).length,
      status_class: summarizeStatusClasses(auditedRows),
      by_network: summarizeByNetwork(auditedRows),
      top_error_domains: topDomains(auditedRows, 20),
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
  const report = await runLinkHealthAudit(args)
  printJson({
    ok: true,
    mode: report.mode,
    totalRows: report.summary.total_rows,
    okCount: report.summary.ok_count,
    errorCount: report.summary.error_count,
    statusClass: report.summary.status_class,
    outputFile: report.output_file,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[inventory-health-links] failed:', error?.message || error)
    process.exit(1)
  })
}

export const __linksHealthInternal = Object.freeze({
  classifyHttpStatus,
  classifyFetchError,
  summarizeStatusClasses,
})
