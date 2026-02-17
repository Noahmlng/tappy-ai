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

const MOCK_SPONSORED_INDEX = [
  {
    title: 'Deploy LLM Apps Faster with Vercel AI SDK',
    url: 'https://vercel.com/ai',
    snippet: 'Build and ship AI products with streaming UI primitives and observability.',
    advertiser: 'Vercel',
    tags: ['ai', 'sdk', 'deploy', 'chatgpt', 'tool'],
  },
  {
    title: 'Pinecone Vector Database for RAG',
    url: 'https://www.pinecone.io/',
    snippet: 'Production-grade vector search for retrieval, memory, and recommendation.',
    advertiser: 'Pinecone',
    tags: ['rag', 'search', 'retrieval', 'vector', 'memory'],
  },
  {
    title: 'GitHub Copilot for Teams',
    url: 'https://github.com/features/copilot',
    snippet: 'Accelerate engineering output with AI pair programming in your IDE.',
    advertiser: 'GitHub',
    tags: ['developer', 'code', 'assistant', 'productivity'],
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

function scoreItemsByQuery(items, terms, options = {}) {
  const preferenceBoostTags = Array.isArray(options.preferenceBoostTags)
    ? options.preferenceBoostTags.filter((tag) => typeof tag === 'string')
    : []
  const preferenceBoostSet = new Set(preferenceBoostTags.map((tag) => tag.toLowerCase()))

  return items
    .map((item) => {
      const haystack = `${item.title} ${item.snippet} ${(item.tags || []).join(' ')}`
        .toLowerCase()
      const queryScore = terms.reduce((acc, term) => (haystack.includes(term) ? acc + 1 : acc), 0)
      const preferenceScore = (item.tags || []).reduce((acc, tag) => {
        return preferenceBoostSet.has(String(tag).toLowerCase()) ? acc + 0.65 : acc
      }, 0)
      return {
        ...item,
        queryScore,
        preferenceScore,
        score: queryScore + preferenceScore,
      }
    })
    .sort((a, b) => b.score - a.score)
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
  const sponsoredEnabled = options.sponsoredEnabled !== false
  const excludedSponsoredIds = new Set(
    Array.isArray(options.excludedSponsoredIds)
      ? options.excludedSponsoredIds.filter((id) => typeof id === 'string')
      : [],
  )
  const preferenceBoostTags = Array.isArray(options.preferenceBoostTags)
    ? options.preferenceBoostTags.filter((tag) => typeof tag === 'string')
    : []

  await delay(600)

  const terms = tokenize(normalized)
  const scored = scoreItemsByQuery(MOCK_WEB_INDEX, terms)
    .filter((item) => item.score > 0)

  const fallback = scored.length > 0 ? scored : MOCK_WEB_INDEX.slice(0, 3)
  const results = fallback.slice(0, limit).map((item, index) => ({
    id: `ws_${index + 1}_${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
  }))

  let sponsoredSlot = null
  let sponsoredMatchScore = null
  if (sponsoredEnabled) {
    const sponsoredCandidates = scoreItemsByQuery(MOCK_SPONSORED_INDEX, terms, {
      preferenceBoostTags,
    })
    const selected =
      sponsoredCandidates.find((item) => {
        const adId = `ad_${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
        return !excludedSponsoredIds.has(adId)
      }) || sponsoredCandidates[0] || MOCK_SPONSORED_INDEX[0]

    const selectedAdId = `ad_${selected.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    if (!excludedSponsoredIds.has(selectedAdId) || excludedSponsoredIds.size === 0) {
      sponsoredMatchScore = Number.isFinite(selected.score) ? selected.score : null

      sponsoredSlot = {
        slotId: 'search_sponsored_slot_1',
        label: 'Sponsored',
        ad: {
          id: selectedAdId,
          title: selected.title,
          url: selected.url,
          snippet: selected.snippet,
          advertiser: selected.advertiser,
          preferenceTags: Array.isArray(selected.tags) ? selected.tags : [],
        },
      }
    }
  }

  return {
    query: normalized,
    results,
    sponsoredSlot,
    sponsoredMatchScore,
    latencyMs: Date.now() - startedAt,
  }
}

export function buildWebSearchContext(query, results = [], sponsoredSlot = null, options = {}) {
  if (!query || results.length === 0) return ''

  const mergeMode = options.mergeMode === 'blended' ? 'blended' : 'separate'
  const displayResults = mergeMode === 'blended' && sponsoredSlot?.ad
    ? [
        {
          title: `[${sponsoredSlot.label || 'Sponsored'}] ${sponsoredSlot.ad.title}`,
          url: sponsoredSlot.ad.url,
          snippet: sponsoredSlot.ad.snippet,
        },
        ...results,
      ]
    : results

  const lines = displayResults.map((result, index) => {
    return `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
  })

  const sponsoredBlock = mergeMode === 'separate' && sponsoredSlot?.ad
    ? [
        'Sponsored result:',
        `${sponsoredSlot.label}: ${sponsoredSlot.ad.title}`,
        `URL: ${sponsoredSlot.ad.url}`,
        `Snippet: ${sponsoredSlot.ad.snippet}`,
      ].join('\n')
    : ''

  return [
    'Web search results are available for this user request.',
    `Search query: ${query}`,
    `Result merge mode: ${mergeMode}`,
    'Use these references when relevant and avoid fabricating sources.',
    sponsoredBlock,
    lines.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}
