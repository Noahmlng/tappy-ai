<script setup>
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import UiBadge from '../components/ui/UiBadge.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiSectionHeader from '../components/ui/UiSectionHeader.vue'
import { apiKeysState, hydrateApiKeys } from '../state/api-keys-state'
import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'

const isLoading = computed(() => Boolean(dashboardState.meta?.loading || apiKeysState.meta?.loading))

const activeKeys = computed(() => {
  const list = Array.isArray(apiKeysState.items) ? apiKeysState.items : []
  return list.filter((item) => item.status === 'active').length
})

const latestKey = computed(() => {
  const list = Array.isArray(apiKeysState.items) ? [...apiKeysState.items] : []
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return list[0] || null
})

const requestPath = computed(() => {
  const connected = Boolean(dashboardState.meta.connected)
  return {
    status: connected ? 'ready' : 'offline',
    detail: connected
      ? 'Public API is reachable for evaluate/events.'
      : (dashboardState.meta.error || 'Connection unavailable, using fallback snapshot.'),
    lastSyncedAt: dashboardState.meta.lastSyncedAt,
  }
})

const usageSnapshot = computed(() => {
  const summary = dashboardState.metricsSummary || {}
  const daily = Array.isArray(dashboardState.metricsByDay) ? dashboardState.metricsByDay : []
  const latestDay = daily[daily.length - 1] || null

  const requests24h = Number(dashboardState.networkFlowStats?.totalRuntimeEvaluations || summary.impressions || 0)
  const revenue24h = Number(latestDay?.revenueUsd || 0)
  const fillRate = Number(summary.fillRate || 0)

  return {
    requests24h: requests24h.toLocaleString(),
    revenue24h: `$${revenue24h.toFixed(2)}`,
    fillRate: `${(fillRate * 100).toFixed(1)}%`,
  }
})

function statusTone(status) {
  if (status === 'ready') return 'success'
  if (status === 'offline') return 'error'
  return 'warn'
}

async function refreshHome() {
  await Promise.allSettled([hydrateDashboardState(), hydrateApiKeys()])
}

onMounted(() => {
  refreshHome()
})
</script>

<template>
  <section class="page">
    <UiSectionHeader
      eyebrow="API First"
      title="Home"
      subtitle="Complete the core path in one screen: key readiness, request connectivity, and 24h usage snapshot."
    >
      <template #right>
        <UiButton :disabled="isLoading" @click="refreshHome">
          {{ isLoading ? 'Refreshing...' : 'Refresh' }}
        </UiButton>
      </template>
    </UiSectionHeader>

    <div class="grid grid-3">
      <UiCard>
        <div class="panel-head">
          <h3>API Key Status</h3>
          <UiBadge tone="info">Step 1</UiBadge>
        </div>
        <p class="metric-value">{{ activeKeys }}</p>
        <p class="metric-sub">Active key(s)</p>
        <p class="muted" v-if="latestKey">
          Latest key: <strong>{{ latestKey.name }}</strong>
        </p>
        <UiButton variant="secondary" as-child>
          <RouterLink to="/api-keys">Go to API Keys</RouterLink>
        </UiButton>
      </UiCard>

      <UiCard>
        <div class="panel-head">
          <h3>Request Path</h3>
          <UiBadge :tone="statusTone(requestPath.status)">{{ requestPath.status }}</UiBadge>
        </div>
        <p class="muted">{{ requestPath.detail }}</p>
        <p class="metric-sub" v-if="requestPath.lastSyncedAt">
          Last synced: {{ new Date(requestPath.lastSyncedAt).toLocaleString() }}
        </p>
      </UiCard>

      <UiCard>
        <div class="panel-head">
          <h3>24h Usage</h3>
          <UiBadge tone="info">Step 3</UiBadge>
        </div>
        <div class="kv-grid">
          <p><span class="muted">Requests</span><strong>{{ usageSnapshot.requests24h }}</strong></p>
          <p><span class="muted">Revenue</span><strong>{{ usageSnapshot.revenue24h }}</strong></p>
          <p><span class="muted">Fill Rate</span><strong>{{ usageSnapshot.fillRate }}</strong></p>
        </div>
        <UiButton variant="secondary" as-child>
          <RouterLink to="/usage">Open Usage</RouterLink>
        </UiButton>
      </UiCard>
    </div>
  </section>
</template>
