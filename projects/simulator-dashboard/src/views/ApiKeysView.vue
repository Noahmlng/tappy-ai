<script setup>
import { computed, onMounted, reactive } from 'vue'

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
  name: 'runtime-staging',
  environment: 'staging',
})

const scopeDraft = reactive({
  appId: scopeState.appId,
  accountId: scopeState.accountId,
})

const environmentOptions = ['sandbox', 'staging', 'prod']

const isBusy = computed(() => Boolean(apiKeysState.meta.loading || apiKeysState.meta.syncing))
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

async function applyScope() {
  setScope({
    appId: scopeDraft.appId,
    accountId: scopeDraft.accountId,
  })
  await hydrateApiKeys()
}

async function handleCreate() {
  clearRevealedSecret()
  const nextScope = {
    appId: String(scopeDraft.appId || '').trim(),
    accountId: String(scopeDraft.accountId || '').trim(),
  }
  setScope(nextScope)

  await createApiKey({
    name: String(draft.name || '').trim() || 'runtime',
    environment: draft.environment,
    appId: nextScope.appId,
    accountId: nextScope.accountId,
  })

  await hydrateApiKeys()
}

async function handleRotate(keyId) {
  await rotateApiKey(keyId)
}

async function handleRevoke(keyId) {
  await revokeApiKey(keyId)
}

onMounted(() => {
  hydrateApiKeys()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">API Keys</p>
      <h2>Get Key</h2>
      <p class="subtitle">Create and manage runtime keys.</p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Scope</h3>
        <button class="button" type="button" :disabled="isBusy" @click="applyScope">
          Apply
        </button>
      </div>
      <div class="form-grid">
        <label>
          Account ID
          <input
            v-model="scopeDraft.accountId"
            class="input"
            type="text"
            maxlength="64"
            placeholder="org_your_company"
          >
        </label>
        <label>
          App ID
          <input
            v-model="scopeDraft.appId"
            class="input"
            type="text"
            maxlength="64"
            placeholder="your_chat_app"
          >
        </label>
      </div>
    </article>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Create Key</h3>
        <button class="button" type="button" :disabled="isBusy" @click="handleCreate">
          {{ isBusy ? 'Creating...' : 'Create Key' }}
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
            placeholder="runtime-staging"
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
      <div v-if="apiKeysState.meta.lastRevealedSecret" class="secret-banner">
        <strong>Secret (shown once)</strong>
        <code>{{ apiKeysState.meta.lastRevealedSecret }}</code>
      </div>
    </article>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Keys</h3>
        <button class="button button-secondary" type="button" :disabled="isBusy" @click="hydrateApiKeys()">
          {{ apiKeysState.meta.loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
      <p class="muted" v-if="apiKeysState.meta.error">{{ apiKeysState.meta.error }}</p>

      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Env</th>
            <th>Status</th>
            <th>Masked Key</th>
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
            <td colspan="6" class="muted">No keys found.</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
