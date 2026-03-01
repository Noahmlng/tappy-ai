#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { inferIntentByRules } from '../../src/runtime/intent-scoring.js'
import { parseArgs } from '../inventory/common.js'
import { cleanText, timestampTag, toPositiveInteger, writeJson } from '../inventory/audit-common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'product-dialogue')

const DEFAULT_MEYKA_SCENARIOS = path.join(PROJECT_ROOT, 'tests', 'scenarios', 'meyka-finance-dialogues.json')
const DEFAULT_DEEPAI_SCENARIOS = path.join(PROJECT_ROOT, 'tests', 'scenarios', 'deepai-chatbot-dialogues.json')
const DEFAULT_COVERAGE_REPORT = path.join(PROJECT_ROOT, 'output', 'inventory-audit', 'latest-product-coverage.json')

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function toArray(value) {
  if (Array.isArray(value)) return value
  return []
}

function normalizeScenarioItem(item = {}, index = 0) {
  const key = cleanText(item.key || `scenario_${index + 1}`) || `scenario_${index + 1}`
  const query = cleanText(item.query)
  const answerText = cleanText(item.answerText)
  const messages = toArray(item.messages)
  if (query && answerText) {
    return {
      key,
      query,
      answerText,
      messages,
    }
  }

  const userMessage = messages.filter((row) => cleanText(row?.role).toLowerCase() === 'user').at(-1)
  const assistantMessage = messages.filter((row) => cleanText(row?.role).toLowerCase() === 'assistant').at(-1)
  return {
    key,
    query: cleanText(userMessage?.content),
    answerText: cleanText(assistantMessage?.content),
    messages,
  }
}

async function loadScenarios(filePath) {
  const payload = await readJson(filePath)
  const source = Array.isArray(payload) ? payload : toArray(payload.scenarios)
  return source.map((item, index) => normalizeScenarioItem(item, index))
}

export function predictDialogueOutcome(input = {}) {
  const intent = inferIntentByRules({
    query: input.query,
    answerText: input.answerText,
  })
  if (intent.class === 'non_commercial') {
    return {
      predicted_result: 'blocked',
      predicted_reason: 'policy_blocked',
      intent,
    }
  }
  const brandHits = Number(input.brandHits || 0)
  if (brandHits > 0) {
    return {
      predicted_result: 'served',
      predicted_reason: 'inventory_match_likely',
      intent,
    }
  }
  return {
    predicted_result: 'no_fill',
    predicted_reason: 'inventory_no_match',
    intent,
  }
}

function summarizeOutcomes(rows = []) {
  const counts = { served: 0, no_fill: 0, blocked: 0 }
  for (const row of rows) {
    const key = cleanText(row.predicted_result).toLowerCase()
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] += 1
    }
  }
  return counts
}

function resolveCoverageHits(coverage = {}) {
  const productHits = coverage?.summary?.brand_hits_by_product
  if (productHits && typeof productHits === 'object') {
    return {
      meyka: Number(productHits.meyka || 0),
      deepai: Number(productHits.deepai || 0),
    }
  }
  return { meyka: 0, deepai: 0 }
}

export async function runProductDialogueReport(rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
  const tag = timestampTag()
  const sampleSize = toPositiveInteger(args['sample-size'], 20)
  const coverageFile = path.resolve(
    PROJECT_ROOT,
    cleanText(args['coverage-report'] || DEFAULT_COVERAGE_REPORT),
  )
  const meykaFile = path.resolve(
    PROJECT_ROOT,
    cleanText(args['meyka-scenarios'] || DEFAULT_MEYKA_SCENARIOS),
  )
  const deepaiFile = path.resolve(
    PROJECT_ROOT,
    cleanText(args['deepai-scenarios'] || DEFAULT_DEEPAI_SCENARIOS),
  )
  const outputFile = path.resolve(
    PROJECT_ROOT,
    cleanText(args['output-file']) || path.join(OUTPUT_ROOT, `product-dialogue-report-${tag}.json`),
  )

  const [coverage, meykaScenarios, deepaiScenarios] = await Promise.all([
    readJson(coverageFile),
    loadScenarios(meykaFile),
    loadScenarios(deepaiFile),
  ])
  const coverageResolved = cleanText(coverage?.report_json)
    ? await readJson(path.resolve(PROJECT_ROOT, coverage.report_json))
    : coverage
  const hits = resolveCoverageHits(coverageResolved)

  const meykaRows = meykaScenarios.map((scenario) => {
    const prediction = predictDialogueOutcome({
      query: scenario.query,
      answerText: scenario.answerText,
      brandHits: hits.meyka,
    })
    return {
      product: 'meyka',
      scenario_key: scenario.key,
      query: scenario.query,
      answer_text: scenario.answerText,
      intent_class: prediction.intent.class,
      intent_score: prediction.intent.score,
      predicted_result: prediction.predicted_result,
      predicted_reason: prediction.predicted_reason,
    }
  })

  const deepaiRows = deepaiScenarios.map((scenario) => {
    const prediction = predictDialogueOutcome({
      query: scenario.query,
      answerText: scenario.answerText,
      brandHits: hits.deepai,
    })
    return {
      product: 'deepai',
      scenario_key: scenario.key,
      query: scenario.query,
      answer_text: scenario.answerText,
      intent_class: prediction.intent.class,
      intent_score: prediction.intent.score,
      predicted_result: prediction.predicted_result,
      predicted_reason: prediction.predicted_reason,
    }
  })

  const combined = [...meykaRows, ...deepaiRows]
  const report = {
    generated_at: new Date().toISOString(),
    inputs: {
      coverage_report: path.relative(PROJECT_ROOT, coverageFile),
      coverage_report_resolved: cleanText(coverage?.report_json)
        ? path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, coverage.report_json))
        : path.relative(PROJECT_ROOT, coverageFile),
      meyka_scenarios: path.relative(PROJECT_ROOT, meykaFile),
      deepai_scenarios: path.relative(PROJECT_ROOT, deepaiFile),
      coverage_brand_hits: hits,
    },
    summary: {
      total_scenarios: combined.length,
      by_product: {
        meyka: {
          scenarios: meykaRows.length,
          outcomes: summarizeOutcomes(meykaRows),
        },
        deepai: {
          scenarios: deepaiRows.length,
          outcomes: summarizeOutcomes(deepaiRows),
        },
      },
      combined_outcomes: summarizeOutcomes(combined),
    },
    rows_sample: combined.slice(0, sampleSize),
    output_file: path.relative(PROJECT_ROOT, outputFile),
  }

  await writeJson(outputFile, report)
  await writeJson(path.join(OUTPUT_ROOT, 'latest-product-dialogue-report.json'), {
    generated_at: new Date().toISOString(),
    report_json: path.relative(PROJECT_ROOT, outputFile),
  })
  return report
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await runProductDialogueReport(args)
  printReport(report)
}

function printReport(report = {}) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    totalScenarios: report?.summary?.total_scenarios || 0,
    combinedOutcomes: report?.summary?.combined_outcomes || {},
    outputFile: report?.output_file || '',
  }, null, 2)}\n`)
}

if (path.resolve(process.argv[1] || '') === __filename) {
  main().catch((error) => {
    console.error('[product-dialogue-report] failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export const __productDialogueInternal = Object.freeze({
  predictDialogueOutcome,
})
