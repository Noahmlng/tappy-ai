<script setup>
import { computed, onMounted } from 'vue'

import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'
import { scopeState } from '../state/scope-state'

const isLoading = computed(() => Boolean(dashboardState.meta.loading))
const scopeLabel = computed(() => `account=${scopeState.accountId} · app=${scopeState.appId}`)
const settlement = computed(() => dashboardState.settlementAggregates || {})
const totals = computed(() => settlement.value.totals || {})

const usageCards = computed(() => {
  const row = totals.value
  const requests = Number(row.requests || 0)
  const settledConversions = Number(row.settledConversions || 0)
  const settledRevenueUsd = Number(row.settledRevenueUsd || 0)
  const cpa = Number(row.cpa || 0)
  const ctr = Number(row.ctr || 0)
  const fillRate = Number(row.fillRate || 0)

  return [
    {
      label: 'Requests',
      value: requests.toLocaleString(),
      sub: 'Scoped usage volume',
    },
    {
      label: 'Settled Conversions',
      value: settledConversions.toLocaleString(),
      sub: 'Postback success only',
    },
    {
      label: 'Settled Revenue',
      value: `$${settledRevenueUsd.toFixed(2)}`,
      sub: `${String(settlement.value.currency || 'USD')} settlement`,
    },
    {
      label: 'CPA',
      value: `$${cpa.toFixed(2)}`,
      sub: 'Revenue / settled conversions',
    },
    {
      label: 'CTR · Fill Rate',
      value: `${(ctr * 100).toFixed(2)}% · ${(fillRate * 100).toFixed(1)}%`,
      sub: 'Delivery effectiveness',
    },
  ]
})

const accountRows = computed(() => (
  Array.isArray(settlement.value.byAccount) ? settlement.value.byAccount : []
))

const appRows = computed(() => (
  Array.isArray(settlement.value.byApp) ? settlement.value.byApp : []
))

const placementRows = computed(() => (
  Array.isArray(settlement.value.byPlacement) ? settlement.value.byPlacement : []
))

const dailyRows = computed(() => {
  const list = Array.isArray(dashboardState.metricsByDay) ? dashboardState.metricsByDay : []
  return list.map((row) => {
    return {
      day: row.day,
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
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
      <p class="eyebrow">Settlement Analytics</p>
      <h2>Usage & Revenue</h2>
      <p class="subtitle">
        Settlement-model metrics (CPA) with account/app/placement aggregations.
      </p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Settlement Summary</h3>
        <button class="button" type="button" :disabled="isLoading" @click="refreshUsage">
          {{ isLoading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
      <p class="muted">
        Source:
        <strong>{{ dashboardState.meta.connected ? 'public API' : 'local fallback' }}</strong>
        <span> · model={{ settlement.settlementModel || 'CPA' }}</span>
        <span> · {{ scopeLabel }}</span>
        <span v-if="dashboardState.meta.lastSyncedAt">
          · last synced {{ new Date(dashboardState.meta.lastSyncedAt).toLocaleString() }}
        </span>
      </p>
      <p v-if="dashboardState.meta.error" class="muted">
        {{ dashboardState.meta.error }}
      </p>
    </article>

    <div class="kpi-grid">
      <article v-for="card in usageCards" :key="card.label" class="kpi-card">
        <p class="kpi-label">{{ card.label }}</p>
        <p class="kpi-value">{{ card.value }}</p>
        <p class="text-detail">{{ card.sub }}</p>
      </article>
    </div>

    <div class="grid">
      <article class="panel">
        <h3>By Account</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Requests</th>
              <th>Conversions</th>
              <th>Revenue</th>
              <th>CPA</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in accountRows" :key="row.accountId">
              <td><code>{{ row.accountId }}</code></td>
              <td>{{ Number(row.requests || 0).toLocaleString() }}</td>
              <td>{{ Number(row.settledConversions || 0).toLocaleString() }}</td>
              <td>${{ Number(row.settledRevenueUsd || 0).toFixed(2) }}</td>
              <td>${{ Number(row.cpa || 0).toFixed(2) }}</td>
            </tr>
            <tr v-if="accountRows.length === 0">
              <td colspan="6" class="muted">No settled account metrics yet.</td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="panel">
        <h3>By App</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>App</th>
              <th>Requests</th>
              <th>Conversions</th>
              <th>Revenue</th>
              <th>CPA</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in appRows" :key="`${row.accountId}::${row.appId}`">
              <td><code>{{ row.accountId }}</code></td>
              <td><code>{{ row.appId }}</code></td>
              <td>{{ Number(row.requests || 0).toLocaleString() }}</td>
              <td>{{ Number(row.settledConversions || 0).toLocaleString() }}</td>
              <td>${{ Number(row.settledRevenueUsd || 0).toFixed(2) }}</td>
              <td>${{ Number(row.cpa || 0).toFixed(2) }}</td>
            </tr>
            <tr v-if="appRows.length === 0">
              <td colspan="6" class="muted">No settled app metrics yet.</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>

    <div class="grid">
      <article class="panel">
        <h3>By Placement</h3>
        <table class="table">
          <thead>
            <tr>
              <th>App</th>
              <th>Placement</th>
              <th>Layer</th>
              <th>Requests</th>
              <th>Conversions</th>
              <th>Revenue</th>
              <th>CTR</th>
              <th>Fill Rate</th>
              <th>CPA</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in placementRows" :key="`${row.accountId}::${row.appId}::${row.placementId}`">
              <td><code>{{ row.appId }}</code></td>
              <td><code>{{ row.placementId }}</code></td>
              <td>{{ row.layer || '-' }}</td>
              <td>{{ Number(row.requests || 0).toLocaleString() }}</td>
              <td>{{ Number(row.settledConversions || 0).toLocaleString() }}</td>
              <td>${{ Number(row.settledRevenueUsd || 0).toFixed(2) }}</td>
              <td>{{ (Number(row.ctr || 0) * 100).toFixed(2) }}%</td>
              <td>{{ (Number(row.fillRate || 0) * 100).toFixed(1) }}%</td>
              <td>${{ Number(row.cpa || 0).toFixed(2) }}</td>
            </tr>
            <tr v-if="placementRows.length === 0">
              <td colspan="9" class="muted">No settled placement metrics yet.</td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="panel">
        <h3>7-Day Trend (Settled Revenue)</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Impressions</th>
              <th>Clicks</th>
              <th>Settled Revenue</th>
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
