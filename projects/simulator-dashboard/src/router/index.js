import { createRouter, createWebHistory } from 'vue-router'

import { authState, hydrateAuthSession } from '../state/auth-state'
import ApiKeysView from '../views/ApiKeysView.vue'
import DecisionLogsView from '../views/DecisionLogsView.vue'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'
import PlacementsView from '../views/PlacementsView.vue'
import RegisterView from '../views/RegisterView.vue'

const routes = [
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    meta: { publicRoute: true },
  },
  {
    path: '/register',
    name: 'register',
    component: RegisterView,
    meta: { publicRoute: true },
  },
  {
    path: '/home',
    name: 'home',
    component: HomeView,
    meta: { navLabel: 'Home', requiresAuth: true },
  },
  {
    path: '/api-keys',
    name: 'apiKeys',
    component: ApiKeysView,
    meta: { navLabel: 'API Keys', requiresAuth: true },
  },
  {
    path: '/config',
    name: 'config',
    component: PlacementsView,
    meta: { navLabel: 'Config', requiresAuth: true },
  },
  {
    path: '/logs',
    name: 'logs',
    component: DecisionLogsView,
    meta: { navLabel: 'Logs', requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/home',
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  if (!authState.ready) {
    await hydrateAuthSession()
  }

  const isPublic = Boolean(to.meta?.publicRoute)
  const requiresAuth = Boolean(to.meta?.requiresAuth)

  if (isPublic && authState.authenticated) {
    return '/home'
  }
  if (requiresAuth && !authState.authenticated) {
    const redirectTarget = String(to.fullPath || '/home')
    return {
      path: '/login',
      query: { redirect: redirectTarget },
    }
  }
  return true
})

export default router
