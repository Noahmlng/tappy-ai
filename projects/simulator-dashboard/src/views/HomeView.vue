<script setup>
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'
import { scopeState } from '../state/scope-state'

const isLoading = computed(() => Boolean(dashboardState.meta?.loading))

const totals = computed(() => dashboardState.settlementAggregates?.totals || {})

const kpis = computed(() => {
  const row = totals.value
  const requests = Number(row.requests || 0)
  const conversions = Number(row.settledConversions || 0)
  const revenue = Number(row.settledRevenueUsd || 0)
  const cpa = Number(row.cpa || 0)

  return [
    { label: 'Revenue', value: `$${revenue.toFixed(2)}` },
    { label: 'Requests', value: requests.toLocaleString() },
    { label: 'Conversions', value: conversions.toLocaleString() },
    { label: 'CPA', value: `$${cpa.toFixed(2)}` },
  ]
})

const quickLinks = [
  {
    to: '/api-keys',
    title: 'Get API Key',
    description: 'Create or rotate runtime keys.',
  },
  {
    to: '/config',
    title: 'Configure Placement',
    description: 'Enable placement and set fanout/timeout.',
  },
  {
    to: '/logs',
    title: 'View Logs',
    description: 'Check recent request outcomes.',
  },
]

const recentLogs = computed(() => {
  const rows = Array.isArray(dashboardState.decisionLogs) ? dashboardState.decisionLogs : []
  return rows.slice(0, 5)
})

const scopeLabel = computed(() => `${scopeState.accountId} / ${scopeState.appId}`)

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
      <p class="eyebrow">Dashboard</p>
      <h2>Revenue</h2>
      <p class="subtitle">
        Scope: {{ scopeLabel }}
      </p>
    </header>

    <article class="panel panel-toolbar">
      <div>
        <h3>Today at a glance</h3>
        <p class="muted" v-if="dashboardState.meta.lastSyncedAt">
          Last synced: {{ new Date(dashboardState.meta.lastSyncedAt).toLocaleString() }}
        </p>
        <p class="muted" v-if="dashboardState.meta.error">{{ dashboardState.meta.error }}</p>
      </div>
      <button class="button" type="button" :disabled="isLoading" @click="refreshHome">
        {{ isLoading ? 'Refreshing...' : 'Refresh' }}
      </button>
    </article>

    <div class="kpi-grid">
      <article v-for="item in kpis" :key="item.label" class="kpi-card">
        <p class="kpi-label">{{ item.label }}</p>
        <p class="kpi-value">{{ item.value }}</p>
      </article>
    </div>

    <div class="quick-link-grid">
      <RouterLink
        v-for="item in quickLinks"
        :key="item.to"
        :to="item.to"
        class="panel quick-link"
      >
        <h3>{{ item.title }}</h3>
        <p class="muted">{{ item.description }}</p>
      </RouterLink>
    </div>

    <article class="panel">
      <h3>Recent Logs</h3>
      <table class="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Request ID</th>
            <th>Placement</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in recentLogs" :key="row.id || row.requestId">
            <td>{{ row.createdAt || '-' }}</td>
            <td>{{ row.requestId || '-' }}</td>
            <td>{{ row.placementId || '-' }}</td>
            <td>{{ row.result || '-' }}</td>
          </tr>
          <tr v-if="recentLogs.length === 0">
            <td colspan="4" class="muted">No logs yet.</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
