import { reactive } from 'vue'

const STORAGE_KEY = 'ai-network-simulator-dashboard-scope-v1'
const DEFAULT_SCOPE = Object.freeze({
  appId: 'simulator-chatbot',
  accountId: 'org_simulator',
})

function cleanText(value) {
  return String(value || '').trim()
}

function normalizeScope(input = {}) {
  const appId = cleanText(input.appId || DEFAULT_SCOPE.appId)
  const accountId = cleanText(input.accountId || DEFAULT_SCOPE.accountId)
  return {
    appId: appId || DEFAULT_SCOPE.appId,
    accountId: accountId || DEFAULT_SCOPE.accountId,
  }
}

function loadScope() {
  if (typeof window === 'undefined') return normalizeScope(DEFAULT_SCOPE)
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return normalizeScope(DEFAULT_SCOPE)
  try {
    return normalizeScope(JSON.parse(raw))
  } catch {
    return normalizeScope(DEFAULT_SCOPE)
  }
}

function persistScope() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      appId: scopeState.appId,
      accountId: scopeState.accountId,
    }),
  )
}

const initialScope = loadScope()

export const scopeState = reactive({
  appId: initialScope.appId,
  accountId: initialScope.accountId,
})

export function getScopeQuery() {
  return {
    appId: cleanText(scopeState.appId),
    accountId: cleanText(scopeState.accountId),
  }
}

export function setScope(input = {}) {
  const next = normalizeScope({
    appId: input.appId ?? scopeState.appId,
    accountId: input.accountId ?? scopeState.accountId,
  })
  scopeState.appId = next.appId
  scopeState.accountId = next.accountId
  persistScope()
}
