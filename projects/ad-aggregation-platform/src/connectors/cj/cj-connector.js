import { loadRuntimeConfig } from '../../config/runtime-config.js'
import { mapCjToUnifiedOffer, normalizeUnifiedOffers } from '../../offers/index.js'

const DEFAULT_PRODUCT_BASE_URL = 'https://product-search.api.cj.com/v2'
const DEFAULT_LINK_BASE_URL = 'https://link-search.api.cj.com/v2'
const DEFAULT_OFFER_BASE_URL = 'https://advertiser-api.api.cj.com'
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 8000
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(error) {
  if (error?.name === 'AbortError') return true
  if (typeof error?.statusCode === 'number' && RETRYABLE_STATUS.has(error.statusCode)) return true
  return Boolean(error?.cause)
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

function decodeXml(text) {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function normalizeText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const cleaned = normalizeText(value)
      if (cleaned) return cleaned
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ''
}

function parseBody(text, contentType = '') {
  const trimmed = normalizeText(text)
  if (!trimmed) return null

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return { rawText: text }
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    if (trimmed.startsWith('<')) {
      return { rawXml: text }
    }
    return { rawText: text }
  }
}

function extractXmlNodes(xml, tags) {
  const nodes = []
  for (const tag of tags) {
    const matcher = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
    let match = matcher.exec(xml)
    while (match) {
      nodes.push({ tag, body: match[1], raw: match[0] })
      match = matcher.exec(xml)
    }
  }
  return nodes
}

function parseXmlRecord(node) {
  const record = {}
  const fieldMatcher = /<([a-zA-Z0-9:_-]+)\b[^>]*>([\s\S]*?)<\/\1>/g
  let fieldMatch = fieldMatcher.exec(node.body)

  while (fieldMatch) {
    const key = fieldMatch[1]
    const value = decodeXml(fieldMatch[2].replace(/<[^>]+>/g, ' '))
    if (!(key in record)) {
      record[key] = normalizeText(value)
    }
    fieldMatch = fieldMatcher.exec(node.body)
  }

  return record
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []

  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.results)) return payload.results
  if (payload.data && typeof payload.data === 'object') {
    if (Array.isArray(payload.data.items)) return payload.data.items
    if (Array.isArray(payload.data.results)) return payload.data.results
  }

  if (typeof payload.rawXml === 'string') {
    const xmlItems = extractXmlNodes(payload.rawXml, ['product', 'link', 'offer', 'item'])
    return xmlItems.map(parseXmlRecord)
  }

  return []
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

class CjApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'CjApiError'
    this.statusCode = options.statusCode
    this.payload = options.payload
    this.path = options.path
    this.baseUrl = options.baseUrl
  }
}

export function createCjConnector(options = {}) {
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig()
  const token = options.token || runtimeConfig.cj.token
  const productBaseUrl = (options.productBaseUrl || DEFAULT_PRODUCT_BASE_URL).replace(/\/+$/, '')
  const linkBaseUrl = (options.linkBaseUrl || DEFAULT_LINK_BASE_URL).replace(/\/+$/, '')
  const offerBaseUrl = (options.offerBaseUrl || DEFAULT_OFFER_BASE_URL).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  if (typeof fetchImpl !== 'function') {
    throw new Error('[cj] fetch implementation is required')
  }

  async function request(baseUrl, path, requestOptions = {}) {
    const method = requestOptions.method || 'GET'
    const query = requestOptions.query || {}
    const body = requestOptions.body

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const url = createUrl(baseUrl, path, query)
        const headers = {
          Accept: 'application/json, application/xml, text/xml',
          Authorization: `Bearer ${token}`
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

        const text = await response.text()
        const payload = parseBody(text, response.headers.get('content-type') || '')

        if (!response.ok) {
          const error = new CjApiError(`[cj] ${method} ${path} failed with ${response.status}`, {
            statusCode: response.status,
            payload,
            path,
            baseUrl
          })

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
          if (error instanceof CjApiError) throw error
          throw new CjApiError(`[cj] ${method} ${path} request failed`, {
            path,
            baseUrl,
            payload: { message: error?.message || 'Unknown error' }
          })
        }

        const backoffMs = 250 * 2 ** attempt + Math.floor(Math.random() * 100)
        await sleep(backoffMs)
      } finally {
        clearTimeout(timer)
      }
    }

    throw new CjApiError(`[cj] ${method} ${path} failed after retries`, {
      path,
      baseUrl
    })
  }

  async function requestWithFallback(candidates) {
    const errors = []
    for (const candidate of candidates) {
      try {
        const payload = await request(candidate.baseUrl, candidate.path, {
          method: candidate.method,
          query: candidate.query,
          body: candidate.body
        })
        const records = extractList(payload)
        return {
          records,
          raw: payload,
          baseUrl: candidate.baseUrl,
          path: candidate.path
        }
      } catch (error) {
        if (error instanceof CjApiError && error.statusCode === 404) {
          errors.push({ baseUrl: candidate.baseUrl, path: candidate.path, statusCode: 404 })
          continue
        }
        throw error
      }
    }

    return {
      records: [],
      raw: { errors },
      baseUrl: null,
      path: null
    }
  }

  async function listProducts(params = {}) {
    const result = await requestWithFallback([
      {
        baseUrl: productBaseUrl,
        path: '/product-search',
        query: {
          'website-id': params.websiteId,
          keywords: params.keywords,
          'advertiser-ids': params.advertiserIds,
          'serviceable-area': params.serviceableArea,
          'records-per-page': params.limit,
          page: params.page
        }
      },
      {
        baseUrl: productBaseUrl,
        path: '/products',
        query: {
          q: params.keywords,
          limit: params.limit,
          page: params.page
        }
      }
    ])

    return {
      products: result.records,
      raw: result.raw,
      sourcePath: result.path,
      sourceBaseUrl: result.baseUrl
    }
  }

  async function listLinks(params = {}) {
    const result = await requestWithFallback([
      {
        baseUrl: linkBaseUrl,
        path: '/link-search',
        query: {
          'website-id': params.websiteId,
          keywords: params.keywords,
          'advertiser-ids': params.advertiserIds,
          'records-per-page': params.limit,
          page: params.page
        }
      },
      {
        baseUrl: linkBaseUrl,
        path: '/links',
        query: {
          q: params.keywords,
          limit: params.limit,
          page: params.page
        }
      }
    ])

    return {
      links: result.records,
      raw: result.raw,
      sourcePath: result.path,
      sourceBaseUrl: result.baseUrl
    }
  }

  async function listOffers(params = {}) {
    const result = await requestWithFallback([
      {
        baseUrl: offerBaseUrl,
        path: '/offers',
        query: {
          q: params.keywords,
          limit: params.limit,
          page: params.page
        }
      },
      {
        baseUrl: offerBaseUrl,
        path: '/offer-search',
        query: {
          keywords: params.keywords,
          'records-per-page': params.limit,
          page: params.page
        }
      }
    ])

    return {
      offers: result.records,
      raw: result.raw,
      sourcePath: result.path,
      sourceBaseUrl: result.baseUrl
    }
  }

  async function fetchOffers(params = {}) {
    const [offersResult, productsResult, linksResult] = await Promise.all([
      listOffers(params).catch((error) => ({ error })),
      listProducts(params).catch((error) => ({ error })),
      listLinks(params).catch((error) => ({ error }))
    ])

    const all = []
    const errors = []

    if (offersResult.error) {
      errors.push({ source: 'offers', message: offersResult.error.message })
    } else {
      for (const offer of offersResult.offers) {
        all.push(
          mapCjToUnifiedOffer(offer, {
            sourceType: 'offer'
          })
        )
      }
    }

    if (productsResult.error) {
      errors.push({ source: 'products', message: productsResult.error.message })
    } else {
      for (const product of productsResult.products) {
        all.push(
          mapCjToUnifiedOffer(product, {
            sourceType: 'product'
          })
        )
      }
    }

    if (linksResult.error) {
      errors.push({ source: 'links', message: linksResult.error.message })
    } else {
      for (const link of linksResult.links) {
        all.push(
          mapCjToUnifiedOffer(link, {
            sourceType: 'link'
          })
        )
      }
    }

    const offers = normalizeUnifiedOffers(all)

    return {
      offers,
      debug: {
        counts: {
          offers: offersResult.error ? 0 : offersResult.offers.length,
          products: productsResult.error ? 0 : productsResult.products.length,
          links: linksResult.error ? 0 : linksResult.links.length
        },
        sources: {
          offers: offersResult.error ? null : { baseUrl: offersResult.sourceBaseUrl, path: offersResult.sourcePath },
          products: productsResult.error
            ? null
            : { baseUrl: productsResult.sourceBaseUrl, path: productsResult.sourcePath },
          links: linksResult.error ? null : { baseUrl: linksResult.sourceBaseUrl, path: linksResult.sourcePath }
        },
        errors
      }
    }
  }

  return {
    request,
    listProducts,
    listLinks,
    listOffers,
    fetchOffers
  }
}

export { CjApiError }
