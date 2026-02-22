import { createRouter, createWebHistory } from 'vue-router'

import { isFeatureEnabled } from '../config/feature-flags'
import ApiKeysView from '../views/ApiKeysView.vue'
import HomeView from '../views/HomeView.vue'
import IntegrationsView from '../views/IntegrationsView.vue'
import InternalResetView from '../views/InternalResetView.vue'
import QuickStartView from '../views/QuickStartView.vue'
import UsageView from '../views/UsageView.vue'

const routes = [
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/home',
    name: 'home',
    component: HomeView,
    meta: { navLabel: 'Home' },
  },
  {
    path: '/quick-start',
    name: 'quickStart',
    component: QuickStartView,
    meta: { navLabel: 'Quick Start' },
  },
  {
    path: '/api-keys',
    name: 'apiKeys',
    component: ApiKeysView,
    meta: { navLabel: 'API Keys' },
  },
  {
    path: '/integrations',
    name: 'integrations',
    component: IntegrationsView,
    meta: { navLabel: 'Integrations' },
  },
  {
    path: '/usage',
    name: 'usage',
    component: UsageView,
    meta: { navLabel: 'Usage' },
  },
]

if (isFeatureEnabled('enableInternalReset')) {
  routes.push({
    path: '/internal-reset',
    name: 'internalReset',
    component: InternalResetView,
    meta: { navLabel: 'Internal Reset' },
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

export default router
