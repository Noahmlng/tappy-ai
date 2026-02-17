const WEB_SEARCH_TRIGGER_TERMS = [
  'latest',
  'today',
  'news',
  'price',
  'release',
  'weather',
  'score',
  'stocks',
  'best',
  'top',
  'compare',
  'vs',
]

const MOCK_WEB_INDEX = [
  {
    title: 'OpenAI API Platform docs',
    url: 'https://platform.openai.com/docs/overview',
    snippet: 'Official API docs for models, streaming, and tool calling patterns.',
    tags: ['openai', 'api', 'tool', 'streaming', 'chatgpt'],
  },
  {
    title: 'DeepSeek API docs',
    url: 'https://api-docs.deepseek.com/',
    snippet: 'Model usage guide, chat completion API, and pricing references.',
    tags: ['deepseek', 'api', 'model', 'reasoner'],
  },
  {
    title: 'MDN Web Docs: Fetch API',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
    snippet: 'How to send HTTP requests in browser environments.',
    tags: ['web', 'javascript', 'fetch', 'http'],
  },
  {
    title: 'Google Search Central',
    url: 'https://developers.google.com/search',
    snippet: 'Guidelines and resources related to web search visibility.',
    tags: ['search', 'seo', 'web'],
  },
  {
    title: 'Node.js release schedule',
    url: 'https://github.com/nodejs/Release',
    snippet: 'Official repository tracking active Node.js versions and timelines.',
    tags: ['node', 'release', 'version', 'latest'],
  },
  {
    title: 'How sponsored results are labeled in search interfaces',
    url: 'https://support.google.com/google-ads/answer/1722122',
    snippet: 'General policy references for sponsored search result disclosures.',
    tags: ['ads', 'sponsored', 'search', 'policy'],
  },
]

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function normalizeQuery(query) {
  return String(query || '').replace(/^\/search\s+/i, '').trim()
}

export function shouldUseWebSearchTool(query) {
  const normalized = normalizeQuery(query)
  if (!normalized) return false

  if (/^\/search\s+/i.test(query || '')) return true

  const lower = normalized.toLowerCase()
  return WEB_SEARCH_TRIGGER_TERMS.some((term) => lower.includes(term))
}

export async function runWebSearchTool(query, options = {}) {
  const startedAt = Date.now()
  const normalized = normalizeQuery(query)
  const limit = Number.isFinite(options.maxResults) ? options.maxResults : 4

  await delay(600)

  const terms = tokenize(normalized)
  const scored = MOCK_WEB_INDEX.map((item) => {
    const haystack = `${item.title} ${item.snippet} ${(item.tags || []).join(' ')}`
      .toLowerCase()

    const score = terms.reduce((acc, term) => (haystack.includes(term) ? acc + 1 : acc), 0)
    return { ...item, score }
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  const fallback = scored.length > 0 ? scored : MOCK_WEB_INDEX.slice(0, 3)
  const results = fallback.slice(0, limit).map((item, index) => ({
    id: `ws_${index + 1}_${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
  }))

  return {
    query: normalized,
    results,
    latencyMs: Date.now() - startedAt,
  }
}

export function buildWebSearchContext(query, results = []) {
  if (!query || results.length === 0) return ''

  const lines = results.map((result, index) => {
    return `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
  })

  return [
    'Web search results are available for this user request.',
    `Search query: ${query}`,
    'Use these references when relevant and avoid fabricating sources.',
    lines.join('\n\n'),
  ].join('\n\n')
}
