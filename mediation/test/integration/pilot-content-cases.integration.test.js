import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const CASES_FILE = path.resolve(process.cwd(), 'mediation', 'config', 'pilot-content-cases.json')

test('pilot content cases: validates six-case contract for PartnerStack + House', async () => {
  const payload = JSON.parse(await fs.readFile(CASES_FILE, 'utf8'))
  assert.equal(Array.isArray(payload), true)
  assert.equal(payload.length, 6)

  const ids = new Set()
  const networks = new Set()
  const allowedStates = new Set(['present', 'missing', 'any'])

  for (const row of payload) {
    const id = String(row?.id || '').trim()
    const network = String(row?.network || '').trim().toLowerCase()
    const descriptionState = String(row?.description_state || '').trim().toLowerCase()
    const imageState = String(row?.image_state || '').trim().toLowerCase()

    assert.equal(Boolean(id), true)
    assert.equal(ids.has(id), false)
    ids.add(id)

    assert.equal(network === 'house' || network === 'partnerstack', true)
    networks.add(network)

    assert.equal(allowedStates.has(descriptionState), true)
    assert.equal(allowedStates.has(imageState), true)
  }

  assert.equal(networks.has('house'), true)
  assert.equal(networks.has('partnerstack'), true)
})
