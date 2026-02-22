import { reactive } from 'vue'

import { controlPlaneClient } from '../api/control-plane-client'

const STORAGE_KEY = 'ai-network-simulator-dashboard-integrations-v1'

function nowIso() {
  return new Date().toISOString()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function defaultTemplates() {
  return [
    {
      placementId: 'chat_inline_v1',
      environment: 'staging',
      surface: 'CHAT_INLINE',
      enabled: true,
      routingMode: 'managed_mediation',
      updatedAt: nowIso(),
    },
  ]
}

function normalizeTemplate(item) {
  if (!item || typeof item !== 'object') return null
  const placementId = String(item.placementId || item.id || '').trim()
  if (!placementId) return null

  return {
    placementId,
    environment: String(item.environment || item.env || 'staging'),
    surface: String(item.surface || 'CHAT_INLINE'),
    enabled: Boolean(item.enabled),
    routingMode: 'managed_mediation',
    updatedAt: String(item.updatedAt || item.updated_at || nowIso()),
  }
}

function normalizeList(payload) {
  const source = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.placements) ? payload.placements : [])

  return source.map(normalizeTemplate).filter(Boolean)
}

function loadLocalTemplates() {
  if (typeof window === 'undefined') return defaultTemplates()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return defaultTemplates()

  try {
    const parsed = JSON.parse(raw)
    const normalized = normalizeList(parsed)
    return normalized.length > 0 ? normalized : defaultTemplates()
  } catch {
    return defaultTemplates()
  }
}

function persist(items) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

function upsert(items, row) {
  const idx = items.findIndex((item) => item.placementId === row.placementId)
  if (idx >= 0) {
    items[idx] = row
    return
  }
  items.unshift(row)
}

export const integrationsState = reactive({
  templates: loadLocalTemplates(),
  meta: {
    loading: false,
    syncing: false,
    syncMode: 'local',
    error: '',
    lastSyncedAt: '',
  },
})

function applyTemplates(items) {
  integrationsState.templates = clone(items)
  persist(integrationsState.templates)
}

export async function hydrateIntegrations() {
  integrationsState.meta.loading = true

  try {
    const payload = await controlPlaneClient.placements.list()
    const normalized = normalizeList(payload)
    if (normalized.length > 0) {
      applyTemplates(normalized)
      integrationsState.meta.syncMode = 'remote'
      integrationsState.meta.error = ''
      integrationsState.meta.lastSyncedAt = nowIso()
      return
    }

    const local = loadLocalTemplates()
    applyTemplates(local)
    integrationsState.meta.syncMode = 'local'
    integrationsState.meta.error = 'Remote placement list empty. Using local fallback.'
  } catch (error) {
    const local = loadLocalTemplates()
    applyTemplates(local)
    integrationsState.meta.syncMode = 'local'
    integrationsState.meta.error = error instanceof Error
      ? error.message
      : 'Failed to load remote placements. Using local fallback.'
  } finally {
    integrationsState.meta.loading = false
  }
}

export async function savePlacementTemplate(draft) {
  const normalized = normalizeTemplate({
    ...draft,
    routingMode: 'managed_mediation',
    updatedAt: nowIso(),
  })
  if (!normalized) return

  integrationsState.meta.syncing = true

  try {
    if (integrationsState.meta.syncMode === 'remote') {
      const exists = integrationsState.templates.some(
        (row) => row.placementId === normalized.placementId,
      )
      const payload = exists
        ? await controlPlaneClient.placements.update(normalized.placementId, normalized)
        : await controlPlaneClient.placements.create(normalized)
      const remoteItem = normalizeTemplate(payload?.placement || payload)
      if (remoteItem) {
        upsert(integrationsState.templates, remoteItem)
      } else {
        upsert(integrationsState.templates, normalized)
      }
      persist(integrationsState.templates)
      integrationsState.meta.error = ''
      integrationsState.meta.lastSyncedAt = nowIso()
      return
    }

    upsert(integrationsState.templates, normalized)
    persist(integrationsState.templates)
    integrationsState.meta.error = ''
    integrationsState.meta.lastSyncedAt = nowIso()
  } catch (error) {
    integrationsState.meta.syncMode = 'local'
    upsert(integrationsState.templates, normalized)
    persist(integrationsState.templates)
    integrationsState.meta.error = error instanceof Error
      ? `${error.message} (switched to local mode)`
      : 'Failed to save on remote API. Switched to local mode.'
    integrationsState.meta.lastSyncedAt = nowIso()
  } finally {
    integrationsState.meta.syncing = false
  }
}
