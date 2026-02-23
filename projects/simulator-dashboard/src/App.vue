<script setup>
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import UiBadge from './components/ui/UiBadge.vue'
import { featureFlags } from './config/feature-flags'

const route = useRoute()

const navItems = computed(() => {
  const items = [
    { to: '/home', label: 'Home' },
    { to: '/quick-start', label: 'Quick Start' },
    { to: '/agent-onboarding', label: 'Agent Onboarding' },
    { to: '/api-keys', label: 'API Keys' },
    { to: '/integrations', label: 'Integrations' },
    { to: '/usage', label: 'Usage' },
  ]

  if (featureFlags.enableInternalReset) {
    items.push({ to: '/internal-reset', label: 'Internal Reset' })
  }

  return items
})

const activeNavLabel = computed(() => {
  const found = navItems.value.find((item) => route.path === item.to || route.path.startsWith(`${item.to}/`))
  return found?.label || 'Dashboard'
})
</script>

<template>
  <div class="dashboard-shell">
    <aside class="dashboard-side card-surface">
      <div>
        <p class="brand-eyebrow">AI Native Network</p>
        <h1 class="brand-title">Developer Dashboard <span>v1</span></h1>
      </div>

      <nav class="side-nav-list">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="side-nav-link"
          :class="{ active: route.path === item.to || route.path.startsWith(`${item.to}/`) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="side-meta">
        <p class="muted">
          Mode: <strong>{{ featureFlags.dashboardV1Minimal ? 'v1 minimal' : 'legacy' }}</strong>
        </p>
        <p class="muted">
          Internal reset: <strong>{{ featureFlags.enableInternalReset ? 'enabled' : 'disabled' }}</strong>
        </p>
      </div>
    </aside>

    <div class="shell-main">
      <header class="top-banner">
        <div class="top-banner-copy">
          <p class="top-banner-eyebrow">Panxo + Exa Inspired Direction</p>
          <strong>{{ activeNavLabel }}</strong>
          <p>Evidence-native monetization control center for AI traffic.</p>
        </div>
        <div class="top-banner-actions">
          <UiBadge tone="success">Realtime telemetry</UiBadge>
          <UiBadge tone="info">Production-ready API flow</UiBadge>
        </div>
      </header>

      <main class="main-container card-surface">
        <RouterView />
      </main>
    </div>
  </div>
</template>
