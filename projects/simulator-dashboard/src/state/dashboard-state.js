import { reactive } from 'vue'

import { controlPlaneClient } from '../api/control-plane-client'
import { mockDashboardState } from '../data/mockDashboard'
import { getScopeQuery } from './scope-state'

const STORAGE_KEY = 'ai-network-simulator-dashboard-state-v2'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function shapeState(value) {
  const fallback = clone(mockDashboardState)
  if (!value || typeof value !== 'object') return fallback

  return {
    placementConfigVersion: Number.isFinite(value.placementConfigVersion)
      ? value.placementConfigVersion
      : 1,
    metricsSummary: value.metricsSummary && typeof value.metricsSummary === 'object'
      ? value.metricsSummary
      : fallback.metricsSummary,
    metricsByDay: Array.isArray(value.metricsByDay) ? value.metricsByDay : fallback.metricsByDay,
    metricsByPlacement: Array.isArray(value.metricsByPlacement)
      ? value.metricsByPlacement
      : fallback.metricsByPlacement,
    settlementAggregates: value.settlementAggregates && typeof value.settlementAggregates === 'object'
      ? value.settlementAggregates
      : (fallback.settlementAggregates || {
        settlementModel: 'CPA',
        currency: 'USD',
        totals: {
          requests: 0,
          served: 0,
          impressions: 0,
          clicks: 0,
          settledConversions: 0,
          settledRevenueUsd: 0,
          ctr: 0,
          fillRate: 0,
          ecpm: 0,
          cpa: 0,
        },
        byAccount: [],
        byApp: [],
        byPlacement: [],
      }),
    placements: Array.isArray(value.placements) ? value.placements : fallback.placements,
    placementAuditLogs: Array.isArray(value.placementAuditLogs)
      ? value.placementAuditLogs
      : [],
    networkHealth: value.networkHealth && typeof value.networkHealth === 'object'
      ? value.networkHealth
      : (fallback.networkHealth || {}),
    networkHealthSummary: value.networkHealthSummary && typeof value.networkHealthSummary === 'object'
      ? value.networkHealthSummary
      : (fallback.networkHealthSummary || { totalNetworks: 0, healthy: 0, degraded: 0, open: 0 }),
    networkFlowStats: value.networkFlowStats && typeof value.networkFlowStats === 'object'
      ? value.networkFlowStats
      : (fallback.networkFlowStats || {
        totalRuntimeEvaluations: 0,
        degradedRuntimeEvaluations: 0,
        resilientServes: 0,
        servedWithNetworkErrors: 0,
        noFillWithNetworkErrors: 0,
        runtimeErrors: 0,
        circuitOpenEvaluations: 0,
      }),
    networkFlowLogs: Array.isArray(value.networkFlowLogs)
      ? value.networkFlowLogs
      : (Array.isArray(fallback.networkFlowLogs) ? fallback.networkFlowLogs : []),
    decisionLogs: Array.isArray(value.decisionLogs) ? value.decisionLogs : fallback.decisionLogs,
    controlPlaneApps: Array.isArray(value.controlPlaneApps) ? value.controlPlaneApps : [],
    scope: value.scope && typeof value.scope === 'object' ? value.scope : {},
  }
}

function loadState() {
  if (typeof window === 'undefined') return shapeState(mockDashboardState)

  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (!saved) return shapeState(mockDashboardState)

  try {
    return shapeState(JSON.parse(saved))
  } catch {
    return shapeState(mockDashboardState)
  }
}

const initial = loadState()

export const dashboardState = reactive({
  ...initial,
  meta: {
    loading: false,
    connected: false,
    error: '',
    lastSyncedAt: '',
  },
})

function persist() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      placementConfigVersion: dashboardState.placementConfigVersion,
      metricsSummary: dashboardState.metricsSummary,
      metricsByDay: dashboardState.metricsByDay,
      metricsByPlacement: dashboardState.metricsByPlacement,
      settlementAggregates: dashboardState.settlementAggregates,
      placements: dashboardState.placements,
      placementAuditLogs: dashboardState.placementAuditLogs,
      networkHealth: dashboardState.networkHealth,
      networkHealthSummary: dashboardState.networkHealthSummary,
      networkFlowStats: dashboardState.networkFlowStats,
      networkFlowLogs: dashboardState.networkFlowLogs,
      decisionLogs: dashboardState.decisionLogs,
      controlPlaneApps: dashboardState.controlPlaneApps,
      scope: dashboardState.scope,
    }),
  )
}

function applySnapshot(snapshot) {
  const next = shapeState(snapshot)
  dashboardState.placementConfigVersion = next.placementConfigVersion
  dashboardState.metricsSummary = next.metricsSummary
  dashboardState.metricsByDay = next.metricsByDay
  dashboardState.metricsByPlacement = next.metricsByPlacement
  dashboardState.settlementAggregates = next.settlementAggregates
  dashboardState.placements = next.placements
  dashboardState.placementAuditLogs = next.placementAuditLogs
  dashboardState.networkHealth = next.networkHealth
  dashboardState.networkHealthSummary = next.networkHealthSummary
  dashboardState.networkFlowStats = next.networkFlowStats
  dashboardState.networkFlowLogs = next.networkFlowLogs
  dashboardState.decisionLogs = next.decisionLogs
  dashboardState.controlPlaneApps = next.controlPlaneApps
  dashboardState.scope = next.scope
  dashboardState.meta.lastSyncedAt = new Date().toISOString()
  persist()
}

function withPlacement(placementId, updater) {
  const target = dashboardState.placements.find((item) => item.placementId === placementId)
  if (!target) return null
  updater(target)
  persist()
  return target
}

function toFiniteNumber(value, fallback) {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  return fallback
}

function syncPlacement(placementId, patch) {
  controlPlaneClient.dashboard.updatePlacement(placementId, patch)
    .then((res) => {
      if (!res?.placement) return
      const idx = dashboardState.placements.findIndex((item) => item.placementId === placementId)
      if (idx >= 0) {
        dashboardState.placements[idx] = res.placement
        dashboardState.meta.connected = true
        dashboardState.meta.error = ''
        dashboardState.meta.lastSyncedAt = new Date().toISOString()
        persist()
      }
    })
    .catch((error) => {
      dashboardState.meta.connected = false
      dashboardState.meta.error = error instanceof Error ? error.message : 'Failed to sync placement'
    })
}

export async function hydrateDashboardState() {
  dashboardState.meta.loading = true

  try {
    const snapshot = await controlPlaneClient.dashboard.getState(getScopeQuery())
    applySnapshot(snapshot)
    dashboardState.meta.connected = true
    dashboardState.meta.error = ''
  } catch (error) {
    dashboardState.meta.connected = false
    dashboardState.meta.error = error instanceof Error
      ? error.message
      : 'Gateway unavailable, fallback to local mock state'
  } finally {
    dashboardState.meta.loading = false
  }
}

export function setPlacementEnabled(placementId, enabled) {
  const placement = withPlacement(placementId, (target) => {
    target.enabled = Boolean(enabled)
  })
  if (!placement) return

  syncPlacement(placementId, { enabled: placement.enabled })
}

export function updatePlacementNumber(placementId, key, value, min = 0) {
  const placement = withPlacement(placementId, (target) => {
    const next = Math.max(min, Math.floor(toFiniteNumber(value, target[key])))
    target[key] = next
  })
  if (!placement) return

  syncPlacement(placementId, { [key]: placement[key] })
}

export function updateFrequencyCap(placementId, key, value) {
  const placement = withPlacement(placementId, (target) => {
    const next = Math.max(0, Math.floor(toFiniteNumber(value, target.frequencyCap[key])))
    target.frequencyCap[key] = next
  })
  if (!placement) return

  syncPlacement(placementId, {
    frequencyCap: {
      [key]: placement.frequencyCap[key],
    },
  })
}

export function updateTriggerNumber(placementId, key, value) {
  const placement = withPlacement(placementId, (target) => {
    const current = target.trigger[key]
    const nextValue = toFiniteNumber(value, current)

    if (key === 'intentThreshold') {
      target.trigger[key] = Math.min(1, Math.max(0, nextValue))
      return
    }

    target.trigger[key] = Math.max(0, nextValue)
  })
  if (!placement) return

  syncPlacement(placementId, {
    trigger: {
      [key]: placement.trigger[key],
    },
  })
}

export function resetDashboardState() {
  applySnapshot(mockDashboardState)
}
