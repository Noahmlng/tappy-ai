import { normalizeUnifiedOffer } from './unified-offer.js'

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

export function mapPartnerStackToUnifiedOffer(record, options = {}) {
  const sourceType = options.sourceType || 'offer'
  const sourceId = pickFirst(
    record?.id,
    record?.key,
    record?.identifier,
    record?.uuid,
    record?.offerId
  )

  return normalizeUnifiedOffer({
    sourceNetwork: 'partnerstack',
    sourceType,
    sourceId,
    offerId: sourceId ? `partnerstack:${sourceType}:${sourceId}` : '',
    title: pickFirst(record?.name, record?.title, record?.campaign_name, record?.program_name),
    description: pickFirst(record?.description, record?.campaign_description),
    targetUrl: pickFirst(
      record?.destination_url,
      record?.destinationUrl,
      record?.target_url,
      record?.targetUrl,
      record?.url
    ),
    trackingUrl: pickFirst(record?.tracking_url, record?.trackingUrl, record?.url),
    merchantName: pickFirst(record?.merchant_name, record?.partner_name),
    productName: pickFirst(record?.product_name, record?.program_name, record?.campaign_name, record?.name),
    entityText: pickFirst(record?.merchant_name, record?.program_name, record?.name, record?.title),
    entityType: sourceType === 'link' ? 'service' : pickFirst(record?.entity_type, record?.type, 'service'),
    locale: pickFirst(record?.locale, record?.language),
    market: pickFirst(record?.market, record?.country),
    currency: pickFirst(record?.currency, record?.currency_code),
    availability: pickFirst(record?.status, 'active'),
    bidValue: record?.bid_value,
    qualityScore: record?.quality_score,
    metadata: {
      partnershipIdentifier: pickFirst(options.partnershipIdentifier, record?.partnership_identifier),
      programId: pickFirst(record?.program_id),
      campaignId: pickFirst(record?.campaign_id)
    },
    raw: record
  })
}

export function mapCjToUnifiedOffer(record, options = {}) {
  const sourceType = options.sourceType || 'offer'
  const sourceId = pickFirst(
    record?.id,
    record?.['offer-id'],
    record?.offerId,
    record?.['product-id'],
    record?.productId,
    record?.['link-id'],
    record?.linkId,
    record?.sku
  )

  return normalizeUnifiedOffer({
    sourceNetwork: 'cj',
    sourceType,
    sourceId,
    offerId: sourceId ? `cj:${sourceType}:${sourceId}` : '',
    title: pickFirst(record?.name, record?.title, record?.['product-name'], record?.['link-name']),
    description: pickFirst(record?.description, record?.['description-short'], record?.['link-description']),
    targetUrl: pickFirst(
      record?.url,
      record?.['buy-url'],
      record?.buyUrl,
      record?.['product-url'],
      record?.destinationUrl,
      record?.['destination-url'],
      record?.click,
      record?.['click-url']
    ),
    trackingUrl: pickFirst(record?.['tracking-url'], record?.trackingUrl, record?.clickUrl, record?.['click-url']),
    merchantName: pickFirst(record?.['advertiser-name'], record?.advertiser, record?.advertiserName),
    productName: pickFirst(record?.['product-name'], record?.name, record?.title, record?.['link-name']),
    entityText: pickFirst(record?.brand, record?.advertiser, record?.['advertiser-name'], record?.name, record?.title),
    entityType: sourceType === 'product' ? 'product' : 'service',
    locale: pickFirst(record?.locale, record?.language),
    market: pickFirst(record?.market, record?.country, record?.['serviceable-area']),
    currency: pickFirst(record?.currency, record?.currencyCode, record?.['currency-code']),
    availability: pickFirst(record?.availability, record?.status, 'active'),
    bidValue: record?.commission,
    qualityScore: record?.quality_score,
    metadata: {
      advertiserId: pickFirst(record?.['advertiser-id'], record?.advertiserId),
      websiteId: pickFirst(record?.['website-id'], record?.websiteId)
    },
    raw: record
  })
}
