export const NER_ENTITY_TYPES = ['product', 'brand', 'service']

export const NER_RESPONSE_SCHEMA_NAME = 'ner_entities_v1'

export const NER_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['entities'],
  properties: {
    entities: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entityText', 'entityType', 'confidence', 'normalizedText'],
        properties: {
          entityText: { type: 'string', minLength: 1, maxLength: 120 },
          entityType: { type: 'string', enum: NER_ENTITY_TYPES },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          normalizedText: { type: 'string', minLength: 1, maxLength: 120 }
        }
      }
    }
  }
}
