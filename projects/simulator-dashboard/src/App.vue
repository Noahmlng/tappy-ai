<script setup>
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import { featureFlags } from './config/feature-flags'
import { authState, logoutDashboardUser } from './state/auth-state'

const route = useRoute()
const router = useRouter()
const isPublicRoute = computed(() => Boolean(route.meta?.publicRoute))

const navItems = computed(() => {
  if (!authState.authenticated) return []
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

async function handleLogout() {
  await logoutDashboardUser()
  await router.replace('/login')
}
</script>

<template>
  <div class="app-shell" :class="{ 'auth-shell': isPublicRoute }">
    <aside v-if="!isPublicRoute" class="side-nav">
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
        Signed in:
        <strong>{{ authState.user?.email || '-' }}</strong>
      </p>

      <p class="muted">
        Account:
        <strong>{{ authState.user?.accountId || '-' }}</strong>
      </p>

      <button class="button button-secondary" type="button" @click="handleLogout">
        Sign out
      </button>

      <p class="muted">
        Mode:
        <strong>{{ featureFlags.dashboardV1Minimal ? 'v1 minimal' : 'legacy' }}</strong>
      </p>

      <p class="muted">
        Internal reset:
        <strong>{{ featureFlags.enableInternalReset ? 'enabled' : 'disabled' }}</strong>
      </p>
    </aside>

    <main class="content-pane card" :class="{ 'auth-content': isPublicRoute }">
      <RouterView />
    </main>
  </div>
</template>
