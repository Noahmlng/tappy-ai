<script setup>
import { computed, onMounted, ref } from 'vue'

import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'

const resultFilter = ref('ALL')
const placementFilter = ref('ALL')
const isLoading = computed(() => Boolean(dashboardState.meta.loading))

function refreshLogs() {
  hydrateDashboardState()
}

onMounted(() => {
  refreshLogs()
})

const placementOptions = computed(() => {
  const placementIds = Array.isArray(dashboardState.placements)
    ? dashboardState.placements.map((item) => item.placementId)
    : []
  return ['ALL', ...placementIds]
})

const filteredLogs = computed(() => {
  const rows = Array.isArray(dashboardState.decisionLogs) ? dashboardState.decisionLogs : []
  return rows.filter((row) => {
    const matchResult = resultFilter.value === 'ALL' || row.result === resultFilter.value
    const matchPlacement = placementFilter.value === 'ALL' || row.placementId === placementFilter.value
    return matchResult && matchPlacement
  })
})

function resultPillClass(result) {
  if (result === 'served') return 'status-pill good'
  if (result === 'error') return 'status-pill bad'
  return 'status-pill warn'
}

function displayReason(row) {
  if (typeof row?.reasonDetail === 'string' && row.reasonDetail.trim()) {
    return row.reasonDetail.trim()
  }
  if (typeof row?.reason === 'string' && row.reason.trim()) {
    return row.reason.trim()
  }
  return '-'
}
</script>

<template>
  <section class="page">
    <header class="page-header page-header-split">
      <div class="header-stack">
        <p class="eyebrow">Logs</p>
        <h2>Logs</h2>
        <p class="subtitle">Filter</p>
      </div>
      <div class="header-actions">
        <button class="button" type="button" :disabled="isLoading" @click="refreshLogs">
          {{ isLoading ? 'Sync...' : 'Sync' }}
        </button>
      </div>
    </header>

    <article class="panel panel-soft">
      <div class="panel-toolbar">
        <h3>Rows</h3>
        <p class="muted">{{ filteredLogs.length }}</p>
      </div>

      <div class="filters">
        <label>
          Result
          <select v-model="resultFilter" class="input">
            <option value="ALL">ALL</option>
            <option value="served">served</option>
            <option value="blocked">blocked</option>
            <option value="no_fill">no_fill</option>
            <option value="error">error</option>
          </select>
        </label>

        <label>
          Placement
          <select v-model="placementFilter" class="input">
            <option v-for="option in placementOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
      </div>

      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Req ID</th>
              <th>Placement</th>
              <th>Result</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredLogs" :key="row.id || row.requestId">
              <td>{{ row.createdAt || '-' }}</td>
              <td>{{ row.requestId || '-' }}</td>
              <td>{{ row.placementId || '-' }}</td>
              <td>
                <span :class="resultPillClass(row.result)">{{ row.result || '-' }}</span>
              </td>
              <td>{{ displayReason(row) }}</td>
            </tr>
            <tr v-if="filteredLogs.length === 0">
              <td colspan="5" class="muted">No rows.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
