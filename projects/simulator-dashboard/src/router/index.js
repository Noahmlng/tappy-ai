import { createRouter, createWebHistory } from 'vue-router'

import OverviewView from '../views/OverviewView.vue'
import PlacementsView from '../views/PlacementsView.vue'
import TriggersView from '../views/TriggersView.vue'
import DecisionLogsView from '../views/DecisionLogsView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/overview',
    },
    {
      path: '/overview',
      name: 'overview',
      component: OverviewView,
    },
    {
      path: '/placements',
      name: 'placements',
      component: PlacementsView,
    },
    {
      path: '/triggers',
      name: 'triggers',
      component: TriggersView,
    },
    {
      path: '/decision-logs',
      name: 'decisionLogs',
      component: DecisionLogsView,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/overview',
    },
  ],
})

export default router
