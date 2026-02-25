<script setup>
import { computed, ref } from 'vue'
import { controlPlaneClient } from '../api/control-plane-client'
import { getScopeQuery } from '../state/scope-state'

const activeTab = ref('javascript')
const copyState = ref('')
const verifyLoading = ref(false)
const verifyError = ref('')
const verifyResult = ref(null)

const envSnippet = `MEDIATION_API_BASE_URL=https://api.example.com
MEDIATION_API_KEY=<issued_api_key>
APP_ID=<your_app_id>
PLACEMENT_ID=chat_from_answer_v1`

const examples = {
  javascript: `const baseUrl = process.env.MEDIATION_API_BASE_URL;
const apiKey = process.env.MEDIATION_API_KEY;
const appId = process.env.APP_ID;
const placementId = process.env.PLACEMENT_ID || 'chat_from_answer_v1';

async function runQuickStart() {
  const sessionId = 'quickstart_session_001';
  const turnId = 'quickstart_turn_001';
  const query = 'Recommend waterproof running shoes';
  const answerText = 'Prioritize grip and breathable waterproof upper.';

  const configParams = new URLSearchParams({
    appId,
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

  const bidRes = await fetch(\`\${baseUrl}/api/v2/bid\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId: sessionId,
      chatId: sessionId,
      placementId,
      messages: [
        { role: 'user', content: query },
        { role: 'assistant', content: answerText }
      ]
    })
  });
  if (!bidRes.ok) {
    throw new Error(\`v2/bid failed: \${bidRes.status}\`);
  }

  const bidData = await bidRes.json();
  const requestId = String(bidData.requestId || '');
  if (!requestId) {
    throw new Error('v2/bid returned empty requestId');
  }

  const eventsRes = await fetch(\`\${baseUrl}/api/v1/sdk/events\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requestId,
      appId,
      sessionId,
      turnId,
      query,
      answerText,
      intentScore: 0.91,
      locale: 'en-US',
      kind: 'impression',
      placementId
    })
  });
  if (!eventsRes.ok) {
    throw new Error(\`events failed: \${eventsRes.status}\`);
  }

  console.log({
    requestId,
    bidMessage: bidData.message || '',
    hasBid: Boolean(bidData?.data?.bid)
  });
}

runQuickStart().catch((error) => {
  // fail-open: do not block your primary user response
  console.error('quickstart error', error);
});`,
  python: `import os
import requests

base_url = os.environ["MEDIATION_API_BASE_URL"]
api_key = os.environ["MEDIATION_API_KEY"]
app_id = os.environ["APP_ID"]
placement_id = os.environ.get("PLACEMENT_ID", "chat_from_answer_v1")

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

config = requests.get(
    f"{base_url}/api/v1/mediation/config",
    headers={"Authorization": f"Bearer {api_key}"},
    params={
        "appId": app_id,
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

session_id = "quickstart_session_001"
turn_id = "quickstart_turn_001"
query = "Recommend waterproof running shoes"
answer_text = "Prioritize grip and breathable waterproof upper."

bid = requests.post(
    f"{base_url}/api/v2/bid",
    headers=headers,
    json={
        "userId": session_id,
        "chatId": session_id,
        "placementId": placement_id,
        "messages": [
            {"role": "user", "content": query},
            {"role": "assistant", "content": answer_text}
        ]
    },
    timeout=5
)
bid.raise_for_status()
bid_json = bid.json()
request_id = str(bid_json.get("requestId", ""))
if not request_id:
    raise RuntimeError("v2/bid returned empty requestId")

event_payload = {
    "requestId": request_id,
    "appId": app_id,
    "sessionId": session_id,
    "turnId": turn_id,
    "query": query,
    "answerText": answer_text,
    "intentScore": 0.91,
    "locale": "en-US",
    "kind": "impression",
    "placementId": placement_id
}

events = requests.post(f"{base_url}/api/v1/sdk/events", headers=headers, json=event_payload, timeout=5)
events.raise_for_status()

print({"requestId": request_id, "bidMessage": bid_json.get("message", ""), "hasBid": bool((bid_json.get("data") or {}).get("bid"))})`,
  curl: `curl -sS "$MEDIATION_API_BASE_URL/api/v1/mediation/config?appId=$APP_ID&placementId=\${PLACEMENT_ID:-chat_from_answer_v1}&environment=prod&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z" \\
  -H "Authorization: Bearer $MEDIATION_API_KEY"

curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v2/bid" \\
  -H "Authorization: Bearer $MEDIATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"userId\\": \\"quickstart_session_001\\",
    \\"chatId\\": \\"quickstart_session_001\\",
    \\"placementId\\": \\"chat_from_answer_v1\\",
    \\"messages\\": [
      { \\"role\\": \\"user\\", \\"content\\": \\"Recommend waterproof running shoes\\" },
      { \\"role\\": \\"assistant\\", \\"content\\": \\"Prioritize grip and breathable waterproof upper.\\" }
    ]
  }" | tee /tmp/mediation-bid.json

REQUEST_ID=$(cat /tmp/mediation-bid.json | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d||"{}");process.stdout.write(j.requestId||"")})')

curl -sS -X POST "$MEDIATION_API_BASE_URL/api/v1/sdk/events" \\
  -H "Authorization: Bearer $MEDIATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"requestId\\": \\"$REQUEST_ID\\",
    \\"appId\\": \\"$APP_ID\\",
    \\"sessionId\\": \\"quickstart_session_001\\",
    \\"turnId\\": \\"quickstart_turn_001\\",
    \\"query\\": \\"Recommend waterproof running shoes\\",
    \\"answerText\\": \\"Prioritize grip and breathable waterproof upper.\\",
    \\"intentScore\\": 0.91,
    \\"locale\\": \\"en-US\\",
    \\"kind\\": \\"impression\\",
    \\"placementId\\": \\"chat_from_answer_v1\\"
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
    if (!String(scope.accountId || '').trim()) {
      throw new Error('Account scope is empty. Please sign in or set scope first.')
    }
    if (!String(scope.appId || '').trim()) {
      throw new Error('App scope is empty. Please set App ID in API Keys scope first.')
    }
    const payload = await controlPlaneClient.quickStart.verify({
      appId: scope.appId,
      accountId: scope.accountId,
      environment: 'prod',
      placementId: 'chat_from_answer_v1',
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
      <p class="subtitle">Runs `config -> v2/bid -> events` and returns evidence.</p>
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
        <li>`v2/bid` returns a non-empty `requestId`</li>
        <li>`v2/bid.message` is `Bid successful` or `No bid`</li>
        <li>`events` request succeeds with `{ "ok": true }`</li>
        <li>Dashboard verify panel returns evidence (`requestId/status`)</li>
        <li>Main user response remains fail-open on ads errors</li>
      </ul>
    </article>
  </section>
</template>
