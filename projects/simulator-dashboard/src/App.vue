<script setup>
import { onMounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import { dashboardState, hydrateDashboardState } from './state/dashboard-state'

const route = useRoute()

const navItems = [
  { label: 'Overview', to: '/overview' },
  { label: 'Placements', to: '/placements' },
  { label: 'Triggers', to: '/triggers' },
  { label: 'Decision Logs', to: '/decision-logs' },
]

onMounted(() => {
  hydrateDashboardState()
})
</script>

<template>
  <div class="app-shell">
    <aside class="side-nav card">
      <div>
        <p class="eyebrow">AI Native Network</p>
        <h1 class="title">Integrator Console</h1>
      </div>
      <nav>
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ active: route.path === item.to }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
      <p class="muted">
        Tenant mode: user-defined parameters
      </p>
      <p class="muted status-row">
        Gateway:
        <span :class="{ ok: dashboardState.meta.connected, bad: !dashboardState.meta.connected }">
          {{ dashboardState.meta.connected ? 'connected' : 'offline fallback' }}
        </span>
      </p>
      <p v-if="dashboardState.meta.error" class="muted">
        {{ dashboardState.meta.error }}
      </p>
    </aside>

    <main class="content-pane">
      <RouterView />
    </main>
  </div>
</template>
