import { reactive } from 'vue'

import { setDashboardAccessToken, controlPlaneClient } from '../api/control-plane-client'
import { setScope } from './scope-state'

const STORAGE_KEY = 'ai-network-simulator-dashboard-auth-v1'

function loadStoredAuth() {
  if (typeof window === 'undefined') return { accessToken: '' }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return { accessToken: '' }
  try {
    const parsed = JSON.parse(raw)
    return {
      accessToken: String(parsed?.accessToken || '').trim(),
    }
  } catch {
    return { accessToken: '' }
  }
}

function persistAccessToken(accessToken) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: String(accessToken || '').trim() }))
}

function clearPersistedAuth() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}

function applyScopeFromUser(user = {}, scope = {}) {
  const accountId = String(scope.accountId || user.accountId || '').trim()
  const appId = String(scope.appId || '').trim()
  if (!accountId) return
  setScope({
    accountId,
    appId,
  })
}

const stored = loadStoredAuth()
setDashboardAccessToken(stored.accessToken)

export const authState = reactive({
  accessToken: stored.accessToken,
  user: null,
  session: null,
  authenticated: Boolean(stored.accessToken),
  ready: false,
  loading: false,
  error: '',
})

function applyAuthPayload(payload = {}) {
  const user = payload?.user && typeof payload.user === 'object' ? payload.user : null
  const session = payload?.session && typeof payload.session === 'object' ? payload.session : null
  const accessToken = String(session?.accessToken || authState.accessToken || '').trim()

  authState.user = user
  authState.session = session
  authState.accessToken = accessToken
  authState.authenticated = Boolean(accessToken && user)
  authState.error = ''
  authState.ready = true

  setDashboardAccessToken(accessToken)
  if (accessToken) {
    persistAccessToken(accessToken)
  } else {
    clearPersistedAuth()
  }
  if (user) {
    applyScopeFromUser(user, payload?.scope || {})
  }
}

function clearAuthState() {
  authState.user = null
  authState.session = null
  authState.accessToken = ''
  authState.authenticated = false
  authState.error = ''
  authState.ready = true
  setDashboardAccessToken('')
  clearPersistedAuth()
}

export async function hydrateAuthSession() {
  authState.loading = true
  try {
    if (!authState.accessToken) {
      authState.ready = true
      authState.authenticated = false
      authState.user = null
      authState.session = null
      return
    }
    const payload = await controlPlaneClient.auth.me()
    applyAuthPayload(payload)
  } catch (error) {
    clearAuthState()
    authState.error = error instanceof Error ? error.message : 'Failed to restore session'
  } finally {
    authState.loading = false
    authState.ready = true
  }
}

export async function registerDashboardUser(payload = {}) {
  authState.loading = true
  try {
    const response = await controlPlaneClient.auth.register(payload)
    applyAuthPayload(response)
    return response
  } finally {
    authState.loading = false
  }
}

export async function loginDashboardUser(payload = {}) {
  authState.loading = true
  try {
    const response = await controlPlaneClient.auth.login(payload)
    applyAuthPayload(response)
    return response
  } finally {
    authState.loading = false
  }
}

export async function logoutDashboardUser() {
  authState.loading = true
  try {
    if (authState.accessToken) {
      await controlPlaneClient.auth.logout()
    }
  } catch {
    // no-op: local session must still be cleared
  } finally {
    clearAuthState()
    authState.loading = false
  }
}
