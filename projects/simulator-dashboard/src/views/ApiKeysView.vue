<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

import {
  apiKeysState,
  clearRevealedSecret,
  createApiKey,
  hydrateApiKeys,
  revokeApiKey,
  rotateApiKey,
} from '../state/api-keys-state'
import { scopeState, setScope } from '../state/scope-state'

const createFormOpen = ref(false)

const draft = reactive({
  name: 'primary-staging',
  environment: 'staging',
})

const environmentOptions = ['sandbox', 'staging', 'prod']
const scopeDraft = reactive({
  appId: scopeState.appId,
  accountId: scopeState.accountId,
})

const isBusy = computed(() => Boolean(apiKeysState.meta.loading || apiKeysState.meta.syncing))
const syncMode = computed(() => String(apiKeysState.meta.syncMode || 'local'))
const rows = computed(() => Array.isArray(apiKeysState.items) ? apiKeysState.items : [])

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function statusClass(status) {
  return status === 'revoked' ? 'status-pill bad' : 'status-pill good'
}

async function handleCreate() {
  await createApiKey({
    name: draft.name.trim() || 'primary',
    environment: draft.environment,
  })
  createFormOpen.value = false
}

async function applyScope() {
  setScope({
    appId: scopeDraft.appId,
    accountId: scopeDraft.accountId,
  })
  await hydrateApiKeys()
}

async function handleRotate(keyId) {
  await rotateApiKey(keyId)
}

async function handleRevoke(keyId) {
  await revokeApiKey(keyId)
}

function toggleCreateForm() {
  createFormOpen.value = !createFormOpen.value
  clearRevealedSecret()
}

onMounted(() => {
  hydrateApiKeys()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Credentials</p>
      <h2>API Keys</h2>
      <p class="subtitle">
        Create, rotate, and revoke keys by environment.
      </p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Keys</h3>
        <div class="toolbar-actions">
          <button class="button" type="button" :disabled="isBusy" @click="hydrateApiKeys()">
            {{ apiKeysState.meta.loading ? 'Refreshing...' : 'Refresh' }}
          </button>
          <button class="button" type="button" :disabled="isBusy" @click="toggleCreateForm">
            {{ createFormOpen ? 'Cancel' : 'Create key' }}
          </button>
        </div>
      </div>

      <p class="muted">
        Sync mode: <strong>{{ syncMode }}</strong>
        <span v-if="apiKeysState.meta.error"> · {{ apiKeysState.meta.error }}</span>
      </p>

      <div class="panel">
        <h3>Scope</h3>
        <div class="form-grid">
          <label>
            Account ID
            <input
              v-model="scopeDraft.accountId"
              class="input"
              type="text"
              maxlength="64"
              placeholder="org_simulator"
            >
          </label>
          <label>
            App ID
            <input
              v-model="scopeDraft.appId"
              class="input"
              type="text"
              maxlength="64"
              placeholder="simulator-chatbot"
            >
          </label>
        </div>
        <div class="toolbar-actions">
          <button class="button" type="button" :disabled="isBusy" @click="applyScope">
            Apply Scope
          </button>
        </div>
      </div>

      <div v-if="createFormOpen" class="panel create-key-form">
        <h3>New Key</h3>
        <div class="form-grid">
          <label>
            Name
            <input
              v-model="draft.name"
              class="input"
              type="text"
              maxlength="40"
              placeholder="primary-staging"
            >
          </label>
          <label>
            Environment
            <select v-model="draft.environment" class="input">
              <option v-for="env in environmentOptions" :key="env" :value="env">
                {{ env }}
              </option>
            </select>
          </label>
        </div>
        <div class="toolbar-actions">
          <button class="button" type="button" :disabled="isBusy" @click="handleCreate">
            {{ isBusy ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </div>

      <div v-if="apiKeysState.meta.lastRevealedSecret" class="secret-banner">
        <strong>New key secret (shown once):</strong>
        <code>{{ apiKeysState.meta.lastRevealedSecret }}</code>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Account</th>
            <th>App</th>
            <th>Name</th>
            <th>Environment</th>
            <th>Status</th>
            <th>Masked Key</th>
            <th>Created At</th>
            <th>Last Used</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.keyId">
            <td><code>{{ row.accountId }}</code></td>
            <td><code>{{ row.appId }}</code></td>
            <td>{{ row.name }}</td>
            <td>{{ row.environment }}</td>
            <td>
              <span :class="statusClass(row.status)">
                {{ row.status }}
              </span>
            </td>
            <td><code>{{ row.maskedKey }}</code></td>
            <td>{{ formatDate(row.createdAt) }}</td>
            <td>{{ formatDate(row.lastUsedAt) }}</td>
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
            <td colspan="9" class="muted">No keys found.</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
