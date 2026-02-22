import { reactive } from 'vue'

import {
  createPublicApiKey,
  fetchPublicApiKeys,
  revokePublicApiKey,
  rotatePublicApiKey,
} from '../api/dashboard-api'

const STORAGE_KEY = 'ai-network-simulator-dashboard-api-keys-v1'

function nowIso() {
  return new Date().toISOString()
}

function randomString(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len)
}

function buildRawSecret(environment = 'staging') {
  return `sk_${environment}_${randomString(6)}${randomString(10)}`
}

function maskSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 8) return '****'
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`
}

function defaultItems() {
  const rawSecret = buildRawSecret('staging')
  return [
    {
      keyId: `key_${randomString(12)}`,
      name: 'primary-staging',
      environment: 'staging',
      status: 'active',
      maskedKey: maskSecret(rawSecret),
      createdAt: nowIso(),
      lastUsedAt: '',
    },
  ]
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
    name: String(item.name || `key_${keyId.slice(0, 6)}`),
    environment: String(item.environment || item.env || 'staging'),
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

function persist(items) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

function loadLocalItems() {
  if (typeof window === 'undefined') return defaultItems()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return defaultItems()

  try {
    const parsed = JSON.parse(raw)
    const normalized = normalizeList(parsed)
    return normalized.length > 0 ? normalized : defaultItems()
  } catch {
    return defaultItems()
  }
}

function upsertItem(items, nextItem) {
  const idx = items.findIndex((row) => row.keyId === nextItem.keyId)
  if (idx >= 0) {
    items[idx] = nextItem
    return
  }
  items.unshift(nextItem)
}

function createLocalItem(input) {
  const secret = buildRawSecret(input.environment || 'staging')
  return {
    item: {
      keyId: `key_${randomString(12)}`,
      name: String(input.name || 'primary'),
      environment: String(input.environment || 'staging'),
      status: 'active',
      maskedKey: maskSecret(secret),
      createdAt: nowIso(),
      lastUsedAt: '',
    },
    rawSecret: secret,
  }
}

export const apiKeysState = reactive({
  items: loadLocalItems(),
  meta: {
    loading: false,
    syncing: false,
    syncMode: 'local',
    error: '',
    lastSyncedAt: '',
    lastRevealedSecret: '',
  },
})

function applyItems(items) {
  apiKeysState.items = clone(items)
  persist(apiKeysState.items)
}

export async function hydrateApiKeys() {
  apiKeysState.meta.loading = true

  try {
    const payload = await fetchPublicApiKeys()
    const keys = normalizeList(payload)
    if (keys.length > 0) {
      applyItems(keys)
      apiKeysState.meta.syncMode = 'remote'
      apiKeysState.meta.error = ''
      apiKeysState.meta.lastSyncedAt = nowIso()
      return
    }

    const local = loadLocalItems()
    applyItems(local)
    apiKeysState.meta.syncMode = 'local'
    apiKeysState.meta.error = 'Remote keys empty. Using local fallback.'
  } catch (error) {
    const local = loadLocalItems()
    applyItems(local)
    apiKeysState.meta.syncMode = 'local'
    apiKeysState.meta.error = error instanceof Error
      ? error.message
      : 'Failed to load remote keys. Using local fallback.'
  } finally {
    apiKeysState.meta.loading = false
  }
}

export async function createApiKey(input) {
  apiKeysState.meta.syncing = true
  apiKeysState.meta.lastRevealedSecret = ''

  try {
    if (apiKeysState.meta.syncMode === 'remote') {
      const payload = await createPublicApiKey(input)
      const normalized = normalizeItem(payload?.key || payload)
      const secret = String(payload?.secret || payload?.apiKey || '')

      if (normalized) {
        upsertItem(apiKeysState.items, normalized)
        persist(apiKeysState.items)
        apiKeysState.meta.lastSyncedAt = nowIso()
        apiKeysState.meta.error = ''
        apiKeysState.meta.lastRevealedSecret = secret
        return
      }
      throw new Error('Unexpected create key response')
    }

    const { item, rawSecret } = createLocalItem(input || {})
    upsertItem(apiKeysState.items, item)
    persist(apiKeysState.items)
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.lastRevealedSecret = rawSecret
    apiKeysState.meta.error = ''
  } catch (error) {
    apiKeysState.meta.syncMode = 'local'
    const { item, rawSecret } = createLocalItem(input || {})
    upsertItem(apiKeysState.items, item)
    persist(apiKeysState.items)
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.lastRevealedSecret = rawSecret
    apiKeysState.meta.error = error instanceof Error
      ? `${error.message} (switched to local mode)`
      : 'Create failed on remote API. Switched to local mode.'
  } finally {
    apiKeysState.meta.syncing = false
  }
}

export async function rotateApiKey(keyId) {
  apiKeysState.meta.syncing = true
  apiKeysState.meta.lastRevealedSecret = ''

  try {
    if (apiKeysState.meta.syncMode === 'remote') {
      const payload = await rotatePublicApiKey(keyId)
      const normalized = normalizeItem(payload?.key || payload)
      const secret = String(payload?.secret || payload?.apiKey || '')
      if (normalized) {
        upsertItem(apiKeysState.items, normalized)
        persist(apiKeysState.items)
        apiKeysState.meta.lastRevealedSecret = secret
        apiKeysState.meta.lastSyncedAt = nowIso()
        apiKeysState.meta.error = ''
        return
      }
      throw new Error('Unexpected rotate key response')
    }

    const idx = apiKeysState.items.findIndex((row) => row.keyId === keyId)
    if (idx < 0) return
    const secret = buildRawSecret(apiKeysState.items[idx].environment)
    apiKeysState.items[idx] = {
      ...apiKeysState.items[idx],
      maskedKey: maskSecret(secret),
      status: 'active',
      lastUsedAt: '',
    }
    persist(apiKeysState.items)
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.lastRevealedSecret = secret
    apiKeysState.meta.error = ''
  } catch (error) {
    apiKeysState.meta.syncMode = 'local'
    const idx = apiKeysState.items.findIndex((row) => row.keyId === keyId)
    if (idx >= 0) {
      const secret = buildRawSecret(apiKeysState.items[idx].environment)
      apiKeysState.items[idx] = {
        ...apiKeysState.items[idx],
        maskedKey: maskSecret(secret),
        status: 'active',
        lastUsedAt: '',
      }
      persist(apiKeysState.items)
      apiKeysState.meta.lastRevealedSecret = secret
    }
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.error = error instanceof Error
      ? `${error.message} (switched to local mode)`
      : 'Rotate failed on remote API. Switched to local mode.'
  } finally {
    apiKeysState.meta.syncing = false
  }
}

export async function revokeApiKey(keyId) {
  apiKeysState.meta.syncing = true

  try {
    if (apiKeysState.meta.syncMode === 'remote') {
      const payload = await revokePublicApiKey(keyId)
      const normalized = normalizeItem(payload?.key || payload)
      if (normalized) {
        upsertItem(apiKeysState.items, normalized)
      } else {
        apiKeysState.items = apiKeysState.items.map((row) => (
          row.keyId === keyId ? { ...row, status: 'revoked' } : row
        ))
      }
      persist(apiKeysState.items)
      apiKeysState.meta.lastSyncedAt = nowIso()
      apiKeysState.meta.error = ''
      return
    }

    apiKeysState.items = apiKeysState.items.map((row) => (
      row.keyId === keyId ? { ...row, status: 'revoked' } : row
    ))
    persist(apiKeysState.items)
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.error = ''
  } catch (error) {
    apiKeysState.meta.syncMode = 'local'
    apiKeysState.items = apiKeysState.items.map((row) => (
      row.keyId === keyId ? { ...row, status: 'revoked' } : row
    ))
    persist(apiKeysState.items)
    apiKeysState.meta.lastSyncedAt = nowIso()
    apiKeysState.meta.error = error instanceof Error
      ? `${error.message} (switched to local mode)`
      : 'Revoke failed on remote API. Switched to local mode.'
  } finally {
    apiKeysState.meta.syncing = false
  }
}

export function clearRevealedSecret() {
  apiKeysState.meta.lastRevealedSecret = ''
}
