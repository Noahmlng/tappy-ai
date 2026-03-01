#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, withDbPool } from '../inventory/common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'content-enrichment')
const DEFAULT_API_SAMPLE_SIZE = 200

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

function resolveRunDir(args = {}) {
  const explicitRunDir = cleanText(args['run-dir'] || args.runDir)
  if (explicitRunDir) return path.resolve(PROJECT_ROOT, explicitRunDir)
  const explicitRunId = cleanText(args['run-id'] || args.runId)
  if (explicitRunId) return path.join(OUTPUT_ROOT, explicitRunId)
  return ''
}

function parseNetworksFromSummary(summary = {}) {
  const rows = Array.isArray(summary.coverage_after) ? summary.coverage_after : []
  const list = rows.map((row) => cleanText(row.network).toLowerCase()).filter(Boolean)
  if (list.length > 0) return Array.from(new Set(list))
  return ['house', 'partnerstack']
}

function buildApiSampleInputRows(rows = []) {
  return rows.map((row, index) => ({
    sample_id: `full_sample_${String(index + 1).padStart(4, '0')}`,
    offer_id: cleanText(row.offer_id),
    network: cleanText(row.network),
    request: {
      appId: 'sample-client-app',
      sessionId: `full_enrich_session_${cleanText(row.network)}_${index + 1}`,
      turnId: `full_enrich_turn_${index + 1}`,
      messages: [
        {
          role: 'user',
          content: cleanText(row.title) || cleanText(row.description) || 'recommend offers',
          timestamp: nowIso(),
        },
      ],
    },
    expected: {
      target_url: cleanText(row.target_url),
      description_non_empty: cleanText(row.description).length > 0,
      image_url_present: Boolean(cleanText(row?.metadata?.image_url || row?.metadata?.imageUrl)),
    },
  }))
}

function toMarkdownTable(rows = []) {
  const header = '| network | total_active_before | total_active_after | description_coverage_before | description_coverage_after | image_coverage_before | image_coverage_after |\n|---|---:|---:|---:|---:|---:|---:|\n'
  const body = rows.map((row) => {
    const bDesc = Number(row.description_coverage_before || 0)
    const aDesc = Number(row.description_coverage_after || 0)
    const bImg = Number(row.image_coverage_before || 0)
    const aImg = Number(row.image_coverage_after || 0)
    return `| ${cleanText(row.network)} | ${Number(row.total_active_before || 0)} | ${Number(row.total_active_after || 0)} | ${bDesc.toFixed(4)} | ${aDesc.toFixed(4)} | ${bImg.toFixed(4)} | ${aImg.toFixed(4)} |`
  }).join('\n')
  return `${header}${body}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let runDir = resolveRunDir(args)
  if (!runDir) {
    const latestRunPath = path.join(OUTPUT_ROOT, 'latest-run.json')
    const latest = await readJson(latestRunPath)
    runDir = path.resolve(PROJECT_ROOT, cleanText(latest?.outputs?.run_dir || ''))
  }
  if (!runDir) {
    throw new Error('Unable to resolve run directory. Provide --run-dir or --run-id.')
  }

  const summaryPath = path.join(runDir, 'summary.json')
  const manifestPath = path.join(runDir, 'manifest.json')
  const failedBatchesPath = path.join(runDir, 'failed-batches.json')

  const summary = await readJson(summaryPath)
  const manifest = await readJson(manifestPath)
  let failedBatches = []
  try {
    failedBatches = await readJson(failedBatchesPath)
  } catch {
    failedBatches = []
  }

  const networks = parseNetworksFromSummary(summary)
  const sampleSize = toPositiveInteger(args['sample-size'] || args.sampleSize, DEFAULT_API_SAMPLE_SIZE)

  const sampledRows = await withDbPool(async (pool) => {
    const result = await pool.query(
      `
        SELECT
          offer_id,
          network,
          title,
          description,
          target_url,
          metadata
        FROM offer_inventory_norm
        WHERE availability = 'active'
          AND network = ANY($1::text[])
        ORDER BY md5(offer_id || $2::text) ASC
        LIMIT $3
      `,
      [networks, cleanText(summary.run_id), sampleSize],
    )
    return Array.isArray(result.rows) ? result.rows : []
  })

  const apiSampleInputs = {
    run_id: cleanText(summary.run_id),
    generated_at: nowIso(),
    sample_size: sampledRows.length,
    samples: buildApiSampleInputRows(sampledRows),
  }

  const imageRows = sampledRows.filter((row) => Boolean(cleanText(row?.metadata?.image_url || row?.metadata?.imageUrl)))
  const noImageRows = sampledRows.filter((row) => !cleanText(row?.metadata?.image_url || row?.metadata?.imageUrl))
  const screenshotChecklist = {
    run_id: cleanText(summary.run_id),
    generated_at: nowIso(),
    checks: [
      ...imageRows.slice(0, 20).map((row) => ({
        type: 'with_image',
        network: cleanText(row.network),
        offer_id: cleanText(row.offer_id),
        title: cleanText(row.title),
      })),
      ...noImageRows.slice(0, 20).map((row) => ({
        type: 'without_image',
        network: cleanText(row.network),
        offer_id: cleanText(row.offer_id),
        title: cleanText(row.title),
      })),
    ],
  }

  const reportDir = path.join(runDir, 'report')
  const reportJsonPath = path.join(reportDir, 'full-report.json')
  const reportMdPath = path.join(reportDir, 'full-report.md')
  const apiSampleInputsPath = path.join(reportDir, 'api-sample-inputs.json')
  const screenshotChecklistPath = path.join(reportDir, 'screenshot-checklist.json')

  const report = {
    generated_at: nowIso(),
    run_id: cleanText(summary.run_id),
    status: cleanText(summary.status),
    totals: summary.totals || {},
    coverage_delta: Array.isArray(summary.coverage_delta) ? summary.coverage_delta : [],
    failed_batches_count: Array.isArray(failedBatches) ? failedBatches.length : 0,
    failed_batches: Array.isArray(failedBatches) ? failedBatches : [],
    files: {
      summary_json: path.relative(PROJECT_ROOT, summaryPath),
      manifest_json: path.relative(PROJECT_ROOT, manifestPath),
      api_sample_inputs_json: path.relative(PROJECT_ROOT, apiSampleInputsPath),
      screenshot_checklist_json: path.relative(PROJECT_ROOT, screenshotChecklistPath),
    },
    progress: manifest.progress || {},
  }

  const markdown = [
    '# Full Content Enrichment Report',
    '',
    `- generated_at: ${report.generated_at}`,
    `- run_id: ${report.run_id}`,
    `- status: ${report.status}`,
    '',
    '## Totals',
    '',
    `- batches: ${Number(report.totals.batches || 0)}`,
    `- scanned: ${Number(report.totals.scanned || 0)}`,
    `- processed: ${Number(report.totals.processed || 0)}`,
    `- changed: ${Number(report.totals.changed || 0)}`,
    `- passed: ${Number(report.totals.passed || 0)}`,
    `- failed: ${Number(report.totals.failed || 0)}`,
    '',
    '## Coverage Delta',
    '',
    toMarkdownTable(report.coverage_delta),
    '## Failed Batches',
    '',
    `- count: ${report.failed_batches_count}`,
    '',
    '## Files',
    '',
    `- summary_json: ${report.files.summary_json}`,
    `- manifest_json: ${report.files.manifest_json}`,
    `- api_sample_inputs_json: ${report.files.api_sample_inputs_json}`,
    `- screenshot_checklist_json: ${report.files.screenshot_checklist_json}`,
  ].join('\n')

  await writeJson(reportJsonPath, report)
  await writeText(reportMdPath, `${markdown}\n`)
  await writeJson(apiSampleInputsPath, apiSampleInputs)
  await writeJson(screenshotChecklistPath, screenshotChecklist)
  await writeJson(path.join(OUTPUT_ROOT, 'latest-report.json'), {
    generated_at: nowIso(),
    run_id: report.run_id,
    report_json: path.relative(PROJECT_ROOT, reportJsonPath),
    report_md: path.relative(PROJECT_ROOT, reportMdPath),
  })

  process.stdout.write(`${JSON.stringify({
    ok: true,
    run_id: report.run_id,
    report_json: path.relative(PROJECT_ROOT, reportJsonPath),
    report_md: path.relative(PROJECT_ROOT, reportMdPath),
    api_sample_inputs_json: path.relative(PROJECT_ROOT, apiSampleInputsPath),
    screenshot_checklist_json: path.relative(PROJECT_ROOT, screenshotChecklistPath),
  }, null, 2)}\n`)
}

main().catch((error) => {
  console.error('[content-enrich-report] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
