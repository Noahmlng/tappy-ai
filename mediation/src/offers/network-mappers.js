import { normalizeUnifiedOffer } from './unified-offer.js'

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function normalizeMaybeUrl(...values) {
  const text = pickFirst(...values)
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(text)) {
    return `https://${text}`
  }
  return ''
}

function pickPartnerStackImageUrl(record = {}) {
  return normalizeMaybeUrl(
    record?.image_url,
    record?.imageUrl,
    record?.logo_url,
    record?.logoUrl,
    record?.icon_url,
    record?.iconUrl,
    record?.company?.image_url,
    record?.company?.imageUrl,
    record?.company?.logo_url,
    record?.company?.logoUrl,
    record?.company?.icon_url,
    record?.company?.iconUrl,
    record?.program?.image_url,
    record?.program?.imageUrl,
  )
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
  const imageUrl = pickPartnerStackImageUrl(record)

  return normalizeUnifiedOffer({
    sourceNetwork: 'partnerstack',
    sourceType,
    sourceId,
    offerId: sourceId ? `partnerstack:${sourceType}:${sourceId}` : '',
    title: pickFirst(record?.name, record?.title, record?.campaign_name, record?.program_name),
    description: pickFirst(
      record?.description,
      record?.campaign_description,
      record?.program_description,
      record?.company?.description,
    ),
    targetUrl: normalizeMaybeUrl(
      record?.destination_url,
      record?.destinationUrl,
      record?.target_url,
      record?.targetUrl,
      record?.url,
      record?.website
    ),
    trackingUrl: normalizeMaybeUrl(
      record?.tracking_url,
      record?.trackingUrl,
      record?.url,
      record?.website
    ),
    merchantName: pickFirst(record?.merchant_name, record?.partner_name),
    productName: pickFirst(record?.product_name, record?.program_name, record?.campaign_name, record?.name),
    entityText: pickFirst(record?.merchant_name, record?.program_name, record?.name, record?.title),
    entityType: sourceType === 'link' ? 'service' : pickFirst(record?.entity_type, record?.type, 'service'),
    locale: pickFirst(record?.locale, record?.language),
    market: pickFirst(record?.market, record?.country),
    currency: pickFirst(record?.currency, record?.currency_code),
    availability: pickFirst(record?.status, 'active'),
    updatedAt: pickFirst(record?.updated_at, record?.updatedAt, record?.modified_at, record?.created_at),
    bidValue: record?.bid_value,
    qualityScore: record?.quality_score,
    metadata: {
      partnershipIdentifier: pickFirst(options.partnershipIdentifier, record?.partnership_identifier),
      programId: pickFirst(record?.program_id),
      campaignId: pickFirst(record?.campaign_id),
      image_url: imageUrl,
      imageUrl,
    },
    raw: record
  })
}

export function mapPartnerStackPartnershipToUnifiedOffer(record, options = {}) {
  const sourceType = options.sourceType || 'link'
  const sourceId = pickFirst(record?.key, record?.id, record?.company?.key, record?.company?.id)
  const imageUrl = pickPartnerStackImageUrl(record)

  return normalizeUnifiedOffer({
    sourceNetwork: 'partnerstack',
    sourceType,
    sourceId,
    offerId: sourceId ? `partnerstack:${sourceType}:${sourceId}` : '',
    title: pickFirst(record?.company?.name, record?.name, record?.title),
    description: pickFirst(
      record?.offers?.description,
      record?.description,
      record?.company?.description,
      record?.program?.description,
    ),
    targetUrl: normalizeMaybeUrl(
      record?.link?.url,
      record?.link?.destination,
      record?.destination_url,
      record?.destinationUrl,
      record?.url
    ),
    trackingUrl: normalizeMaybeUrl(record?.link?.url, record?.tracking_url, record?.trackingUrl),
    merchantName: pickFirst(record?.company?.name),
    productName: pickFirst(record?.company?.name, record?.name),
    entityText: pickFirst(record?.company?.name, record?.name),
    entityType: 'service',
    locale: pickFirst(record?.locale),
    market: pickFirst(record?.country, record?.company?.country),
    currency: pickFirst(record?.offers?.currency),
    availability: pickFirst(record?.status, 'active'),
    updatedAt: pickFirst(record?.updated_at, record?.created_at),
    bidValue: record?.offers?.base_rate,
    metadata: {
      partnershipKey: pickFirst(record?.key),
      stackKey: pickFirst(record?.link?.stack_key),
      destinationUrl: normalizeMaybeUrl(record?.link?.destination),
      teamName: pickFirst(record?.team?.name),
      image_url: imageUrl,
      imageUrl,
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
    updatedAt: pickFirst(
      record?.['last-updated'],
      record?.updatedAt,
      record?.updated_at,
      record?.['effective-date'],
      record?.['creation-date']
    ),
    bidValue: record?.commission,
    qualityScore: record?.quality_score,
    metadata: {
      advertiserId: pickFirst(record?.['advertiser-id'], record?.advertiserId),
      websiteId: pickFirst(record?.['website-id'], record?.websiteId)
    },
    raw: record
  })
}
