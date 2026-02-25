const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

function normalizeUpstreamBaseUrl(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value) return ''

  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''

    const pathname = parsed.pathname.replace(/\/$/, '')
    if (!pathname || pathname === '/') {
      parsed.pathname = '/api'
    } else if (!pathname.endsWith('/api')) {
      parsed.pathname = `${pathname}/api`
    } else {
      parsed.pathname = pathname
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function resolveUpstreamBaseUrl() {
  const candidates = [
    process.env.MEDIATION_CONTROL_PLANE_API_PROXY_TARGET,
    process.env.MEDIATION_CONTROL_PLANE_API_BASE_URL,
    process.env.VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL,
  ]
  for (const candidate of candidates) {
    const normalized = normalizeUpstreamBaseUrl(candidate)
    if (normalized) return normalized
  }
  return ''
}

function buildUpstreamUrl(req, upstreamBaseUrl) {
  const requestUrl = new URL(req.url || '/api', 'http://localhost')
  const base = new URL(upstreamBaseUrl)
  const basePath = base.pathname.replace(/\/$/, '')

  const incomingPath = requestUrl.pathname.startsWith('/api')
    ? requestUrl.pathname.slice('/api'.length)
    : requestUrl.pathname
  const suffix = incomingPath
    ? (incomingPath.startsWith('/') ? incomingPath : `/${incomingPath}`)
    : ''

  base.pathname = `${basePath}${suffix}`
  base.search = requestUrl.search
  return base.toString()
}

function buildUpstreamHeaders(req) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (value === undefined || value === null) continue
    const normalizedKey = String(key || '').toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return headers
}

async function readRequestBody(req) {
  const method = String(req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return undefined

  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body
    if (typeof req.body === 'string') return req.body
    if (typeof req.body === 'object') return JSON.stringify(req.body)
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return undefined
  return Buffer.concat(chunks)
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export default async function dashboardApiProxyHandler(req, res) {
  const upstreamBaseUrl = resolveUpstreamBaseUrl()
  if (!upstreamBaseUrl) {
    sendJson(res, 500, {
      error: {
        code: 'PROXY_TARGET_NOT_CONFIGURED',
        message: 'Set MEDIATION_CONTROL_PLANE_API_PROXY_TARGET (or VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL) to your control-plane API origin.',
      },
    })
    return
  }

  const targetUrl = buildUpstreamUrl(req, upstreamBaseUrl)
  const headers = buildUpstreamHeaders(req)
  const body = await readRequestBody(req)

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: String(req.method || 'GET').toUpperCase(),
      headers,
      body,
      redirect: 'manual',
    })

    res.statusCode = upstreamResponse.status
    for (const [key, value] of upstreamResponse.headers.entries()) {
      if (HOP_BY_HOP_HEADERS.has(String(key || '').toLowerCase())) continue
      res.setHeader(key, value)
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer())
    res.end(buffer)
  } catch (error) {
    sendJson(res, 502, {
      error: {
        code: 'PROXY_UPSTREAM_FETCH_FAILED',
        message: error instanceof Error ? error.message : 'Failed to reach upstream API.',
        target: targetUrl,
      },
    })
  }
}
