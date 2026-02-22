<script setup>
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import { featureFlags } from './config/feature-flags'

const route = useRoute()

const navItems = computed(() => {
  const items = [
    { to: '/home', label: 'Home' },
    { to: '/quick-start', label: 'Quick Start' },
    { to: '/api-keys', label: 'API Keys' },
    { to: '/integrations', label: 'Integrations' },
    { to: '/usage', label: 'Usage' },
  ]

  if (featureFlags.enableInternalReset) {
    items.push({ to: '/internal-reset', label: 'Internal Reset' })
  }

  return items
})
</script>

<template>
  <div class="app-shell">
    <aside class="side-nav">
      <div>
        <p class="eyebrow">AI Native Network</p>
        <h1 class="title">Developer Dashboard</h1>
      </div>

      <nav class="nav-list">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ active: route.path === item.to || route.path.startsWith(`${item.to}/`) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <p class="muted">
        Mode:
        <strong>{{ featureFlags.dashboardV1Minimal ? 'v1 minimal' : 'legacy' }}</strong>
      </p>

      <p class="muted">
        Internal reset:
        <strong>{{ featureFlags.enableInternalReset ? 'enabled' : 'disabled' }}</strong>
      </p>
    </aside>

    <main class="content-pane card">
      <RouterView />
    </main>
  </div>
</template>
