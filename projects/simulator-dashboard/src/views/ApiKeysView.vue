<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

import UiBadge from '../components/ui/UiBadge.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiSectionHeader from '../components/ui/UiSectionHeader.vue'
import {
  apiKeysState,
  clearRevealedSecret,
  createApiKey,
  hydrateApiKeys,
  revokeApiKey,
  rotateApiKey,
} from '../state/api-keys-state'

const createFormOpen = ref(false)

const draft = reactive({
  name: 'primary-staging',
  environment: 'staging',
})

const environmentOptions = ['sandbox', 'staging', 'prod']

const isBusy = computed(() => Boolean(apiKeysState.meta.loading || apiKeysState.meta.syncing))
const rows = computed(() => Array.isArray(apiKeysState.items) ? apiKeysState.items : [])
const activeCount = computed(() => rows.value.filter((item) => item.status === 'active').length)
const revokedCount = computed(() => rows.value.filter((item) => item.status === 'revoked').length)

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function statusTone(status) {
  return status === 'revoked' ? 'error' : 'success'
}

async function handleCreate() {
  await createApiKey({
    name: draft.name.trim() || 'primary',
    environment: draft.environment,
  })
  createFormOpen.value = false
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
    <UiSectionHeader
      eyebrow="Credentials"
      title="API Keys"
      subtitle="Keep keys minimal and scoped by environment."
    >
      <template #right>
        <div class="toolbar-actions">
          <UiButton :disabled="isBusy" @click="hydrateApiKeys()">
            {{ apiKeysState.meta.loading ? 'Refreshing...' : 'Refresh' }}
          </UiButton>
          <UiButton :disabled="isBusy" @click="toggleCreateForm">
            {{ createFormOpen ? 'Cancel' : 'Create key' }}
          </UiButton>
        </div>
      </template>
    </UiSectionHeader>

    <UiCard>
      <div class="grid">
        <article class="kpi-card">
          <p class="kpi-label">Active keys</p>
          <p class="kpi-value">{{ activeCount }}</p>
        </article>
        <article class="kpi-card">
          <p class="kpi-label">Revoked keys</p>
          <p class="kpi-value">{{ revokedCount }}</p>
        </article>
      </div>

      <p class="muted" v-if="apiKeysState.meta.error">{{ apiKeysState.meta.error }}</p>

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
          <UiButton :disabled="isBusy" @click="handleCreate">
            {{ isBusy ? 'Creating...' : 'Create' }}
          </UiButton>
        </div>
      </div>

      <div v-if="apiKeysState.meta.lastRevealedSecret" class="secret-banner">
        <strong>New key secret (shown once)</strong>
        <code>{{ apiKeysState.meta.lastRevealedSecret }}</code>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Environment</th>
            <th>Status</th>
            <th>Masked Key</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.keyId">
            <td>{{ row.name }}</td>
            <td>{{ row.environment }}</td>
            <td><UiBadge :tone="statusTone(row.status)">{{ row.status }}</UiBadge></td>
            <td><code>{{ row.maskedKey }}</code></td>
            <td>{{ formatDate(row.lastUsedAt || row.createdAt) }}</td>
            <td>
              <div class="toolbar-actions">
                <UiButton
                  variant="secondary"
                  :disabled="isBusy || row.status === 'revoked'"
                  @click="handleRotate(row.keyId)"
                >
                  Rotate
                </UiButton>
                <UiButton
                  variant="danger"
                  :disabled="isBusy || row.status === 'revoked'"
                  @click="handleRevoke(row.keyId)"
                >
                  Revoke
                </UiButton>
              </div>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="6" class="muted">No keys found.</td>
          </tr>
        </tbody>
      </table>
    </UiCard>
  </section>
</template>
