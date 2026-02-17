import { loadRuntimeConfig } from '../../config/runtime-config.js'
import { mapPartnerStackToUnifiedOffer, normalizeUnifiedOffers } from '../../offers/index.js'

const DEFAULT_BASE_URL = 'https://api.partnerstack.com/api/v2'
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 8000
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

function toArray(value) {
  return Array.isArray(value) ? value : []
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

function resolvePartnershipIdentifier(partnership) {
  return pickFirst(
    String(partnership?.identifier ?? ''),
    String(partnership?.key ?? ''),
    String(partnership?.id ?? '')
  )
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
    const payload = await request('/partnerships', {
      query: {
        page: params.page,
        per_page: params.perPage,
        limit: params.limit
      }
    })

    const partnerships = extractList(payload).map((partnership) => ({
      ...partnership,
      _identifier: resolvePartnershipIdentifier(partnership)
    }))

    return { partnerships, raw: payload }
  }

  async function listLinksByPartnership(partnershipIdentifier, params = {}) {
    if (!normalizeText(partnershipIdentifier)) {
      throw new Error('[partnerstack] partnershipIdentifier is required')
    }

    const payload = await request(`/links/partnership/${encodeURIComponent(partnershipIdentifier)}`, {
      query: {
        page: params.page,
        per_page: params.perPage,
        limit: params.limit
      }
    })

    const links = extractList(payload)
    return { links, raw: payload }
  }

  async function listOffers(params = {}) {
    const candidates = [
      { path: '/offers', query: { search: params.search, limit: params.limit } },
      { path: '/marketplace/programs', query: { search: params.search, limit: params.limit } },
      { path: '/programs', query: { search: params.search, limit: params.limit } }
    ]
    const errors = []

    for (const candidate of candidates) {
      try {
        const payload = await request(candidate.path, { query: candidate.query })
        const offers = extractList(payload)
        if (offers.length > 0) {
          return { offers, raw: payload, sourcePath: candidate.path }
        }
      } catch (error) {
        if (error instanceof PartnerStackApiError && error.statusCode === 404) {
          errors.push({ path: candidate.path, statusCode: 404 })
          continue
        }
        throw error
      }
    }

    return { offers: [], raw: { errors }, sourcePath: null }
  }

  async function fetchOffers(params = {}) {
    const offersResult = await listOffers(params)
    if (offersResult.offers.length > 0) {
      const mapped = normalizeUnifiedOffers(
        offersResult.offers.map((offer) =>
          mapPartnerStackToUnifiedOffer(offer, {
            sourceType: 'offer'
          })
        )
      )

      return { offers: mapped, debug: { mode: 'offers_endpoint', sourcePath: offersResult.sourcePath } }
    }

    const partnershipsResult = await listPartnerships({ limit: params.limitPartnerships })
    const partnershipIdentifiers = toArray(partnershipsResult.partnerships)
      .map((item) => item?._identifier)
      .filter((value) => typeof value === 'string' && value.length > 0)

    const allOffers = []
    const linkErrors = []

    for (const partnershipIdentifier of partnershipIdentifiers) {
      try {
        const linksResult = await listLinksByPartnership(partnershipIdentifier, { limit: params.limitLinksPerPartnership })
        for (const link of linksResult.links) {
          allOffers.push(
            mapPartnerStackToUnifiedOffer(link, {
              sourceType: 'link',
              partnershipIdentifier
            })
          )
        }
      } catch (error) {
        linkErrors.push({
          partnershipIdentifier,
          message: error?.message || 'Unknown error'
        })
      }
    }

    return {
      offers: normalizeUnifiedOffers(allOffers),
      debug: {
        mode: 'links_fallback',
        partnerships: partnershipIdentifiers.length,
        linkErrors
      }
    }
  }

  return {
    request,
    listPartnerships,
    listLinksByPartnership,
    listOffers,
    fetchOffers
  }
}

export { PartnerStackApiError }
