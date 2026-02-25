import { reactive } from 'vue'

import { controlPlaneClient } from '../api/control-plane-client'
import { getScopeQuery } from './scope-state'

function nowIso() {
  return new Date().toISOString()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null

  const keyId = String(item.keyId || item.id || '').trim()
  if (!keyId) return null

  const status = String(item.status || 'active').toLowerCase()
  const maskedKey = String(item.maskedKey || item.keyMasked || item.preview || '****')

  return {
    keyId,
    appId: String(item.appId || item.app_id || ''),
    accountId: String(item.accountId || item.account_id || item.organizationId || ''),
    name: String(item.name || `key_${keyId.slice(0, 6)}`),
    environment: String(item.environment || item.env || 'prod'),
    status: status === 'revoked' ? 'revoked' : 'active',
    maskedKey,
    createdAt: String(item.createdAt || item.created_at || nowIso()),
    lastUsedAt: String(item.lastUsedAt || item.last_used_at || ''),
  }
}

function normalizeList(payload) {
  const source = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.keys) ? payload.keys : [])

  return source.map(normalizeItem).filter(Boolean)
}

function upsertItem(items, nextItem) {
  const idx = items.findIndex((row) => row.keyId === nextItem.keyId)
  if (idx >= 0) {
    items[idx] = nextItem
    return
  }
  items.unshift(nextItem)
}

export const apiKeysState = reactive({
  items: [],
  meta: {
    loading: false,
    syncing: false,
    syncMode: 'unknown',
    error: '',
    lastSyncedAt: '',
    lastRevealedSecret: '',
  },
})

function applyItems(items) {
  apiKeysState.items = clone(items)
}

export async function hydrateApiKeys() {
  apiKeysState.meta.loading = true

  try {
    const payload = await controlPlaneClient.credentials.listKeys(getScopeQuery())
    const keys = normalizeList(payload)
    applyItems(keys)
    apiKeysState.meta.syncMode = 'remote'
    apiKeysState.meta.error = ''
    apiKeysState.meta.lastSyncedAt = nowIso()
  } catch (error) {
    apiKeysState.items = []
    apiKeysState.meta.lastRevealedSecret = ''
    apiKeysState.meta.syncMode = 'offline'
    apiKeysState.meta.error = error instanceof Error
      ? error.message
      : 'Failed to load API keys from remote service.'
  } finally {
    apiKeysState.meta.loading = false
  }
}

export async function createApiKey(input) {
  apiKeysState.meta.syncing = true
  apiKeysState.meta.lastRevealedSecret = ''
  const scope = getScopeQuery()
  const scopedInput = {
    ...(input || {}),
    appId: String(input?.appId ?? scope.appId ?? '').trim(),
    accountId: String(input?.accountId ?? scope.accountId ?? '').trim(),
  }

  try {
    const payload = await controlPlaneClient.credentials.createKey(scopedInput)
    const normalized = normalizeItem(payload?.key || payload)
    if (!normalized) {
      throw new Error('Unexpected create key response')
    }
    upsertItem(apiKeysState.items, normalized)
    apiKeysState.meta.syncMode = 'remote'
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.error = ''
    apiKeysState.meta.lastRevealedSecret = String(payload?.secret || payload?.apiKey || '')
    return { ok: true, key: normalized }
  } catch (error) {
    apiKeysState.meta.lastRevealedSecret = ''
    apiKeysState.meta.syncMode = 'offline'
    apiKeysState.meta.error = error instanceof Error
      ? error.message
      : 'Create API key failed on remote service.'
    return {
      ok: false,
      error: apiKeysState.meta.error,
    }
  } finally {
    apiKeysState.meta.syncing = false
  }
}

export async function rotateApiKey(keyId) {
  apiKeysState.meta.syncing = true
  apiKeysState.meta.lastRevealedSecret = ''

  try {
    const payload = await controlPlaneClient.credentials.rotateKey(keyId)
    const normalized = normalizeItem(payload?.key || payload)
    if (!normalized) {
      throw new Error('Unexpected rotate key response')
    }
    upsertItem(apiKeysState.items, normalized)
    apiKeysState.meta.syncMode = 'remote'
    apiKeysState.meta.lastRevealedSecret = String(payload?.secret || payload?.apiKey || '')
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.error = ''
  } catch (error) {
    apiKeysState.meta.lastRevealedSecret = ''
    apiKeysState.meta.syncMode = 'offline'
    apiKeysState.meta.error = error instanceof Error
      ? error.message
      : 'Rotate API key failed on remote service.'
  } finally {
    apiKeysState.meta.syncing = false
  }
}

export async function revokeApiKey(keyId) {
  apiKeysState.meta.syncing = true

  try {
    const payload = await controlPlaneClient.credentials.revokeKey(keyId)
    const normalized = normalizeItem(payload?.key || payload)
    if (normalized) {
      upsertItem(apiKeysState.items, normalized)
    } else {
      apiKeysState.items = apiKeysState.items.map((row) => (
        row.keyId === keyId ? { ...row, status: 'revoked' } : row
      ))
    }
    apiKeysState.meta.syncMode = 'remote'
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.error = ''
  } catch (error) {
    apiKeysState.meta.syncMode = 'offline'
    apiKeysState.meta.error = error instanceof Error
      ? error.message
      : 'Revoke API key failed on remote service.'
  } finally {
    apiKeysState.meta.syncing = false
  }
}

export function clearRevealedSecret() {
  apiKeysState.meta.lastRevealedSecret = ''
}
