<script setup>
import { computed, onMounted, reactive } from 'vue'

import { controlPlaneClient } from '../api/control-plane-client'
import { authState } from '../state/auth-state'
import {
  apiKeysState,
  clearRevealedSecret,
  createApiKey,
  hydrateApiKeys,
  revokeApiKey,
  rotateApiKey,
} from '../state/api-keys-state'
import { scopeState, setScope } from '../state/scope-state'

const draft = reactive({
  name: 'runtime-prod',
})

const appSelection = reactive({
  loading: false,
  error: '',
  options: [],
})

const isBusy = computed(() => Boolean(apiKeysState.meta.loading || apiKeysState.meta.syncing))
const refreshBusy = computed(() => Boolean(isBusy.value || appSelection.loading))
const rows = computed(() => Array.isArray(apiKeysState.items) ? apiKeysState.items : [])
const hasMultipleApps = computed(() => appSelection.options.length > 1)

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function statusClass(status) {
  return status === 'revoked' ? 'status-pill bad' : 'status-pill good'
}

function normalizeAppOptions(controlPlaneApps = []) {
  const rows = Array.isArray(controlPlaneApps) ? controlPlaneApps : []
  const filtered = rows.filter((row) => {
    const accountId = String(row?.accountId || row?.organizationId || '').trim()
    return accountId && accountId === String(scopeState.accountId || '').trim()
  })
  const mapped = filtered
    .map((row) => {
      const appId = String(row?.appId || '').trim()
      if (!appId) return null
      return {
        appId,
        label: String(row?.displayName || '').trim() || appId,
      }
    })
    .filter(Boolean)

  const deduped = []
  const seen = new Set()
  for (const item of mapped) {
    if (seen.has(item.appId)) continue
    seen.add(item.appId)
    deduped.push(item)
  }
  deduped.sort((a, b) => a.label.localeCompare(b.label))
  return deduped
}

async function hydrateAppOptions() {
  appSelection.loading = true
  appSelection.error = ''
  try {
    if (!scopeState.accountId) {
      appSelection.options = []
      return
    }
    const snapshot = await controlPlaneClient.dashboard.getState({
      accountId: scopeState.accountId,
    })
    appSelection.options = normalizeAppOptions(snapshot?.controlPlaneApps)

    const hasCurrent = appSelection.options.some((item) => item.appId === scopeState.appId)
    if (!hasCurrent) {
      const fallbackAppId = String(authState.user?.appId || '').trim() || String(appSelection.options[0]?.appId || '').trim()
      if (fallbackAppId) {
        setScope({ accountId: scopeState.accountId, appId: fallbackAppId })
      }
    }
  } catch (error) {
    appSelection.options = []
    appSelection.error = error instanceof Error ? error.message : 'App list unavailable.'
  } finally {
    appSelection.loading = false
  }
}

async function onChangeApp(appId) {
  const nextAppId = String(appId || '').trim()
  if (!nextAppId || nextAppId === scopeState.appId) return
  setScope({
    accountId: scopeState.accountId,
    appId: nextAppId,
  })
  clearRevealedSecret()
  await hydrateApiKeys()
}

async function handleCreate() {
  clearRevealedSecret()
  const scopedInput = {
    accountId: String(scopeState.accountId || '').trim(),
    appId: String(scopeState.appId || '').trim(),
  }

  await createApiKey({
    name: String(draft.name || '').trim() || 'runtime',
    environment: 'prod',
    appId: scopedInput.appId,
    accountId: scopedInput.accountId,
  })

  await hydrateApiKeys()
}

async function handleRotate(keyId) {
  await rotateApiKey(keyId)
}

async function handleRevoke(keyId) {
  await revokeApiKey(keyId)
}

async function refreshKeys() {
  await hydrateAppOptions()
  await hydrateApiKeys()
}

onMounted(() => {
  refreshKeys()
})
</script>

<template>
  <section class="page">
    <header class="page-header page-header-split">
      <div class="header-stack">
        <p class="eyebrow">Keys</p>
        <h2>Key</h2>
        <p class="subtitle">Create, rotate, revoke</p>
      </div>
      <div class="header-actions">
        <button class="button" type="button" :disabled="refreshBusy" @click="refreshKeys()">
          {{ refreshBusy ? 'Sync...' : 'Sync' }}
        </button>
      </div>
    </header>

    <article class="panel create-key-form">
      <h3>Scope</h3>
      <p class="muted">Account <strong>{{ scopeState.accountId || '-' }}</strong></p>
      <label v-if="hasMultipleApps">
        App
        <select class="input" :value="scopeState.appId" @change="onChangeApp($event.target.value)">
          <option v-for="item in appSelection.options" :key="item.appId" :value="item.appId">{{ item.label }}</option>
        </select>
      </label>
      <p v-else class="muted">App <strong>{{ scopeState.appId || '-' }}</strong></p>
      <p class="muted" v-if="appSelection.error">{{ appSelection.error }}</p>
    </article>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Create</h3>
        <button class="button" type="button" :disabled="isBusy || !scopeState.appId" @click="handleCreate">
          {{ isBusy ? 'Creating...' : 'Create' }}
        </button>
      </div>
      <div class="form-grid">
        <label>
          Name
          <input
            v-model="draft.name"
            class="input"
            type="text"
            maxlength="40"
            placeholder="runtime-prod"
          >
        </label>
      </div>
      <div v-if="apiKeysState.meta.lastRevealedSecret" class="secret-banner">
        <strong>Secret (once)</strong>
        <code>{{ apiKeysState.meta.lastRevealedSecret }}</code>
      </div>
    </article>

    <article class="panel panel-soft">
      <div class="panel-toolbar">
        <h3>Keys</h3>
        <p class="muted">{{ rows.length }}</p>
      </div>
      <p class="muted" v-if="apiKeysState.meta.error">{{ apiKeysState.meta.error }}</p>

      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Env</th>
              <th>Status</th>
              <th>Masked</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.keyId">
              <td>{{ row.name }}</td>
              <td>{{ row.environment }}</td>
              <td>
                <span :class="statusClass(row.status)">
                  {{ row.status }}
                </span>
              </td>
              <td><code>{{ row.maskedKey }}</code></td>
              <td>{{ formatDate(row.createdAt) }}</td>
              <td>
                <div class="toolbar-actions">
                  <button
                    class="button button-secondary"
                    type="button"
                    :disabled="isBusy || row.status === 'revoked'"
                    @click="handleRotate(row.keyId)"
                  >
                    Rotate
                  </button>
                  <button
                    class="button button-danger"
                    type="button"
                    :disabled="isBusy || row.status === 'revoked'"
                    @click="handleRevoke(row.keyId)"
                  >
                    Revoke
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="6" class="muted">No keys.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
