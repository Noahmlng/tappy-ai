import { INTENT_CLASSES, PREFERENCE_FACET_KEYS, PREFERENCE_FACET_SOURCES } from './intent-schema.js'

export const INTENT_INFERENCE_SYSTEM_PROMPT = [
  'You are an intent inference engine for sponsored recommendation.',
  'You must return strict JSON only.',
  'No markdown, no explanation, no prose.',
  'Infer from user query and short conversation context.',
  `intent_class enum: ${INTENT_CLASSES.join(', ')}`,
  `facet_key enum: ${PREFERENCE_FACET_KEYS.join(', ')}`,
  `facet source enum: ${PREFERENCE_FACET_SOURCES.join(', ')}`,
  'Output keys must be exactly: intent_class, intent_score, preference_facets.',
  'If confidence is low or the query is not commercial, return:',
  '{"intent_class":"non_commercial","intent_score":0,"preference_facets":[]}',
].join(' ')

function stringifyMaybe(value) {
  if (typeof value === 'string') return value.trim()
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function clipText(value, maxChars) {
  const text = stringifyMaybe(value)
  if (!text) return ''
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

function sanitizeHintObject(value) {
  if (!value || typeof value !== 'object') return {}
  const allowedKeys = ['intent_class', 'intent_score', 'preference_facets', 'constraints', 'blocked_topics']
  const output = {}
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    output[key] = value[key]
  }
  return output
}

export function buildIntentInferenceUserPrompt(input = {}) {
  const payload = {
    query: clipText(input.query, 320),
    answerText: clipText(input.answerText, 240),
    locale: stringifyMaybe(input.locale) || 'en-US',
    recent_turns: Array.isArray(input.recentTurns)
      ? input.recentTurns.slice(-2).map((item) => ({
          role: stringifyMaybe(item?.role),
          content: clipText(item?.content, 120),
        }))
      : [],
    client_hints: sanitizeHintObject(input.hints),
  }

  return [
    'Return only this JSON shape:',
    '{"intent_class":"<enum>","intent_score":0-1,"preference_facets":[{"facet_key":"<enum>","facet_value":"<text>","confidence":0-1,"source":"<enum>"}]}',
    'Do not output extra keys.',
    'Input:',
    JSON.stringify(payload),
  ].join('\n')
}
