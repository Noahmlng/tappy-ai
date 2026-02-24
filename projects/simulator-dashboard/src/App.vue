<script setup>
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import { authState, logoutDashboardUser } from './state/auth-state'

const route = useRoute()
const router = useRouter()
const isPublicRoute = computed(() => Boolean(route.meta?.publicRoute))
const sidebarOpen = ref(false)

const navItems = computed(() => {
  if (!authState.authenticated) return []
  return [
    { to: '/home', label: 'Home' },
    { to: '/api-keys', label: 'API Keys' },
    { to: '/config', label: 'Config' },
    { to: '/logs', label: 'Logs' },
  ]
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
        <p class="eyebrow">AI Native Ads</p>
        <h1 class="title">Simple Dashboard</h1>
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

      <p class="muted nav-meta">
        {{ authState.user?.email || '-' }}
      </p>
      <p class="muted nav-meta">
        {{ authState.user?.accountId || '-' }}
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
