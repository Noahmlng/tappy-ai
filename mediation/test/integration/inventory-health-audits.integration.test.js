import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { runLinkHealthAudit, __linksHealthInternal } from '../../scripts/inventory/health-links.js'
import { runImageHealthAudit, __imagesHealthInternal } from '../../scripts/inventory/health-images.js'

function buildBatchPayload(rows = []) {
  return {
    metrics: {
      rows,
    },
  }
}

test('inventory health links: classify helpers map status and errors', () => {
  assert.equal(__linksHealthInternal.classifyHttpStatus(200), '2xx')
  assert.equal(__linksHealthInternal.classifyHttpStatus(302), '3xx')
  assert.equal(__linksHealthInternal.classifyHttpStatus(404), '4xx')
  assert.equal(__linksHealthInternal.classifyHttpStatus(503), '5xx')
  assert.equal(__linksHealthInternal.classifyHttpStatus(0), 'none')

  const timeoutError = new Error('request timeout')
  timeoutError.name = 'AbortError'
  assert.equal(__linksHealthInternal.classifyFetchError(timeoutError), 'timeout')
  assert.equal(__linksHealthInternal.classifyFetchError(new Error('getaddrinfo ENOTFOUND x.y')), 'dns')
  assert.equal(__linksHealthInternal.classifyFetchError(new Error('socket hang up')), 'request_error')
})

test('inventory health links: batch mode writes report with status classes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-links-'))
  const batchPath = path.join(tmpDir, 'batch.json')
  const outputPath = path.join(tmpDir, 'report.json')
  const payload = buildBatchPayload([
    {
      skipped: false,
      network: 'house',
      after: {
        offer_id: 'offer_ok',
        network: 'house',
        target_url: 'https://example.com/ok',
      },
    },
    {
      skipped: false,
      network: 'partnerstack',
      after: {
        offer_id: 'offer_404',
        network: 'partnerstack',
        target_url: 'https://example.com/missing',
      },
    },
    {
      skipped: false,
      network: 'house',
      after: {
        offer_id: 'offer_timeout',
        network: 'house',
        target_url: 'https://example.com/timeout',
      },
    },
  ])
  await fs.writeFile(batchPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const text = String(url)
    if (text.includes('/ok')) {
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } })
    }
    if (text.includes('/missing')) {
      return new Response('', { status: 404, headers: { 'content-type': 'text/html' } })
    }
    const timeoutError = new Error('timeout')
    timeoutError.name = 'AbortError'
    throw timeoutError
  }

  try {
    const report = await runLinkHealthAudit({
      'batch-files': batchPath,
      'output-file': outputPath,
      concurrency: '2',
      'timeout-ms': '500',
      'sample-size': '10',
    })

    assert.equal(report.mode, 'batch_files')
    assert.equal(report.summary.total_rows, 3)
    assert.equal(report.summary.status_class['2xx'], 1)
    assert.equal(report.summary.status_class['4xx'], 1)
    assert.equal(report.summary.status_class.timeout, 1)

    const saved = JSON.parse(await fs.readFile(outputPath, 'utf8'))
    assert.equal(saved.summary.total_rows, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('inventory health images: classify helpers detect image type and landing-like URLs', () => {
  assert.equal(__imagesHealthInternal.classifyHttpStatus(204), '2xx')
  assert.equal(__imagesHealthInternal.isImageContentType('image/png'), true)
  assert.equal(__imagesHealthInternal.isImageContentType('text/html'), false)
  assert.equal(__imagesHealthInternal.isLikelyLandingPage('text/html', 'https://a.com/p'), true)
  assert.equal(__imagesHealthInternal.isLikelyLandingPage('image/webp', 'https://a.com/p.webp'), false)
})

test('inventory health images: batch mode reports valid image and landing-like counts', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-images-'))
  const batchPath = path.join(tmpDir, 'batch.json')
  const outputPath = path.join(tmpDir, 'report.json')
  const payload = buildBatchPayload([
    {
      skipped: false,
      network: 'house',
      after: {
        offer_id: 'img_ok',
        network: 'house',
        target_url: 'https://example.com/p1',
        image_url: 'https://cdn.example.com/p1.png',
      },
    },
    {
      skipped: false,
      network: 'house',
      after: {
        offer_id: 'img_html',
        network: 'house',
        target_url: 'https://example.com/p2',
        image_url: 'https://example.com/landing',
      },
    },
    {
      skipped: false,
      network: 'partnerstack',
      after: {
        offer_id: 'img_missing',
        network: 'partnerstack',
        target_url: 'https://example.com/p3',
      },
    },
  ])
  await fs.writeFile(batchPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    const method = String(options?.method || 'GET').toUpperCase()
    if (target.includes('p1.png')) {
      return new Response('', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    if (target.includes('/landing')) {
      if (method === 'HEAD') {
        return new Response('', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } })
  }

  try {
    const report = await runImageHealthAudit({
      'batch-files': batchPath,
      'output-file': outputPath,
      concurrency: '2',
      'timeout-ms': '500',
      'sample-size': '10',
    })

    assert.equal(report.mode, 'batch_files')
    assert.equal(report.summary.total_rows, 3)
    assert.equal(report.summary.valid_image_count, 1)
    assert.equal(report.summary.missing_image_count, 1)
    assert.equal(report.summary.landing_like_count, 1)

    const saved = JSON.parse(await fs.readFile(outputPath, 'utf8'))
    assert.equal(saved.summary.valid_image_count, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

