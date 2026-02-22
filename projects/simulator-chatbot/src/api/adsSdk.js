import { createAdsSdkClient } from '../../../ad-aggregation-platform/src/sdk/client.js'

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const API_BASE = (
  import.meta.env.VITE_SIMULATOR_API_BASE_URL ||
  import.meta.env.MEDIATION_API_BASE_URL ||
  '/api'
).replace(/\/+$/, '')
const MEDIATION_API_KEY = cleanText(
  import.meta.env.VITE_MEDIATION_API_KEY ||
  import.meta.env.MEDIATION_API_KEY ||
  ''
)
const MEDIATION_ENV = cleanText(
  import.meta.env.VITE_MEDIATION_ENV ||
  import.meta.env.MEDIATION_ENV ||
  'staging'
) || 'staging'
const DEFAULT_APP_ID = cleanText(
  import.meta.env.VITE_SIMULATOR_APP_ID ||
  import.meta.env.APP_ID ||
  'simulator-chatbot'
) || 'simulator-chatbot'
const DEFAULT_PLACEMENT_ID = cleanText(
  import.meta.env.VITE_SIMULATOR_PLACEMENT_ID ||
  import.meta.env.PLACEMENT_ID ||
  'chat_inline_v1'
) || 'chat_inline_v1'
const DEFAULT_SCHEMA_VERSION = cleanText(
  import.meta.env.VITE_MEDIATION_SCHEMA_VERSION ||
  import.meta.env.MEDIATION_SCHEMA_VERSION ||
  'schema_v1'
) || 'schema_v1'
const DEFAULT_SDK_VERSION = cleanText(
  import.meta.env.VITE_MEDIATION_SDK_VERSION ||
  import.meta.env.MEDIATION_SDK_VERSION ||
  '1.0.0'
) || '1.0.0'
const DEFAULT_EVALUATE_TIMEOUT_MS = 20000

const sdkClient = createAdsSdkClient({
  apiBaseUrl: API_BASE,
  apiKey: MEDIATION_API_KEY,
  timeouts: {
    config: 3000,
    evaluate: DEFAULT_EVALUATE_TIMEOUT_MS,
    events: 2500,
  },
})

export async function fetchSdkConfig(appId, options = {}) {
  const normalizedAppId = String(appId || '').trim() || DEFAULT_APP_ID
  if (!normalizedAppId) {
    throw new Error('appId is required')
  }

  const placementId = String(options.placementId || DEFAULT_PLACEMENT_ID).trim() || DEFAULT_PLACEMENT_ID
  const response = await sdkClient.fetchConfig({
    appId: normalizedAppId,
    placementId,
    environment: MEDIATION_ENV,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    sdkVersion: DEFAULT_SDK_VERSION,
    requestAt: new Date().toISOString(),
  })
  return response?.payload || {}
}

function normalizeAttachPayload(payload = {}) {
  return {
    requestId: String(payload.requestId || '').trim(),
    appId: String(payload.appId || '').trim(),
    sessionId: String(payload.sessionId || '').trim(),
    turnId: String(payload.turnId || '').trim(),
    query: String(payload.query || '').trim(),
    answerText: String(payload.answerText || '').trim(),
    intentScore: Number(payload.intentScore),
    locale: String(payload.locale || '').trim(),
  }
}

function normalizeNextStepIntentCardPayload(payload = {}) {
  const contextInput = payload.context && typeof payload.context === 'object' ? payload.context : {}
  const context = {
    query: String(contextInput.query || '').trim(),
    answerText: String(contextInput.answerText || '').trim(),
    locale: String(contextInput.locale || '').trim(),
    intent_class: String(contextInput.intent_class || '').trim(),
    intent_score: Number(contextInput.intent_score),
    preference_facets: Array.isArray(contextInput.preference_facets)
      ? contextInput.preference_facets
      : [],
  }

  if (Array.isArray(contextInput.recent_turns)) {
    context.recent_turns = contextInput.recent_turns
  }

  if (contextInput.constraints && typeof contextInput.constraints === 'object') {
    context.constraints = contextInput.constraints
  }

  return {
    requestId: String(payload.requestId || '').trim(),
    appId: String(payload.appId || '').trim(),
    sessionId: String(payload.sessionId || '').trim(),
    turnId: String(payload.turnId || '').trim(),
    userId: String(payload.userId || '').trim(),
    event: String(payload.event || 'followup_generation').trim(),
    placementId: String(payload.placementId || 'chat_followup_v1').trim(),
    placementKey: String(payload.placementKey || 'next_step.intent_card').trim(),
    context,
  }
}

export async function evaluateAttachPlacement(payload) {
  const body = normalizeAttachPayload(payload)
  const response = await sdkClient.evaluate(body, {
    timeoutMs: DEFAULT_EVALUATE_TIMEOUT_MS,
  })
  return response?.payload || {}
}

export async function evaluateNextStepIntentCardPlacement(payload) {
  const body = normalizeNextStepIntentCardPayload(payload)
  const response = await sdkClient.evaluate(body, {
    timeoutMs: DEFAULT_EVALUATE_TIMEOUT_MS,
  })
  return response?.payload || {}
}

export async function reportSdkEvent(payload) {
  const body = payload?.context ? normalizeNextStepIntentCardPayload(payload) : normalizeAttachPayload(payload)
  const response = await sdkClient.reportEvent(body, {
    timeoutMs: 2500,
  })
  return response?.payload || {}
}

export async function runAttachPlacementFlow(payload = {}) {
  const body = normalizeAttachPayload(payload)
  return sdkClient.runAttachFlow({
    appId: body.appId || DEFAULT_APP_ID,
    placementId: DEFAULT_PLACEMENT_ID,
    placementKey: 'attach.post_answer_render',
    environment: MEDIATION_ENV,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    sdkVersion: DEFAULT_SDK_VERSION,
    sessionId: body.sessionId,
    turnId: body.turnId,
    query: body.query,
    answerText: body.answerText,
    intentScore: body.intentScore,
    locale: body.locale,
  })
}

export async function runNextStepIntentCardPlacementFlow(payload = {}) {
  const body = normalizeNextStepIntentCardPayload(payload)
  return sdkClient.runNextStepFlow({
    appId: body.appId || DEFAULT_APP_ID,
    placementId: body.placementId || 'chat_followup_v1',
    placementKey: body.placementKey || 'next_step.intent_card',
    environment: MEDIATION_ENV,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    sdkVersion: DEFAULT_SDK_VERSION,
    sessionId: body.sessionId,
    turnId: body.turnId,
    userId: body.userId,
    event: body.event,
    context: body.context,
  })
}
