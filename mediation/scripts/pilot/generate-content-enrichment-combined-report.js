#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, withDbPool } from '../inventory/common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'content-enrichment')
const DEFAULT_SAMPLE_SIZE = 200

function cleanText(value) {
  return String(value || '').trim()
}

function toPositiveInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function nowIso() {
  return new Date().toISOString()
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

async function writeText(filePath, payload) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, payload, 'utf8')
}

function parseRunIds(raw = '') {
  return raw
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean)
}

function mapByNetwork(rows = []) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const network = cleanText(row.network).toLowerCase()
    if (!network) continue
    map.set(network, row)
  }
  return map
}

function mergeCoverageSummaries(summaries = []) {
  const beforeByNetwork = new Map()
  const afterByNetwork = new Map()
  for (const summary of summaries) {
    for (const row of Array.isArray(summary.coverage_before) ? summary.coverage_before : []) {
      const network = cleanText(row.network).toLowerCase()
      if (!network) continue
      if (!beforeByNetwork.has(network)) beforeByNetwork.set(network, row)
    }
    for (const row of Array.isArray(summary.coverage_after) ? summary.coverage_after : []) {
      const network = cleanText(row.network).toLowerCase()
      if (!network) continue
      afterByNetwork.set(network, row)
    }
  }

  const networks = Array.from(new Set([
    ...beforeByNetwork.keys(),
    ...afterByNetwork.keys(),
  ])).sort()

  const merged = networks.map((network) => {
    const before = beforeByNetwork.get(network) || {}
    const after = afterByNetwork.get(network) || {}
    return {
      network,
      total_active_before: Number(before.total_active || 0),
      total_active_after: Number(after.total_active || 0),
      with_description_before: Number(before.with_description || 0),
      with_description_after: Number(after.with_description || 0),
      with_image_before: Number(before.with_image || 0),
      with_image_after: Number(after.with_image || 0),
      description_coverage_before: Number(before.description_coverage || 0),
      description_coverage_after: Number(after.description_coverage || 0),
      image_coverage_before: Number(before.image_coverage || 0),
      image_coverage_after: Number(after.image_coverage || 0),
    }
  })

  return {
    networks,
    coverage_delta: merged,
  }
}

function buildApiSampleInputs(rows = []) {
  return rows.map((row, index) => ({
    sample_id: `combined_sample_${String(index + 1).padStart(4, '0')}`,
    offer_id: cleanText(row.offer_id),
    network: cleanText(row.network),
    request: {
      appId: 'sample-client-app',
      sessionId: `combined_full_session_${cleanText(row.network)}_${index + 1}`,
      turnId: `combined_full_turn_${index + 1}`,
      messages: [
        {
          role: 'user',
          content: cleanText(row.title || row.description || row.offer_id),
          timestamp: nowIso(),
        },
      ],
    },
  }))
}

function toMarkdownTable(rows = []) {
  const header = '| network | desc_before | desc_after | image_before | image_after | desc_cov_before | desc_cov_after | image_cov_before | image_cov_after |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n'
  const body = rows.map((row) => {
    return `| ${cleanText(row.network)} | ${row.with_description_before} | ${row.with_description_after} | ${row.with_image_before} | ${row.with_image_after} | ${Number(row.description_coverage_before || 0).toFixed(4)} | ${Number(row.description_coverage_after || 0).toFixed(4)} | ${Number(row.image_coverage_before || 0).toFixed(4)} | ${Number(row.image_coverage_after || 0).toFixed(4)} |`
  }).join('\n')
  return `${header}${body}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runIds = parseRunIds(cleanText(args['run-ids'] || args.runIds))
  if (runIds.length === 0) {
    throw new Error('--run-ids is required. Example: --run-ids=full_x,full_y')
  }
  const sampleSize = toPositiveInteger(args['sample-size'] || args.sampleSize, DEFAULT_SAMPLE_SIZE)

  const summaries = []
  for (const runId of runIds) {
    const summaryPath = path.join(OUTPUT_ROOT, runId, 'summary.json')
    summaries.push(await readJson(summaryPath))
  }

  const merged = mergeCoverageSummaries(summaries)
  const networks = merged.networks
  const perNetworkSample = Math.max(1, Math.floor(sampleSize / Math.max(1, networks.length)))

  const sampledRows = await withDbPool(async (pool) => {
    const all = []
    for (const network of networks) {
      const result = await pool.query(
        `
          SELECT offer_id, network, title, description, target_url, metadata
          FROM offer_inventory_norm
          WHERE availability = 'active'
            AND network = $1
          ORDER BY md5(offer_id || $2::text) ASC
          LIMIT $3
        `,
        [network, cleanText(runIds.join('|')), perNetworkSample],
      )
      all.push(...(Array.isArray(result.rows) ? result.rows : []))
    }
    return all.slice(0, sampleSize)
  })

  const combinedRunId = `combined_${Date.now().toString(36)}`
  const runDir = path.join(OUTPUT_ROOT, 'combined', combinedRunId)
  const reportDir = path.join(runDir, 'report')

  const combinedReport = {
    generated_at: nowIso(),
    run_ids: runIds,
    networks,
    totals: summaries.reduce((acc, summary) => {
      const totals = summary?.totals && typeof summary.totals === 'object' ? summary.totals : {}
      acc.scanned += Number(totals.scanned || 0)
      acc.processed += Number(totals.processed || 0)
      acc.changed += Number(totals.changed || 0)
      acc.passed += Number(totals.passed || 0)
      acc.failed += Number(totals.failed || 0)
      acc.batches += Number(totals.batches || 0)
      return acc
    }, {
      scanned: 0,
      processed: 0,
      changed: 0,
      passed: 0,
      failed: 0,
      batches: 0,
    }),
    coverage_delta: merged.coverage_delta,
    source_summaries: summaries.map((summary) => ({
      run_id: cleanText(summary.run_id),
      status: cleanText(summary.status),
      totals: summary.totals || {},
      outputs: summary.outputs || {},
    })),
  }

  const apiSampleInputs = {
    generated_at: nowIso(),
    run_ids: runIds,
    sample_size: sampledRows.length,
    samples: buildApiSampleInputs(sampledRows),
  }

  const screenshotChecklist = {
    generated_at: nowIso(),
    run_ids: runIds,
    checks: sampledRows.slice(0, 120).map((row) => ({
      network: cleanText(row.network),
      offer_id: cleanText(row.offer_id),
      type: cleanText(row?.metadata?.image_url || row?.metadata?.imageUrl) ? 'with_image' : 'without_image',
      title: cleanText(row.title),
    })),
  }

  const reportJsonPath = path.join(reportDir, 'combined-report.json')
  const reportMdPath = path.join(reportDir, 'combined-report.md')
  const apiInputPath = path.join(reportDir, 'combined-api-sample-inputs.json')
  const screenshotPath = path.join(reportDir, 'combined-screenshot-checklist.json')

  const markdown = [
    '# Full Content Enrichment Combined Report',
    '',
    `- generated_at: ${combinedReport.generated_at}`,
    `- run_ids: ${runIds.join(', ')}`,
    `- networks: ${networks.join(', ')}`,
    '',
    '## Totals',
    '',
    `- scanned: ${combinedReport.totals.scanned}`,
    `- processed: ${combinedReport.totals.processed}`,
    `- changed: ${combinedReport.totals.changed}`,
    `- passed: ${combinedReport.totals.passed}`,
    `- failed: ${combinedReport.totals.failed}`,
    `- batches: ${combinedReport.totals.batches}`,
    '',
    '## Coverage Delta',
    '',
    toMarkdownTable(combinedReport.coverage_delta),
    '## Files',
    '',
    `- combined_report_json: ${path.relative(PROJECT_ROOT, reportJsonPath)}`,
    `- combined_api_sample_inputs_json: ${path.relative(PROJECT_ROOT, apiInputPath)}`,
    `- combined_screenshot_checklist_json: ${path.relative(PROJECT_ROOT, screenshotPath)}`,
  ].join('\n')

  await writeJson(reportJsonPath, combinedReport)
  await writeText(reportMdPath, `${markdown}\n`)
  await writeJson(apiInputPath, apiSampleInputs)
  await writeJson(screenshotPath, screenshotChecklist)
  await writeJson(path.join(OUTPUT_ROOT, 'latest-combined-report.json'), {
    generated_at: nowIso(),
    run_ids: runIds,
    combined_report_json: path.relative(PROJECT_ROOT, reportJsonPath),
    combined_report_md: path.relative(PROJECT_ROOT, reportMdPath),
  })

  process.stdout.write(`${JSON.stringify({
    ok: true,
    run_ids: runIds,
    combined_report_json: path.relative(PROJECT_ROOT, reportJsonPath),
    combined_report_md: path.relative(PROJECT_ROOT, reportMdPath),
    combined_api_sample_inputs_json: path.relative(PROJECT_ROOT, apiInputPath),
    combined_screenshot_checklist_json: path.relative(PROJECT_ROOT, screenshotPath),
  }, null, 2)}\n`)
}

if (path.resolve(process.argv[1] || '') === __filename) {
  main().catch((error) => {
    console.error('[content-enrich-combined-report] failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export const __combinedContentInternal = Object.freeze({
  parseRunIds,
  mergeCoverageSummaries,
})
