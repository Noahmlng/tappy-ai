import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { nowIso, parseArgs } from './lib/meyka-suite-utils.js'
import { calibrateRelevanceThresholds, normalizeThresholdMap } from '../src/runtime/relevance-calibration.js'
import { DEFAULT_THRESHOLDS_BY_PLACEMENT } from '../src/runtime/relevance-model.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_SNAPSHOT_PATH = path.join(PROJECT_ROOT, 'config', 'relevance-thresholds.snapshot.json')

function toSafeInt(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

function toSafeNumber(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function parseJsonText(text, fallback = {}) {
  try {
    const parsed = JSON.parse(String(text || '').trim())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
    return parsed
  } catch {
    return fallback
  }
}

function getDayTag(inputDate = new Date()) {
  const yyyy = inputDate.getFullYear()
  const mm = String(inputDate.getMonth() + 1).padStart(2, '0')
  const dd = String(inputDate.getDate()).padStart(2, '0')
  return `${yyyy}_${mm}_${dd}`
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.items)) return payload.items
  return []
}

function summarizeSamples(samples = []) {
  const positive = samples.filter((item) => item.label === 'positive').length
  const negative = samples.filter((item) => item.label === 'negative').length
  const unlabeled = samples.filter((item) => item.label === 'unlabeled').length
  const placements = [...new Set(samples.map((item) => String(item.placementId || '').trim()).filter(Boolean))]
  return {
    total: samples.length,
    positive,
    negative,
    unlabeled,
    placements,
  }
}

function getThresholdsFromSnapshot(snapshot = {}) {
  const runtime = snapshot?.thresholds?.runtimeByPlacement && typeof snapshot.thresholds.runtimeByPlacement === 'object'
    ? snapshot.thresholds.runtimeByPlacement
    : (snapshot?.runtimeThresholds && typeof snapshot.runtimeThresholds === 'object'
      ? snapshot.runtimeThresholds
      : {})
  const byPlacement = snapshot?.thresholds?.byPlacement && typeof snapshot.thresholds.byPlacement === 'object'
    ? snapshot.thresholds.byPlacement
    : (snapshot?.byPlacement && typeof snapshot.byPlacement === 'object' ? snapshot.byPlacement : {})
  const source = Object.keys(runtime).length > 0 ? runtime : byPlacement
  return normalizeThresholdMap(source, DEFAULT_THRESHOLDS_BY_PLACEMENT)
}

async function ensureOutputDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function readOptionalJsonFile(filePath) {
  try {
    return await readJsonFile(filePath)
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const decisionsPath = String(args['decisions-file'] || '').trim()
  const eventsPath = String(args['events-file'] || '').trim()
  if (!decisionsPath || !eventsPath) {
    throw new Error('--decisions-file and --events-file are required')
  }

  const outputPath = path.resolve(process.cwd(), String(args.output || DEFAULT_SNAPSHOT_PATH))
  const snapshotInputPath = path.resolve(
    process.cwd(),
    String(args['previous-snapshot'] || outputPath),
  )
  const thresholdVersionPrefix = String(args['version-prefix'] || 'relevance_v2').trim() || 'relevance_v2'
  const asOfDate = String(args['as-of-date'] || '').trim()
    || new Date().toISOString().slice(0, 10)
  const minSamples = Math.max(1, toSafeInt(args['min-samples'], 200))
  const maxDeltaPerDay = Math.max(0, Math.min(1, toSafeNumber(args['max-delta-per-day'], 0.03)))
  const fillDropLimit = Math.max(0, Math.min(1, toSafeNumber(args['fill-drop-limit'], 0.03)))
  const dismissWindowMs = Math.max(1, toSafeInt(args['dismiss-window-ms'], 5 * 60 * 1000))

  const [decisionsPayload, eventsPayload, previousSnapshot] = await Promise.all([
    readJsonFile(path.resolve(process.cwd(), decisionsPath)),
    readJsonFile(path.resolve(process.cwd(), eventsPath)),
    readOptionalJsonFile(snapshotInputPath),
  ])
  const decisions = normalizeRows(decisionsPayload)
  const events = normalizeRows(eventsPayload)
  const cliThresholds = parseJsonText(args['current-thresholds-json'], {})
  const previousThresholds = previousSnapshot ? getThresholdsFromSnapshot(previousSnapshot) : {}
  const currentThresholdsByPlacement = normalizeThresholdMap(
    Object.keys(cliThresholds).length > 0 ? cliThresholds : previousThresholds,
    DEFAULT_THRESHOLDS_BY_PLACEMENT,
  )

  const calibration = calibrateRelevanceThresholds({
    decisions,
    events,
    currentThresholdsByPlacement,
    minSamples,
    maxDeltaPerDay,
    fillDropLimit,
    dismissWindowMs,
  })
  const now = nowIso()
  const thresholdVersion = `${thresholdVersionPrefix}_${getDayTag(new Date(`${asOfDate}T00:00:00.000Z`))}`
  const rollbackThresholdVersion = String(
    previousSnapshot?.thresholdVersion
    || previousSnapshot?.thresholds?.thresholdVersion
    || '',
  ).trim()
  const snapshot = {
    generatedAt: now,
    asOfDate,
    thresholdVersion,
    rollbackThresholdVersion,
    calibrationConfig: calibration.calibrationConfig,
    sampleStats: summarizeSamples(calibration.samples),
    thresholds: {
      runtimeByPlacement: calibration.runtimeThresholds,
      byPlacement: calibration.byPlacement,
      byPlacementVertical: calibration.byPlacementVertical,
    },
    input: {
      decisionsFile: path.resolve(process.cwd(), decisionsPath),
      eventsFile: path.resolve(process.cwd(), eventsPath),
      previousSnapshot: snapshotInputPath,
    },
  }

  await ensureOutputDir(outputPath)
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

  const placementSummary = Object.entries(snapshot.thresholds.byPlacement)
    .map(([placementId, row]) => (
      `${placementId}: strict=${row.strict.toFixed(3)} relaxed=${row.relaxed.toFixed(3)} status=${row.status} samples=${row.sampleCount}`
    ))
    .join('\n')

  console.log(`[relevance-calibration] generatedAt=${now}`)
  console.log(`[relevance-calibration] thresholdVersion=${thresholdVersion}`)
  if (rollbackThresholdVersion) {
    console.log(`[relevance-calibration] rollbackThresholdVersion=${rollbackThresholdVersion}`)
  }
  console.log(`[relevance-calibration] decisions=${decisions.length} events=${events.length} samples=${calibration.samples.length}`)
  console.log(`[relevance-calibration] snapshot=${outputPath}`)
  if (placementSummary) {
    console.log(`[relevance-calibration] byPlacement\n${placementSummary}`)
  }
}

main().catch((error) => {
  console.error(`[relevance-calibration] failed: ${error.message}`)
  process.exit(1)
})

