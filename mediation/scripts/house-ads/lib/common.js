import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const HOUSE_ADS_ROOT = path.resolve(process.cwd(), 'data/house-ads')
export const RAW_ROOT = path.join(HOUSE_ADS_ROOT, 'raw')
export const CURATED_ROOT = path.join(HOUSE_ADS_ROOT, 'curated')
export const SNAPSHOT_ROOT = path.join(HOUSE_ADS_ROOT, 'snapshots')
export const REPORT_ROOT = path.join(HOUSE_ADS_ROOT, 'reports')

const KNOWN_SECOND_LEVEL_TLDS = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'com.br',
  'com.mx',
  'com.cn',
])

export function parseArgs(argv = []) {
  const options = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const idx = arg.indexOf('=')
    if (idx < 0) {
      options[arg.slice(2)] = 'true'
      continue
    }
    options[arg.slice(2, idx)] = arg.slice(idx + 1)
  }
  return options
}

export function toInteger(value, fallback) {
  const num = Number(value)
  if (Number.isFinite(num)) return Math.floor(num)
  return fallback
}

export function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

export function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

export function slugify(value, fallback = 'unknown') {
  const input = cleanText(value).toLowerCase()
  if (!input) return fallback
  const slug = input
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return slug || fallback
}

export function hashId(value, length = 12) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, length)
}

export function timestampTag(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (fallback !== null) return fallback
    throw error
  }
}

export async function writeJsonl(filePath, rows = []) {
  await ensureDir(path.dirname(filePath))
  const payload = rows.map((row) => JSON.stringify(row)).join('\n')
  await fs.writeFile(filePath, payload ? `${payload}\n` : '', 'utf8')
}

export async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export async function listFiles(dirPath, suffix = '') {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name))
    .filter((filePath) => (suffix ? filePath.endsWith(suffix) : true))
    .sort()
}

export async function findLatestFile(dirPath, suffix = '') {
  const files = await listFiles(dirPath, suffix)
  if (files.length === 0) return ''
  return files[files.length - 1]
}

export function registrableDomain(input) {
  const host = cleanText(input).toLowerCase().replace(/^www\./, '')
  if (!host || !host.includes('.')) return ''
  const parts = host.split('.').filter(Boolean)
  if (parts.length < 2) return ''
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
  if (parts.length >= 3 && KNOWN_SECOND_LEVEL_TLDS.has(lastTwo)) {
    return `${parts[parts.length - 3]}.${lastTwo}`
  }
  return lastTwo
}

export function normalizeUrl(urlText) {
  const text = cleanText(urlText)
  if (!text) return ''
  try {
    const parsed = new URL(text.startsWith('http') ? text : `https://${text}`)
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase()
      if (
        lower.startsWith('utm_')
        || lower === 'gclid'
        || lower === 'fbclid'
        || lower === 'msclkid'
        || lower === 'ref'
      ) {
        parsed.searchParams.delete(key)
      }
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.toString()
  } catch {
    return ''
  }
}

export function domainToBrandName(domain) {
  const root = registrableDomain(domain)
  if (!root) return ''
  const label = root.split('.')[0]
  return label
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(' ')
}

export async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs || 8000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          options.userAgent
          || 'Mozilla/5.0 (compatible; HouseAdsBot/0.1; +https://ai-network.local)',
        Accept: options.accept || 'text/html,application/xhtml+xml',
        ...(options.headers || {}),
      },
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

export function extractHtmlTitle(html = '') {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return ''
  return cleanText(match[1].replace(/<[^>]+>/g, ''))
}

export function extractMetaDescription(html = '') {
  const match = html.match(
    /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)["'][^>]*>/i,
  )
  if (!match) return ''
  return cleanText(match[1])
}

export function extractH1(html = '') {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (!match) return ''
  return cleanText(match[1].replace(/<[^>]+>/g, ''))
}

export function stripHtmlText(html = '') {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

export async function asyncPool(limit, items, worker) {
  const safeLimit = Math.max(1, Number(limit) || 1)
  const queue = [...items]
  const results = []
  let active = 0
  let index = 0

  return new Promise((resolve, reject) => {
    const runNext = () => {
      if (queue.length === 0 && active === 0) {
        resolve(results)
        return
      }
      while (active < safeLimit && queue.length > 0) {
        const item = queue.shift()
        const currentIndex = index
        index += 1
        active += 1
        Promise.resolve(worker(item, currentIndex))
          .then((value) => {
            results[currentIndex] = value
            active -= 1
            runNext()
          })
          .catch((error) => {
            reject(error)
          })
      }
    }
    runNext()
  })
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
