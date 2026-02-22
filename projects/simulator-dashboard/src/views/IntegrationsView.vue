<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

import {
  hydrateIntegrations,
  integrationsState,
  savePlacementTemplate,
} from '../state/integrations-state'

const createMode = ref(true)
const editingPlacementId = ref('')

const draft = reactive({
  placementId: 'chat_inline_v1',
  environment: 'staging',
  surface: 'CHAT_INLINE',
  enabled: true,
})

const isBusy = computed(() => Boolean(integrationsState.meta.loading || integrationsState.meta.syncing))
const rows = computed(() => Array.isArray(integrationsState.templates) ? integrationsState.templates : [])
const syncMode = computed(() => String(integrationsState.meta.syncMode || 'local'))

const environmentOptions = ['sandbox', 'staging', 'prod']
const surfaceOptions = ['CHAT_INLINE', 'FOLLOW_UP', 'AGENT_PANEL']

function resetDraft() {
  draft.placementId = `chat_inline_${Date.now().toString().slice(-4)}`
  draft.environment = 'staging'
  draft.surface = 'CHAT_INLINE'
  draft.enabled = true
}

function startCreate() {
  createMode.value = true
  editingPlacementId.value = ''
  resetDraft()
}

function startEdit(row) {
  createMode.value = false
  editingPlacementId.value = row.placementId
  draft.placementId = row.placementId
  draft.environment = row.environment
  draft.surface = row.surface
  draft.enabled = Boolean(row.enabled)
}

async function saveDraft() {
  await savePlacementTemplate({
    placementId: draft.placementId.trim(),
    environment: draft.environment,
    surface: draft.surface,
    enabled: Boolean(draft.enabled),
  })
  createMode.value = true
  editingPlacementId.value = ''
}

async function toggleEnabled(row) {
  await savePlacementTemplate({
    ...row,
    enabled: !row.enabled,
  })
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function statusClass(enabled) {
  return enabled ? 'status-pill good' : 'status-pill warn'
}

onMounted(() => {
  hydrateIntegrations()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Integration</p>
      <h2>Integrations</h2>
      <p class="subtitle">
        Minimal placement template. Routing is fixed to `managed_mediation` in v1.
      </p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Placement Templates</h3>
        <div class="toolbar-actions">
          <button class="button" type="button" :disabled="isBusy" @click="hydrateIntegrations()">
            {{ integrationsState.meta.loading ? 'Refreshing...' : 'Refresh' }}
          </button>
          <button class="button" type="button" :disabled="isBusy" @click="startCreate">
            New template
          </button>
        </div>
      </div>

      <p class="muted">
        Sync mode: <strong>{{ syncMode }}</strong>
        <span v-if="integrationsState.meta.error"> · {{ integrationsState.meta.error }}</span>
      </p>

      <div class="panel create-key-form">
        <h3>{{ createMode ? 'Create Template' : `Edit Template (${editingPlacementId})` }}</h3>
        <div class="form-grid">
          <label>
            Placement ID
            <input
              v-model="draft.placementId"
              class="input"
              type="text"
              maxlength="64"
              :disabled="!createMode"
            >
          </label>
          <label>
            Environment
            <select v-model="draft.environment" class="input">
              <option v-for="env in environmentOptions" :key="env" :value="env">{{ env }}</option>
            </select>
          </label>
          <label>
            Surface
            <select v-model="draft.surface" class="input">
              <option v-for="surface in surfaceOptions" :key="surface" :value="surface">{{ surface }}</option>
            </select>
          </label>
          <label class="checkbox-line">
            <input v-model="draft.enabled" type="checkbox">
            Enabled
          </label>
        </div>
        <div class="toolbar-actions">
          <button class="button" type="button" :disabled="isBusy || !draft.placementId.trim()" @click="saveDraft">
            {{ isBusy ? 'Saving...' : (createMode ? 'Create template' : 'Save changes') }}
          </button>
        </div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Placement ID</th>
            <th>Environment</th>
            <th>Surface</th>
            <th>Status</th>
            <th>Routing</th>
            <th>Updated At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.placementId">
            <td><code>{{ row.placementId }}</code></td>
            <td>{{ row.environment }}</td>
            <td>{{ row.surface }}</td>
            <td>
              <span :class="statusClass(row.enabled)">
                {{ row.enabled ? 'enabled' : 'disabled' }}
              </span>
            </td>
            <td>{{ row.routingMode }}</td>
            <td>{{ formatDate(row.updatedAt) }}</td>
            <td>
              <div class="toolbar-actions">
                <button class="button button-secondary" type="button" :disabled="isBusy" @click="startEdit(row)">
                  Edit
                </button>
                <button class="button button-secondary" type="button" :disabled="isBusy" @click="toggleEnabled(row)">
                  {{ row.enabled ? 'Disable' : 'Enable' }}
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="7" class="muted">No placement templates found.</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
