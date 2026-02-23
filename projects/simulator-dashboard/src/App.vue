<script setup>
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import { featureFlags } from './config/feature-flags'

const route = useRoute()
const router = useRouter()

const navItems = computed(() => {
  return router.getRoutes()
    .filter((item) => item.meta?.nav)
    .map((item) => ({
      to: item.path,
      label: item.meta?.navLabel || item.name,
      order: Number(item.meta?.navOrder || 99),
    }))
    .sort((a, b) => a.order - b.order)
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
          <p class="top-banner-eyebrow">Primary Flow</p>
          <strong>API First Path</strong>
          <p>API Key → Request Path → 24h Usage</p>
        </div>
        <div class="top-banner-actions">
          <RouterLink to="/api-keys" class="button button-secondary">Manage API Keys</RouterLink>
        </div>
      </header>

      <main class="main-container card-surface">
        <RouterView />
      </main>
    </div>
  </div>
</template>
