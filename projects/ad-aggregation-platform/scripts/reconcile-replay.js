import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildReplayRequestFromDiff } from '../src/infra/reconcile/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

function parseArgs(argv = []) {
  const output = {}
  for (const item of argv) {
    if (!item.startsWith('--')) continue
    const pair = item.slice(2).split('=')
    const key = pair[0]
    const value = pair.slice(1).join('=')
    output[key] = value
  }
  return output
}

function toSafeInt(value, fallback = 100) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  return JSON.parse(text)
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const diffFile = String(args['diff-file'] || '').trim()
  const outputFile = String(args['output-file'] || path.join(PROJECT_ROOT, '.local', 'reconcile', 'latest-replay-jobs.json'))
  const maxJobs = toSafeInt(args['max-jobs'], 500)
  const replayMode = String(args['replay-mode'] || 'deterministic')

  if (!diffFile) {
    throw new Error('--diff-file is required.')
  }

  const report = await readJsonFile(diffFile)
  const diffs = Array.isArray(report.diffs) ? report.diffs : []

  const jobs = diffs.slice(0, maxJobs).map((diff, index) =>
    buildReplayRequestFromDiff(diff, {
      replayMode,
      replayJobId: `replay_${Date.now()}_${index + 1}`
    })
  )

  const output = {
    generatedAt: new Date().toISOString(),
    sourceDiffFile: diffFile,
    replayMode,
    totalDiffs: diffs.length,
    generatedJobs: jobs.length,
    jobs
  }

  await writeJsonFile(outputFile, output)

  console.log(`[reconcile:replay] jobs written to ${outputFile}`)
  console.log(`[reconcile:replay] generatedJobs=${jobs.length}`)
}

main().catch((error) => {
  console.error(`[reconcile:replay] failed: ${error.message}`)
  process.exit(1)
})
