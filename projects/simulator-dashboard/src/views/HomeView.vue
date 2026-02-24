<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { controlPlaneClient } from '../api/control-plane-client'
import { authState } from '../state/auth-state'
import { dashboardState, hydrateDashboardState } from '../state/dashboard-state'
import { scopeState, setScope } from '../state/scope-state'

const isLoading = computed(() => Boolean(dashboardState.meta?.loading))
const scopeLabel = computed(() => `${scopeState.accountId || '-'} / ${scopeState.appId || '-'}`)
const scopeReady = computed(() => Boolean(scopeState.accountId && scopeState.appId))

const integrationForm = reactive({
  environment: 'staging',
  placementId: 'chat_inline_v1',
})

const appSelection = reactive({
  loading: false,
  error: '',
  options: [],
})

const readiness = reactive({
  loading: false,
  error: '',
  activeKeyCount: 0,
})

const verifyLoading = ref(false)
const verifyError = ref('')
const verifyResult = ref(null)

const totals = computed(() => dashboardState.settlementAggregates?.totals || {})
const refreshBusy = computed(() => Boolean(isLoading.value || readiness.loading || appSelection.loading))
const lastSyncedLabel = computed(() => {
  const raw = dashboardState.meta?.lastSyncedAt
  if (!raw) return 'No sync yet'
  const value = new Date(raw)
  if (Number.isNaN(value.getTime())) return 'No sync yet'
  return `Last synced ${value.toLocaleString()}`
})
const connectionStatus = computed(() => {
  if (dashboardState.meta?.connected) {
    return { label: 'Public API online', tone: 'good' }
  }
  return { label: 'Offline snapshot', tone: 'warn' }
})
const readinessStatus = computed(() => {
  if (!scopeReady.value) return { label: 'Action required', tone: 'warn' }
  if (hasActiveKey.value && placementEnabled.value) {
    return verifyPassed.value
      ? { label: 'Verified', tone: 'good' }
      : { label: 'Ready to verify', tone: 'good' }
  }
  return { label: 'Action required', tone: 'warn' }
})

const kpis = computed(() => {
  const row = totals.value
  const requests = Number(row.requests || 0)
  const conversions = Number(row.settledConversions || 0)
  const revenue = Number(row.settledRevenueUsd || 0)

  return [
    { label: 'Revenue', value: `$${revenue.toFixed(2)}` },
    { label: 'Requests', value: requests.toLocaleString() },
    { label: 'Conversions', value: conversions.toLocaleString() },
  ]
})

const placementOptions = computed(() => {
  const current = Array.isArray(dashboardState.placements) ? dashboardState.placements : []
  const ids = new Set(['chat_inline_v1', 'chat_followup_v1'])
  for (const row of current) {
    const id = String(row?.placementId || '').trim()
    if (id) ids.add(id)
  }
  return Array.from(ids)
})

const selectedPlacement = computed(() => {
  const current = Array.isArray(dashboardState.placements) ? dashboardState.placements : []
  return current.find((row) => String(row?.placementId || '') === String(integrationForm.placementId || '')) || null
})

const placementEnabled = computed(() => Boolean(selectedPlacement.value?.enabled))
const hasActiveKey = computed(() => readiness.activeKeyCount > 0)
const hasMultipleApps = computed(() => appSelection.options.length > 1)
const verifyPassed = computed(() => {
  const payload = verifyResult.value
  return Boolean(payload?.ok && String(payload?.requestId || '').trim())
})

const checklistRows = computed(() => ([
  {
    label: 'Scope ready',
    done: scopeReady.value,
    detail: scopeReady.value ? scopeLabel.value : 'No app selected.',
    actionTo: '/api-keys',
    actionLabel: 'Open API Keys',
  },
  {
    label: 'Active key',
    done: hasActiveKey.value,
    detail: hasActiveKey.value
      ? `${readiness.activeKeyCount} active key(s) in ${integrationForm.environment}`
      : `No active key in ${integrationForm.environment}.`,
    actionTo: '/api-keys',
    actionLabel: 'Create key',
  },
  {
    label: 'Placement enabled',
    done: placementEnabled.value,
    detail: placementEnabled.value
      ? `${integrationForm.placementId} is enabled.`
      : `${integrationForm.placementId} is disabled or missing.`,
    actionTo: '/config',
    actionLabel: 'Open config',
  },
  {
    label: 'Verification',
    done: verifyPassed.value,
    detail: verifyPassed.value
      ? `Verified with requestId ${String(verifyResult.value?.requestId || '-')}`
      : 'Run integration verify to complete onboarding.',
    actionTo: '/logs',
    actionLabel: 'Open logs',
  },
]))

const nextAction = computed(() => {
  const pending = checklistRows.value.find((item) => !item.done)
  if (pending) return pending

  return {
    label: 'All set',
    done: true,
    detail: 'Scope, key, placement, and verification are all ready.',
    actionTo: '/logs',
    actionLabel: 'Open logs',
  }
})

const verifyEvidence = computed(() => {
  const payload = verifyResult.value
  if (!payload || typeof payload !== 'object') return null
  const evidence = payload.evidence && typeof payload.evidence === 'object' ? payload.evidence : {}
  const bid = evidence.bid && typeof evidence.bid === 'object' ? evidence.bid : null
  const evaluate = evidence.evaluate && typeof evidence.evaluate === 'object' ? evidence.evaluate : null
  const bidResult = bid
    ? (bid.hasBid ? 'bid_found' : 'no_bid')
    : (evaluate?.result || '-')

  return {
    requestId: String(payload.requestId || ''),
    status: String(payload.status || ''),
    configStatus: Number(evidence?.config?.status || 0),
    bidResult,
    bidLatencyMs: Number(bid?.latencyMs || evaluate?.latencyMs || 0),
    eventsStatus: Number(evidence?.events?.status || 0),
  }
})

function statusClass(done) {
  return done ? 'status-pill good' : 'status-pill warn'
}

function metaPillClass(tone) {
  if (tone === 'good') return 'meta-pill good'
  if (tone === 'bad') return 'meta-pill bad'
  return 'meta-pill warn'
}

function normalizeAppOptions(controlPlaneApps = []) {
  const rows = Array.isArray(controlPlaneApps) ? controlPlaneApps : []
  const filtered = rows.filter((row) => {
    const accountId = String(row?.accountId || row?.organizationId || '').trim()
    return accountId && accountId === String(scopeState.accountId || '').trim()
  })
  const mapped = filtered
    .map((row) => {
      const appId = String(row?.appId || '').trim()
      if (!appId) return null
      return {
        appId,
        label: String(row?.displayName || '').trim() || appId,
      }
    })
    .filter(Boolean)

  const deduped = []
  const seen = new Set()
  for (const item of mapped) {
    if (seen.has(item.appId)) continue
    seen.add(item.appId)
    deduped.push(item)
  }
  deduped.sort((a, b) => a.label.localeCompare(b.label))
  return deduped
}

async function hydrateAppOptions() {
  appSelection.loading = true
  appSelection.error = ''
  try {
    if (!scopeState.accountId) {
      appSelection.options = []
      return
    }
    const snapshot = await controlPlaneClient.dashboard.getState({
      accountId: scopeState.accountId,
    })
    appSelection.options = normalizeAppOptions(snapshot?.controlPlaneApps)

    const hasCurrent = appSelection.options.some((item) => item.appId === scopeState.appId)
    if (!hasCurrent) {
      const fallbackAppId = String(authState.user?.appId || '').trim() || String(appSelection.options[0]?.appId || '').trim()
      if (fallbackAppId) {
        setScope({ accountId: scopeState.accountId, appId: fallbackAppId })
      }
    }
  } catch (error) {
    appSelection.options = []
    appSelection.error = error instanceof Error ? error.message : 'Failed to load app list.'
  } finally {
    appSelection.loading = false
  }
}

async function onChangeApp(appId) {
  const nextAppId = String(appId || '').trim()
  if (!nextAppId || nextAppId === scopeState.appId) return
  setScope({
    accountId: scopeState.accountId,
    appId: nextAppId,
  })
  verifyResult.value = null
  verifyError.value = ''
  await refreshReadiness({ reloadDashboard: true, reloadApps: false })
}

async function refreshReadiness(options = {}) {
  const reloadDashboard = options?.reloadDashboard !== false
  const reloadApps = options?.reloadApps !== false
  if (reloadApps) {
    await hydrateAppOptions()
  }
  if (reloadDashboard) {
    await hydrateDashboardState()
  }

  readiness.loading = true
  readiness.error = ''

  try {
    if (!scopeReady.value) {
      readiness.activeKeyCount = 0
      return
    }

    const payload = await controlPlaneClient.credentials.listKeys({
      accountId: scopeState.accountId,
      appId: scopeState.appId,
      environment: integrationForm.environment,
    })
    const keys = Array.isArray(payload?.keys) ? payload.keys : []
    readiness.activeKeyCount = keys.filter((item) => String(item?.status || '').toLowerCase() === 'active').length
  } catch (error) {
    readiness.activeKeyCount = 0
    readiness.error = error instanceof Error ? error.message : 'Failed to read key readiness.'
  } finally {
    readiness.loading = false
  }
}

async function runIntegrationVerify() {
  verifyLoading.value = true
  verifyError.value = ''
  verifyResult.value = null

  try {
    if (!scopeReady.value) {
      throw new Error('Scope is empty. Please select an app first.')
    }
    if (!hasActiveKey.value) {
      throw new Error(`No active API key for appId=${scopeState.appId} environment=${integrationForm.environment}.`)
    }

    const payload = await controlPlaneClient.quickStart.verify({
      accountId: scopeState.accountId,
      appId: scopeState.appId,
      environment: integrationForm.environment,
      placementId: integrationForm.placementId,
    })

    verifyResult.value = payload
    await refreshReadiness({ reloadDashboard: true, reloadApps: false })
  } catch (error) {
    verifyError.value = error instanceof Error ? error.message : 'Integration verify failed.'
  } finally {
    verifyLoading.value = false
  }
}

function refreshHome() {
  refreshReadiness({ reloadDashboard: true, reloadApps: true })
}

watch(
  () => integrationForm.environment,
  () => {
    refreshReadiness({ reloadDashboard: false, reloadApps: false })
  },
)

onMounted(() => {
  refreshHome()
})
</script>

<template>
  <section class="page">
    <header class="page-header page-header-split">
      <div class="header-stack">
        <p class="eyebrow">Dashboard</p>
        <h2>Revenue + Integration</h2>
        <p class="subtitle">Scope: {{ scopeLabel }}</p>
      </div>
      <div class="header-actions">
        <span :class="metaPillClass(readinessStatus.tone)">{{ readinessStatus.label }}</span>
        <button class="button" type="button" :disabled="refreshBusy" @click="refreshHome">
          {{ refreshBusy ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
    </header>

    <article class="panel panel-soft snapshot-strip">
      <div class="panel-toolbar">
        <div>
          <p class="eyebrow">Status</p>
          <h3>Today at a glance</h3>
        </div>
        <p class="muted panel-note">{{ lastSyncedLabel }}</p>
      </div>
      <div class="toolbar-actions">
        <span :class="metaPillClass(connectionStatus.tone)">{{ connectionStatus.label }}</span>
        <p class="muted">Scope: {{ scopeLabel }}</p>
      </div>
      <p class="muted" v-if="dashboardState.meta.error">{{ dashboardState.meta.error }}</p>
    </article>

    <div class="kpi-grid minimal-kpi-grid">
      <article v-for="item in kpis" :key="item.label" class="kpi-card">
        <p class="kpi-label">{{ item.label }}</p>
        <p class="kpi-value">{{ item.value }}</p>
      </article>
    </div>

    <article class="panel panel-soft">
      <div class="panel-toolbar">
        <h3>Self-Serve Integration</h3>
        <button
          class="button"
          type="button"
          :disabled="verifyLoading || !scopeReady || readiness.loading || !hasActiveKey"
          @click="runIntegrationVerify"
        >
          {{ verifyLoading ? 'Running...' : 'Run Verify' }}
        </button>
      </div>

      <div class="form-grid">
        <label v-if="hasMultipleApps">
          App
          <select class="input" :value="scopeState.appId" @change="onChangeApp($event.target.value)">
            <option v-for="item in appSelection.options" :key="item.appId" :value="item.appId">{{ item.label }}</option>
          </select>
        </label>
        <label>
          Environment
          <select v-model="integrationForm.environment" class="input">
            <option value="sandbox">sandbox</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </select>
        </label>
        <label>
          Placement
          <select v-model="integrationForm.placementId" class="input">
            <option v-for="item in placementOptions" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
      </div>

      <article class="panel panel-soft minimal-focus">
        <div class="panel-toolbar">
          <h4>{{ nextAction.label }}</h4>
          <span :class="statusClass(nextAction.done)">{{ nextAction.done ? 'done' : 'action needed' }}</span>
        </div>
        <p class="muted">{{ nextAction.detail }}</p>
        <div class="toolbar-actions">
          <RouterLink :to="nextAction.actionTo" class="button button-secondary">{{ nextAction.actionLabel }}</RouterLink>
          <RouterLink to="/logs" class="text-link">Open decision logs</RouterLink>
        </div>
      </article>

      <p class="muted" v-if="appSelection.error">{{ appSelection.error }}</p>
      <p class="muted" v-if="readiness.error">{{ readiness.error }}</p>
      <p class="muted" v-if="verifyError">{{ verifyError }}</p>

      <details v-if="verifyEvidence" class="verify-disclosure">
        <summary>View verify evidence</summary>
        <div class="kv-grid">
          <p><strong>requestId</strong><span><code>{{ verifyEvidence.requestId }}</code></span></p>
          <p><strong>status</strong><span>{{ verifyEvidence.status }}</span></p>
          <p><strong>config status</strong><span>{{ verifyEvidence.configStatus }}</span></p>
          <p><strong>bid result</strong><span>{{ verifyEvidence.bidResult }}</span></p>
          <p><strong>bid latency</strong><span>{{ verifyEvidence.bidLatencyMs }}ms</span></p>
          <p><strong>events status</strong><span>{{ verifyEvidence.eventsStatus }}</span></p>
        </div>
      </details>
    </article>
  </section>
</template>
