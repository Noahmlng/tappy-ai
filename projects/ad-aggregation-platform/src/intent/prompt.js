import { INTENT_CLASSES, PREFERENCE_FACET_KEYS, PREFERENCE_FACET_SOURCES } from './intent-schema.js'

export const INTENT_INFERENCE_SYSTEM_PROMPT = [
  'You are an intent inference engine for next-step sponsored recommendation.',
  'You must return strict JSON only.',
  'No markdown, no explanation, no prose.',
  'Infer from user query + recent conversation context.',
  `intent_class enum: ${INTENT_CLASSES.join(', ')}`,
  `facet_key enum: ${PREFERENCE_FACET_KEYS.join(', ')}`,
  `facet source enum: ${PREFERENCE_FACET_SOURCES.join(', ')}`,
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

export function buildIntentInferenceUserPrompt(input = {}) {
  const payload = {
    query: stringifyMaybe(input.query),
    answerText: stringifyMaybe(input.answerText),
    locale: stringifyMaybe(input.locale) || 'en-US',
    recent_turns: Array.isArray(input.recentTurns)
      ? input.recentTurns.slice(-8).map((item) => ({
          role: stringifyMaybe(item?.role),
          content: stringifyMaybe(item?.content),
        }))
      : [],
    client_hints: input.hints && typeof input.hints === 'object'
      ? input.hints
      : {},
  }

  return [
    'Return JSON object with shape:',
    '{',
    '  "intent_class": string,',
    '  "intent_score": number(0-1),',
    '  "preference_facets": [',
    '    { "facet_key": string, "facet_value": string, "confidence": number(0-1), "source": string }',
    '  ],',
    '  "constraints": { "must_include": string[], "must_exclude": string[] },',
    '  "inference_trace": string[]',
    '}',
    'Input:',
    JSON.stringify(payload),
  ].join('\n')
}

