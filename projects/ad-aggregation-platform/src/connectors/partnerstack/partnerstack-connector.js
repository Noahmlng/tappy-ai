import { loadRuntimeConfig } from '../../config/runtime-config.js'
import { mapPartnerStackPartnershipToUnifiedOffer, normalizeUnifiedOffers } from '../../offers/index.js'

const DEFAULT_BASE_URL = 'https://api.partnerstack.com/api/v2'
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_PARTNERSHIP_LIMIT = 200
const MAX_PARTNERSHIP_LIMIT = 200
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

function isRetryableError(error) {
  if (error?.name === 'AbortError') return true
  if (typeof error?.statusCode === 'number' && RETRYABLE_STATUS.has(error.statusCode)) return true
  return Boolean(error?.cause)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []

  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.results)) return payload.results
  if (Array.isArray(payload.items)) return payload.items
  if (payload.data && typeof payload.data === 'object') {
    if (Array.isArray(payload.data.items)) return payload.data.items
    if (Array.isArray(payload.data.results)) return payload.data.results
  }

  return []
}

function parseRetryAfterMs(response) {
  const value = response.headers.get('retry-after')
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const at = Date.parse(value)
  if (Number.isFinite(at)) {
    const ms = at - Date.now()
    if (ms > 0) return ms
  }
  return null
}

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function toBoundedLimit(value, fallback = DEFAULT_PARTNERSHIP_LIMIT) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.max(1, Math.min(MAX_PARTNERSHIP_LIMIT, Math.floor(numeric)))
}

function buildSearchTerms(value) {
  const raw = normalizeText(value)
  if (!raw) return []

  const terms = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)

  return [...new Set(terms)]
}

function toSearchCorpus(record) {
  return [
    normalizeText(record?.company?.name),
    normalizeText(record?.link?.destination),
    normalizeText(record?.link?.url),
    normalizeText(record?.offers?.description),
    normalizeText(record?.status),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

class PartnerStackApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'PartnerStackApiError'
    this.statusCode = options.statusCode
    this.payload = options.payload
    this.path = options.path
  }
}

async function parseJsonSafe(response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

function createUrl(baseUrl, path, query = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${baseUrl}${normalizedPath}`)

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') {
          url.searchParams.append(key, String(item))
        }
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }

  return url
}

export function createPartnerStackConnector(options = {}) {
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig()
  const apiKey = options.apiKey || runtimeConfig.partnerstack.apiKey
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  if (typeof fetchImpl !== 'function') {
    throw new Error('[partnerstack] fetch implementation is required')
  }

  async function request(path, requestOptions = {}) {
    const method = requestOptions.method || 'GET'
    const query = requestOptions.query || {}
    const body = requestOptions.body

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const url = createUrl(baseUrl, path, query)
        const headers = {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        }

        if (body !== undefined) {
          headers['Content-Type'] = 'application/json'
        }

        const response = await fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        })

        const payload = await parseJsonSafe(response)
        if (!response.ok) {
          const error = new PartnerStackApiError(
            `[partnerstack] ${method} ${path} failed with ${response.status}`,
            {
              statusCode: response.status,
              payload,
              path
            }
          )

          if (attempt < maxRetries && RETRYABLE_STATUS.has(response.status)) {
            const retryAfterMs = parseRetryAfterMs(response)
            const backoffMs = retryAfterMs ?? (250 * 2 ** attempt + Math.floor(Math.random() * 100))
            await sleep(backoffMs)
            continue
          }

          throw error
        }

        return payload
      } catch (error) {
        if (attempt >= maxRetries || !isRetryableError(error)) {
          if (error instanceof PartnerStackApiError) throw error
          throw new PartnerStackApiError(`[partnerstack] ${method} ${path} request failed`, {
            path,
            payload: { message: error?.message || 'Unknown error' }
          })
        }

        const backoffMs = 250 * 2 ** attempt + Math.floor(Math.random() * 100)
        await sleep(backoffMs)
      } finally {
        clearTimeout(timer)
      }
    }

    throw new PartnerStackApiError(`[partnerstack] ${method} ${path} failed after retries`, {
      path
    })
  }

  async function listPartnerships(params = {}) {
    const path = '/partnerships'
    const payload = await request(path, {
      query: {
        limit: toBoundedLimit(params.limit, DEFAULT_PARTNERSHIP_LIMIT)
      }
    })

    const partnerships = extractList(payload)
    return { partnerships, raw: payload, sourcePath: path }
  }

  async function fetchOffers(params = {}) {
    const partnershipsResult = await listPartnerships(params)
    const searchTerms = buildSearchTerms(params.search)
    const activePartnerships = partnershipsResult.partnerships.filter((item) =>
      normalizeText(item?.status).toLowerCase() === 'active'
    )
    const matchedPartnerships = searchTerms.length > 0
      ? activePartnerships.filter((item) => {
          const corpus = toSearchCorpus(item)
          return searchTerms.some((term) => corpus.includes(term))
        })
      : activePartnerships

    const mapped = normalizeUnifiedOffers(
      matchedPartnerships.map((partnership) =>
        mapPartnerStackPartnershipToUnifiedOffer(partnership, {
          sourceType: 'link'
        })
      )
    )

    return {
      offers: mapped,
      debug: {
        mode: 'partner_partnership_links',
        sourcePath: partnershipsResult.sourcePath,
        rawPartnershipCount: partnershipsResult.partnerships.length,
        activePartnershipCount: activePartnerships.length,
        matchedPartnershipCount: matchedPartnerships.length,
        mappedOfferCount: mapped.length,
        searchTerms
      }
    }
  }

  async function healthCheck(params = {}) {
    try {
      const startedAt = Date.now()
      const result = await listPartnerships({
        limit: params.limit ?? 1
      })

      return {
        ok: true,
        network: 'partnerstack',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        counts: {
          partnerships: Array.isArray(result.partnerships) ? result.partnerships.length : 0
        }
      }
    } catch (error) {
      return {
        ok: false,
        network: 'partnerstack',
        checkedAt: new Date().toISOString(),
        errorCode: typeof error?.statusCode === 'number' ? `HTTP_${error.statusCode}` : 'HEALTHCHECK_FAILED',
        message: error?.message || 'Health check failed'
      }
    }
  }

  return {
    request,
    listPartnerships,
    fetchOffers,
    healthCheck
  }
}

export { PartnerStackApiError }
