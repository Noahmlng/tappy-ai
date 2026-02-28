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

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function writeText(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, payload, 'utf8')
}

function toMarkdownTable(rows = []) {
  const header = '| case_id | offer_id | pass | description_len | image_url |\n|---|---|---:|---:|---|\n'
  const body = rows.map((row) => {
    const description = cleanText(row?.after?.description)
    const imageUrl = cleanText(row?.after?.image_url)
    const pass = row?.acceptance?.pass === true ? 'yes' : 'no'
    return `| ${cleanText(row.case_id)} | ${cleanText(row.after?.offer_id)} | ${pass} | ${description.length} | ${imageUrl || '(none)'} |`
  }).join('\n')
  return `${header}${body}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const latestRunPath = path.join(OUTPUT_ROOT, 'latest-run.json')
  const latestRun = await readJson(latestRunPath)
  const runDir = path.resolve(PROJECT_ROOT, cleanText(latestRun?.outputs?.run_dir || ''))
  const beforeAfter = await readJson(path.join(runDir, 'before-after.json'))
  const acceptance = await readJson(path.join(runDir, 'acceptance.json'))
  const selected = await readJson(path.join(runDir, 'selected-cases.json'))
  const apiSamplesPath = cleanText(args['api-samples'] || args.apiSamples)
    ? path.resolve(PROJECT_ROOT, cleanText(args['api-samples'] || args.apiSamples))
    : path.join(runDir, 'api-samples.json')

  let apiSamples = null
  try {
    apiSamples = await readJson(apiSamplesPath)
  } catch {
    apiSamples = null
  }

  const acceptanceByCase = new Map(
    (Array.isArray(acceptance) ? acceptance : []).map((row) => [cleanText(row.case_id), row]),
  )
  const mergedRows = (Array.isArray(beforeAfter) ? beforeAfter : []).map((row) => ({
    ...row,
    acceptance: acceptanceByCase.get(cleanText(row.case_id)) || null,
  }))

  const review = {
    generated_at: nowIso(),
    run_id: cleanText(latestRun?.run_id),
    run_dir: path.relative(PROJECT_ROOT, runDir),
    totals: {
      selected_cases: Array.isArray(selected) ? selected.length : 0,
      before_after_cases: mergedRows.length,
      pass_count: mergedRows.filter((row) => row.acceptance?.pass === true).length,
      fail_count: mergedRows.filter((row) => row.acceptance?.pass !== true).length,
      api_sample_count: Array.isArray(apiSamples?.samples) ? apiSamples.samples.length : 0,
    },
    files: {
      selected_cases_json: path.relative(PROJECT_ROOT, path.join(runDir, 'selected-cases.json')),
      before_after_json: path.relative(PROJECT_ROOT, path.join(runDir, 'before-after.json')),
      acceptance_json: path.relative(PROJECT_ROOT, path.join(runDir, 'acceptance.json')),
      api_samples_json: apiSamples ? path.relative(PROJECT_ROOT, apiSamplesPath) : '',
    },
    cases: mergedRows.map((row) => ({
      case_id: cleanText(row.case_id),
      case_name: cleanText(row.case_name),
      query: cleanText(row.query),
      network: cleanText(row.network),
      offer_id: cleanText(row.after?.offer_id),
      changed: row.changed === true,
      acceptance: row.acceptance,
      before: row.before,
      after: row.after,
      evidence: row.evidence,
    })),
  }

  const reviewDir = path.join(OUTPUT_ROOT, 'review-pack', cleanText(latestRun?.run_id || `run_${Date.now()}`))
  const reviewJsonPath = path.join(reviewDir, 'review-pack.json')
  const reviewMdPath = path.join(reviewDir, 'review-pack.md')

  const markdown = [
    '# Pilot Review Pack',
    '',
    `- generated_at: ${review.generated_at}`,
    `- run_id: ${review.run_id}`,
    `- run_dir: ${review.run_dir}`,
    '',
    '## Acceptance Snapshot',
    '',
    toMarkdownTable(mergedRows),
    '## Files',
    '',
    `- selected_cases_json: ${review.files.selected_cases_json}`,
    `- before_after_json: ${review.files.before_after_json}`,
    `- acceptance_json: ${review.files.acceptance_json}`,
    `- api_samples_json: ${review.files.api_samples_json || '(not generated yet)'}`,
    '',
    '## Screenshot Checklist',
    '',
    '1. House with image',
    '2. House without image',
    '3. PartnerStack with image',
    '4. PartnerStack without image',
  ].join('\n')

  await writeJson(reviewJsonPath, review)
  await writeText(reviewMdPath, `${markdown}\n`)
  await writeJson(path.join(OUTPUT_ROOT, 'latest-review-pack.json'), {
    generated_at: nowIso(),
    review_json: path.relative(PROJECT_ROOT, reviewJsonPath),
    review_md: path.relative(PROJECT_ROOT, reviewMdPath),
  })

  process.stdout.write(`${JSON.stringify({
    ok: true,
    review_json: path.relative(PROJECT_ROOT, reviewJsonPath),
    review_md: path.relative(PROJECT_ROOT, reviewMdPath),
  }, null, 2)}\n`)
}

main().catch((error) => {
  console.error('[pilot-generate-review-pack] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
