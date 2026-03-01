import fs from 'node:fs/promises'
import path from 'node:path'

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function toPositiveInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function toBoolean(value, fallback = false) {
  const normalized = cleanText(value).toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function splitCsv(value = '') {
  return cleanText(value)
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean)
}

export function timestampTag(date = new Date()) {
  const yyyy = String(date.getFullYear())
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const min = pad2(date.getMinutes())
  const sec = pad2(date.getSeconds())
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function writeJson(filePath, payload = {}) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function parseJsonSafe(raw = '', fallback = null) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function pickImageUrl(item = {}) {
  const source = asObject(item)
  return cleanText(
    source.image_url
    || source.imageUrl
    || source.brand_image_url
    || source.brandImageUrl
    || source.icon_url
    || source.iconUrl,
  )
}

export function toCategoryKey(input = {}) {
  const row = asObject(input)
  const metadata = asObject(row.metadata)
  const verticalL1 = cleanText(
    row.vertical_l1
    || row.verticalL1
    || metadata.vertical_l1
    || metadata.verticalL1
    || metadata.vertical
    || '',
  )
  const verticalL2 = cleanText(
    row.vertical_l2
    || row.verticalL2
    || metadata.vertical_l2
    || metadata.verticalL2
    || metadata.category
    || '',
  )
  if (verticalL1 && verticalL2) return `${verticalL1}::${verticalL2}`
  if (verticalL2) return verticalL2
  if (verticalL1) return verticalL1
  return ''
}

export function normalizeOfferRow(input = {}, sourceFile = '') {
  const row = asObject(input)
  const metadataRaw = row.metadata
  const metadata = typeof metadataRaw === 'string'
    ? asObject(parseJsonSafe(metadataRaw, {}))
    : asObject(metadataRaw)
  return {
    offer_id: cleanText(row.offer_id || row.offerId),
    network: cleanText(row.network).toLowerCase(),
    title: cleanText(row.title),
    description: cleanText(row.description),
    target_url: cleanText(row.target_url || row.targetUrl),
    image_url: cleanText(row.image_url || row.imageUrl || pickImageUrl(metadata)),
    category_key: toCategoryKey({ ...row, metadata }),
    metadata,
    source_file: cleanText(sourceFile),
  }
}

function normalizeBatchItem(item = {}, sourceFile = '', preferAfter = true) {
  const payload = asObject(item)
  const primary = preferAfter
    ? asObject(payload.after || payload.before || payload)
    : asObject(payload.before || payload.after || payload)
  const normalized = normalizeOfferRow(
    {
      ...primary,
      network: cleanText(primary.network || payload.network),
      offer_id: cleanText(primary.offer_id || primary.offerId || payload.offer_id || payload.offerId),
    },
    sourceFile,
  )
  return normalized
}

export async function readRowsFromBatchFiles(batchFiles = [], options = {}) {
  const preferAfter = options.preferAfter !== false
  const rows = []
  for (const rawFile of batchFiles) {
    const filePath = path.resolve(process.cwd(), cleanText(rawFile))
    const payload = parseJsonSafe(await fs.readFile(filePath, 'utf8'), {})
    const items = Array.isArray(payload?.metrics?.rows) ? payload.metrics.rows : []
    for (const item of items) {
      if (item?.skipped === true) continue
      const normalized = normalizeBatchItem(item, path.relative(process.cwd(), filePath), preferAfter)
      if (!normalized.offer_id && !normalized.target_url && !normalized.image_url) continue
      rows.push(normalized)
    }
  }
  return dedupeRows(rows)
}

export function dedupeRows(rows = []) {
  const out = []
  const seen = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeOfferRow(row, row.source_file)
    const dedupeKey = [
      cleanText(normalized.offer_id || '').toLowerCase(),
      cleanText(normalized.network || '').toLowerCase(),
      cleanText(normalized.target_url || normalized.image_url || '').toLowerCase(),
    ].join('|')
    if (!dedupeKey || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(normalized)
  }
  return out
}

export async function queryOfferRows(pool, options = {}) {
  const limit = toPositiveInteger(options.limit, 5000)
  const networks = Array.isArray(options.networks) && options.networks.length > 0
    ? options.networks.map((item) => cleanText(item).toLowerCase()).filter(Boolean)
    : []
  const result = await pool.query(
    `
      SELECT
        offer_id,
        network,
        title,
        description,
        target_url,
        metadata
      FROM offer_inventory_norm
      WHERE availability = 'active'
        AND ($1::text[] IS NULL OR lower(network) = ANY($1::text[]))
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [networks.length > 0 ? networks : null, limit],
  )
  const rows = Array.isArray(result.rows) ? result.rows : []
  return dedupeRows(rows.map((row) => normalizeOfferRow(row, 'offer_inventory_norm')))
}

