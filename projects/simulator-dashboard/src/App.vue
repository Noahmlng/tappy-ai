<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import { authState, logoutDashboardUser } from './state/auth-state'

const route = useRoute()
const router = useRouter()
const isPublicRoute = computed(() => Boolean(route.meta?.publicRoute))
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)

const navItems = computed(() => {
  if (!authState.authenticated) return []
  return [
    { to: '/home', label: 'Home', icon: 'home' },
    { to: '/api-keys', label: 'API Keys', icon: 'key' },
    { to: '/config', label: 'Config', icon: 'sliders' },
    { to: '/logs', label: 'Logs', icon: 'list' },
  ]
})

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function toggleSidebarCollapse() {
  sidebarCollapsed.value = !sidebarCollapsed.value
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

function isNavActive(path) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

onMounted(() => {
  const cached = typeof window !== 'undefined' ? window.localStorage.getItem('dashboard.sidebarCollapsed') : null
  sidebarCollapsed.value = cached === '1'
})

watch(sidebarCollapsed, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('dashboard.sidebarCollapsed', value ? '1' : '0')
})

watch(
  () => route.fullPath,
  () => {
    closeSidebar()
  },
)
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'auth-shell': isPublicRoute,
      'sidebar-collapsed': !isPublicRoute && sidebarCollapsed,
    }"
  >
    <div v-if="!isPublicRoute" class="mobile-header">
      <p class="mobile-title">Control Plane</p>
      <button class="icon-button hamburger-btn" type="button" @click="toggleSidebar">
        Menu
      </button>
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
      <div class="side-nav-head">
        <div class="brand-block">
          <p class="eyebrow">AI Native Ads</p>
          <h1 class="title">Control Plane</h1>
          <p class="subtitle nav-subtitle">Runtime Dashboard</p>
        </div>
        <button class="icon-button collapse-btn" type="button" @click="toggleSidebarCollapse">
          {{ sidebarCollapsed ? '>' : '<' }}
        </button>
      </div>

      <nav class="nav-list">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ active: isNavActive(item.to) }"
          @click="handleNavClick"
        >
          <span class="nav-icon" aria-hidden="true">
            <svg v-if="item.icon === 'home'" viewBox="0 0 24 24">
              <path d="M3 10.5L12 3l9 7.5" />
              <path d="M5.5 9.5V20h13V9.5" />
            </svg>
            <svg v-else-if="item.icon === 'key'" viewBox="0 0 24 24">
              <circle cx="8" cy="12" r="3.5" />
              <path d="M11.5 12H21" />
              <path d="M17 12v3" />
              <path d="M20 12v2" />
            </svg>
            <svg v-else-if="item.icon === 'sliders'" viewBox="0 0 24 24">
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h16" />
              <circle cx="9" cy="6" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="7" cy="18" r="2" />
            </svg>
            <svg v-else viewBox="0 0 24 24">
              <path d="M7 7h10" />
              <path d="M7 12h10" />
              <path d="M7 17h10" />
              <circle cx="4.5" cy="7" r="1.2" />
              <circle cx="4.5" cy="12" r="1.2" />
              <circle cx="4.5" cy="17" r="1.2" />
            </svg>
          </span>
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-tooltip">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="side-nav-footer">
        <div class="nav-meta">
          <p class="muted mono">{{ authState.user?.email || '-' }}</p>
          <p class="muted mono">{{ authState.user?.accountId || '-' }}</p>
        </div>

        <button class="button button-secondary nav-signout" type="button" @click="handleLogout">
          Sign out
        </button>
      </div>
    </aside>

    <main class="content-pane" :class="{ 'auth-content': isPublicRoute }">
      <RouterView />
    </main>
  </div>
</template>
