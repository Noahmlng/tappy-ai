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
const DEFAULT_DESCRIPTION_PROMPT = 'Create a concise and compelling product description for [Brand]\'s [Product Category]. Focus on the most relevant aspects of the product, considering its unique features, benefits, or target audience. If the product is part of an offer or promotion, mention the special deal or value. If not, emphasize the product\'s key qualities and the problems it solves. Adapt the tone and language to match the brand\'s voice and make sure the description is engaging and drives action. Keep the language simple, direct, and aligned with the user\'s intent.'
const IMAGE_METADATA_KEYS = Object.freeze([
  'image_url',
  'imageUrl',
  'brand_image_url',
  'brandImageUrl',
  'icon_url',
  'iconUrl',
  'logo_url',
  'logoUrl',
])
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
  const text = cleanText(decodeHtmlEntities(value))
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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function toTitleCase(value) {
  const text = cleanText(value).replace(/[_-]+/g, ' ')
  if (!text) return ''
  return text
    .split(' ')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function deriveBrandFromUrl(url = '') {
  const domain = getUrlDomain(url)
  if (!domain) return ''
  const root = cleanText(domain.split('.')[0] || '')
  if (!root) return ''
  return toTitleCase(root)
}

function deriveBrandName(input = {}) {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const metadataBrand = pickFirstNonEmpty(
    metadata.brand,
    metadata.brandName,
    metadata.merchant,
    metadata.merchantName,
  )
  if (metadataBrand) return metadataBrand
  const domainBrand = pickFirstNonEmpty(
    deriveBrandFromUrl(metadata.destinationUrl || metadata.destination_url),
    deriveBrandFromUrl(metadata.merchantUrl || metadata.merchant_url),
    deriveBrandFromUrl(metadata.programUrl || metadata.program_url),
    deriveBrandFromUrl(input.targetUrl),
  )
  if (domainBrand) return domainBrand
  const normalizedTitle = cleanText(input.title)
    .replace(/\b(affiliate program|limited deal|new arrival|best seller)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
  if (normalizedTitle) return normalizedTitle.split(' ').slice(0, 2).join(' ')
  return cleanText(metadata.teamName)
}

function deriveCategoryName(input = {}) {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  return pickFirstNonEmpty(
    toTitleCase(metadata.category),
    toTitleCase(metadata.verticalL2),
    toTitleCase(metadata.verticalL1),
    'Product',
  )
}

function isGenericDescription(value) {
  const text = cleanText(value).toLowerCase()
  if (!text) return false
  const patterns = [
    'option with strong category relevance and direct shopping intent',
    'direct shopping intent',
    'featured offer from',
    'sponsored recommendation support',
  ]
  return patterns.some((pattern) => text.includes(pattern))
}

function isLowQualityDescription(value) {
  const text = cleanText(value)
  if (!text) return true
  if (!hasPreferredDescriptionLength(text)) return true
  if (/\b([a-z0-9]{3,})\b\s+\1\b/i.test(text)) return true
  return false
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

function getDomainLabel(domain = '') {
  const normalized = cleanText(domain).toLowerCase()
  if (!normalized) return ''
  return cleanText(normalized.split('.')[0] || '')
}

function isImageAllowedForTarget(imageUrl = '', targetUrl = '') {
  return isImageAllowedForDomains(imageUrl, resolveAllowedImageDomains(targetUrl))
}

function resolveAllowedImageDomains(targetUrl = '', metadata = {}, extraUrls = []) {
  const urls = [
    targetUrl,
    metadata?.destinationUrl,
    metadata?.destination_url,
    metadata?.merchantUrl,
    metadata?.merchant_url,
    metadata?.programUrl,
    metadata?.program_url,
    metadata?.website,
    ...(Array.isArray(extraUrls) ? extraUrls : []),
  ]
  const allowed = new Set()
  for (const source of urls) {
    const normalized = toHttpUrl(source)
    if (!normalized) continue
    const domain = getUrlDomain(normalized)
    if (domain) allowed.add(domain)
  }
  return allowed
}

function isImageAllowedForDomains(imageUrl = '', allowedDomains = new Set()) {
  const image = toHttpUrl(imageUrl)
  if (!image) return false
  const imageDomain = getUrlDomain(image)
  if (!imageDomain) return false
  if (allowedDomains.has(imageDomain)) return true
  const imageLabel = getDomainLabel(imageDomain)
  if (!imageLabel) return false
  const allowedLabels = new Set(Array.from(allowedDomains).map((domain) => getDomainLabel(domain)).filter(Boolean))
  return allowedLabels.has(imageLabel)
}

function parseTagAttributes(tag = '') {
  const attributes = {}
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
  let matched = pattern.exec(tag)
  while (matched) {
    const key = cleanText(matched[1]).toLowerCase()
    const value = cleanText(matched[3] || matched[4] || matched[5] || '')
    if (key && value) attributes[key] = value
    matched = pattern.exec(tag)
  }
  return attributes
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

function extractIconImage(html = '', baseUrl = '') {
  const links = html.match(/<link\b[^>]*>/gi) || []
  for (const link of links) {
    const attrs = parseTagAttributes(link)
    const rel = cleanText(attrs.rel).toLowerCase()
    if (!rel) continue
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue
    const href = toHttpUrl(attrs.href, baseUrl)
    if (href) return href
  }
  return ''
}

function extractLogoImage(html = '', baseUrl = '') {
  const images = html.match(/<img\b[^>]*>/gi) || []
  let best = ''
  let bestScore = -1
  for (const imageTag of images) {
    const attrs = parseTagAttributes(imageTag)
    const src = toHttpUrl(attrs.src || attrs['data-src'] || attrs['data-original'], baseUrl)
    if (!src) continue
    if (src.startsWith('data:')) continue
    let score = 0
    const alt = cleanText(decodeHtmlEntities(attrs.alt)).toLowerCase()
    const className = cleanText(attrs.class).toLowerCase()
    const id = cleanText(attrs.id).toLowerCase()
    const srcLower = src.toLowerCase()
    if (alt.includes('logo')) score += 8
    if (className.includes('logo') || id.includes('logo')) score += 10
    if (srcLower.includes('logo') || srcLower.includes('brand') || srcLower.includes('icon')) score += 6
    if (attrs.width && Number.isFinite(Number(attrs.width))) {
      const width = Number(attrs.width)
      if (width >= 40 && width <= 1024) score += 2
    }
    if (attrs.height && Number.isFinite(Number(attrs.height))) {
      const height = Number(attrs.height)
      if (height >= 40 && height <= 1024) score += 2
    }
    if (score > bestScore) {
      best = src
      bestScore = score
    }
  }
  return best
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
        const candidates = []
        const pushCandidate = (item) => {
          if (!item) return
          if (typeof item === 'string') {
            candidates.push(item)
            return
          }
          if (Array.isArray(item)) {
            for (const nested of item) pushCandidate(nested)
            return
          }
          if (typeof item !== 'object') return
          candidates.push(item.url)
          candidates.push(item.contentUrl)
          candidates.push(item.thumbnailUrl)
        }
        pushCandidate(node.image)
        pushCandidate(node.logo)
        for (const candidate of candidates) {
          const normalized = toHttpUrl(candidate, baseUrl)
          if (normalized) return normalized
        }
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

function toSiteRootUrl(url = '') {
  const normalized = toHttpUrl(url)
  if (!normalized) return ''
  try {
    const parsed = new URL(normalized)
    return `${parsed.origin}/`
  } catch {
    return ''
  }
}

function buildFallbackFetchUrls(targetUrl = '', metadata = {}, primaryFinalUrl = '') {
  const candidates = [
    toSiteRootUrl(primaryFinalUrl || targetUrl),
    toHttpUrl(metadata?.destinationUrl),
    toSiteRootUrl(metadata?.destinationUrl),
    toHttpUrl(metadata?.destination_url),
    toSiteRootUrl(metadata?.destination_url),
    toHttpUrl(metadata?.merchantUrl),
    toSiteRootUrl(metadata?.merchantUrl),
    toHttpUrl(metadata?.merchant_url),
    toSiteRootUrl(metadata?.merchant_url),
    toHttpUrl(metadata?.programUrl),
    toSiteRootUrl(metadata?.programUrl),
    toHttpUrl(metadata?.program_url),
    toSiteRootUrl(metadata?.program_url),
  ].map((item) => toHttpUrl(item)).filter(Boolean)

  const primaryCanonical = toHttpUrl(primaryFinalUrl || targetUrl)
  const dedup = new Set()
  const output = []
  for (const candidate of candidates) {
    if (!candidate || candidate === primaryCanonical || dedup.has(candidate)) continue
    dedup.add(candidate)
    output.push(candidate)
  }
  return output
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
  const logoImage = extractLogoImage(html, targetUrl)
  const iconImage = extractIconImage(html, targetUrl)
  const imageUrl = pickFirstNonEmpty(ogImage, twitterImage, jsonLdImage, logoImage, iconImage)

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
        logoImage: cleanText(logoImage),
        iconImage: cleanText(iconImage),
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
  const brand = cleanText(input.brand) || merchant || title.split(' ')[0] || 'the brand'
  const category = cleanText(input.category) || 'product'
  const offer = cleanText(input.offer)
  const hint = cleanText(input.sourceDescription)
  const userIntent = cleanText(input.query)
  const promptTemplate = cleanText(input.promptTemplate) || DEFAULT_DESCRIPTION_PROMPT
  const basePrompt = promptTemplate
    .replaceAll('[Brand]', brand)
    .replaceAll('[Product Category]', category)
  const targetUrl = cleanText(input.targetUrl)
  if (!title || !targetUrl) return { text: '', source: '' }

  const prompt = [
    basePrompt,
    'Output language: English.',
    'Length: 40-180 characters.',
    'Do not include unverifiable claims.',
    'Use plain text only. No markdown or quotes.',
    `Title: ${title}`,
    `Brand: ${brand}`,
    `Product Category: ${category}`,
    `Merchant: ${merchant}`,
    offer ? `Offer Context: ${offer}` : '',
    hint ? `Supporting Context: ${hint}` : '',
    userIntent ? `User Intent: ${userIntent}` : '',
    `URL: ${targetUrl}`,
  ].filter(Boolean).join('\n')

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
  const brand = cleanText(input.brand || input.merchant || input.network || 'trusted brand')
  const category = toTitleCase(input.category) || 'Product'
  const offer = cleanText(input.offer)
  const normalizedTitle = title.toLowerCase().startsWith(brand.toLowerCase())
    ? title
    : `${brand} ${title}`
  const sentence = offer
    ? `Discover ${normalizedTitle} in ${category}. ${offer}. Visit the official site to learn more.`
    : `Discover ${normalizedTitle} in ${category}. Explore key features and current offers on the official site.`
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
      offerId: cleanText(item.offer_id || item.offerId),
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
  if (caseSpec.offerId) {
    const fixed = rows.find((row) => cleanText(row.offer_id) === cleanText(caseSpec.offerId))
    if (!fixed) {
      return {
        picked: null,
        keywordScore: 0,
        fallbackMode: 'fixed_offer_not_found',
      }
    }
    if (usedOfferIds.has(cleanText(fixed.offer_id))) {
      return {
        picked: null,
        keywordScore: 0,
        fallbackMode: 'fixed_offer_reused',
      }
    }
    return {
      picked: fixed,
      keywordScore: scoreKeywordMatch(fixed, caseSpec.keywords),
      fallbackMode: 'fixed_offer_id',
    }
  }

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
  const needsDescription =
    !hasDescription(descriptionBefore)
    || isGenericDescription(descriptionBefore)
    || isLowQualityDescription(descriptionBefore)
  const needsImage = !imageBefore
  const fetchTimeoutMs = toPositiveInteger(options.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS)

  let crawl = { ok: false, status: 0, finalUrl: targetUrl, html: '' }
  let crawlFallback = { ok: false, status: 0, finalUrl: '', html: '' }
  let extracted = { description: '', imageUrl: '', extractionMeta: {} }
  if ((needsDescription || needsImage) && targetUrl) {
    crawl = await fetchHtml(targetUrl, fetchTimeoutMs)
    if (crawl.ok && crawl.html) {
      extracted = enrichFromHtml(crawl.finalUrl || targetUrl, crawl.html)
    }
    const fallbackUrls = buildFallbackFetchUrls(targetUrl, metadataBefore, crawl.finalUrl)
    const shouldTryFallback = !hasDescription(extracted.description) || !cleanText(extracted.imageUrl)
    if (shouldTryFallback) {
      for (const fallbackUrl of fallbackUrls) {
        crawlFallback = await fetchHtml(fallbackUrl, fetchTimeoutMs)
        if (!crawlFallback.ok || !crawlFallback.html) continue
        const rootExtracted = enrichFromHtml(crawlFallback.finalUrl || fallbackUrl, crawlFallback.html)
        extracted = {
          description: pickFirstNonEmpty(extracted.description, rootExtracted.description),
          imageUrl: pickFirstNonEmpty(extracted.imageUrl, rootExtracted.imageUrl),
          extractionMeta: {
            primary: extracted.extractionMeta || {},
            fallback_root: rootExtracted.extractionMeta || {},
          },
        }
        if (hasDescription(extracted.description) && cleanText(extracted.imageUrl)) break
      }
    }
  }

  const brand = deriveBrandName({
    title: cleanText(row.title),
    metadata: metadataBefore,
    targetUrl,
  })
  const category = deriveCategoryName({ metadata: metadataBefore })
  const offerContext = cleanText(
    metadataBefore.offer
    || metadataBefore.offerText
    || metadataBefore.promotion
    || metadataBefore.offer_value,
  )

  let descriptionAfter = descriptionBefore
  let descriptionSource = ''
  if (needsDescription) {
    if (hasDescription(extracted.description)
      && !isGenericDescription(extracted.description)
      && !isLowQualityDescription(extracted.description)) {
      descriptionAfter = extracted.description
      descriptionSource = 'crawl'
    } else {
      const llm = options.enableLlm
        ? await generateDescriptionWithLlm({
            title: cleanText(row.title),
            merchant: cleanText(metadataBefore.merchant || metadataBefore.merchantName),
            brand,
            category,
            offer: offerContext,
            sourceDescription: extracted.description,
            query: caseSpec.query,
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
          brand,
          category,
          offer: offerContext,
          network: cleanText(row.network),
        })
        descriptionSource = 'deterministic'
      }
    }
  }

  let imageAfter = imageBefore
  let imageSource = ''
  const allowedImageDomains = resolveAllowedImageDomains(targetUrl, metadataBefore, [
    crawl.finalUrl,
    crawlFallback.finalUrl,
  ])
  if (needsImage && !caseSpec.simulateNoImageForPilot) {
    const candidateImage = cleanText(extracted.imageUrl)
    if (candidateImage && isImageAllowedForDomains(candidateImage, allowedImageDomains)) {
      imageAfter = candidateImage
      imageSource = 'crawl'
    }
  }
  if (caseSpec.simulateNoImageForPilot) {
    imageAfter = ''
    imageSource = 'pilot_forced_no_image'
  }

  const metadataAfter = {
    ...Object.fromEntries(
      Object.entries(metadataBefore).filter(([key]) => !IMAGE_METADATA_KEYS.includes(key)),
    ),
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
      allowed_image_domains: Array.from(allowedImageDomains),
      crawl_fallback: {
        ok: crawlFallback.ok,
        status: crawlFallback.status,
        final_url: crawlFallback.finalUrl,
      },
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
  const allowedDomains = resolveAllowedImageDomains(targetUrl, after.metadata, [
    evidence?.crawl?.final_url,
    evidence?.crawl_fallback?.final_url,
  ])
  const imagePolicyOk = !imageUrl || isImageAllowedForDomains(imageUrl, allowedDomains)

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

function isDirectExecution() {
  if (!process.argv[1]) return false
  return path.resolve(process.argv[1]) === __filename
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

if (isDirectExecution()) {
  main().catch((error) => {
    console.error('[pilot-enrich-content-cases] failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export const __pilotContentInternal = Object.freeze({
  resolveAllowedImageDomains,
  isImageAllowedForDomains,
  enrichFromHtml,
  isGenericDescription,
  isLowQualityDescription,
  DEFAULT_DESCRIPTION_PROMPT,
})
