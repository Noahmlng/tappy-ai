<script setup>
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import { featureFlags } from './config/feature-flags'
import { authState, logoutDashboardUser } from './state/auth-state'

const route = useRoute()
const router = useRouter()
const isPublicRoute = computed(() => Boolean(route.meta?.publicRoute))
const sidebarOpen = ref(false)

const navItems = computed(() => {
  if (!authState.authenticated) return []
  const items = [
    { to: '/overview', label: 'Overview' },
    { to: '/api-keys', label: 'API Keys' },
    { to: '/integrations', label: 'Integrations' },
    { to: '/agent-onboarding', label: 'Agent Onboarding' },
    { to: '/quick-start', label: 'Quick Start' },
    { to: '/usage', label: 'Usage' },
    { to: '/decision-logs', label: 'Decision Logs' },
  ]

  if (featureFlags.enableInternalReset) {
    items.push({ to: '/internal-reset', label: 'Internal Reset' })
  }

  return items
})

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function closeSidebar() {
  sidebarOpen.value = false
}

function handleNavClick() {
  closeSidebar()
}

async function handleLogout() {
  closeSidebar()
  await logoutDashboardUser()
  await router.replace('/login')
}
</script>

<template>
  <div class="app-shell" :class="{ 'auth-shell': isPublicRoute }">
    <div v-if="!isPublicRoute" class="mobile-header">
      <button class="hamburger-btn" type="button" @click="toggleSidebar">&#9776;</button>
    </div>

    <div
      v-if="!isPublicRoute"
      class="side-nav-overlay"
      :class="{ visible: sidebarOpen }"
      @click="closeSidebar"
    />

    <aside
      v-if="!isPublicRoute"
      class="side-nav"
      :class="{ open: sidebarOpen }"
    >
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
          @click="handleNavClick"
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
    </aside>

    <main class="content-pane card" :class="{ 'auth-content': isPublicRoute }">
      <RouterView />
    </main>
  </div>
</template>
