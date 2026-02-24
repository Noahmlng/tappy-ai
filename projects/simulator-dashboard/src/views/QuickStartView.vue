<script setup>
import { computed, ref } from 'vue'
import { controlPlaneClient } from '../api/control-plane-client'
import { getScopeQuery } from '../state/scope-state'

const activeTab = ref('javascript')
const copyState = ref('')
const verifyLoading = ref(false)
const verifyError = ref('')
const verifyResult = ref(null)

const envSnippet = `MEDIATION_API_BASE_URL=https://api.<env>.example.com
MEDIATION_API_KEY=<issued_api_key>
PLACEMENT_ID=chat_inline_v1`

const examples = {
  javascript: `const baseUrl = process.env.MEDIATION_API_BASE_URL;
const apiKey = process.env.MEDIATION_API_KEY;
const placementId = process.env.PLACEMENT_ID || 'chat_inline_v1';

async function runQuickStart() {
  const configParams = new URLSearchParams({
    placementId,
    environment: 'prod',
    schemaVersion: 'schema_v1',
    sdkVersion: '1.0.0',
    requestAt: new Date().toISOString()
  });
  const configRes = await fetch(\`\${baseUrl}/api/v1/mediation/config?\${configParams.toString()}\`, {
    headers: {
      'Authorization': \`Bearer \${apiKey}\`
    }
  });
  if (![200, 304].includes(configRes.status)) {
    throw new Error(\`config failed: \${configRes.status}\`);
  }

  const evaluateRes = await fetch(\`\${baseUrl}/api/v1/sdk/evaluate\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sessionId: 'quickstart_session_001',
      turnId: 'quickstart_turn_001',
      query: 'Recommend waterproof running shoes',
      answerText: 'Prioritize grip and breathable waterproof upper.',
      intentScore: 0.91,
      locale: 'en-US'
    })
  });
  if (!evaluateRes.ok) {
    throw new Error(\`evaluate failed: \${evaluateRes.status}\`);
  }

  const evaluateData = await evaluateRes.json();
  const requestId = evaluateData.requestId;

  const eventsRes = await fetch(\`\${baseUrl}/api/v1/sdk/events\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requestId,
      sessionId: 'quickstart_session_001',
      turnId: 'quickstart_turn_001',
      query: 'Recommend waterproof running shoes',
      answerText: 'Prioritize grip and breathable waterproof upper.',
      intentScore: 0.91,
      locale: 'en-US'
    })
  });
  if (!eventsRes.ok) {
    throw new Error(\`events failed: \${eventsRes.status}\`);
  }

  console.log({ requestId, result: evaluateData.decision?.result });
}

runQuickStart().catch((error) => {
  // fail-open: do not block your primary user response
  console.error('quickstart error', error);
});`,
  python: `import os
import requests

base_url = os.environ["MEDIATION_API_BASE_URL"]
api_key = os.environ["MEDIATION_API_KEY"]
placement_id = os.environ.get("PLACEMENT_ID", "chat_inline_v1")

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

config = requests.get(
    f"{base_url}/api/v1/mediation/config",
    headers={"Authorization": f"Bearer {api_key}"},
    params={
        "placementId": placement_id,
        "environment": "prod",
        "schemaVersion": "schema_v1",
        "sdkVersion": "1.0.0",
        "requestAt": "2026-02-22T00:00:00.000Z"
    },
    timeout=5
)
if config.status_code not in (200, 304):
    raise RuntimeError(f"config failed: {config.status_code}")

payload = {
    "sessionId": "quickstart_session_001",
    "turnId": "quickstart_turn_001",
    "query": "Recommend waterproof running shoes",
    "answerText": "Prioritize grip and breathable waterproof upper.",
    "intentScore": 0.91,
    "locale": "en-US"
}

evaluate = requests.post(f"{base_url}/api/v1/sdk/evaluate", headers=headers, json=payload, timeout=5)
evaluate.raise_for_status()
evaluate_json = evaluate.json()
request_id = evaluate_json.get("requestId")

event_payload = dict(payload)
event_payload["requestId"] = request_id

events = requests.post(f"{base_url}/api/v1/sdk/events", headers=headers, json=event_payload, timeout=5)
events.raise_for_status()

print({"requestId": request_id, "result": evaluate_json.get("decision", {}).get("result")})`,
  curl: `curl -sS "$MEDIATION_API_BASE_URL/api/v1/mediation/config?placementId=\${PLACEMENT_ID:-chat_inline_v1}&environment=prod&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z" \\
  -H "Authorization: Bearer $MEDIATION_API_KEY"

curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/evaluate" \\
  -H "Authorization: Bearer $MEDIATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"sessionId\\": \\"quickstart_session_001\\",
    \\"turnId\\": \\"quickstart_turn_001\\",
    \\"query\\": \\"Recommend waterproof running shoes\\",
    \\"answerText\\": \\"Prioritize grip and breathable waterproof upper.\\",
    \\"intentScore\\": 0.91,
    \\"locale\\": \\"en-US\\"
  }" | tee /tmp/mediation-eval.json

REQUEST_ID=$(cat /tmp/mediation-eval.json | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d||"{}");process.stdout.write(j.requestId||"")})')

curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/events" \\
  -H "Authorization: Bearer $MEDIATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"requestId\\": \\"$REQUEST_ID\\",
    \\"sessionId\\": \\"quickstart_session_001\\",
    \\"turnId\\": \\"quickstart_turn_001\\",
    \\"query\\": \\"Recommend waterproof running shoes\\",
    \\"answerText\\": \\"Prioritize grip and breathable waterproof upper.\\",
    \\"intentScore\\": 0.91,
    \\"locale\\": \\"en-US\\"
  }"`
}

const snippet = computed(() => examples[activeTab.value] || examples.javascript)

const tabs = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'curl', label: 'cURL' },
]

const verifyEvidence = computed(() => (
  verifyResult.value ? JSON.stringify(verifyResult.value, null, 2) : ''
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

async function runQuickStartVerifier() {
  verifyLoading.value = true
  verifyError.value = ''
  verifyResult.value = null

  try {
    const scope = getScopeQuery()
    const payload = await controlPlaneClient.quickStart.verify({
      appId: scope.appId,
      accountId: scope.accountId,
      environment: 'staging',
      placementId: 'chat_inline_v1',
    })
    verifyResult.value = payload
  } catch (error) {
    verifyError.value = error instanceof Error ? error.message : 'Verifier failed'
  } finally {
    verifyLoading.value = false
  }
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Onboarding</p>
      <h2>Quick Start</h2>
      <p class="subtitle">
        Run your first production-style integration call in minutes.
      </p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Step 1: Prepare env</h3>
        <button class="button" type="button" @click="copyText(envSnippet)">
          Copy env
        </button>
      </div>
      <pre class="code-block">{{ envSnippet }}</pre>
    </article>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Step 2: Run minimal client call</h3>
        <button class="button" type="button" @click="copyText(snippet)">
          Copy snippet
        </button>
      </div>

      <div class="tab-list" role="tablist" aria-label="Quickstart language tabs">
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

      <pre class="code-block">{{ snippet }}</pre>
      <p v-if="copyState" class="copy-note">{{ copyState }}</p>
    </article>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Step 3: Verify in dashboard</h3>
        <button class="button" type="button" :disabled="verifyLoading" @click="runQuickStartVerifier">
          {{ verifyLoading ? 'Verifying...' : 'Run verify' }}
        </button>
      </div>
      <p class="subtitle">Runs `config -> evaluate -> events` and returns evidence.</p>
      <p v-if="verifyError" class="muted">{{ verifyError }}</p>
      <div v-if="verifyResult">
        <p><strong>requestId:</strong> <code>{{ verifyResult.requestId || '-' }}</code></p>
        <p><strong>status:</strong> <code>{{ verifyResult.status || '-' }}</code></p>
        <pre class="code-block">{{ verifyEvidence }}</pre>
      </div>
    </article>

    <article class="panel">
      <h3>Pass criteria</h3>
      <ul class="checklist">
        <li>`config` returns `200` or `304`</li>
        <li>`evaluate` returns a non-empty `requestId`</li>
        <li>`decision.result` exists (`served|blocked|no_fill|error`)</li>
        <li>`events` request succeeds with `{ "ok": true }`</li>
        <li>Dashboard verify panel returns evidence (`requestId/status`)</li>
        <li>Main user response remains fail-open on ads errors</li>
      </ul>
    </article>
  </section>
</template>
