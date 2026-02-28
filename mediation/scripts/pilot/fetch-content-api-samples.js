#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '../inventory/common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')

function cleanText(value) {
  return String(value || '').trim()
}

function nowIso() {
  return new Date().toISOString()
}

function toHttpUrl(value) {
  const raw = cleanText(value)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    const protocol = cleanText(parsed.protocol).toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') return ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function toPositiveInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function withTimeoutSignal(timeoutMs) {
  const ms = toPositiveInteger(timeoutMs, 12000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer)
    },
  }
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export function buildAuthHeaders(options = {}) {
  const runtimeKey = cleanText(options.runtimeKey)
  const explicitAuthHeader = cleanText(options.authHeader)
  const authorization = explicitAuthHeader || (runtimeKey ? `Bearer ${runtimeKey}` : '')
  const headers = {}
  if (runtimeKey) headers['x-runtime-key'] = runtimeKey
  if (authorization) headers.authorization = authorization
  return headers
}

async function callBid(runtimeUrl, payload, options = {}) {
  const timeoutMs = toPositiveInteger(options.timeoutMs, 12000)
  const headers = {
    'content-type': 'application/json',
    ...buildAuthHeaders(options),
  }
  const timeout = withTimeoutSignal(timeoutMs)
  const requestPromise = (async () => {
    const response = await fetch(`${runtimeUrl}/api/v2/bid`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: timeout.signal,
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text }
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
    }
  })()

  let timeoutTimer = null
  const timeoutPromise = new Promise((resolve) => {
    timeoutTimer = setTimeout(() => {
      resolve({
        ok: false,
        status: 0,
        error: 'request_timeout',
        body: null,
      })
    }, timeoutMs + 200)
  })

  try {
    const result = await Promise.race([requestPromise, timeoutPromise])
    if (timeoutTimer) clearTimeout(timeoutTimer)
    return result
  } catch (error) {
    const timeoutAborted = Boolean(timeout.signal?.aborted)
    return {
      ok: false,
      status: 0,
      error: timeoutAborted
        ? 'request_timeout'
        : (error instanceof Error ? error.message : 'request_failed'),
      body: null,
    }
  } finally {
    timeout.clear()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runtimeUrl = toHttpUrl(args['runtime-url'] || args.runtimeUrl)
  if (!runtimeUrl) {
    throw new Error('--runtime-url is required')
  }
  const inputPath = cleanText(args.input || args['input-file'])
    ? path.resolve(PROJECT_ROOT, cleanText(args.input || args['input-file']))
    : ''
  if (!inputPath) {
    throw new Error('--input is required (combined-api-sample-inputs.json)')
  }
  const payload = await readJson(inputPath)
  const samples = Array.isArray(payload?.samples) ? payload.samples : []
  if (samples.length === 0) {
    throw new Error('input samples is empty')
  }
  const concurrency = toPositiveInteger(args.concurrency, 8)
  const limiter = createLimiter(concurrency)
  const requestOptions = {
    runtimeKey: args['runtime-key'] || args.runtimeKey || process.env.RUNTIME_API_KEY,
    authHeader: args['auth-header'] || args.authHeader,
    timeoutMs: toPositiveInteger(args['fetch-timeout-ms'] || args.fetchTimeoutMs, 12000),
  }

  const responses = await Promise.all(samples.map((sample) => limiter(async () => {
    const request = sample?.request && typeof sample.request === 'object' ? sample.request : {}
    const response = await callBid(runtimeUrl, request, requestOptions)
    return {
      sample_id: cleanText(sample.sample_id),
      offer_id: cleanText(sample.offer_id),
      network: cleanText(sample.network),
      request,
      response,
      captured_at: nowIso(),
    }
  })))

  const outputPath = cleanText(args.output || args['output-file'])
    ? path.resolve(PROJECT_ROOT, cleanText(args.output || args['output-file']))
    : path.join(path.dirname(inputPath), 'combined-api-samples.json')

  const result = {
    generated_at: nowIso(),
    runtime_url: runtimeUrl,
    input_file: path.relative(PROJECT_ROOT, inputPath),
    total: responses.length,
    success_count: responses.filter((row) => row.response?.ok === true).length,
    failed_count: responses.filter((row) => row.response?.ok !== true).length,
    concurrency,
    fetch_timeout_ms: requestOptions.timeoutMs,
    samples: responses,
  }
  await writeJson(outputPath, result)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime_url: runtimeUrl,
    output_file: path.relative(PROJECT_ROOT, outputPath),
    total: result.total,
    success_count: result.success_count,
    failed_count: result.failed_count,
  }, null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('[fetch-content-api-samples] failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
