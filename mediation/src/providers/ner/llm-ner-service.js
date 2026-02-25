import { loadRuntimeConfig } from '../../config/runtime-config.js'
import { NER_ENTITY_TYPES } from './entity-schema.js'
import { buildNerUserPrompt, NER_SYSTEM_PROMPT } from './prompt.js'

const DEFAULT_GLM_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const DEFAULT_TIMEOUT_MS = 45000

function normalizeText(value) {
  return value.trim().replace(/\s+/g, ' ')
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

function normalizeEntity(rawEntity) {
  if (!rawEntity || typeof rawEntity !== 'object') return null
  const rawEntityText = typeof rawEntity.entityText === 'string'
    ? rawEntity.entityText
    : (typeof rawEntity.text === 'string' ? rawEntity.text : '')
  const rawEntityType = typeof rawEntity.entityType === 'string'
    ? rawEntity.entityType
    : (typeof rawEntity.type === 'string' ? rawEntity.type : '')
  const rawNormalizedText = typeof rawEntity.normalizedText === 'string'
    ? rawEntity.normalizedText
    : (typeof rawEntity.normalized === 'string' ? rawEntity.normalized : rawEntityText)
  const confidenceValue = typeof rawEntity.confidence === 'number'
    ? rawEntity.confidence
    : Number(rawEntity.confidence)

  if (!Number.isFinite(confidenceValue)) return null

  const entityText = normalizeText(rawEntityText)
  const normalizedText = normalizeText(rawNormalizedText)
  const entityType = rawEntityType.trim().toLowerCase()

  if (!entityText || !normalizedText) return null
  if (!NER_ENTITY_TYPES.includes(entityType)) return null

  return {
    entityText,
    entityType,
    confidence: clamp01(confidenceValue),
    normalizedText
  }
}

function normalizeNerResponse(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entities)) {
    return { entities: [] }
  }

  const dedupe = new Set()
  const entities = []

  for (const candidate of raw.entities) {
    const entity = normalizeEntity(candidate)
    if (!entity) continue
    const key = `${entity.entityType}::${entity.normalizedText.toLowerCase()}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    entities.push(entity)
  }

  entities.sort((a, b) => b.confidence - a.confidence)
  return { entities }
}

async function readResponseJson(response) {
  const text = await response.text()
  const data = parseMaybeJson(text)
  if (!data) {
    throw new Error(`[ner] Failed to parse LLM response body: ${text.slice(0, 300)}`)
  }
  return data
}

export async function extractEntitiesWithLlm(input, options = {}) {
  const {
    query = '',
    answerText = '',
    locale = 'en-US',
    maxEntities = 8,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = input || {}
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig()
  const endpoint = options.endpoint || DEFAULT_GLM_CHAT_URL
  const requestId = options.requestId || `ner_${Date.now()}`
  const apiKey = typeof runtimeConfig?.openrouter?.apiKey === 'string'
    ? runtimeConfig.openrouter.apiKey.trim()
    : ''
  const model = typeof runtimeConfig?.openrouter?.model === 'string'
    ? runtimeConfig.openrouter.model.trim()
    : ''

  if (!apiKey || !model) {
    return {
      requestId,
      model,
      entities: []
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: NER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildNerUserPrompt({ query, answerText, locale, maxEntities })
          }
        ],
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    })

    const payload = await readResponseJson(response)
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText || 'GLM request failed'
      throw new Error(`[ner] GLM error (${response.status}): ${message}`)
    }

    const content = payload?.choices?.[0]?.message?.content
    const parsed = typeof content === 'string' ? parseMaybeJson(content) : (content && typeof content === 'object' ? content : null)
    const result = normalizeNerResponse(parsed)

    return {
      requestId,
      model,
      entities: result.entities
    }
  } finally {
    clearTimeout(timer)
  }
}
