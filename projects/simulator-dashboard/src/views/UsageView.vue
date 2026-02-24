<script setup>
import { computed, onMounted } from 'vue'

import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'
import { scopeState } from '../state/scope-state'

const isLoading = computed(() => Boolean(dashboardState.meta.loading))
const scopeLabel = computed(() => `account=${scopeState.accountId} · app=${scopeState.appId}`)

const latestDay = computed(() => {
  const list = Array.isArray(dashboardState.metricsByDay) ? dashboardState.metricsByDay : []
  return list[list.length - 1] || null
})

const usageCards = computed(() => {
  const summary = dashboardState.metricsSummary || {}
  const stats = dashboardState.networkFlowStats || {}
  const day = latestDay.value

  const requests24h = Number(stats.totalRuntimeEvaluations || day?.impressions || 0)
  const runtimeErrors = Number(stats.runtimeErrors || 0)
  const successRate = requests24h > 0
    ? (1 - Math.min(runtimeErrors, requests24h) / requests24h)
    : 0
  const spend24h = Number(day?.revenueUsd || 0)

  return [
    {
      label: 'Requests (24h)',
      value: requests24h.toLocaleString(),
      sub: 'Latest traffic window',
    },
    {
      label: 'Success Rate',
      value: `${(successRate * 100).toFixed(2)}%`,
      sub: `Runtime errors: ${runtimeErrors.toLocaleString()}`,
    },
    {
      label: 'Estimated Spend (24h)',
      value: `$${spend24h.toFixed(2)}`,
      sub: `eCPM: $${Number(summary.ecpm || 0).toFixed(2)}`,
    },
  ]
})

const billingSummary = computed(() => {
  const summary = dashboardState.metricsSummary || {}
  const day = latestDay.value
  const impressions24h = Number(day?.impressions || 0)
  const ctr = Number(summary.ctr || 0)
  const clicks24h = Math.round(impressions24h * ctr)
  const revenue24h = Number(day?.revenueUsd || 0)

  return [
    { metric: 'Revenue (24h est.)', value: `$${revenue24h.toFixed(2)}` },
    { metric: 'Billable impressions (24h est.)', value: impressions24h.toLocaleString() },
    { metric: 'Clicks (24h est.)', value: clicks24h.toLocaleString() },
    { metric: 'CTR (rolling)', value: `${(ctr * 100).toFixed(2)}%` },
    { metric: 'Fill Rate (rolling)', value: `${(Number(summary.fillRate || 0) * 100).toFixed(1)}%` },
    { metric: 'eCPM (rolling)', value: `$${Number(summary.ecpm || 0).toFixed(2)}` },
  ]
})

const dailyRows = computed(() => {
  const list = Array.isArray(dashboardState.metricsByDay) ? dashboardState.metricsByDay : []
  const ctr = Number(dashboardState.metricsSummary?.ctr || 0)
  return list.map((row) => {
    const impressions = Number(row.impressions || 0)
    return {
      day: row.day,
      impressions,
      clicks: Math.round(impressions * ctr),
      revenueUsd: Number(row.revenueUsd || 0),
    }
  })
})

function refreshUsage() {
  hydrateDashboardState()
}

onMounted(() => {
  refreshUsage()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Observability</p>
      <h2>Usage</h2>
      <p class="subtitle">
        Request volume, success rate, and basic billing summary.
      </p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>24h Summary</h3>
        <button class="button" type="button" :disabled="isLoading" @click="refreshUsage">
          {{ isLoading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
      <p class="muted">
        Source:
        <strong>{{ dashboardState.meta.connected ? 'public API' : 'local fallback' }}</strong>
        <span> · {{ scopeLabel }}</span>
        <span v-if="dashboardState.meta.lastSyncedAt">
          · last synced {{ new Date(dashboardState.meta.lastSyncedAt).toLocaleString() }}
        </span>
      </p>
      <p v-if="dashboardState.meta.error" class="muted">
        {{ dashboardState.meta.error }}
      </p>
    </article>

    <div class="grid grid-3">
      <article v-for="card in usageCards" :key="card.label" class="panel metric">
        <h3>{{ card.label }}</h3>
        <p class="metric-value">{{ card.value }}</p>
        <p class="metric-sub">{{ card.sub }}</p>
      </article>
    </div>

    <div class="grid">
      <article class="panel">
        <h3>Basic Billing Summary</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in billingSummary" :key="row.metric">
              <td>{{ row.metric }}</td>
              <td>{{ row.value }}</td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="panel">
        <h3>7-Day Usage Trend</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Impressions</th>
              <th>Clicks (est.)</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in dailyRows" :key="row.day">
              <td>{{ row.day }}</td>
              <td>{{ row.impressions.toLocaleString() }}</td>
              <td>{{ row.clicks.toLocaleString() }}</td>
              <td>${{ row.revenueUsd.toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  </section>
</template>
