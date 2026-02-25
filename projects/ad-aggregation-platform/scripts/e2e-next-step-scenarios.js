import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'src/devtools/simulator/simulator-gateway.js')
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3213
const HEALTH_CHECK_TIMEOUT_MS = 15000
const REQUEST_TIMEOUT_MS = 8000

function parseArgs(argv) {
  const options = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const index = arg.indexOf('=')
    if (index < 0) {
      options[arg.slice(2)] = 'true'
      continue
    }
    options[arg.slice(2, index)] = arg.slice(index + 1)
  }
  return options
}

function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

function toInteger(value, fallback) {
  const num = Number(value)
  if (Number.isFinite(num)) return Math.floor(num)
  return fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const timeout = withTimeoutSignal(options.timeoutMs || REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: timeout.signal,
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error?.message || `HTTP_${response.status}`)
    }
    return payload
  } finally {
    timeout.clear()
  }
}

function buildBasePayload(name) {
  const now = Date.now()
  return {
    appId: 'simulator-chatbot',
    sessionId: `e2e_${name}_${now}`,
    turnId: `turn_${name}_${now}`,
    userId: `user_${name}`,
    event: 'followup_generation',
    placementId: 'chat_intent_recommendation_v1',
    placementKey: 'next_step.intent_card',
    context: {
      query: '',
      answerText: '',
      locale: 'en-US',
      intent_class: 'shopping',
      intent_score: 0.9,
      preference_facets: [],
    },
  }
}

function buildScenarioPayload(name) {
  const payload = buildBasePayload(name)

  if (name === 'shopping') {
    payload.context.query = 'I want to buy a running shoe for daily gym training'
    payload.context.answerText = 'You can compare running shoes by cushioning and durability.'
    payload.context.intent_class = 'shopping'
    payload.context.intent_score = 0.92
    payload.context.preference_facets = [
      { facet_key: 'use_case', facet_value: 'daily gym', confidence: 0.8, source: 'user_query' },
      { facet_key: 'price', facet_value: 'mid range', confidence: 0.7, source: 'user_query' },
    ]
    return payload
  }

  if (name === 'gifting_preference') {
    payload.context.query = 'My girlfriend likes colorful materials, suggest a gift.'
    payload.context.answerText = 'You can consider scarves, tote bags, or floral accessories.'
    payload.context.intent_class = 'gifting'
    payload.context.intent_score = 0.9
    payload.context.preference_facets = [
      { facet_key: 'recipient', facet_value: 'girlfriend', confidence: 0.95, source: 'user_query' },
      { facet_key: 'material', facet_value: 'colorful', confidence: 0.82, source: 'user_query' },
    ]
    return payload
  }

  if (name === 'non_commercial') {
    payload.context.query = 'Explain why the sky is blue in simple physics terms.'
    payload.context.answerText = 'Rayleigh scattering causes shorter wavelengths to scatter more.'
    payload.context.intent_class = 'non_commercial'
    payload.context.intent_score = 0.93
    payload.context.preference_facets = []
    return payload
  }

  if (name === 'sensitive_topic') {
    payload.context.query = 'I need medical diagnosis advice and medicine recommendations.'
    payload.context.answerText = 'For diagnosis you should consult a licensed doctor.'
    payload.context.intent_class = 'shopping'
    payload.context.intent_score = 0.9
    payload.context.preference_facets = [
      { facet_key: 'use_case', facet_value: 'medical', confidence: 0.8, source: 'user_query' },
    ]
    return payload
  }

  throw new Error(`Unknown scenario: ${name}`)
}

function evaluateScenarioResult(response) {
  const requestId = String(response?.requestId || '')
  const status = String(response?.status || '')
  if (!requestId) {
    return { ok: false, reason: 'missing_requestId' }
  }
  if (status !== 'success') {
    return { ok: false, reason: `unexpected_status:${status}` }
  }
  return { ok: true, reason: response?.data?.bid ? 'served' : 'no_fill' }
}

async function waitForGateway(baseUrl) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < HEALTH_CHECK_TIMEOUT_MS) {
    try {
      const response = await requestJson(baseUrl, '/api/health', { timeoutMs: 1200 })
      if (response?.ok) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`Gateway health check timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`)
}

function startGatewayProcess(port) {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', GATEWAY_ENTRY], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SIMULATOR_GATEWAY_HOST: DEFAULT_HOST,
      SIMULATOR_GATEWAY_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  return child
}

async function runScenario(baseUrl, name) {
  const scenarioPayload = buildScenarioPayload(name)
  const bidPayload = {
    userId: scenarioPayload.userId,
    chatId: scenarioPayload.sessionId,
    placementId: scenarioPayload.placementId,
    messages: [
      { role: 'user', content: String(scenarioPayload.context?.query || '') },
      { role: 'assistant', content: String(scenarioPayload.context?.answerText || '') },
    ],
  }
  const bidResponse = await requestJson(baseUrl, '/api/v2/bid', {
    method: 'POST',
    body: bidPayload,
  })

  const check = evaluateScenarioResult(bidResponse)
  if (!check.ok) {
    return {
      name,
      ok: false,
      stage: 'v2_bid',
      reason: check.reason,
      requestId: String(bidResponse?.requestId || ''),
      status: String(bidResponse?.status || ''),
    }
  }

  const requestId = String(bidResponse.requestId || '')
  const servedAdId = String(bidResponse?.data?.bid?.bidId || '')
  if (servedAdId) {
    const eventPayload = {
      appId: 'simulator-chatbot',
      sessionId: scenarioPayload.sessionId,
      turnId: scenarioPayload.turnId,
      query: String(scenarioPayload.context?.query || ''),
      answerText: String(scenarioPayload.context?.answerText || ''),
      intentScore: Number(scenarioPayload.context?.intent_score || 0),
      locale: String(scenarioPayload.context?.locale || 'en-US'),
      placementId: scenarioPayload.placementId,
      requestId,
      kind: 'impression',
      adId: servedAdId,
    }
    await requestJson(baseUrl, '/api/v1/sdk/events', {
      method: 'POST',
      body: eventPayload,
    })
  }

  const decisions = await requestJson(
    baseUrl,
    `/api/v1/dashboard/decisions?requestId=${encodeURIComponent(requestId)}`,
  )
  const events = await requestJson(
    baseUrl,
    `/api/v1/dashboard/events?requestId=${encodeURIComponent(requestId)}`,
  )

  const decisionRows = Array.isArray(decisions?.items) ? decisions.items : []
  const eventRows = Array.isArray(events?.items) ? events.items : []
  const matchedDecision = decisionRows.find((item) => String(item?.requestId || '') === requestId)
  const decisionEvent = eventRows.find((item) => item?.eventType === 'decision')
  const sdkEvent = eventRows.find((item) => item?.eventType === 'sdk_event')

  if (!matchedDecision) {
    return { name, ok: false, stage: 'decision_log', reason: 'decision_not_found', requestId }
  }
  if (!decisionEvent) {
    return { name, ok: false, stage: 'event_log', reason: 'decision_event_not_found', requestId }
  }
  if (servedAdId && !sdkEvent) {
    return { name, ok: false, stage: 'event_log', reason: 'sdk_event_not_found', requestId }
  }

  return {
    name,
    ok: true,
    stage: 'done',
    reason: check.reason,
    requestId,
    result: servedAdId ? 'served' : 'no_fill',
    reasonDetail: String(bidResponse?.message || ''),
    decisionLogResult: String(matchedDecision?.result || ''),
  }
}

async function ensureNextStepPlacementEnabled(baseUrl) {
  const placementsPayload = await requestJson(baseUrl, '/api/v1/dashboard/placements')
  const placements = Array.isArray(placementsPayload?.placements) ? placementsPayload.placements : []
  const placement = placements.find((item) => {
    const placementKey = String(item?.placementKey || '').trim()
    const placementId = String(item?.placementId || '').trim()
    return placementKey === 'next_step.intent_card' || placementId === 'chat_intent_recommendation_v1'
  })

  if (!placement || !placement.placementId) {
    throw new Error('next_step intent card placement not found in gateway config')
  }

  if (placement.enabled === true) return

  await requestJson(
    baseUrl,
    `/api/v1/dashboard/placements/${encodeURIComponent(String(placement.placementId))}`,
    {
      method: 'PUT',
      body: {
        enabled: true,
      },
    },
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const externalGatewayUrl = String(args.gatewayUrl || '').trim()
  const port = toInteger(args.port, DEFAULT_PORT)
  const scenarioNames = ['shopping', 'gifting_preference', 'non_commercial', 'sensitive_topic']

  let child = null
  const baseUrl = externalGatewayUrl || `http://${DEFAULT_HOST}:${port}`
  const useExternal = Boolean(externalGatewayUrl)

  try {
    if (!useExternal) {
      child = startGatewayProcess(port)
    }

    await waitForGateway(baseUrl)
    await ensureNextStepPlacementEnabled(baseUrl)

    const results = []
    for (const name of scenarioNames) {
      const result = await runScenario(baseUrl, name)
      results.push(result)
    }

    const failed = results.filter((item) => !item.ok)
    const passed = results.filter((item) => item.ok)
    console.log(
      JSON.stringify(
        {
          ok: failed.length === 0,
          gateway: baseUrl,
          total: results.length,
          passed: passed.length,
          failed: failed.length,
          results,
        },
        null,
        2,
      ),
    )

    if (failed.length > 0) {
      process.exitCode = 1
    }
  } finally {
    if (child) {
      child.kill('SIGTERM')
      await sleep(200)
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
  }
}

main().catch((error) => {
  console.error('[e2e-next-step] failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
