export const AGENT_TEMPLATE_ITEMS = Object.freeze([
  { id: 'codex', label: 'Codex' },
  { id: 'cloudcode', label: 'CloudCode' },
  { id: 'cursor', label: 'Cursor' },
])

export const AUTO_PR_POLICY = Object.freeze({
  enabled: false,
  label: 'OFF',
  summary: 'Patch-only handoff. Agent must not open or auto-submit PR.',
  acknowledgement: 'PR action: skipped (auto PR disabled).',
  rules: Object.freeze([
    'Auto-submit PR is OFF by default and cannot be enabled in v1.',
    'Do not run PR automation commands (`gh pr create`, `hub pull-request`).',
    'Stop at patch + commands + smoke evidence; hand over to developer for PR timing.',
  ]),
})

function text(value, fallback) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function normalizeInput(input = {}) {
  return {
    environment: 'prod',
    appId: text(input.appId, '<APP_ID>'),
    placementId: text(input.placementId, 'chat_from_answer_v1'),
    repoPath: text(input.repoPath, '/path/to/your/repo'),
    integrationToken: text(input.integrationToken, '<ONE_TIME_INTEGRATION_TOKEN>'),
    exchangeTtlSeconds: Number.isFinite(Number(input.exchangeTtlSeconds))
      ? Math.max(60, Math.min(900, Math.floor(Number(input.exchangeTtlSeconds))))
      : 300,
  }
}

function buildEnvBlock(input) {
  return [
    'MEDIATION_CONTROL_PLANE_API_BASE_URL=https://control-plane.example.com',
    'MEDIATION_RUNTIME_API_BASE_URL=https://runtime.example.com',
    `APP_ID=${input.appId}`,
    `PLACEMENT_ID=${input.placementId}`,
    `INTEGRATION_TOKEN=${input.integrationToken}`,
  ].join('\n')
}

function buildSmokeRunbook(input) {
  return [
    'Smoke run (must execute and keep output):',
    '1. Exchange one-time integration token to short-lived access token.',
    '2. Run config -> v2/bid -> events with access token.',
    '3. Print evidence JSON.',
    '',
    "EXCHANGE_JSON=$(curl -sS -X POST \"$MEDIATION_CONTROL_PLANE_API_BASE_URL/api/v1/public/agent/token-exchange\" \\",
    '  -H "Content-Type: application/json" \\',
    `  -d "{\"integrationToken\":\"$INTEGRATION_TOKEN\",\"ttlSeconds\":${input.exchangeTtlSeconds}}")`,
    '',
    "ACCESS_TOKEN=$(echo \"$EXCHANGE_JSON\" | node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{const j=JSON.parse(d||\"{}\");process.stdout.write(j.accessToken||\"\")})')",
    'test -n "$ACCESS_TOKEN" || (echo "token exchange failed"; exit 1)',
    '',
    "curl -sS \"$MEDIATION_RUNTIME_API_BASE_URL/api/v1/mediation/config?appId=$APP_ID&placementId=$PLACEMENT_ID&environment="
      + `${input.environment}&schemaVersion=schema_v1&sdkVersion=1.0.0&requestAt=2026-02-22T00:00:00.000Z\" \\`,
    '  -H "Authorization: Bearer $ACCESS_TOKEN" >/tmp/agent-config.json',
    '',
    "BID_JSON=$(curl -sS -X POST \"$MEDIATION_RUNTIME_API_BASE_URL/api/v2/bid\" \\",
    '  -H "Authorization: Bearer $ACCESS_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d \"{\\\"userId\\\":\\\"agent_smoke_session_001\\\",\\\"chatId\\\":\\\"agent_smoke_session_001\\\",\\\"placementId\\\":\\\"$PLACEMENT_ID\\\",\\\"messages\\\":[{\\\"role\\\":\\\"user\\\",\\\"content\\\":\\\"Recommend waterproof running shoes\\\"},{\\\"role\\\":\\\"assistant\\\",\\\"content\\\":\\\"Prioritize grip and breathable waterproof upper.\\\"}]}\")",
    '',
    "REQUEST_ID=$(echo \"$BID_JSON\" | node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{const j=JSON.parse(d||\"{}\");process.stdout.write(j.requestId||\"\")})')",
    'test -n "$REQUEST_ID" || (echo "v2/bid failed"; exit 1)',
    '',
    "EVENTS_JSON=$(curl -sS -X POST \"$MEDIATION_RUNTIME_API_BASE_URL/api/v1/sdk/events\" \\",
    '  -H "Authorization: Bearer $ACCESS_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d \"{\\\"requestId\\\":\\\"$REQUEST_ID\\\",\\\"appId\\\":\\\"$APP_ID\\\",\\\"sessionId\\\":\\\"agent_smoke_session_001\\\",\\\"turnId\\\":\\\"agent_smoke_turn_001\\\",\\\"query\\\":\\\"Recommend waterproof running shoes\\\",\\\"answerText\\\":\\\"Prioritize grip and breathable waterproof upper.\\\",\\\"intentScore\\\":0.91,\\\"locale\\\":\\\"en-US\\\",\\\"kind\\\":\\\"impression\\\",\\\"placementId\\\":\\\"$PLACEMENT_ID\\\"}\")",
    '',
    "node -e 'const bidJson=JSON.parse(process.argv[1]||\"{}\"); const eventsJson=JSON.parse(process.argv[2]||\"{}\"); const hasBid=Boolean(bidJson?.data?.bid); console.log(JSON.stringify({requestId: bidJson.requestId||\"\", decisionResult: hasBid ? \"served\" : \"no_fill\", eventsOk: Boolean(eventsJson?.ok), bidMessage: bidJson.message||\"\"}, null, 2));' \"$BID_JSON\" \"$EVENTS_JSON\"",
  ].join('\n')
}

function buildSharedInstruction(input) {
  return [
    `Environment: ${input.environment}`,
    `Placement ID: ${input.placementId}`,
    `Repo: ${input.repoPath}`,
    '',
    'Hard rules:',
    '1. Do not use long-lived API key in prompt or code.',
    '2. Only use public production-ready network endpoints.',
    '3. Never call /api/v1/dashboard/* or /api/v1/dev/*.',
    '4. Keep fail-open: ad failure must not block primary response.',
    `5. Auto-submit PR: ${AUTO_PR_POLICY.label} (hard rule).`,
    '6. Never execute PR automation commands (`gh pr create`, `hub pull-request`).',
    '',
    'Required output:',
    '1. Changed files list.',
    '2. Commands executed.',
    '3. Smoke evidence JSON: requestId, decisionResult, eventsOk.',
    `4. ${AUTO_PR_POLICY.acknowledgement}`,
  ].join('\n')
}

export function buildAgentTemplates(rawInput = {}) {
  const input = normalizeInput(rawInput)
  const shared = buildSharedInstruction(input)
  const envBlock = buildEnvBlock(input)
  const smokeRunbook = buildSmokeRunbook(input)

  return {
    codex: [
      'Use this exact task for Codex:',
      '',
      shared,
      '',
      'Execution:',
      `1. Open repo: ${input.repoPath}`,
      `2. Prepare env:\n${envBlock}`,
      '3. Implement minimal server-side integration helper: config -> v2/bid -> events.',
      '4. Keep primary response fail-open.',
      `5. Run smoke:\n${smokeRunbook}`,
    ].join('\n'),
    cloudcode: [
      'Task for CloudCode agent:',
      '',
      shared,
      '',
      'Execution:',
      `1. Open repo: ${input.repoPath}`,
      `2. Prepare env:\n${envBlock}`,
      '3. Generate minimal integration patch with one helper function.',
      '4. Print smoke command output and evidence.',
      `5. Required smoke:\n${smokeRunbook}`,
    ].join('\n'),
    cursor: [
      'Instruction block for Cursor agent:',
      '',
      shared,
      '',
      'Execution:',
      `1. Open repo: ${input.repoPath}`,
      `2. Prepare env:\n${envBlock}`,
      '3. Implement patch only (no PR action).',
      '4. Return evidence in JSON section.',
      `5. Required smoke:\n${smokeRunbook}`,
    ].join('\n'),
  }
}
