#!/usr/bin/env node
import path from 'node:path'
import {
  RAW_ROOT,
  parseArgs,
  timestampTag,
  writeJson,
  writeJsonl,
  ensureDir,
  cleanText,
} from './lib/common.js'

const SEARCH_JOBS_DIR = path.join(RAW_ROOT, 'search-jobs')

const MARKET_SUFFIXES = ['US', 'North America', 'Europe', 'Japan', 'Korea']
const BASE_TEMPLATES = [
  '"{keyword}" brands official websites {market}',
  '"{keyword}" brand list manufacturers {market}',
  '"{keyword}" company official site',
  '"{keyword}" direct to consumer brand {market}',
  '"{keyword}" pet tech manufacturer {market}',
]

function dedupeQueries(queries = []) {
  const seen = new Set()
  const out = []
  for (const query of queries) {
    const normalized = cleanText(query).toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(cleanText(query))
  }
  return out
}

function buildQueries(keywords = []) {
  const queries = []
  for (const keyword of keywords) {
    for (const template of BASE_TEMPLATES) {
      for (const market of MARKET_SUFFIXES) {
        queries.push(template.replaceAll('{keyword}', keyword).replaceAll('{market}', market))
      }
    }
  }
  return dedupeQueries(queries)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const verticalL1 = cleanText(args['vertical-l1'] || 'consumer_electronics')
  const verticalL2 = cleanText(args['vertical-l2'] || 'pet_supplies')
  const market = cleanText(args.market || 'US')
  const localeHint = cleanText(args.locale || 'en-US')
  const perKeywordLimit = Math.max(1, Number(args['per-keyword-limit'] || 8))
  const explicitKeywords = cleanText(args.keywords)

  const keywords = explicitKeywords
    ? explicitKeywords.split(',').map((item) => cleanText(item)).filter(Boolean)
    : [
        'smart pet feeder',
        'pet camera',
        'pet tracker',
        'GPS pet collar',
        'automatic litter box',
        'pet water fountain',
        'pet health monitor',
        'pet tech device',
      ]

  const rawQueries = buildQueries(keywords)
  const clipped = rawQueries.slice(0, keywords.length * perKeywordLimit)
  const tag = timestampTag()
  const jobs = clipped.map((query, idx) => ({
    id: `job_targeted_${verticalL1}_${verticalL2}_${idx + 1}`,
    jobType: 'brand_discovery_targeted',
    query,
    vertical_l1: verticalL1,
    vertical_l2: verticalL2,
    localeHint,
    market,
  }))

  await ensureDir(SEARCH_JOBS_DIR)
  const jsonlPath = path.join(SEARCH_JOBS_DIR, `search-jobs-targeted-${verticalL1}-${verticalL2}-${tag}.jsonl`)
  const summaryPath = path.join(SEARCH_JOBS_DIR, `search-jobs-targeted-${verticalL1}-${verticalL2}-${tag}.summary.json`)
  const latestPath = path.join(SEARCH_JOBS_DIR, `latest-search-jobs-targeted-${verticalL1}-${verticalL2}.json`)

  await writeJsonl(jsonlPath, jobs)
  await writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    vertical_l1: verticalL1,
    vertical_l2: verticalL2,
    market,
    localeHint,
    keywords,
    totalJobs: jobs.length,
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
        jobsFile: path.relative(process.cwd(), jsonlPath),
        summaryFile: path.relative(process.cwd(), summaryPath),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[build-targeted-search-jobs] failed:', error?.message || error)
  process.exit(1)
})
