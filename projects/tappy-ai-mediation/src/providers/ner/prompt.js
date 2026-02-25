export const NER_SYSTEM_PROMPT = [
  'You are a commercial NER extractor for affiliate offer matching.',
  'Extract only explicit entities that can map to product, brand, or service offers.',
  'Use only evidence from the provided input and do not hallucinate.',
  'If no eligible entities exist, return {"entities":[]}.',
  'Return JSON only, no markdown, no explanations.'
].join(' ')

export function buildNerUserPrompt({ query = '', answerText = '', locale = 'en-US', maxEntities = 8 }) {
  return [
    `Locale: ${locale}`,
    `Max entities: ${maxEntities}`,
    '',
    'Task:',
    '1) Extract commercial entities from query and answer.',
    '2) Assign entityType from: product | brand | service.',
    '3) Set confidence between 0 and 1.',
    '4) Set normalizedText as canonical short form for lookup.',
    '',
    'Input Query:',
    query || '(empty)',
    '',
    'Input Answer:',
    answerText || '(empty)'
  ].join('\n')
}
