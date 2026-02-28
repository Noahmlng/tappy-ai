import { loadRuntimeConfig } from '../../config/runtime-config.js'
import {
  INTENT_CLASSES,
  PREFERENCE_FACET_KEYS,
  PREFERENCE_FACET_SOURCES,
  INTENT_INFERENCE_RESPONSE_SCHEMA_NAME,
  INTENT_INFERENCE_RESPONSE_SCHEMA,
} from './intent-schema.js'
import { buildIntentInferenceUserPrompt, INTENT_INFERENCE_SYSTEM_PROMPT } from './prompt.js'

const DEFAULT_DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions'
const DEFAULT_TIMEOUT_MS = 5000

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function clamp01(value) {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end === -1 || start >= end) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value
  return []
}

function normalizeRawFacet(raw) {
  if (!raw || typeof raw !== 'object') return null

  const facetKey = normalizeText(raw.facet_key || raw.facetKey).toLowerCase()
  const facetValue = normalizeText(raw.facet_value || raw.facetValue)
  const confidenceValue = Number(raw.confidence)
  const source = normalizeText(raw.source).toLowerCase()

  if (!facetKey || !facetValue) return null

  return {
    facet_key: facetKey,
    facet_value: facetValue,
    ...(Number.isFinite(confidenceValue) ? { confidence: clamp01(confidenceValue) } : {}),
    ...(source ? { source } : {}),
  }
}

function normalizeConstraints(raw) {
  if (!raw || typeof raw !== 'object') return null
  const mustInclude = toArray(raw.must_include || raw.mustInclude)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 12)
  const mustExclude = toArray(raw.must_exclude || raw.mustExclude)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 12)

  if (mustInclude.length === 0 && mustExclude.length === 0) return null
  return {
    ...(mustInclude.length > 0 ? { must_include: mustInclude } : {}),
    ...(mustExclude.length > 0 ? { must_exclude: mustExclude } : {}),
  }
}

function normalizeCandidate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const intentClass = normalizeText(raw.intent_class || raw.intentClass).toLowerCase()
  const intentScore = Number(raw.intent_score ?? raw.intentScore)
  const preferenceFacets = toArray(raw.preference_facets ?? raw.preferenceFacets)
    .map((item) => normalizeRawFacet(item))
    .filter(Boolean)
  const inferenceTrace = toArray(raw.inference_trace ?? raw.inferenceTrace)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 10)
  const constraints = normalizeConstraints(raw.constraints)

  return {
    intent_class: intentClass,
    intent_score: intentScore,
    preference_facets: preferenceFacets,
    ...(constraints ? { constraints } : {}),
    ...(inferenceTrace.length > 0 ? { inference_trace: inferenceTrace } : {}),
  }
}

function validateIntentInference(candidate) {
  const errors = []
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, errors: ['payload_not_object'] }
  }

  const requiredFields = Array.isArray(INTENT_INFERENCE_RESPONSE_SCHEMA.required)
    ? INTENT_INFERENCE_RESPONSE_SCHEMA.required
    : []
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(candidate, field)) {
      errors.push(`missing_required_field:${field}`)
    }
  }

  if (!INTENT_CLASSES.includes(candidate.intent_class)) {
    errors.push('intent_class_invalid')
  }

  if (!Number.isFinite(candidate.intent_score) || candidate.intent_score < 0 || candidate.intent_score > 1) {
    errors.push('intent_score_invalid')
  }

  if (!Array.isArray(candidate.preference_facets)) {
    errors.push('preference_facets_not_array')
  } else {
    for (let index = 0; index < candidate.preference_facets.length; index += 1) {
      const facet = candidate.preference_facets[index]
      if (!facet || typeof facet !== 'object') {
        errors.push(`preference_facets_${index}_invalid`)
        continue
      }

      if (!PREFERENCE_FACET_KEYS.includes(facet.facet_key)) {
        errors.push(`preference_facets_${index}_facet_key_invalid`)
      }

      if (typeof facet.facet_value !== 'string' || !facet.facet_value.trim()) {
        errors.push(`preference_facets_${index}_facet_value_invalid`)
      }

      if (
        Object.prototype.hasOwnProperty.call(facet, 'confidence')
        && (!Number.isFinite(facet.confidence) || facet.confidence < 0 || facet.confidence > 1)
      ) {
        errors.push(`preference_facets_${index}_confidence_invalid`)
      }

      if (
        Object.prototype.hasOwnProperty.call(facet, 'source')
        && !PREFERENCE_FACET_SOURCES.includes(facet.source)
      ) {
        errors.push(`preference_facets_${index}_source_invalid`)
      }
    }
  }

  if (candidate.constraints !== undefined) {
    if (!candidate.constraints || typeof candidate.constraints !== 'object') {
      errors.push('constraints_invalid')
    } else {
      const mustInclude = candidate.constraints.must_include
      const mustExclude = candidate.constraints.must_exclude
      if (mustInclude !== undefined && !Array.isArray(mustInclude)) {
        errors.push('constraints_must_include_invalid')
      }
      if (mustExclude !== undefined && !Array.isArray(mustExclude)) {
        errors.push('constraints_must_exclude_invalid')
      }
    }
  }

  if (candidate.inference_trace !== undefined && !Array.isArray(candidate.inference_trace)) {
    errors.push('inference_trace_invalid')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

async function readResponseJson(response) {
  const text = await response.text()
  const data = parseMaybeJson(text)
  if (!data) {
    throw new Error(`[intent] Failed to parse LLM response body: ${text.slice(0, 300)}`)
  }
  return data
}

function createFallbackIntent({
  requestId,
  model,
  reason = 'fallback',
  errors = [],
} = {}) {
  return {
    requestId,
    model,
    intent_class: 'non_commercial',
    intent_score: 0,
    preference_facets: [],
    inference_trace: [`fallback:${reason}`, `schema:${INTENT_INFERENCE_RESPONSE_SCHEMA_NAME}`],
    fallbackUsed: true,
    fallbackReason: reason,
    validationErrors: errors,
  }
}

export async function inferIntentWithLlm(input, options = {}) {
  const query = normalizeText(input?.query)
  const answerText = normalizeText(input?.answerText)
  const locale = normalizeText(input?.locale) || 'en-US'
  const recentTurns = Array.isArray(input?.recentTurns) ? input.recentTurns : []
  const hints = input?.hints && typeof input.hints === 'object' ? input.hints : {}

  const requestId = options.requestId || `intent_${Date.now()}`
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(500, options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig(process.env, { strict: false })
  const apiKey = typeof runtimeConfig?.deepseek?.apiKey === 'string'
    ? runtimeConfig.deepseek.apiKey.trim()
    : ''
  const model = typeof runtimeConfig?.deepseek?.model === 'string'
    ? runtimeConfig.deepseek.model.trim()
    : ''
  const endpoint = options.endpoint
    || (typeof runtimeConfig?.deepseek?.baseUrl === 'string' ? runtimeConfig.deepseek.baseUrl.trim() : '')
    || DEFAULT_DEEPSEEK_CHAT_URL
  const maxTokens = Number.isFinite(runtimeConfig?.deepseek?.intentMaxTokens)
    ? Math.max(32, Math.min(256, Math.floor(runtimeConfig.deepseek.intentMaxTokens)))
    : 96

  if (!query) {
    return createFallbackIntent({
      requestId,
      model,
      reason: 'empty_query',
    })
  }

  if (!apiKey || !model) {
    return createFallbackIntent({
      requestId,
      model,
      reason: 'missing_llm_config',
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        thinking: { type: 'disabled' },
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: INTENT_INFERENCE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildIntentInferenceUserPrompt({
              query,
              answerText,
              locale,
              recentTurns,
              hints,
            }),
          },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    const payload = await readResponseJson(response)
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText || 'DeepSeek request failed'
      throw new Error(`[intent] DeepSeek error (${response.status}): ${message}`)
    }

    const content = payload?.choices?.[0]?.message?.content
    const rawCandidate = typeof content === 'string'
      ? parseMaybeJson(content)
      : (content && typeof content === 'object' ? content : null)
    const candidate = normalizeCandidate(rawCandidate)
    const validation = validateIntentInference(candidate)

    if (!validation.valid) {
      return createFallbackIntent({
        requestId,
        model,
        reason: 'schema_validation_failed',
        errors: validation.errors,
      })
    }

    const normalized = {
      requestId,
      model,
      intent_class: candidate.intent_class,
      intent_score: clamp01(candidate.intent_score),
      preference_facets: candidate.preference_facets,
      fallbackUsed: false,
      fallbackReason: '',
      validationErrors: [],
    }

    return normalized
  } catch (error) {
    return createFallbackIntent({
      requestId,
      model,
      reason: error instanceof Error ? 'llm_request_failed' : 'llm_unknown_error',
      errors: [error instanceof Error ? error.message : 'unknown_error'],
    })
  } finally {
    clearTimeout(timer)
  }
}

export {
  INTENT_INFERENCE_RESPONSE_SCHEMA_NAME,
  INTENT_INFERENCE_RESPONSE_SCHEMA,
}
