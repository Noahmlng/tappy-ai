import { inferIntentWithLlm } from '../providers/intent/index.js'

const RULE_CLASS_KEYWORDS = {
  gifting: new Set(['gift', 'girlfriend', 'boyfriend', 'wife', 'husband', 'birthday', 'anniversary', 'present']),
  shopping: new Set(['deal', 'deals', 'coupon', 'discount', 'sale', 'buy', 'order', 'shop', 'pricing', 'price']),
  purchase_intent: new Set(['best', 'compare', 'recommend', 'top', 'review', 'reviews', 'cheap', 'affordable']),
  product_exploration: new Set(['iphone', 'macbook', 'camera', 'backpack', 'shoe', 'shoes', 'vpn', 'hostinger', 'shopify', 'canva', 'protein']),
}

const DEFAULT_OPTIONS = {
  llmTimeoutMs: 300,
  ruleBudgetMs: 120,
  llmFallbackThreshold: 0.45,
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function tokenize(value = '') {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/g)
    .filter(Boolean)
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function chooseIntentClass(hitCount = {}) {
  if ((hitCount.gifting || 0) > 0) return 'gifting'
  if ((hitCount.shopping || 0) > 0 && (hitCount.product_exploration || 0) > 0) return 'purchase_intent'
  if ((hitCount.shopping || 0) > 0) return 'shopping'
  if ((hitCount.product_exploration || 0) > 0 || (hitCount.purchase_intent || 0) > 1) return 'product_exploration'
  return 'non_commercial'
}

function inferIntentByRules(input = {}) {
  const query = cleanText(input.query)
  const answerText = cleanText(input.answerText)
  const joined = `${query} ${answerText}`.trim()
  const tokens = tokenize(joined)
  const tokenSet = new Set(tokens)

  const hitCount = {
    gifting: 0,
    shopping: 0,
    purchase_intent: 0,
    product_exploration: 0,
  }

  for (const [intentClass, keywords] of Object.entries(RULE_CLASS_KEYWORDS)) {
    for (const keyword of keywords) {
      if (tokenSet.has(keyword)) {
        hitCount[intentClass] += 1
      }
    }
  }

  const intentClass = chooseIntentClass(hitCount)
  const commerceHits = (hitCount.gifting || 0) + (hitCount.shopping || 0) + (hitCount.purchase_intent || 0) + (hitCount.product_exploration || 0)
  const scoreBase = intentClass === 'non_commercial' ? 0.06 : 0.34
  const score = clamp01(scoreBase + commerceHits * 0.12)

  return {
    score,
    class: intentClass,
    source: 'rule',
    hitCount,
    ruleMeta: {
      tokenCount: tokens.length,
      commerceHits,
    },
  }
}

function toUnifiedLlmIntent(payload = {}, fallback) {
  const fallbackUsed = Boolean(payload.fallbackUsed)
  const inferredClass = cleanText(payload.intent_class || payload.intentClass).toLowerCase()
  const inferredScore = clamp01(payload.intent_score ?? payload.intentScore)

  const intentClass = fallbackUsed
    ? fallback.class
    : (inferredClass || fallback.class)

  return {
    score: fallbackUsed ? clamp01(fallback.score) : inferredScore,
    class: intentClass,
    source: fallbackUsed ? fallback.source : 'llm',
    llm: {
      fallbackUsed,
      fallbackReason: cleanText(payload.fallbackReason),
      model: cleanText(payload.model),
      validationErrors: Array.isArray(payload.validationErrors) ? payload.validationErrors.slice(0, 8) : [],
    },
  }
}

export async function scoreIntentOpportunityFirst(input = {}, options = {}) {
  const startedAt = Date.now()
  const settings = {
    ...DEFAULT_OPTIONS,
    ...(options && typeof options === 'object' ? options : {}),
  }

  const ruleResult = inferIntentByRules(input)
  const ruleLatencyMs = Math.max(0, Date.now() - startedAt)

  const shouldUseLlm = Boolean(settings.useLlmFallback)
    && ruleResult.score < clamp01(settings.llmFallbackThreshold)
  if (!shouldUseLlm) {
    return {
      ...ruleResult,
      latencyMs: ruleLatencyMs,
      ruleLatencyMs,
      llmLatencyMs: 0,
    }
  }

  const llmStartedAt = Date.now()
  const llmResult = await inferIntentWithLlm({
    query: input.query,
    answerText: input.answerText,
    locale: input.locale || 'en-US',
    recentTurns: Array.isArray(input.recentTurns) ? input.recentTurns : [],
  }, {
    timeoutMs: Math.max(120, Math.min(1200, Number(settings.llmTimeoutMs) || DEFAULT_OPTIONS.llmTimeoutMs)),
    runtimeConfig: options.runtimeConfig,
  })

  const merged = toUnifiedLlmIntent(llmResult, ruleResult)
  return {
    ...merged,
    latencyMs: Math.max(0, Date.now() - startedAt),
    ruleLatencyMs,
    llmLatencyMs: Math.max(0, Date.now() - llmStartedAt),
    rule: ruleResult,
  }
}

export { inferIntentByRules }
