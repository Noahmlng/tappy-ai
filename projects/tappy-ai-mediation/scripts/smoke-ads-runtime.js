import { runAdsRetrievalPipeline } from '../src/runtime/index.js'

function parseArgs(argv) {
  const options = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const eqIndex = arg.indexOf('=')
    if (eqIndex === -1) {
      const key = arg.slice(2)
      options[key] = 'true'
      continue
    }
    const key = arg.slice(2, eqIndex)
    const value = arg.slice(eqIndex + 1)
    options[key] = value
  }
  return options
}

function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  if (typeof value !== 'string') return Boolean(value)
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

function createMockNerExtractor() {
  return async ({ query = '', answerText = '' }) => {
    const raw = `${query} ${answerText}`.trim()
    const firstToken = raw.split(/\s+/).find(Boolean) || 'offer'
    return {
      entities: [
        {
          entityText: firstToken,
          normalizedText: firstToken.toLowerCase(),
          entityType: 'product',
          confidence: 0.95
        }
      ]
    }
  }
}

function createMockPartnerStackConnector() {
  return {
    async fetchOffers() {
      return {
        offers: [
          {
            offerId: 'partnerstack:offer:mock-1',
            sourceNetwork: 'partnerstack',
            sourceType: 'offer',
            title: 'Mock PartnerStack Offer',
            description: 'Mock PartnerStack description',
            targetUrl: 'https://partnerstack.example.com/offer/mock-1',
            trackingUrl: 'https://partnerstack.example.com/track/mock-1',
            entityText: 'mock',
            normalizedEntityText: 'mock',
            entityType: 'service',
            availability: 'active'
          }
        ]
      }
    },
    async fetchLinksCatalog() {
      return {
        offers: [
          {
            offerId: 'partnerstack:link:mock-next-step-1',
            sourceNetwork: 'partnerstack',
            sourceType: 'link',
            title: 'Mock PartnerStack Link Catalog Offer',
            description: 'Mock PartnerStack link catalog description',
            targetUrl: 'https://partnerstack.example.com/link/mock-next-step-1',
            trackingUrl: 'https://partnerstack.example.com/track/link/mock-next-step-1',
            entityText: 'mock',
            normalizedEntityText: 'mock',
            entityType: 'service',
            availability: 'active'
          }
        ],
        debug: {
          mode: 'partnerstack_links_catalog'
        }
      }
    },
  }
}

function createMockCjConnector() {
  return {
    async fetchOffers() {
      return {
        offers: [
          {
            offerId: 'cj:product:mock-1',
            sourceNetwork: 'cj',
            sourceType: 'product',
            title: 'Mock CJ Product Offer',
            description: 'Mock CJ description',
            targetUrl: 'https://cj.example.com/offer/mock-1',
            trackingUrl: 'https://cj.example.com/track/mock-1',
            entityText: 'mock',
            normalizedEntityText: 'mock',
            entityType: 'product',
            availability: 'active'
          }
        ]
      }
    },
    async fetchLinksCatalog() {
      return {
        offers: [
          {
            offerId: 'cj:link:mock-next-step-1',
            sourceNetwork: 'cj',
            sourceType: 'link',
            title: 'Mock CJ Link Catalog Offer',
            description: 'Mock CJ link catalog description',
            targetUrl: 'https://cj.example.com/link/mock-next-step-1',
            trackingUrl: 'https://cj.example.com/track/link/mock-next-step-1',
            entityText: 'mock',
            normalizedEntityText: 'mock',
            entityType: 'product',
            availability: 'active'
          }
        ],
        debug: {
          mode: 'cj_links_catalog'
        }
      }
    },
  }
}

function createMockHouseConnector() {
  return {
    async fetchProductOffersCatalog() {
      return {
        offers: [
          {
            offerId: 'house:product:mock-next-step-1',
            sourceNetwork: 'house',
            sourceType: 'product',
            title: 'Mock House Product Offer',
            description: 'Mock house product catalog description',
            targetUrl: 'https://house.example.com/product/mock-next-step-1',
            trackingUrl: 'https://house.example.com/product/mock-next-step-1',
            entityText: 'mock',
            normalizedEntityText: 'mock',
            entityType: 'product',
            availability: 'active',
            metadata: {
              intentCardItemId: 'mock_house_item_1',
              category: 'software',
              matchTags: ['software', 'mock']
            }
          }
        ],
        debug: {
          mode: 'house_product_offers_catalog'
        }
      }
    },
  }
}

function createLogger(verbose = false) {
  if (!verbose) {
    return {
      info(payload) {
        const event = payload?.event || 'runtime_log'
        const requestId = payload?.requestId || ''
        console.log(`[runtime] ${event} requestId=${requestId}`)
      },
      error(payload) {
        console.error('[runtime:error]', payload)
      }
    }
  }
  return console
}

function buildAdRequest(options) {
  return {
    appId: options.appId || 'smoke-app',
    sessionId: options.sessionId || `smoke_${Date.now()}`,
    placementId: options.placementId || 'attach.post_answer_render',
    context: {
      query: options.query || 'best iphone deals',
      answerText: options.answerText || 'You can compare iPhone offers from multiple merchants.',
      intentScore: Number(options.intentScore || 0.9),
      locale: options.locale || 'en-US',
      testAllOffers: toBoolean(options.testAllOffers, true),
      debug: {}
    }
  }
}

function assertSmokeResult(result, mode, adRequest) {
  if (!result || typeof result !== 'object') {
    throw new Error('Pipeline result is empty.')
  }
  if (!result.adResponse || typeof result.adResponse !== 'object') {
    throw new Error('adResponse is missing.')
  }
  if (!Array.isArray(result.adResponse.ads)) {
    throw new Error('adResponse.ads must be an array.')
  }
  if (mode === 'mock' && result.adResponse.ads.length === 0) {
    throw new Error('Mock smoke test expected non-empty ads[].')
  }
  if (
    mode === 'mock'
    && adRequest?.placementId === 'next_step.intent_card'
    && result.adResponse.ads.length > 0
  ) {
    const hasHouseProductOffer = result.adResponse.ads.some((item) =>
      String(item?.sourceNetwork || '').toLowerCase() === 'house'
    )
    if (!hasHouseProductOffer) {
      throw new Error('Expected next_step.intent_card mock smoke to include house product catalog offers.')
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = (args.mode || 'mock').toLowerCase()
  const verbose = toBoolean(args.verbose, false)
  const logger = createLogger(verbose)
  const adRequest = buildAdRequest(args)

  const options =
    mode === 'live'
      ? { logger }
      : {
          logger,
          runtimeConfig: {
            openrouter: { apiKey: 'mock-key', model: 'mock-model' },
            cj: { token: 'mock-cj-token' },
            partnerstack: { apiKey: 'mock-partnerstack-key' }
          },
          nerExtractor: createMockNerExtractor(),
          partnerstackConnector: createMockPartnerStackConnector(),
          cjConnector: createMockCjConnector(),
          houseConnector: createMockHouseConnector()
        }

  const result = await runAdsRetrievalPipeline(adRequest, options)
  assertSmokeResult(result, mode, adRequest)

  console.log(
    JSON.stringify(
      {
        mode,
        requestId: result.adResponse.requestId,
        placementId: result.adResponse.placementId,
        adCount: result.adResponse.ads.length,
        ads: result.adResponse.ads
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error('[smoke] failed:', error?.message || error)
  process.exit(1)
})
