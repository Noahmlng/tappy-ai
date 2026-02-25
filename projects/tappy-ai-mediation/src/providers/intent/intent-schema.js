export const INTENT_CLASSES = [
  'shopping',
  'purchase_intent',
  'gifting',
  'product_exploration',
  'non_commercial',
  'other',
]

export const PREFERENCE_FACET_KEYS = [
  'color',
  'material',
  'style',
  'brand',
  'price',
  'use_case',
  'recipient',
  'other',
]

export const PREFERENCE_FACET_SOURCES = ['user_query', 'session_context', 'llm_inference']

export const INTENT_INFERENCE_RESPONSE_SCHEMA_NAME = 'next_step_intent_inference_v1'

export const INTENT_INFERENCE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent_class', 'intent_score', 'preference_facets'],
  properties: {
    intent_class: { type: 'string', enum: INTENT_CLASSES },
    intent_score: { type: 'number', minimum: 0, maximum: 1 },
    preference_facets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['facet_key', 'facet_value'],
        properties: {
          facet_key: { type: 'string', enum: PREFERENCE_FACET_KEYS },
          facet_value: { type: 'string', minLength: 1, maxLength: 80 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          source: { type: 'string', enum: PREFERENCE_FACET_SOURCES },
        },
      },
      maxItems: 12,
    },
    constraints: {
      type: 'object',
      additionalProperties: false,
      properties: {
        must_include: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 80 },
          maxItems: 12,
        },
        must_exclude: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 80 },
          maxItems: 12,
        },
      },
    },
    inference_trace: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 120 },
      maxItems: 10,
    },
  },
}

