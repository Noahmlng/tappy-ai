import { inferIntentWithLlm } from '../providers/intent/index.js'

const RULE_CLASS_KEYWORDS = {
  gifting: new Set(['gift', 'girlfriend', 'boyfriend', 'wife', 'husband', 'birthday', 'anniversary', 'present']),
  shopping: new Set([
    'deal', 'deals', 'coupon', 'discount', 'sale', 'buy', 'order', 'shop', 'pricing', 'price',
    'fee', 'fees', 'rate', 'rates', 'cost', 'costs', 'subscription', 'plan',
  ]),
  purchase_intent: new Set([
    'best', 'compare', 'recommend', 'top', 'review', 'reviews', 'cheap', 'affordable',
    'switch', 'alternative', 'stack', 'platform', 'broker', 'brokerage',
  ]),
  product_exploration: new Set([
    'iphone', 'macbook', 'camera', 'backpack', 'shoe', 'shoes', 'vpn', 'hostinger', 'shopify', 'canva', 'protein',
    'broker', 'brokerage', 'trading', 'trader', 'options', 'etf', 'stock', 'stocks', 'exchange',
    'crypto', 'wallet', 'hardware', 'ledger', 'portfolio', 'backtest', 'earnings', 'analyst',
    'tax', 'budget', 'budgeting', 'credit', 'monitoring', 'savings', 'yield', 'roboadvisor', 'robo', 'advisor',
  ]),
}

const RULE_CLASS_KEYWORDS_ZH = {
  gifting: [
    '送礼', '礼物', '女朋友', '男朋友', '老婆', '老公', '生日', '纪念日',
  ],
  shopping: [
    '购买', '买', '下单', '价格', '多少钱', '优惠', '折扣', '会员', '订阅',
  ],
  purchase_intent: [
    '对比', '比较', '推荐', '哪个好', '评测', '测评',
  ],
  product_exploration: [
    '平台', '工具', '方案', '软件',
  ],
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
  const lowerJoined = joined.toLowerCase()
  const tokens = tokenize(joined)
  const tokenSet = new Set(tokens)

  const hitCount = {
    gifting: 0,
    shopping: 0,
    purchase_intent: 0,
    product_exploration: 0,
  }
  const matchedKeywords = []
  const matchedKeywordSet = new Set()

  for (const [intentClass, keywords] of Object.entries(RULE_CLASS_KEYWORDS)) {
    for (const keyword of keywords) {
      if (tokenSet.has(keyword)) {
        hitCount[intentClass] += 1
        if (!matchedKeywordSet.has(keyword)) {
          matchedKeywordSet.add(keyword)
          matchedKeywords.push(keyword)
        }
      }
    }
  }

  for (const [intentClass, keywords] of Object.entries(RULE_CLASS_KEYWORDS_ZH)) {
    for (const keyword of keywords) {
      if (lowerJoined.includes(keyword)) {
        hitCount[intentClass] += 1
        if (!matchedKeywordSet.has(keyword)) {
          matchedKeywordSet.add(keyword)
          matchedKeywords.push(keyword)
        }
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
      matchedKeywords: matchedKeywords.slice(0, 20),
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
