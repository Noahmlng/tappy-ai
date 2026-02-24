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

function resultPillClass(result) {
  if (result === 'served') return 'status-pill good'
  if (result === 'error') return 'status-pill bad'
  if (result === 'blocked') return 'status-pill warn'
  return 'status-pill warn'
}

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

function formatIntentScore(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-'
}

function clipText(value, maxLength = 140) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return '-'
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function getInputQuery(row) {
  return clipText(row?.input?.query, 120)
}

function getInputAnswer(row) {
  return clipText(row?.input?.answerText, 180)
}

function getEntityItems(row) {
  return Array.isArray(row?.runtime?.entityItems) ? row.runtime.entityItems : []
}

function getAds(row) {
  return Array.isArray(row?.ads) ? row.ads : []
}

function formatConfidence(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function getIntentInferenceMeta(row) {
  if (!row || typeof row !== 'object') return null
  const value = row.intentInference
  if (!value || typeof value !== 'object') return null

  return {
    inferenceFallbackReason: typeof value.inferenceFallbackReason === 'string'
      ? value.inferenceFallbackReason.trim()
      : '',
    inferenceModel: typeof value.inferenceModel === 'string'
      ? value.inferenceModel.trim()
      : '',
    inferenceLatencyMs: Number.isFinite(value.inferenceLatencyMs)
      ? Math.max(0, Math.floor(value.inferenceLatencyMs))
      : 0,
  }
}
</script>

<template>
  <section class="page">
    <header class="section-head">
      <div class="page-header">
        <p class="eyebrow">Observability</p>
        <h2>Decision Logs</h2>
      </div>
      <p class="muted">Use reasons to explain why an ad was served, blocked, or no-filled.</p>
    </header>

    <article class="panel">
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
            <th>Status</th>
            <th>Input</th>
            <th>Entities</th>
            <th>Ads</th>
            <th>Created At</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredLogs" :key="row.id || row.requestId">
            <td>{{ row.requestId }}</td>
            <td>{{ row.placementId }}</td>
            <td>
              <span :class="resultPillClass(row.result)">{{ row.result }}</span>
              <p class="text-detail">{{ getDisplayReason(row) }}</p>
              <p class="text-detail">intent {{ formatIntentScore(row.intentScore) }}</p>
              <template v-if="getIntentInferenceMeta(row)">
                <p class="text-detail">
                  infer {{ getIntentInferenceMeta(row).inferenceModel || '-' }} ·
                  {{ getIntentInferenceMeta(row).inferenceLatencyMs }}ms
                </p>
                <p class="text-detail">
                  fallback {{ getIntentInferenceMeta(row).inferenceFallbackReason || 'none' }}
                </p>
              </template>
            </td>
            <td>
              <p class="text-detail"><strong>Q:</strong> {{ getInputQuery(row) }}</p>
              <p class="text-detail">A: {{ getInputAnswer(row) }}</p>
            </td>
            <td>
              <p v-if="getEntityItems(row).length === 0" class="text-detail">none</p>
              <div v-else>
                <p
                  v-for="(entity, idx) in getEntityItems(row)"
                  :key="`${row.requestId}_entity_${idx}`"
                  class="text-detail"
                >
                  <strong>{{ entity.entityText || entity.normalizedText || '-' }}</strong>
                  <span class="muted"> ({{ entity.entityType || 'unknown' }}, {{ formatConfidence(entity.confidence) }})</span>
                </p>
              </div>
            </td>
            <td>
              <p v-if="getAds(row).length === 0" class="text-detail">none</p>
              <div v-else>
                <div
                  v-for="(ad, idx) in getAds(row)"
                  :key="`${row.requestId}_ad_${idx}`"
                >
                  <p class="text-detail"><strong>{{ clipText(ad.title || ad.entityText || '-', 64) }}</strong></p>
                  <p class="text-detail muted">{{ clipText(ad.targetUrl || '-', 72) }}</p>
                </div>
              </div>
            </td>
            <td>{{ row.createdAt }}</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
