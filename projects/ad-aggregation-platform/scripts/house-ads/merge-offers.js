#!/usr/bin/env node
import path from 'node:path'
import {
  parseArgs,
  cleanText,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl,
  ensureDir,
} from './lib/common.js'

const OFFERS_ROOT = path.resolve(process.cwd(), 'data/house-ads/offers')
const OFFERS_CURATED_DIR = path.join(OFFERS_ROOT, 'curated')

function normalizeKeyPart(value) {
  return cleanText(value || '').toLowerCase()
}

function dedupeKey(offer) {
  return [
    normalizeKeyPart(offer.brand_id),
    normalizeKeyPart(offer.target_url),
    normalizeKeyPart(offer.title),
  ].join('|')
}

function sourcePriority(sourceType) {
  const value = cleanText(sourceType || '').toLowerCase()
  if (value === 'real') return 3
  if (value === 'partner') return 2
  if (value === 'synthetic') return 1
  return 0
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function chooseBetter(current, incoming) {
  const currentScore = toNumber(current?.confidence_score, 0)
  const incomingScore = toNumber(incoming?.confidence_score, 0)
  if (incomingScore > currentScore) return incoming
  if (incomingScore < currentScore) return current

  const currentSource = sourcePriority(current?.source_type)
  const incomingSource = sourcePriority(incoming?.source_type)
  if (incomingSource > currentSource) return incoming
  if (incomingSource < currentSource) return current

  // Stable tie-breaker: keep earlier last_verified_at if both equal confidence/source.
  const currentTs = Date.parse(cleanText(current?.last_verified_at) || '')
  const incomingTs = Date.parse(cleanText(incoming?.last_verified_at) || '')
  if (Number.isFinite(incomingTs) && Number.isFinite(currentTs)) {
    if (incomingTs > currentTs) return incoming
  }
  return current
}

async function resolveInputFile(explicitArg, latestMetaFile) {
  const explicit = cleanText(explicitArg || '')
  if (explicit) return path.resolve(process.cwd(), explicit)
  const metaPath = path.join(OFFERS_CURATED_DIR, latestMetaFile)
  const meta = await readJson(metaPath, null)
  if (!meta?.latestJsonl) return ''
  return path.resolve(process.cwd(), meta.latestJsonl)
}

async function loadOffers(filePath) {
  if (!filePath) return []
  return readJsonl(filePath)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const realFile = await resolveInputFile(args['real-offers-file'], 'latest-offers-real.json')
  const syntheticFile = await resolveInputFile(args['synthetic-offers-file'], 'latest-offers-synthetic.json')
  const outputFile = path.resolve(
    process.cwd(),
    cleanText(args['output-file']) || path.join(OFFERS_CURATED_DIR, 'offers-merged.jsonl'),
  )
  const summaryFile = path.resolve(
    process.cwd(),
    cleanText(args['summary-file']) || path.join(OFFERS_CURATED_DIR, 'offers-merged.summary.json'),
  )
  const latestMetaFile = path.resolve(
    process.cwd(),
    cleanText(args['latest-meta-file']) || path.join(OFFERS_CURATED_DIR, 'latest-offers-merged.json'),
  )

  const [realOffers, syntheticOffers] = await Promise.all([loadOffers(realFile), loadOffers(syntheticFile)])
  const allOffers = [...realOffers, ...syntheticOffers]

  const byKey = new Map()
  const conflictStats = new Map()
  let replacedByHigherConfidence = 0

  for (const offer of allOffers) {
    const key = dedupeKey(offer)
    if (!key || key === '||') continue
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, offer)
      conflictStats.set(key, {
        count: 1,
        max_confidence: toNumber(offer.confidence_score, 0),
      })
      continue
    }

    const stats = conflictStats.get(key) || { count: 1, max_confidence: toNumber(existing.confidence_score, 0) }
    stats.count += 1
    const incomingConfidence = toNumber(offer.confidence_score, 0)
    if (incomingConfidence > stats.max_confidence) stats.max_confidence = incomingConfidence
    conflictStats.set(key, stats)

    const picked = chooseBetter(existing, offer)
    if (picked !== existing && incomingConfidence > toNumber(existing.confidence_score, 0)) {
      replacedByHigherConfidence += 1
    }
    byKey.set(key, picked)
  }

  const merged = [...byKey.values()]
  const mergedByType = {
    link: merged.filter((item) => cleanText(item.offer_type) === 'link').length,
    product: merged.filter((item) => cleanText(item.offer_type) === 'product').length,
  }

  const duplicateGroups = [...conflictStats.values()].filter((row) => row.count > 1)
  const summary = {
    generatedAt: new Date().toISOString(),
    inputs: {
      real_offers_file: realFile ? path.relative(process.cwd(), realFile) : '',
      synthetic_offers_file: syntheticFile ? path.relative(process.cwd(), syntheticFile) : '',
      real_offers_count: realOffers.length,
      synthetic_offers_count: syntheticOffers.length,
      total_input_offers: allOffers.length,
    },
    dedupe_rule: 'brand_id + target_url + title (case-insensitive)',
    selection_rule: 'keep highest confidence_score; tie-break by source_type priority real>partner>synthetic',
    results: {
      merged_offers_count: merged.length,
      duplicate_groups: duplicateGroups.length,
      dropped_offers_count: allOffers.length - merged.length,
      replaced_by_higher_confidence: replacedByHigherConfidence,
      by_type: mergedByType,
      unique_brands: new Set(merged.map((item) => cleanText(item.brand_id))).size,
      unique_campaigns: new Set(merged.map((item) => cleanText(item.campaign_id))).size,
    },
    output: {
      merged_jsonl: path.relative(process.cwd(), outputFile),
      summary_json: path.relative(process.cwd(), summaryFile),
    },
  }

  await ensureDir(path.dirname(outputFile))
  await writeJsonl(outputFile, merged)
  await writeJson(summaryFile, summary)
  await writeJson(latestMetaFile, {
    generatedAt: new Date().toISOString(),
    latestJsonl: path.relative(process.cwd(), outputFile),
    latestSummary: path.relative(process.cwd(), summaryFile),
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputOffers: allOffers.length,
        mergedOffers: merged.length,
        duplicateGroups: duplicateGroups.length,
        outputFile: path.relative(process.cwd(), outputFile),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[merge-offers] failed:', error?.message || error)
  process.exit(1)
})
