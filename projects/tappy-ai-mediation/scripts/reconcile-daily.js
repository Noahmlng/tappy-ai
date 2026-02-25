import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { reconcileFactSets } from '../src/infra/reconcile/index.js'

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

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  return JSON.parse(text)
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function toBool(value, fallback = false) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return fallback
  return ['1', 'true', 'yes', 'on'].includes(text)
}

function toSafeInt(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const archiveFile = String(args['archive-file'] || '').trim()
  const billingFile = String(args['billing-file'] || '').trim()
  const outputFile = String(args['output-file'] || path.join(PROJECT_ROOT, '.local', 'reconcile', 'latest-report.json'))
  const reconcileDate = String(args.date || new Date().toISOString().slice(0, 10))
  const amountToleranceMicros = toSafeInt(args['amount-tolerance-micros'], 0)
  const failOnDiff = toBool(args['fail-on-diff'], false)

  if (!archiveFile || !billingFile) {
    throw new Error('Both --archive-file and --billing-file are required.')
  }

  const archiveRecords = await readJsonFile(archiveFile)
  const billingRecords = await readJsonFile(billingFile)

  const result = reconcileFactSets(
    {
      archiveRecords,
      billingRecords
    },
    {
      amountToleranceMicros
    }
  )

  const report = {
    generatedAt: new Date().toISOString(),
    reconcileDate,
    source: {
      archiveFile,
      billingFile
    },
    summary: {
      totalArchiveRecords: result.totalArchiveRecords,
      totalBillingRecords: result.totalBillingRecords,
      matchedCount: result.matchedCount,
      diffCount: result.diffCount,
      pass: result.pass
    },
    diffs: result.diffs
  }

  await writeJsonFile(outputFile, report)

  console.log(`[reconcile] report written to ${outputFile}`)
  console.log(`[reconcile] matched=${result.matchedCount} diff=${result.diffCount}`)

  if (failOnDiff && !result.pass) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[reconcile] failed: ${error.message}`)
  process.exit(1)
})
