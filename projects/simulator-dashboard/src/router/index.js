import { createRouter, createWebHistory } from 'vue-router'

import { isFeatureEnabled } from '../config/feature-flags'
import { authState, hydrateAuthSession } from '../state/auth-state'
import ApiKeysView from '../views/ApiKeysView.vue'
import AgentOnboardingView from '../views/AgentOnboardingView.vue'
import HomeView from '../views/HomeView.vue'
import IntegrationsView from '../views/IntegrationsView.vue'
import InternalResetView from '../views/InternalResetView.vue'
import LoginView from '../views/LoginView.vue'
import QuickStartView from '../views/QuickStartView.vue'
import RegisterView from '../views/RegisterView.vue'
import UsageView from '../views/UsageView.vue'

const routes = [
  {
    path: '/',
    redirect: '/usage',
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
    path: '/quick-start',
    name: 'quickStart',
    component: QuickStartView,
    meta: { navLabel: 'Quick Start', requiresAuth: true },
  },
  {
    path: '/api-keys',
    name: 'apiKeys',
    component: ApiKeysView,
    meta: { navLabel: 'API Keys', requiresAuth: true },
  },
  {
    path: '/integrations',
    name: 'integrations',
    component: IntegrationsView,
    meta: { navLabel: 'Integrations', requiresAuth: true },
  },
  {
    path: '/usage',
    name: 'usage',
    component: UsageView,
    meta: { navLabel: 'Usage', requiresAuth: true },
  },
  {
    path: '/agent-onboarding',
    name: 'agentOnboarding',
    component: AgentOnboardingView,
    meta: { navLabel: 'Agent Onboarding', requiresAuth: true },
  },
]

if (isFeatureEnabled('enableInternalReset')) {
  routes.push({
    path: '/internal-reset',
    name: 'internalReset',
    component: InternalResetView,
    meta: { navLabel: 'Internal Reset', requiresAuth: true },
  })
}

routes.push({
  path: '/:pathMatch(.*)*',
  redirect: '/home',
})

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
    return '/usage'
  }
  if (requiresAuth && !authState.authenticated) {
    const redirectTarget = String(to.fullPath || '/usage')
    return {
      path: '/login',
      query: { redirect: redirectTarget },
    }
  }
  return true
})

export default router
