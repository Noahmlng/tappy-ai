<script setup>
import { computed, reactive, ref } from 'vue'

import UiBadge from '../components/ui/UiBadge.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import LegacyNotice from '../components/ui/LegacyNotice.vue'
import UiSectionHeader from '../components/ui/UiSectionHeader.vue'
import { controlPlaneClient } from '../api/control-plane-client'
import { AGENT_TEMPLATE_ITEMS, AUTO_PR_POLICY, buildAgentTemplates } from '../lib/agent-templates'
import { validateAgentOutputContract } from '../lib/agent-output-contract'

const activeTab = ref('codex')
const copyState = ref('')
const tokenIssuing = ref(false)
const tokenError = ref('')
const tokenMeta = ref(null)
const contractOutput = ref('')
const contractValidation = ref(null)

const draft = reactive({
  appId: 'simulator-chatbot',
  environment: 'staging',
  placementId: 'chat_inline_v1',
  repoPath: '/path/to/your/repo',
  integrationToken: '<ONE_TIME_INTEGRATION_TOKEN>',
  tokenTtlMinutes: 10,
  exchangeTtlSeconds: 300,
})

const environmentOptions = ['sandbox', 'staging', 'prod']
const tabs = AGENT_TEMPLATE_ITEMS
const templates = computed(() => buildAgentTemplates({
  appId: draft.appId,
  environment: draft.environment,
  placementId: draft.placementId,
  repoPath: draft.repoPath,
  integrationToken: draft.integrationToken,
  exchangeTtlSeconds: draft.exchangeTtlSeconds,
}))

const activeSnippet = computed(() => templates.value[activeTab.value] || templates.value.codex)
const contractEvidence = computed(() => {
  const evidence = contractValidation.value?.checks?.evidence?.evidence
  return evidence ? JSON.stringify(evidence, null, 2) : ''
})
const prPolicyTone = computed(() => (AUTO_PR_POLICY.enabled ? 'warn' : 'success'))
const prPolicyLabel = computed(() => (
  AUTO_PR_POLICY.enabled ? 'auto pr on' : 'auto pr off'
))

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)
    copyState.value = 'Copied'
  } catch {
    copyState.value = 'Copy failed'
  }
  setTimeout(() => {
    copyState.value = ''
  }, 1200)
}

async function issueIntegrationToken() {
  tokenIssuing.value = true
  tokenError.value = ''
  tokenMeta.value = null

  try {
    const payload = await controlPlaneClient.agent.issueIntegrationToken({
      appId: draft.appId.trim() || 'simulator-chatbot',
      environment: draft.environment,
      placementId: draft.placementId.trim() || 'chat_inline_v1',
      ttlMinutes: Number(draft.tokenTtlMinutes) || 10,
    })
    const token = String(payload?.integrationToken || payload?.token || '').trim()
    if (token) {
      draft.integrationToken = token
    }
    tokenMeta.value = {
      tokenId: String(payload?.tokenId || ''),
      expiresAt: String(payload?.expiresAt || ''),
      ttlSeconds: Number(payload?.ttlSeconds || 0),
    }
  } catch (error) {
    tokenError.value = error instanceof Error ? error.message : 'Failed to issue integration token'
  } finally {
    tokenIssuing.value = false
  }
}

function runContractValidation() {
  contractValidation.value = validateAgentOutputContract(contractOutput.value)
}

function contractCheckTone(ok) {
  return ok ? 'success' : 'error'
}
</script>

<template>
  <section class="page">
    <LegacyNotice />

    <UiSectionHeader
      eyebrow="Agent Onboarding"
      title="Agent Onboarding"
      subtitle="Generate one-command onboarding instructions for Codex, CloudCode, and Cursor."
    />

    <UiCard class="create-key-form">
      <h3>Input</h3>
      <div class="form-grid">
        <label>
          App ID
          <input v-model="draft.appId" class="input" type="text" maxlength="64">
        </label>
        <label>
          Environment
          <select v-model="draft.environment" class="input">
            <option v-for="env in environmentOptions" :key="env" :value="env">
              {{ env }}
            </option>
          </select>
        </label>
        <label>
          Placement ID
          <input v-model="draft.placementId" class="input" type="text" maxlength="64">
        </label>
        <label>
          Repo Path
          <input v-model="draft.repoPath" class="input" type="text">
        </label>
        <label style="grid-column: 1 / -1;">
          One-time Integration Token
          <input v-model="draft.integrationToken" class="input" type="text">
        </label>
        <label>
          Token TTL (minutes)
          <select v-model.number="draft.tokenTtlMinutes" class="input">
            <option :value="10">10</option>
            <option :value="11">11</option>
            <option :value="12">12</option>
            <option :value="13">13</option>
            <option :value="14">14</option>
            <option :value="15">15</option>
          </select>
        </label>
        <label>
          Exchange TTL (seconds)
          <select v-model.number="draft.exchangeTtlSeconds" class="input">
            <option :value="120">120</option>
            <option :value="180">180</option>
            <option :value="300">300</option>
            <option :value="600">600</option>
            <option :value="900">900</option>
          </select>
        </label>
      </div>
      <div class="toolbar-actions">
        <UiButton :disabled="tokenIssuing" @click="issueIntegrationToken">
          {{ tokenIssuing ? 'Issuing...' : 'Issue one-time token' }}
        </UiButton>
      </div>
      <p v-if="tokenError" class="muted">{{ tokenError }}</p>
      <p v-if="tokenMeta" class="muted">
        Token issued: <code>{{ tokenMeta.tokenId }}</code>
        · expires {{ tokenMeta.expiresAt ? new Date(tokenMeta.expiresAt).toLocaleString() : '-' }}
        · ttl {{ tokenMeta.ttlSeconds }}s
      </p>
      <p class="muted">
        Agent-first flow should use one-time token only. Long-lived API key must not be pasted in prompt.
      </p>
    </UiCard>

    <UiCard>
      <div class="panel-toolbar">
        <h3>Instruction Template</h3>
        <UiButton @click="copyText(activeSnippet)">Copy template</UiButton>
      </div>
      <div class="tab-list" role="tablist" aria-label="Agent tabs">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          class="tab-button"
          :class="{ active: activeTab === item.id }"
          @click="activeTab = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <pre class="code-block">{{ activeSnippet }}</pre>
      <p v-if="copyState" class="copy-note">{{ copyState }}</p>
    </UiCard>

    <UiCard>
      <div class="panel-head">
        <h3>PR Policy</h3>
        <UiBadge :tone="prPolicyTone">{{ prPolicyLabel }}</UiBadge>
      </div>
      <p class="subtitle">{{ AUTO_PR_POLICY.summary }}</p>
      <ul class="checklist">
        <li v-for="rule in AUTO_PR_POLICY.rules" :key="rule">
          {{ rule }}
        </li>
      </ul>
      <p class="muted">Required output line: <code>{{ AUTO_PR_POLICY.acknowledgement }}</code></p>
    </UiCard>

    <UiCard>
      <h3>Output Contract</h3>
      <ul class="checklist">
        <li>Patch only, no auto PR submission.</li>
        <li>Must run `token exchange -> config -> evaluate -> events` smoke.</li>
        <li>Evidence includes `requestId`, `decisionResult`, and `eventsOk`.</li>
        <li>Fail-open is explicitly preserved.</li>
        <li>{{ AUTO_PR_POLICY.acknowledgement }}</li>
      </ul>
    </UiCard>

    <UiCard>
      <div class="panel-toolbar">
        <h3>Output Contract Validator</h3>
        <UiButton @click="runContractValidation">Validate output</UiButton>
      </div>
      <p class="subtitle">
        Paste agent final output and validate `files + smoke + evidence` in one check.
      </p>
      <textarea
        v-model="contractOutput"
        class="textarea-input"
        rows="14"
        placeholder="Paste final agent output here"
      />

      <div v-if="contractValidation" class="status-grid">
        <p>
          <UiBadge :tone="contractValidation.ok ? 'success' : 'error'">
            {{ contractValidation.ok ? 'pass' : 'fail' }}
          </UiBadge>
          Score {{ contractValidation.score }}
        </p>
        <p>
          <UiBadge :tone="contractCheckTone(contractValidation.checks.files.ok)">files</UiBadge>
          {{ contractValidation.checks.files.message }}
        </p>
        <p>
          <UiBadge :tone="contractCheckTone(contractValidation.checks.smoke.ok)">smoke</UiBadge>
          {{ contractValidation.checks.smoke.message }}
        </p>
        <p>
          <UiBadge :tone="contractCheckTone(contractValidation.checks.evidence.ok)">evidence</UiBadge>
          {{ contractValidation.checks.evidence.message }}
        </p>
        <p>
          <UiBadge :tone="contractCheckTone(contractValidation.checks.prPolicy.ok)">pr policy</UiBadge>
          {{ contractValidation.checks.prPolicy.message }}
        </p>
        <div v-if="contractValidation.checks.files.files.length">
          <p class="muted">Detected files</p>
          <pre class="code-block">{{ contractValidation.checks.files.files.join('\n') }}</pre>
        </div>
        <div v-if="contractEvidence">
          <p class="muted">Parsed evidence</p>
          <pre class="code-block">{{ contractEvidence }}</pre>
        </div>
        <div v-if="contractValidation.checks.prPolicy.matches.length">
          <p class="muted">PR policy matches</p>
          <pre class="code-block">{{ contractValidation.checks.prPolicy.matches.join('\n') }}</pre>
        </div>
      </div>
    </UiCard>
  </section>
</template>
