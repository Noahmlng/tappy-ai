<script setup>
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { hydrateDashboardState } from '../state/dashboard-state'
import { authState, loginDashboardUser } from '../state/auth-state'

const router = useRouter()
const route = useRoute()
const submitError = ref('')

const draft = reactive({
  email: '',
  password: '',
})

const isBusy = computed(() => Boolean(authState.loading))

async function handleLogin() {
  submitError.value = ''
  try {
    await loginDashboardUser({
      email: draft.email,
      password: draft.password,
    })
    await hydrateDashboardState()
    const redirect = String(route.query.redirect || '/home')
    await router.replace(redirect)
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : 'Login failed'
  }
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Customer Access</p>
      <h2>Sign In</h2>
      <p class="subtitle">
        Sign in to manage revenue, keys, config, and logs.
      </p>
    </header>

    <article class="panel">
      <div class="form-grid">
        <label>
          Email
          <input v-model="draft.email" class="input" type="email" maxlength="120" autocomplete="username">
        </label>
        <label>
          Password
          <input
            v-model="draft.password"
            class="input"
            type="password"
            maxlength="120"
            autocomplete="current-password"
          >
        </label>
      </div>
      <div class="toolbar-actions">
        <button
          class="button"
          type="button"
          :disabled="isBusy || !draft.email.trim() || !draft.password"
          @click="handleLogin"
        >
          {{ isBusy ? 'Signing in...' : 'Sign In' }}
        </button>
        <RouterLink class="button button-secondary" to="/register">
          Create account
        </RouterLink>
      </div>
      <p v-if="submitError || authState.error" class="muted">
        {{ submitError || authState.error }}
      </p>
    </article>
  </section>
</template>
