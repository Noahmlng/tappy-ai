<script setup>
import { computed, ref } from 'vue'

import { dashboardState } from '../state/dashboard-state'

const resultFilter = ref('ALL')
const placementFilter = ref('ALL')

const placementOptions = computed(() => {
  return ['ALL', ...dashboardState.placements.map((item) => item.placementId)]
})

const filteredLogs = computed(() => {
  return dashboardState.decisionLogs.filter((row) => {
    const matchResult = resultFilter.value === 'ALL' || row.result === resultFilter.value
    const matchPlacement = placementFilter.value === 'ALL' || row.placementId === placementFilter.value
    return matchResult && matchPlacement
  })
})

function getReasonDetail(row) {
  return typeof row?.reasonDetail === 'string' ? row.reasonDetail.trim() : ''
}

function getRuntimeErrorMessage(row) {
  return typeof row?.runtime?.message === 'string' ? row.runtime.message.trim() : ''
}

function getDisplayReason(row) {
  if (row?.result === 'error') {
    return getRuntimeErrorMessage(row) || getReasonDetail(row) || row?.reason || 'unknown_error'
  }

  if (row?.result === 'no_fill' || row?.result === 'blocked') {
    return getReasonDetail(row) || row?.reason || '-'
  }

  return getReasonDetail(row) || row?.reason || '-'
}

function getInlineReason(row) {
  if (row?.result === 'no_fill' || row?.result === 'blocked' || row?.result === 'error') {
    return getDisplayReason(row)
  }
  return ''
}

function formatIntentScore(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-'
}
</script>

<template>
  <section>
    <header class="section-head">
      <div>
        <p class="eyebrow">Observability</p>
        <h2>Decision Logs</h2>
      </div>
      <p class="muted">Use reasons to explain why an ad was served, blocked, or no-filled.</p>
    </header>

    <article class="card">
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

      <table class="table">
        <thead>
          <tr>
            <th>Request ID</th>
            <th>Placement</th>
            <th>Result</th>
            <th>Reason</th>
            <th>Intent Score</th>
            <th>Created At</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredLogs" :key="row.id || row.requestId">
            <td>{{ row.requestId }}</td>
            <td>{{ row.placementId }}</td>
            <td>
              <span class="pill" :data-result="row.result">{{ row.result }}</span>
              <span
                v-if="getInlineReason(row)"
                class="ml-2 text-xs"
                :class="row.result === 'error' ? 'text-[#b42318]' : 'text-[#667085]'"
              >
                {{ getInlineReason(row) }}
              </span>
            </td>
            <td :class="row.result === 'error' ? 'text-[#b42318]' : ''">{{ getDisplayReason(row) }}</td>
            <td>{{ formatIntentScore(row.intentScore) }}</td>
            <td>{{ row.createdAt }}</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
