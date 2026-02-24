<script setup>
import { computed, onMounted } from 'vue'

import {
  dashboardState,
  hydrateDashboardState,
  setPlacementEnabled,
  updatePlacementNumber,
} from '../state/dashboard-state'

const placements = computed(() => Array.isArray(dashboardState.placements) ? dashboardState.placements : [])

function refreshConfig() {
  hydrateDashboardState()
}

onMounted(() => {
  refreshConfig()
})
</script>

<template>
  <section class="page">
    <header class="page-header page-header-split">
      <div class="header-stack">
        <p class="eyebrow">Placement</p>
        <h2>Placement</h2>
        <p class="subtitle">Enable + limits</p>
      </div>
      <div class="header-actions">
        <button class="button" type="button" :disabled="dashboardState.meta.loading" @click="refreshConfig">
          {{ dashboardState.meta.loading ? 'Sync...' : 'Sync' }}
        </button>
      </div>
    </header>

    <div class="placement-card-grid">
      <article v-for="placement in placements" :key="placement.placementId" class="panel">
        <div class="panel-head">
          <div>
            <h3>{{ placement.placementId }}</h3>
            <p class="muted">{{ placement.surface || '-' }} · {{ Array.isArray(placement.bidders) ? placement.bidders.length : 0 }} bidders</p>
          </div>
          <label class="inline-switch">
            <input
              type="checkbox"
              :checked="placement.enabled"
              @change="setPlacementEnabled(placement.placementId, $event.target.checked)"
            >
            <span>{{ placement.enabled ? 'On' : 'Off' }}</span>
          </label>
        </div>

        <div class="form-grid">
          <label>
            Fanout
            <input
              class="input"
              type="number"
              min="1"
              max="10"
              :value="Number(placement.maxFanout || 3)"
              @change="updatePlacementNumber(placement.placementId, 'maxFanout', $event.target.value, 1)"
            >
          </label>
          <label>
            Timeout (ms)
            <input
              class="input"
              type="number"
              min="100"
              step="50"
              :value="Number(placement.globalTimeoutMs || 1200)"
              @change="updatePlacementNumber(placement.placementId, 'globalTimeoutMs', $event.target.value, 100)"
            >
          </label>
        </div>
      </article>

      <article v-if="placements.length === 0" class="panel">
        <p class="muted">No placement.</p>
      </article>
    </div>
  </section>
</template>
