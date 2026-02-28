#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, withDbPool } from '../inventory/common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const DEFAULT_CASES_FILE = path.join(PROJECT_ROOT, 'config', 'pilot-content-cases.json')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output', 'pilot-content')
const DEFAULT_FETCH_TIMEOUT_MS = 6500
const DESCRIPTION_MIN_LEN = 40
const DESCRIPTION_MAX_LEN = 180
const COMMON_TWO_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'co.kr',
  'com.cn',
  'com.hk',
])

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function toPositiveInteger(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.floor(numeric)
}

function toBoolean(value, fallback = false) {
  const text = cleanText(value).toLowerCase()
  if (!text) return fallback
  if (text === 'true' || text === '1' || text === 'yes') return true
  if (text === 'false' || text === '0' || text === 'no') return false
  return fallback
}

function nowIso() {
  return new Date().toISOString()
}

function buildRunId() {
  const token = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `pilot_${token}_${random}`
}

function toHttpUrl(value, base = '') {
  const raw = cleanText(value)
  if (!raw) return ''
  try {
    const parsed = base ? new URL(raw, base) : new URL(raw)
    const protocol = cleanText(parsed.protocol).toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function normalizeDescription(value) {
  const text = cleanText(value)
  if (!text) return ''
  if (text.length <= DESCRIPTION_MAX_LEN) return text
  return `${text.slice(0, DESCRIPTION_MAX_LEN - 3)}...`
}

function hasDescription(value) {
  return cleanText(value).length >= 12
}

function hasPreferredDescriptionLength(value) {
  const length = cleanText(value).length
  return length >= DESCRIPTION_MIN_LEN && length <= DESCRIPTION_MAX_LEN
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return ''
}

function getRegistrableDomain(hostname = '') {
  const host = cleanText(hostname).toLowerCase().replace(/\.$/, '')
  if (!host) return ''
  const pieces = host.split('.').filter(Boolean)
  if (pieces.length <= 2) return host
  const lastTwo = `${pieces[pieces.length - 2]}.${pieces[pieces.length - 1]}`
  if (COMMON_TWO_PART_TLDS.has(lastTwo) && pieces.length >= 3) {
    return `${pieces[pieces.length - 3]}.${lastTwo}`
  }
  return lastTwo
}

function getUrlDomain(value = '') {
  try {
    const parsed = new URL(value)
    return getRegistrableDomain(parsed.hostname)
  } catch {
    return ''
  }
}

function isImageAllowedForTarget(imageUrl = '', targetUrl = '') {
  const image = toHttpUrl(imageUrl)
  const target = toHttpUrl(targetUrl)
  if (!image || !target) return false
  const imageDomain = getUrlDomain(image)
  const targetDomain = getUrlDomain(target)
  if (!imageDomain || !targetDomain) return false
  return imageDomain === targetDomain
}

function extractMetaContent(html = '', attr = 'name', key = '') {
  const normalizedKey = cleanText(key)
  if (!normalizedKey) return ''
  const patterns = [
    new RegExp(`<meta[^>]*${attr}=["']${normalizedKey}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${normalizedKey}["'][^>]*>`, 'i'),
  ]
  for (const pattern of patterns) {
    const matched = html.match(pattern)
    if (matched && matched[1]) {
      return cleanText(matched[1])
    }
  }
  return ''
}

function extractFirstParagraph(html = '') {
  const matched = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  if (!matched || !matched[1]) return ''
  const text = cleanText(String(matched[1]).replace(/<[^>]+>/g, ' '))
  return text
}

function extractJsonLdDescription(html = '') {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const block of blocks) {
    const payload = cleanText(block[1] || '')
    if (!payload) continue
    try {
      const parsed = JSON.parse(payload)
      const queue = [parsed]
      while (queue.length > 0) {
        const node = queue.shift()
        if (!node) continue
        if (Array.isArray(node)) {
          queue.push(...node)
          continue
        }
        if (typeof node !== 'object') continue
        const description = cleanText(node.description)
        if (description) return description
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') queue.push(value)
        }
      }
    } catch {
      // Ignore malformed json-ld blocks.
    }
  }
  return ''
}

function extractJsonLdImage(html = '', baseUrl = '') {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const block of blocks) {
    const payload = cleanText(block[1] || '')
    if (!payload) continue
    try {
      const parsed = JSON.parse(payload)
      const queue = [parsed]
      while (queue.length > 0) {
        const node = queue.shift()
        if (!node) continue
        if (Array.isArray(node)) {
          queue.push(...node)
          continue
        }
        if (typeof node !== 'object') continue
        const image = Array.isArray(node.image) ? node.image[0] : node.image
        const normalized = toHttpUrl(image, baseUrl)
        if (normalized) return normalized
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') queue.push(value)
        }
      }
    } catch {
      // Ignore malformed json-ld blocks.
    }
  }
  return ''
}

async function fetchHtml(url, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'tappy-ai-mediation-pilot/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        finalUrl: cleanText(response.url || url),
        html: '',
      }
    }
    const contentType = cleanText(response.headers.get('content-type') || '').toLowerCase()
    if (!contentType.includes('text/html')) {
      return {
        ok: false,
        status: response.status,
        finalUrl: cleanText(response.url || url),
        html: '',
      }
    }
    const html = await response.text()
    return {
      ok: true,
      status: response.status,
      finalUrl: cleanText(response.url || url),
      html: String(html || ''),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: cleanText(url),
      html: '',
      error: error instanceof Error ? error.message : 'fetch_failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

function enrichFromHtml(targetUrl, html = '') {
  const metaDescription = extractMetaContent(html, 'name', 'description')
  const ogDescription = extractMetaContent(html, 'property', 'og:description')
  const jsonLdDescription = extractJsonLdDescription(html)
  const firstParagraph = extractFirstParagraph(html)
  const description = normalizeDescription(
    pickFirstNonEmpty(
      metaDescription,
      ogDescription,
      jsonLdDescription,
      firstParagraph,
    ),
  )

  const ogImage = toHttpUrl(extractMetaContent(html, 'property', 'og:image'), targetUrl)
  const twitterImage = toHttpUrl(extractMetaContent(html, 'name', 'twitter:image'), targetUrl)
  const jsonLdImage = extractJsonLdImage(html, targetUrl)
  const imageUrl = pickFirstNonEmpty(ogImage, twitterImage, jsonLdImage)

  return {
    description,
    imageUrl,
    extractionMeta: {
      descriptionSources: {
        metaDescription: cleanText(metaDescription),
        ogDescription: cleanText(ogDescription),
        jsonLdDescription: cleanText(jsonLdDescription),
        firstParagraph: cleanText(firstParagraph),
      },
      imageSources: {
        ogImage: cleanText(ogImage),
        twitterImage: cleanText(twitterImage),
        jsonLdImage: cleanText(jsonLdImage),
      },
    },
  }
}

async function generateDescriptionWithLlm(input = {}) {
  const apiKey = cleanText(process.env.OPENROUTER_API_KEY)
  if (!apiKey) return { text: '', source: '' }
  const model = cleanText(process.env.OPENROUTER_MODEL) || 'openai/gpt-4o-mini'
  const title = cleanText(input.title)
  const merchant = cleanText(input.merchant || input.network)
  const targetUrl = cleanText(input.targetUrl)
  if (!title || !targetUrl) return { text: '', source: '' }

  const prompt = [
    'Write one concise ad product description in English.',
    'Length: 40-180 characters.',
    'Do not include prices or unverifiable claims.',
    `Title: ${title}`,
    `Merchant: ${merchant}`,
    `URL: ${targetUrl}`,
    'Output plain text only.',
  ].join('\n')

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 80,
      }),
    })
    if (!response.ok) return { text: '', source: '' }
    const payload = await response.json()
    const content = cleanText(payload?.choices?.[0]?.message?.content || '')
    const normalized = normalizeDescription(content)
    if (!normalized) return { text: '', source: '' }
    return { text: normalized, source: 'llm' }
  } catch {
    return { text: '', source: '' }
  }
}

function buildDeterministicFallbackDescription(input = {}) {
  const title = cleanText(input.title) || 'Featured offer'
  const merchant = cleanText(input.merchant || input.network || 'trusted merchant')
  const sentence = `${title} from ${merchant}, with direct access to the official destination and sponsored recommendation support.`
  return normalizeDescription(sentence)
}

function isDescriptionStateMatch(value, state) {
  if (state === 'any') return true
  const exists = hasDescription(value)
  if (state === 'present') return exists
  if (state === 'missing') return !exists
  return true
}

function extractMetadataImage(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return ''
  return cleanText(
    metadata.image_url
    || metadata.imageUrl
    || metadata.brand_image_url
    || metadata.brandImageUrl
    || metadata.icon_url
    || metadata.iconUrl,
  )
}

function isImageStateMatch(metadata = {}, state = 'any') {
  if (state === 'any') return true
  const exists = Boolean(extractMetadataImage(metadata))
  if (state === 'present') return exists
  if (state === 'missing') return !exists
  return true
}

function scoreKeywordMatch(row = {}, keywords = []) {
  const list = Array.isArray(keywords) ? keywords : []
  if (list.length === 0) return 0
  const corpus = cleanText([row.title, row.description, row.target_url].join(' ')).toLowerCase()
  let score = 0
  for (const keyword of list) {
    const token = cleanText(keyword).toLowerCase()
    if (!token) continue
    if (corpus.includes(token)) score += token.length
  }
  return score
}

async function loadCases(filePath) {
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'))
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`Pilot cases file is empty: ${filePath}`)
  }
  return payload.map((item, index) => {
    const network = cleanText(item.network).toLowerCase()
    if (!network) {
      throw new Error(`Invalid case network at index ${index}`)
    }
    return {
      id: cleanText(item.id) || `case_${index + 1}`,
      name: cleanText(item.name) || `Pilot case ${index + 1}`,
      network,
      query: cleanText(item.query),
      keywords: Array.isArray(item.keywords) ? item.keywords.map((v) => cleanText(v)).filter(Boolean) : [],
      descriptionState: cleanText(item.description_state || 'any').toLowerCase() || 'any',
      imageState: cleanText(item.image_state || 'any').toLowerCase() || 'any',
      simulateNoImageForPilot: item.simulate_no_image_for_pilot === true,
    }
  })
}

async function fetchNetworkRows(pool, network, limit) {
  const result = await pool.query(
    `
      SELECT
        offer_id,
        network,
        title,
        description,
        target_url,
        market,
        language,
        availability,
        metadata,
        updated_at
      FROM offer_inventory_norm
      WHERE network = $1
        AND availability = 'active'
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [network, limit],
  )
  return Array.isArray(result.rows) ? result.rows : []
}

function chooseCaseOffer(rows = [], caseSpec = {}, usedOfferIds = new Set()) {
  const candidates = rows
    .filter((row) => !usedOfferIds.has(cleanText(row.offer_id)))
    .filter((row) => isDescriptionStateMatch(row.description, caseSpec.descriptionState))
    .filter((row) => isImageStateMatch(row.metadata, caseSpec.imageState))
    .map((row) => ({
      row,
      keywordScore: scoreKeywordMatch(row, caseSpec.keywords),
    }))
    .sort((a, b) => {
      if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore
      const aTs = Date.parse(cleanText(a.row.updated_at))
      const bTs = Date.parse(cleanText(b.row.updated_at))
      if (Number.isFinite(aTs) && Number.isFinite(bTs) && bTs !== aTs) return bTs - aTs
      return cleanText(a.row.offer_id).localeCompare(cleanText(b.row.offer_id))
    })

  if (candidates.length > 0) {
    return {
      picked: candidates[0].row,
      keywordScore: candidates[0].keywordScore,
      fallbackMode: '',
    }
  }

  const relaxed = rows
    .filter((row) => !usedOfferIds.has(cleanText(row.offer_id)))
    .map((row) => ({
      row,
      keywordScore: scoreKeywordMatch(row, caseSpec.keywords),
    }))
    .sort((a, b) => {
      if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore
      return cleanText(b.row.updated_at).localeCompare(cleanText(a.row.updated_at))
    })

  if (relaxed.length > 0) {
    return {
      picked: relaxed[0].row,
      keywordScore: relaxed[0].keywordScore,
      fallbackMode: 'relaxed_state_filter',
    }
  }

  return {
    picked: null,
    keywordScore: 0,
    fallbackMode: 'empty_network_inventory',
  }
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  return { ...metadata }
}

async function enrichCaseOffer(caseSpec, row, options = {}) {
  const targetUrl = cleanText(row.target_url)
  const metadataBefore = sanitizeMetadata(row.metadata)
  const descriptionBefore = cleanText(row.description)
  const imageBefore = extractMetadataImage(metadataBefore)
  const needsDescription = !hasDescription(descriptionBefore)
  const needsImage = !imageBefore
  const fetchTimeoutMs = toPositiveInteger(options.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS)

  let crawl = { ok: false, status: 0, finalUrl: targetUrl, html: '' }
  let extracted = { description: '', imageUrl: '', extractionMeta: {} }
  if ((needsDescription || needsImage) && targetUrl) {
    crawl = await fetchHtml(targetUrl, fetchTimeoutMs)
    if (crawl.ok && crawl.html) {
      extracted = enrichFromHtml(crawl.finalUrl || targetUrl, crawl.html)
    }
  }

  let descriptionAfter = descriptionBefore
  let descriptionSource = ''
  if (needsDescription) {
    if (hasDescription(extracted.description)) {
      descriptionAfter = extracted.description
      descriptionSource = 'crawl'
    } else {
      const llm = options.enableLlm
        ? await generateDescriptionWithLlm({
            title: cleanText(row.title),
            merchant: cleanText(metadataBefore.merchant || metadataBefore.merchantName),
            network: cleanText(row.network),
            targetUrl,
          })
        : { text: '', source: '' }
      if (hasDescription(llm.text)) {
        descriptionAfter = llm.text
        descriptionSource = llm.source || 'llm'
      } else {
        descriptionAfter = buildDeterministicFallbackDescription({
          title: cleanText(row.title),
          merchant: cleanText(metadataBefore.merchant || metadataBefore.merchantName),
          network: cleanText(row.network),
        })
        descriptionSource = 'deterministic'
      }
    }
  }

  let imageAfter = imageBefore
  let imageSource = ''
  if (needsImage && !caseSpec.simulateNoImageForPilot) {
    const candidateImage = cleanText(extracted.imageUrl)
    if (candidateImage && isImageAllowedForTarget(candidateImage, targetUrl)) {
      imageAfter = candidateImage
      imageSource = 'crawl'
    }
  }
  if (caseSpec.simulateNoImageForPilot) {
    imageAfter = ''
    imageSource = 'pilot_forced_no_image'
  }

  const metadataAfter = {
    ...metadataBefore,
    ...(imageAfter
      ? {
          image_url: imageAfter,
          imageUrl: imageAfter,
        }
      : {}),
    description_source: descriptionSource || metadataBefore.description_source || '',
    image_source: imageSource || metadataBefore.image_source || '',
    pilot_case_id: caseSpec.id,
    pilot_updated_at: nowIso(),
    enrichment_version: 'pilot_v1',
  }

  const changed =
    descriptionAfter !== descriptionBefore
    || cleanText(imageAfter) !== cleanText(imageBefore)

  return {
    changed,
    before: {
      offer_id: cleanText(row.offer_id),
      network: cleanText(row.network),
      title: cleanText(row.title),
      target_url: targetUrl,
      description: descriptionBefore,
      image_url: imageBefore,
      metadata: metadataBefore,
    },
    after: {
      offer_id: cleanText(row.offer_id),
      network: cleanText(row.network),
      title: cleanText(row.title),
      target_url: targetUrl,
      description: descriptionAfter,
      image_url: cleanText(imageAfter),
      metadata: metadataAfter,
    },
    evidence: {
      crawl: {
        ok: crawl.ok,
        status: crawl.status,
        final_url: crawl.finalUrl,
      },
      extraction: extracted.extractionMeta || {},
      description_source: descriptionSource,
      image_source: imageSource,
    },
  }
}

async function updateOffer(pool, payload = {}, options = {}) {
  if (options.dryRun) return
  await pool.query(
    `
      UPDATE offer_inventory_norm
      SET
        description = $2,
        metadata = $3::jsonb,
        updated_at = NOW()
      WHERE offer_id = $1
    `,
    [
      cleanText(payload.offer_id),
      cleanText(payload.description),
      JSON.stringify(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
    ],
  )
}

function evaluateAcceptance(caseSpec, after = {}, evidence = {}) {
  const title = cleanText(after.title)
  const description = cleanText(after.description)
  const targetUrl = toHttpUrl(after.target_url)
  const imageUrl = toHttpUrl(after.image_url)
  const imagePolicyOk = !imageUrl || isImageAllowedForTarget(imageUrl, targetUrl)

  const checks = {
    has_title: Boolean(title),
    has_description: Boolean(description),
    preferred_description_length: hasPreferredDescriptionLength(description),
    has_target_url: Boolean(targetUrl),
    image_policy_ok: imagePolicyOk,
    no_image_degradation_ok: caseSpec.imageState === 'missing' ? !imageUrl : true,
  }

  const hardCheckKeys = ['has_title', 'has_description', 'has_target_url', 'image_policy_ok']
  const pass = hardCheckKeys.every((key) => checks[key] === true)

  return {
    pass,
    checks,
    notes: {
      description_source: cleanText(evidence?.description_source),
      image_source: cleanText(evidence?.image_source),
    },
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runId = buildRunId()
  const runDir = path.join(OUTPUT_ROOT, runId)
  const casesFile = cleanText(args['cases-file']) ? path.resolve(PROJECT_ROOT, args['cases-file']) : DEFAULT_CASES_FILE
  const scanLimit = toPositiveInteger(args['scan-limit'], 800)
  const dryRun = toBoolean(args['dry-run'], false)
  const enableLlm = toBoolean(args['enable-llm'], true)
  const fetchTimeoutMs = toPositiveInteger(args['fetch-timeout-ms'], DEFAULT_FETCH_TIMEOUT_MS)
  const cases = await loadCases(casesFile)

  await withDbPool(async (pool) => {
    const networkRowsCache = new Map()
    const usedOfferIds = new Set()
    const selectedCases = []
    const beforeAfter = []
    const acceptanceRows = []

    for (const caseSpec of cases) {
      if (!networkRowsCache.has(caseSpec.network)) {
        const rows = await fetchNetworkRows(pool, caseSpec.network, scanLimit)
        networkRowsCache.set(caseSpec.network, rows)
      }
      const rows = networkRowsCache.get(caseSpec.network) || []
      const choice = chooseCaseOffer(rows, caseSpec, usedOfferIds)
      if (!choice.picked) {
        throw new Error(`No candidate offer found for pilot case: ${caseSpec.id}`)
      }

      const pickedOfferId = cleanText(choice.picked.offer_id)
      usedOfferIds.add(pickedOfferId)

      const enrichment = await enrichCaseOffer(caseSpec, choice.picked, {
        enableLlm,
        fetchTimeoutMs,
      })
      if (enrichment.changed) {
        await updateOffer(pool, enrichment.after, { dryRun })
      }

      const acceptance = evaluateAcceptance(caseSpec, enrichment.after, enrichment.evidence)
      selectedCases.push({
        case_id: caseSpec.id,
        case_name: caseSpec.name,
        query: caseSpec.query,
        network: caseSpec.network,
        selected_offer_id: pickedOfferId,
        fallback_mode: choice.fallbackMode,
        keyword_score: choice.keywordScore,
        dry_run: dryRun,
      })
      beforeAfter.push({
        case_id: caseSpec.id,
        case_name: caseSpec.name,
        query: caseSpec.query,
        network: caseSpec.network,
        changed: enrichment.changed,
        before: enrichment.before,
        after: enrichment.after,
        evidence: enrichment.evidence,
      })
      acceptanceRows.push({
        case_id: caseSpec.id,
        case_name: caseSpec.name,
        offer_id: pickedOfferId,
        pass: acceptance.pass,
        checks: acceptance.checks,
        notes: acceptance.notes,
      })
    }

    const summary = {
      run_id: runId,
      generated_at: nowIso(),
      dry_run: dryRun,
      cases_file: path.relative(PROJECT_ROOT, casesFile),
      totals: {
        cases: selectedCases.length,
        changed: beforeAfter.filter((item) => item.changed).length,
        passed: acceptanceRows.filter((item) => item.pass).length,
        failed: acceptanceRows.filter((item) => !item.pass).length,
      },
      outputs: {
        run_dir: path.relative(PROJECT_ROOT, runDir),
        selected_cases_json: path.relative(PROJECT_ROOT, path.join(runDir, 'selected-cases.json')),
        before_after_json: path.relative(PROJECT_ROOT, path.join(runDir, 'before-after.json')),
        acceptance_json: path.relative(PROJECT_ROOT, path.join(runDir, 'acceptance.json')),
      },
    }

    await writeJson(path.join(runDir, 'selected-cases.json'), selectedCases)
    await writeJson(path.join(runDir, 'before-after.json'), beforeAfter)
    await writeJson(path.join(runDir, 'acceptance.json'), acceptanceRows)
    await writeJson(path.join(runDir, 'summary.json'), summary)
    await writeJson(path.join(OUTPUT_ROOT, 'latest-run.json'), summary)

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  })
}

main().catch((error) => {
  console.error('[pilot-enrich-content-cases] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
