#!/usr/bin/env node
import path from 'node:path'
import {
  RAW_ROOT,
  parseArgs,
  timestampTag,
  writeJson,
  writeJsonl,
  ensureDir,
  toInteger,
  cleanText,
} from './lib/common.js'
import { SEARCH_TEMPLATES, VERTICAL_TAXONOMY } from './lib/vertical-taxonomy.js'

const SEARCH_JOBS_DIR = path.join(RAW_ROOT, 'search-jobs')

function dedupeQueries(queries = []) {
  const seen = new Set()
  const output = []
  for (const query of queries) {
    const normalized = cleanText(query).toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(cleanText(query))
  }
  return output
}

function buildDiscoveryQueries(vertical) {
  const templates = SEARCH_TEMPLATES.discovery
  const all = []
  for (const keyword of vertical.keywords || []) {
    for (const template of templates) {
      all.push(template.replaceAll('{keyword}', keyword))
    }
  }
  return dedupeQueries(all)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const perVerticalLimit = toInteger(args['per-vertical-limit'], 18)
  const tag = timestampTag()
  const jobs = []

  for (const vertical of VERTICAL_TAXONOMY) {
    const queries = buildDiscoveryQueries(vertical).slice(0, Math.max(1, perVerticalLimit))
    for (const query of queries) {
      const id = `job_${vertical.vertical_l1}_${vertical.vertical_l2}_${jobs.length + 1}`
      jobs.push({
        id,
        jobType: 'brand_discovery',
        query,
        vertical_l1: vertical.vertical_l1,
        vertical_l2: vertical.vertical_l2,
        localeHint: 'en-US',
        market: 'US',
      })
    }
  }

  await ensureDir(SEARCH_JOBS_DIR)
  const jsonlPath = path.join(SEARCH_JOBS_DIR, `search-jobs-${tag}.jsonl`)
  const summaryPath = path.join(SEARCH_JOBS_DIR, `search-jobs-${tag}.summary.json`)
  const latestPath = path.join(SEARCH_JOBS_DIR, 'latest-search-jobs.json')

  await writeJsonl(jsonlPath, jobs)
  await writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    totalJobs: jobs.length,
    perVerticalLimit,
    output: path.relative(process.cwd(), jsonlPath),
  })
  await writeJson(latestPath, {
    generatedAt: new Date().toISOString(),
    latestJsonl: path.relative(process.cwd(), jsonlPath),
    latestSummary: path.relative(process.cwd(), summaryPath),
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        totalJobs: jobs.length,
        jsonlPath: path.relative(process.cwd(), jsonlPath),
        summaryPath: path.relative(process.cwd(), summaryPath),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[build-search-jobs] failed:', error?.message || error)
  process.exit(1)
})
