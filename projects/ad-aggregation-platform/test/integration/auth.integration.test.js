import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTH_REASON_CODES,
  authorizeServiceRequest,
  createServiceToken,
  parseServiceTokenKeyringFromEnv,
  resolveSigningKeyFromEnv,
  verifyServiceToken
} from '../../src/infra/auth/index.js'

const FIXED_NOW = 1766660000

test('auth: valid token with required scope is authorized', () => {
  const keyring = {
    key_current: 'secret-current'
  }

  const { token } = createServiceToken('svc:publisher', {
    kid: 'key_current',
    secret: keyring.key_current,
    role: 'publisher',
    nowEpochSec: FIXED_NOW
  })

  const result = authorizeServiceRequest(
    {
      token,
      requiredScope: 'config:publish',
      authAction: 'config_publish'
    },
    {
      keyring,
      nowEpochSec: FIXED_NOW + 30
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.reasonCode, AUTH_REASON_CODES.SUCCESS)
  assert.equal(result.payload.role, 'publisher')
  assert.equal(result.auditRecord.result, 'allow')
})

test('auth: invalid signature is denied with deterministic reason code', () => {
  const keyring = {
    key_current: 'secret-current'
  }

  const { token } = createServiceToken('svc:publisher', {
    kid: 'key_current',
    secret: keyring.key_current,
    role: 'publisher',
    nowEpochSec: FIXED_NOW
  })

  const tamperedToken = `${token.slice(0, -2)}aa`

  const result = authorizeServiceRequest(
    {
      token: tamperedToken,
      requiredScope: 'config:publish',
      authAction: 'config_publish'
    },
    {
      keyring,
      nowEpochSec: FIXED_NOW + 10
    }
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, AUTH_REASON_CODES.SIGNATURE_INVALID)
  assert.equal(result.auditRecord.result, 'deny')
})

test('auth: expired token is denied', () => {
  const keyring = {
    key_current: 'secret-current'
  }

  const { token } = createServiceToken('svc:publisher', {
    kid: 'key_current',
    secret: keyring.key_current,
    role: 'publisher',
    expiresInSec: 5,
    nowEpochSec: FIXED_NOW
  })

  const verification = verifyServiceToken(token, {
    keyring,
    nowEpochSec: FIXED_NOW + 30,
    clockToleranceSec: 1
  })

  assert.equal(verification.ok, false)
  assert.equal(verification.reasonCode, AUTH_REASON_CODES.TOKEN_EXPIRED)
})

test('auth: missing scope is denied with scope reason code', () => {
  const keyring = {
    key_current: 'secret-current'
  }

  const { token } = createServiceToken('svc:publisher', {
    kid: 'key_current',
    secret: keyring.key_current,
    role: 'publisher',
    scopes: ['event:write'],
    nowEpochSec: FIXED_NOW
  })

  const result = authorizeServiceRequest(
    {
      token,
      requiredScope: 'audit:read',
      authAction: 'replay_read'
    },
    {
      keyring,
      nowEpochSec: FIXED_NOW + 30
    }
  )

  assert.equal(result.ok, false)
  assert.equal(result.reasonCode, AUTH_REASON_CODES.SCOPE_DENIED)
  assert.equal(result.auditRecord.result, 'deny')
})

test('auth: key rotation keeps old tokens valid during overlap window', () => {
  const keyring = {
    key_previous: 'secret-previous',
    key_current: 'secret-current'
  }

  const { token: previousToken } = createServiceToken('svc:reviewer', {
    kid: 'key_previous',
    secret: keyring.key_previous,
    role: 'reviewer',
    nowEpochSec: FIXED_NOW
  })

  const overlapResult = verifyServiceToken(previousToken, {
    keyring,
    nowEpochSec: FIXED_NOW + 120
  })
  assert.equal(overlapResult.ok, true)

  const keyringAfterCutover = {
    key_current: 'secret-current'
  }

  const cutoverResult = verifyServiceToken(previousToken, {
    keyring: keyringAfterCutover,
    nowEpochSec: FIXED_NOW + 120
  })

  assert.equal(cutoverResult.ok, false)
  assert.equal(cutoverResult.reasonCode, AUTH_REASON_CODES.SIGNING_KEY_MISSING)
})

test('auth: parse signing key config from env', () => {
  const env = {
    SERVICE_TOKEN_ACTIVE_KID: 'k2026q1',
    SERVICE_TOKEN_KEYS_JSON: JSON.stringify({
      k2026q1: 'secret-a',
      k2025q4: 'secret-b'
    })
  }

  const keyring = parseServiceTokenKeyringFromEnv(env)
  assert.equal(keyring.k2026q1, 'secret-a')

  const active = resolveSigningKeyFromEnv(env)
  assert.equal(active.kid, 'k2026q1')
  assert.equal(active.secret, 'secret-a')
})
