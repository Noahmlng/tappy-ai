<script setup>
import { computed } from 'vue'

import { dashboardState } from '../state/dashboard-state'

const maxRevenue = computed(() => {
  const values = dashboardState.metricsByDay.map((item) => item.revenueUsd)
  return Math.max(...values, 1)
})

const kpis = computed(() => {
  const m = dashboardState.metricsSummary
  return [
    { label: 'Revenue (7d)', value: `$${m.revenueUsd.toFixed(2)}` },
    { label: 'Impressions', value: m.impressions.toLocaleString() },
    { label: 'Clicks', value: m.clicks.toLocaleString() },
    { label: 'CTR', value: `${(m.ctr * 100).toFixed(2)}%` },
    { label: 'eCPM', value: `$${m.ecpm.toFixed(2)}` },
    { label: 'Fill Rate', value: `${(m.fillRate * 100).toFixed(1)}%` },
  ]
})

const networkRows = computed(() => {
  const health = dashboardState.networkHealth || {}
  return Object.keys(health)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const item = health[key] || {}
      const cooldownUntilMs = Number(item.cooldownUntil || 0)
      const cooldownUntil = cooldownUntilMs > 0
        ? new Date(cooldownUntilMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '-'
      return {
        network: key,
        status: String(item.status || 'unknown'),
        consecutiveFailures: Number(item.consecutiveFailures || 0),
        lastErrorCode: String(item.lastErrorCode || '-'),
        cooldownUntil,
      }
    })
})

const resilienceKpis = computed(() => {
  const stats = dashboardState.networkFlowStats || {}
  return [
    { label: 'Runtime Evaluations', value: Number(stats.totalRuntimeEvaluations || 0).toLocaleString() },
    { label: 'Degraded Evaluations', value: Number(stats.degradedRuntimeEvaluations || 0).toLocaleString() },
    { label: 'Resilient Serves', value: Number(stats.resilientServes || 0).toLocaleString() },
    { label: 'Circuit Open Hits', value: Number(stats.circuitOpenEvaluations || 0).toLocaleString() },
  ]
})
</script>

<template>
  <section>
    <header class="section-head">
      <div>
        <p class="eyebrow">Dashboard</p>
        <h2>Revenue & Delivery Overview</h2>
      </div>
      <div class="chip">
        Parameters controlled by tenant users
      </div>
    </header>

    <div class="kpi-grid">
      <article v-for="item in kpis" :key="item.label" class="card kpi-card">
        <p class="kpi-label">{{ item.label }}</p>
        <p class="kpi-value">{{ item.value }}</p>
      </article>
    </div>

    <div class="split-grid">
      <article class="card">
        <h3>7-Day Revenue Trend</h3>
        <div class="trend-list">
          <div v-for="row in dashboardState.metricsByDay" :key="row.day" class="trend-row">
            <span>{{ row.day }}</span>
            <div class="bar-wrap">
              <div class="bar" :style="{ width: `${(row.revenueUsd / maxRevenue) * 100}%` }" />
            </div>
            <strong>${{ row.revenueUsd.toFixed(2) }}</strong>
          </div>
        </div>
      </article>

      <article class="card">
        <h3>Placement Contribution</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Placement</th>
              <th>Layer</th>
              <th>Revenue</th>
              <th>CTR</th>
              <th>Fill Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in dashboardState.metricsByPlacement" :key="row.placementId">
              <td>{{ row.placementId }}</td>
              <td>{{ row.layer }}</td>
              <td>${{ row.revenueUsd.toFixed(2) }}</td>
              <td>{{ (row.ctr * 100).toFixed(2) }}%</td>
              <td>{{ (row.fillRate * 100).toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>

    <div class="split-grid">
      <article class="card">
        <h3>Network Health & Circuit Breaker</h3>
        <div class="kpi-grid" style="margin-top: 0.75rem;">
          <article v-for="item in resilienceKpis" :key="item.label" class="kpi-card">
            <p class="kpi-label">{{ item.label }}</p>
            <p class="kpi-value">{{ item.value }}</p>
          </article>
        </div>

        <table class="table" style="margin-top: 0.75rem;">
          <thead>
            <tr>
              <th>Network</th>
              <th>Status</th>
              <th>Consecutive Failures</th>
              <th>Last Error</th>
              <th>Cooldown Until</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in networkRows" :key="row.network">
              <td>{{ row.network }}</td>
              <td>{{ row.status }}</td>
              <td>{{ row.consecutiveFailures }}</td>
              <td>{{ row.lastErrorCode }}</td>
              <td>{{ row.cooldownUntil }}</td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="card">
        <h3>Degradation Signals</h3>
        <p class="muted">
          This panel tracks whether single-network failures were absorbed by the runtime
          (fallback/snapshot/circuit behavior) without dragging total response delivery.
        </p>

        <table class="table" style="margin-top: 0.75rem;">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Served With Network Errors</td>
              <td>{{ dashboardState.networkFlowStats?.servedWithNetworkErrors || 0 }}</td>
            </tr>
            <tr>
              <td>No Fill With Network Errors</td>
              <td>{{ dashboardState.networkFlowStats?.noFillWithNetworkErrors || 0 }}</td>
            </tr>
            <tr>
              <td>Runtime Errors</td>
              <td>{{ dashboardState.networkFlowStats?.runtimeErrors || 0 }}</td>
            </tr>
            <tr>
              <td>Open Circuits</td>
              <td>{{ dashboardState.networkHealthSummary?.open || 0 }}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  </section>
</template>
