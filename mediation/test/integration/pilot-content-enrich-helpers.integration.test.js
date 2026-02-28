import assert from 'node:assert/strict'
import test from 'node:test'

import { __pilotContentInternal } from '../../scripts/pilot/enrich-content-cases.js'

test('pilot enrich helper: allows image domain from destination url metadata', () => {
  const allowed = __pilotContentInternal.resolveAllowedImageDomains(
    'https://affiliate.example-partnerlinks.io/offer',
    { destinationUrl: 'https://www.brand.com/product' },
  )
  assert.equal(allowed.has('brand.com'), true)
  assert.equal(
    __pilotContentInternal.isImageAllowedForDomains('https://cdn.brand.com/hero.png', allowed),
    true,
  )
  assert.equal(
    __pilotContentInternal.isImageAllowedForDomains('https://cdn.brand.co.uk/hero.png', allowed),
    true,
  )
  assert.equal(
    __pilotContentInternal.isImageAllowedForDomains('https://evil-site.com/hero.png', allowed),
    false,
  )
})

test('pilot enrich helper: extracts image fallback from icon or logo html tags', () => {
  const html = `
    <html>
      <head>
        <link rel="icon" href="/favicon-32x32.png">
      </head>
      <body>
        <img src="/assets/logo-brand.png" alt="Brand Logo" width="180" height="48">
      </body>
    </html>
  `
  const extracted = __pilotContentInternal.enrichFromHtml('https://www.brand.com/page', html)
  assert.equal(Boolean(extracted.imageUrl), true)
  assert.equal(extracted.imageUrl.startsWith('https://www.brand.com/'), true)
})

test('pilot enrich helper: identifies generic stock descriptions', () => {
  assert.equal(
    __pilotContentInternal.isGenericDescription(
      'A product option with strong category relevance and direct shopping intent.',
    ),
    true,
  )
  assert.equal(
    __pilotContentInternal.isGenericDescription(
      'Fast invoice automation for growing teams with flexible workflows.',
    ),
    false,
  )
  assert.equal(
    __pilotContentInternal.isLowQualityDescription('Get that Linux feeling - on Windows'),
    true,
  )
  assert.equal(
    __pilotContentInternal.isLowQualityDescription(
      'Build automated workflows and campaign journeys to convert and retain customers faster.',
    ),
    false,
  )
})
