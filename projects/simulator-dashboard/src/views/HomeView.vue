<script setup>
import { computed, onMounted } from 'vue'

import UiBadge from '../components/ui/UiBadge.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiSectionHeader from '../components/ui/UiSectionHeader.vue'
import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'

const isLoading = computed(() => Boolean(dashboardState.meta?.loading))

const integrationStatus = computed(() => {
  const hasPlacements = Array.isArray(dashboardState.placements) && dashboardState.placements.length > 0
  const hasEnabledPlacement = hasPlacements && dashboardState.placements.some((row) => row.enabled)
  const hasRecentDecision = Array.isArray(dashboardState.decisionLogs) && dashboardState.decisionLogs.length > 0

  return [
    {
      label: 'Public API Connectivity',
      status: dashboardState.meta.connected ? 'ready' : 'offline',
      detail: dashboardState.meta.connected
        ? 'Connected to public API'
        : (dashboardState.meta.error || 'Using local fallback snapshot'),
    },
    {
      label: 'Placement Template',
      status: hasPlacements ? 'ready' : 'pending',
      detail: hasPlacements
        ? `${dashboardState.placements.length} placement template(s) available`
        : 'No placement template found',
    },
    {
      label: 'Serving Ready',
      status: hasEnabledPlacement ? 'ready' : 'pending',
      detail: hasEnabledPlacement
        ? 'At least one placement is enabled'
        : 'Enable one placement to start serving',
    },
    {
      label: 'Recent Request Trace',
      status: hasRecentDecision ? 'ready' : 'pending',
      detail: hasRecentDecision
        ? `${dashboardState.decisionLogs.length} recent decision log(s) found`
        : 'No recent decision logs',
    },
  ]
})

const kpis24h = computed(() => {
  const summary = dashboardState.metricsSummary || {}
  const stats = dashboardState.networkFlowStats || {}
  const daily = Array.isArray(dashboardState.metricsByDay) ? dashboardState.metricsByDay : []
  const latestDay = daily[daily.length - 1] || null
  const requests24h = Number(stats.totalRuntimeEvaluations || summary.impressions || 0)
  const estimatedRevenue24h = Number(latestDay?.revenueUsd || 0)
  const ctr = Number(summary.ctr || 0)
  const fillRate = Number(summary.fillRate || 0)

  return [
    { label: 'Requests (24h)', value: requests24h.toLocaleString() },
    { label: 'CTR (24h)', value: `${(ctr * 100).toFixed(2)}%` },
    { label: 'Fill Rate (24h)', value: `${(fillRate * 100).toFixed(1)}%` },
    { label: 'Revenue (24h est.)', value: `$${estimatedRevenue24h.toFixed(2)}` },
  ]
})

function statusTone(status) {
  if (status === 'ready') return 'success'
  if (status === 'offline') return 'error'
  return 'warn'
}

function refreshHome() {
  hydrateDashboardState()
}

onMounted(() => {
  refreshHome()
})
</script>

<template>
  <section class="page">
    <UiSectionHeader
      eyebrow="Dashboard v1"
      title="Home"
      subtitle="Integration readiness and key 24-hour metrics."
    />

    <UiCard>
      <div class="panel-toolbar">
        <h3>Integration Status</h3>
        <UiButton :disabled="isLoading" @click="refreshHome">
          {{ isLoading ? 'Refreshing...' : 'Refresh' }}
        </UiButton>
      </div>

      <div class="status-grid">
        <article v-for="item in integrationStatus" :key="item.label" class="status-item">
          <div class="panel-head">
            <strong>{{ item.label }}</strong>
            <UiBadge :tone="statusTone(item.status)">{{ item.status }}</UiBadge>
          </div>
          <p class="muted">{{ item.detail }}</p>
        </article>
      </div>

      <p v-if="dashboardState.meta.lastSyncedAt" class="muted">
        Last synced: {{ new Date(dashboardState.meta.lastSyncedAt).toLocaleString() }}
      </p>
    </UiCard>

    <div class="grid grid-3">
      <UiCard v-for="kpi in kpis24h" :key="kpi.label" class="metric">
        <h3>{{ kpi.label }}</h3>
        <p class="metric-value">{{ kpi.value }}</p>
      </UiCard>
    </div>
  </section>
</template>
