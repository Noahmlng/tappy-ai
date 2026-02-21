import crypto from 'node:crypto'

import {
  AUTH_REASON_CODES,
  TOKEN_TTL_SECONDS,
  buildMinimumScopes,
  hasRequiredScope,
  normalizeRole,
  normalizeScopes
} from './token-policy.js'

const SERVICE_TOKEN_ISSUER = 'mediation-control-plane'
const SERVICE_TOKEN_AUDIENCE = 'mediation-internal'

function toSafePositiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function nowEpochSec(input) {
  const value = Number(input)
  if (Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  return Math.floor(Date.now() / 1000)
}

function encodeSegment(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeSegment(segment) {
  try {
    const text = Buffer.from(String(segment || ''), 'base64url').toString('utf8')
    return JSON.parse(text)
  } catch (error) {
    return null
  }
}

function signSigningInput(signingInput, secret) {
  return crypto.createHmac('sha256', secret).update(signingInput).digest('base64url')
}

function timingSafeEqual(left, right) {
  const leftText = String(left || '')
  const rightText = String(right || '')
  if (leftText.length !== rightText.length) return false

  const leftBuffer = Buffer.from(leftText)
  const rightBuffer = Buffer.from(rightText)
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function parseToken(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return { ok: false, reasonCode: AUTH_REASON_CODES.MALFORMED_TOKEN, reasonDetail: 'token must have 3 segments' }
  }

  const [headerSegment, payloadSegment, signature] = parts
  const header = decodeSegment(headerSegment)
  const payload = decodeSegment(payloadSegment)

  if (!header || !payload) {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.MALFORMED_TOKEN,
      reasonDetail: 'token header/payload is invalid json'
    }
  }

  return {
    ok: true,
    header,
    payload,
    signature,
    signingInput: `${headerSegment}.${payloadSegment}`
  }
}

function resolveSecretByKid(keyring, kid) {
  if (!kid) return ''

  if (keyring instanceof Map) {
    return String(keyring.get(kid) || '')
  }

  if (keyring && typeof keyring === 'object') {
    return String(keyring[kid] || '')
  }

  return ''
}

function createServiceToken(subject, options = {}) {
  const normalizedSubject = String(subject || '').trim()
  if (!normalizedSubject) {
    throw new Error('[auth] subject is required to create service token.')
  }

  const secret = String(options.secret || '').trim()
  if (!secret) {
    throw new Error('[auth] secret is required to create service token.')
  }

  const kid = String(options.kid || '').trim()
  if (!kid) {
    throw new Error('[auth] kid is required to create service token.')
  }

  const role = normalizeRole(options.role)
  const scopes = buildMinimumScopes(role, options.scopes)
  const issuedAt = nowEpochSec(options.nowEpochSec)
  const expiresInSec = toSafePositiveInt(options.expiresInSec, TOKEN_TTL_SECONDS.serviceToken)

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid
  }

  const payload = {
    iss: String(options.issuer || SERVICE_TOKEN_ISSUER),
    aud: String(options.audience || SERVICE_TOKEN_AUDIENCE),
    sub: normalizedSubject,
    role,
    scopes,
    jti: String(options.jti || `${kid}_${issuedAt}_${crypto.randomUUID()}`),
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + expiresInSec
  }

  const headerSegment = encodeSegment(header)
  const payloadSegment = encodeSegment(payload)
  const signingInput = `${headerSegment}.${payloadSegment}`
  const signature = signSigningInput(signingInput, secret)

  return {
    token: `${signingInput}.${signature}`,
    payload,
    header
  }
}

function verifyServiceToken(token, options = {}) {
  const parsed = parseToken(token)
  if (!parsed.ok) return parsed

  const { header, payload, signature, signingInput } = parsed
  if (header.alg !== 'HS256') {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.MALFORMED_TOKEN,
      reasonDetail: 'unsupported alg'
    }
  }

  const kid = String(header.kid || '').trim()
  const secret = resolveSecretByKid(options.keyring, kid)
  if (!secret) {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.SIGNING_KEY_MISSING,
      reasonDetail: `missing key for kid=${kid || '<empty>'}`
    }
  }

  const expectedSignature = signSigningInput(signingInput, secret)
  if (!timingSafeEqual(signature, expectedSignature)) {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.SIGNATURE_INVALID,
      reasonDetail: 'token signature mismatch'
    }
  }

  const now = nowEpochSec(options.nowEpochSec)
  const tolerance = toSafePositiveInt(options.clockToleranceSec, 10)
  const tokenExp = toSafePositiveInt(payload.exp, 0)
  const tokenNbf = toSafePositiveInt(payload.nbf, 0)

  if (tokenExp <= now - tolerance) {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.TOKEN_EXPIRED,
      reasonDetail: `token expired at ${tokenExp}`
    }
  }

  if (tokenNbf > now + tolerance) {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.TOKEN_NOT_ACTIVE,
      reasonDetail: `token not active before ${tokenNbf}`
    }
  }

  const expectedIssuer = String(options.issuer || SERVICE_TOKEN_ISSUER)
  if (expectedIssuer && String(payload.iss || '') !== expectedIssuer) {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.ISSUER_MISMATCH,
      reasonDetail: `expected iss=${expectedIssuer}`
    }
  }

  const expectedAudience = String(options.audience || SERVICE_TOKEN_AUDIENCE)
  if (expectedAudience && String(payload.aud || '') !== expectedAudience) {
    return {
      ok: false,
      reasonCode: AUTH_REASON_CODES.AUDIENCE_MISMATCH,
      reasonDetail: `expected aud=${expectedAudience}`
    }
  }

  return {
    ok: true,
    reasonCode: AUTH_REASON_CODES.SUCCESS,
    reasonDetail: 'token verified',
    header,
    payload: {
      ...payload,
      role: normalizeRole(payload.role),
      scopes: normalizeScopes(payload.scopes)
    }
  }
}

function buildAuthAuditRecord(input = {}) {
  const result = String(input.result || '').trim().toLowerCase() === 'deny' ? 'deny' : 'allow'
  const reasonCode = String(input.reasonCode || AUTH_REASON_CODES.SUCCESS)
  const nowIso = new Date().toISOString()

  return {
    timestamp: nowIso,
    requestId: String(input.requestId || ''),
    actorId: String(input.actorId || ''),
    actorRole: normalizeRole(input.actorRole),
    authAction: String(input.authAction || ''),
    requiredScope: String(input.requiredScope || ''),
    result,
    reasonCode,
    reasonDetail: String(input.reasonDetail || ''),
    traceKey: String(input.traceKey || '')
  }
}

function authorizeServiceRequest(input = {}, options = {}) {
  const verification = verifyServiceToken(input.token, options)
  if (!verification.ok) {
    return {
      ok: false,
      ...verification,
      auditRecord: buildAuthAuditRecord({
        ...input,
        result: 'deny',
        reasonCode: verification.reasonCode,
        reasonDetail: verification.reasonDetail
      })
    }
  }

  const requiredScope = String(input.requiredScope || '').trim().toLowerCase()
  if (!hasRequiredScope(verification.payload.scopes, requiredScope)) {
    const reasonCode = AUTH_REASON_CODES.SCOPE_DENIED
    const reasonDetail = `missing required scope=${requiredScope}`

    return {
      ok: false,
      reasonCode,
      reasonDetail,
      payload: verification.payload,
      header: verification.header,
      auditRecord: buildAuthAuditRecord({
        ...input,
        actorId: input.actorId || verification.payload.sub,
        actorRole: verification.payload.role,
        result: 'deny',
        reasonCode,
        reasonDetail
      })
    }
  }

  return {
    ok: true,
    reasonCode: AUTH_REASON_CODES.SUCCESS,
    reasonDetail: 'authorized',
    payload: verification.payload,
    header: verification.header,
    auditRecord: buildAuthAuditRecord({
      ...input,
      actorId: input.actorId || verification.payload.sub,
      actorRole: verification.payload.role,
      result: 'allow',
      reasonCode: AUTH_REASON_CODES.SUCCESS,
      reasonDetail: 'authorized'
    })
  }
}

function parseServiceTokenKeyringFromEnv(env = process.env) {
  const raw = String(env.SERVICE_TOKEN_KEYS_JSON || '').trim()
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    const output = {}
    for (const [kid, secret] of Object.entries(parsed)) {
      const normalizedKid = String(kid || '').trim()
      const normalizedSecret = String(secret || '').trim()
      if (!normalizedKid || !normalizedSecret) continue
      output[normalizedKid] = normalizedSecret
    }

    return output
  } catch (error) {
    return {}
  }
}

function resolveSigningKeyFromEnv(env = process.env) {
  const keyring = parseServiceTokenKeyringFromEnv(env)
  const kid = String(env.SERVICE_TOKEN_ACTIVE_KID || '').trim()
  const secret = kid ? String(keyring[kid] || '') : ''

  if (!kid || !secret) {
    throw new Error('[auth] SERVICE_TOKEN_ACTIVE_KID or SERVICE_TOKEN_KEYS_JSON is not configured correctly.')
  }

  return {
    kid,
    secret,
    keyring
  }
}

export {
  SERVICE_TOKEN_AUDIENCE,
  SERVICE_TOKEN_ISSUER,
  authorizeServiceRequest,
  buildAuthAuditRecord,
  createServiceToken,
  parseServiceTokenKeyringFromEnv,
  resolveSigningKeyFromEnv,
  verifyServiceToken
}
