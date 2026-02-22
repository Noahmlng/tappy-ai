<script setup>
import { computed, reactive, ref } from 'vue'

const activeTab = ref('codex')
const copyState = ref('')

const draft = reactive({
  appId: 'simulator-chatbot',
  environment: 'staging',
  placementId: 'chat_inline_v1',
  repoPath: '/path/to/your/repo',
  integrationToken: '<ONE_TIME_INTEGRATION_TOKEN>',
})

const environmentOptions = ['sandbox', 'staging', 'prod']
const tabs = [
  { id: 'codex', label: 'Codex' },
  { id: 'cloudcode', label: 'CloudCode' },
  { id: 'cursor', label: 'Cursor' },
]

function buildSharedInstruction() {
  return [
    `App ID: ${draft.appId.trim() || 'simulator-chatbot'}`,
    `Environment: ${draft.environment}`,
    `Placement ID: ${draft.placementId.trim() || 'chat_inline_v1'}`,
    `Repo: ${draft.repoPath.trim() || '/path/to/your/repo'}`,
    '',
    'Rules:',
    '1. Use only public production-ready API path:',
    '   - GET /api/v1/mediation/config',
    '   - POST /api/v1/sdk/evaluate',
    '   - POST /api/v1/sdk/events',
    '2. Never call internal endpoints: /api/v1/dashboard/*, /api/v1/dev/*.',
    `3. Use one-time token only: ${draft.integrationToken.trim() || '<ONE_TIME_INTEGRATION_TOKEN>'}.`,
    '4. Keep fail-open behavior: ad call failure must not block primary response.',
    '5. Do not auto-submit PR; output patch + run steps + evidence only.',
    '',
    'Deliverables:',
    '1. Minimal integration patch (config -> evaluate -> events).',
    '2. Smoke run command.',
    '3. Evidence JSON: requestId, decision.result, events.ok.',
  ].join('\n')
}

const templates = computed(() => {
  const shared = buildSharedInstruction()
  const envVars = [
    `MEDIATION_API_BASE_URL=https://api.${draft.environment}.example.com`,
    `INTEGRATION_TOKEN=${draft.integrationToken.trim() || '<ONE_TIME_INTEGRATION_TOKEN>'}`,
    `APP_ID=${draft.appId.trim() || 'simulator-chatbot'}`,
    `PLACEMENT_ID=${draft.placementId.trim() || 'chat_inline_v1'}`,
  ].join('\n')

  return {
    codex: `Use this exact task:\n\n${shared}\n\nRunbook:\n1. Open repo at ${draft.repoPath.trim() || '/path/to/your/repo'}.\n2. Add env template:\n${envVars}\n3. Implement a single helper to call config -> evaluate -> events.\n4. Fail-open wrapper: return primary response when ad request fails.\n5. Run smoke curl and print evidence JSON.\n`,
    cloudcode: `Task for CloudCode agent:\n\n${shared}\n\nExecution plan:\n1. Prepare .env with:\n${envVars}\n2. Generate minimal server-side integration code.\n3. Add smoke script that prints requestId + decision.result + events.ok.\n4. Stop at patch and command output; do not auto-open PR.\n`,
    cursor: `Cursor instruction block:\n\n${shared}\n\nRequired output format:\n1. Files changed\n2. Commands executed\n3. Smoke evidence JSON\n4. Risk notes (if any)\n\nContext vars:\n${envVars}\n`,
  }
})

const activeSnippet = computed(() => templates.value[activeTab.value] || templates.value.codex)

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
</script>

<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Agent Onboarding</p>
      <h2>Agent Onboarding</h2>
      <p class="subtitle">
        Generate one-command onboarding instructions for Codex, CloudCode, and Cursor.
      </p>
    </header>

    <article class="panel create-key-form">
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
      </div>
      <p class="muted">
        Agent-first flow should use one-time token only. Long-lived API key must not be pasted in prompt.
      </p>
    </article>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Instruction Template</h3>
        <button class="button" type="button" @click="copyText(activeSnippet)">
          Copy template
        </button>
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
    </article>

    <article class="panel">
      <h3>Output Contract</h3>
      <ul class="checklist">
        <li>Patch only, no auto PR submission.</li>
        <li>Public endpoint chain must be `config -> evaluate -> events`.</li>
        <li>Evidence includes `requestId`, `decision.result`, and `events.ok`.</li>
        <li>Fail-open is explicitly preserved.</li>
      </ul>
    </article>
  </section>
</template>
