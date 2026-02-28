#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '../inventory/common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'pilot-content')

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

function toBoolean(value, fallback = false) {
  const text = cleanText(value).toLowerCase()
  if (!text) return fallback
  if (text === 'true' || text === '1' || text === 'yes') return true
  if (text === 'false' || text === '0' || text === 'no') return false
  return fallback
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function buildBidPayload(caseRow = {}, options = {}) {
  const caseId = cleanText(caseRow.case_id || 'pilot_case')
  const query = cleanText(caseRow.query || `${caseRow.case_name || caseId} offers`)
  return {
    appId: cleanText(options.appId || 'sample-client-app'),
    sessionId: `pilot_session_${caseId}`,
    turnId: `pilot_turn_${caseId}`,
    placementId: cleanText(options.placementId || 'chat_intent_recommendation_v1'),
    messages: [
      {
        role: 'user',
        content: query,
        timestamp: nowIso(),
      },
      {
        role: 'assistant',
        content: 'Here are sponsored options to compare.',
        timestamp: nowIso(),
      },
    ],
  }
}

async function callBidApi(runtimeUrl, payload, options = {}) {
  const endpoint = `${runtimeUrl}/api/v2/bid`
  const headers = {
    'content-type': 'application/json',
  }
  const runtimeKey = cleanText(options.runtimeKey)
  const authHeader = cleanText(options.authHeader)
  if (runtimeKey) headers['x-runtime-key'] = runtimeKey
  if (authHeader) headers.authorization = authHeader

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
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
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'request_failed',
      body: null,
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runtimeUrl = toHttpUrl(args['runtime-url'] || args.runtimeUrl)
  if (!runtimeUrl) {
    throw new Error('runtime-url is required, e.g. --runtime-url=https://your-preview.vercel.app')
  }

  const latestRunPath = path.join(OUTPUT_ROOT, 'latest-run.json')
  const latestRun = await readJson(latestRunPath)
  const runDir = path.resolve(PROJECT_ROOT, cleanText(latestRun?.outputs?.run_dir || ''))
  const selectedCasesPath = path.join(runDir, 'selected-cases.json')
  const selectedCases = await readJson(selectedCasesPath)
  if (!Array.isArray(selectedCases) || selectedCases.length === 0) {
    throw new Error('No selected pilot cases found in latest run.')
  }

  const samples = []
  for (const item of selectedCases) {
    const payload = buildBidPayload(item, {
      appId: args.appId,
      placementId: args.placementId || args['placement-id'],
    })
    const response = await callBidApi(runtimeUrl, payload, {
      runtimeKey: args.runtimeKey || args['runtime-key'] || process.env.RUNTIME_API_KEY,
      authHeader: args.authHeader || args['auth-header'],
    })
    samples.push({
      case_id: cleanText(item.case_id),
      query: cleanText(item.query),
      request: payload,
      response,
    })
  }

  const outputFile = cleanText(args.output || args['output-file'])
    ? path.resolve(PROJECT_ROOT, cleanText(args.output || args['output-file']))
    : path.join(runDir, 'api-samples.json')

  await writeJson(outputFile, {
    generated_at: nowIso(),
    runtime_url: runtimeUrl,
    samples,
  })

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime_url: runtimeUrl,
    sample_count: samples.length,
    output_file: path.relative(PROJECT_ROOT, outputFile),
    strict_success: toBoolean(args.strictSuccess || args['strict-success'], false)
      ? samples.every((item) => item.response?.ok === true)
      : null,
  }, null, 2)}\n`)
}

main().catch((error) => {
  console.error('[pilot-fetch-api-samples] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
