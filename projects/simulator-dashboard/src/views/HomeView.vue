<script setup>
import { computed, onMounted } from 'vue'

import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'
import { scopeState } from '../state/scope-state'

const isLoading = computed(() => Boolean(dashboardState.meta?.loading))
const scopeLabel = computed(() => `account=${scopeState.accountId} · app=${scopeState.appId}`)

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
        : (dashboardState.meta.error || 'Dashboard API unavailable'),
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
  const settlement = dashboardState.settlementAggregates || {}
  const totals = settlement.totals || {}
  const requests = Number(totals.requests || summary.impressions || 0)
  const settledRevenue = Number(totals.settledRevenueUsd || 0)
  const settledConversions = Number(totals.settledConversions || 0)
  const ctr = Number(summary.ctr || 0)
  const fillRate = Number(summary.fillRate || 0)

  return [
    { label: 'Requests', value: requests.toLocaleString() },
    { label: 'CTR', value: `${(ctr * 100).toFixed(2)}%` },
    { label: 'Fill Rate', value: `${(fillRate * 100).toFixed(1)}%` },
    { label: 'Settled Conversions', value: settledConversions.toLocaleString() },
    { label: 'Settled Revenue', value: `$${settledRevenue.toFixed(2)}` },
  ]
})

function statusClass(status) {
  if (status === 'ready') return 'status-pill good'
  if (status === 'offline') return 'status-pill bad'
  return 'status-pill warn'
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
    <header class="page-header">
      <p class="eyebrow">Dashboard v1</p>
      <h2>Home</h2>
      <p class="subtitle">
        Integration readiness and key scoped settlement metrics.
      </p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Integration Status</h3>
        <button class="button" type="button" :disabled="isLoading" @click="refreshHome">
          {{ isLoading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>

      <div class="status-grid">
        <article v-for="item in integrationStatus" :key="item.label" class="status-item">
          <div class="panel-head">
            <strong>{{ item.label }}</strong>
            <span :class="statusClass(item.status)">{{ item.status }}</span>
          </div>
          <p class="muted">{{ item.detail }}</p>
        </article>
      </div>

      <p v-if="dashboardState.meta.lastSyncedAt" class="muted">
        Scope: {{ scopeLabel }} ·
        Last synced: {{ new Date(dashboardState.meta.lastSyncedAt).toLocaleString() }}
      </p>
    </article>

    <div class="kpi-grid">
      <article v-for="kpi in kpis24h" :key="kpi.label" class="kpi-card">
        <p class="kpi-label">{{ kpi.label }}</p>
        <p class="kpi-value">{{ kpi.value }}</p>
      </article>
    </div>
  </section>
</template>
