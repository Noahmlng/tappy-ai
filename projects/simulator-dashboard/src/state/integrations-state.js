import { reactive } from 'vue'

import { controlPlaneClient } from '../api/control-plane-client'

function nowIso() {
  return new Date().toISOString()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeTemplate(item) {
  if (!item || typeof item !== 'object') return null
  const placementId = String(item.placementId || item.id || '').trim()
  if (!placementId) return null

  return {
    placementId,
    environment: String(item.environment || item.env || 'prod'),
    surface: String(item.surface || 'CHAT_INLINE'),
    enabled: Boolean(item.enabled),
    updatedAt: String(item.updatedAt || item.updated_at || nowIso()),
  }
}

function normalizeList(payload) {
  const source = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.placements) ? payload.placements : [])

  return source.map(normalizeTemplate).filter(Boolean)
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
  templates: [],
  meta: {
    loading: false,
    syncing: false,
    syncMode: 'unknown',
    error: '',
    lastSyncedAt: '',
  },
})

function applyTemplates(items) {
  integrationsState.templates = clone(items)
}

export async function hydrateIntegrations() {
  integrationsState.meta.loading = true

  try {
    const payload = await controlPlaneClient.placements.list()
    const normalized = normalizeList(payload)
    applyTemplates(normalized)
    integrationsState.meta.syncMode = 'remote'
    integrationsState.meta.error = ''
    integrationsState.meta.lastSyncedAt = nowIso()
  } catch (error) {
    applyTemplates([])
    integrationsState.meta.syncMode = 'offline'
    integrationsState.meta.error = error instanceof Error
      ? error.message
      : 'Failed to load placements from remote service.'
    integrationsState.meta.lastSyncedAt = ''
  } finally {
    integrationsState.meta.loading = false
  }
}

export async function savePlacementTemplate(draft) {
  const normalized = normalizeTemplate({
    ...draft,
    updatedAt: nowIso(),
  })
  if (!normalized) return

  integrationsState.meta.syncing = true

  try {
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
    integrationsState.meta.syncMode = 'remote'
    integrationsState.meta.error = ''
    integrationsState.meta.lastSyncedAt = nowIso()
  } catch (error) {
    integrationsState.meta.syncMode = 'offline'
    integrationsState.meta.error = error instanceof Error
      ? error.message
      : 'Failed to save placement on remote API.'
  } finally {
    integrationsState.meta.syncing = false
  }
}
