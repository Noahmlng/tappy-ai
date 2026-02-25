import { createRuntimeClient, createControlPlaneClient } from './client.js'

const SCHEMA_FILES = Object.freeze({
  placement: new URL('../schemas/placement.schema.json', import.meta.url),
  adRequest: new URL('../schemas/ad-request.schema.json', import.meta.url),
  adResponse: new URL('../schemas/ad-response.schema.json', import.meta.url),
  v2BidRequest: new URL('../schemas/v2-bid-request.schema.json', import.meta.url),
  v2BidResponse: new URL('../schemas/v2-bid-response.schema.json', import.meta.url),
  nextStepIntentCardRequest: new URL('../schemas/next-step-intent-card-request.schema.json', import.meta.url),
  nextStepIntentCardResponse: new URL('../schemas/next-step-intent-card-response.schema.json', import.meta.url),
})

export function listSchemaKeys() {
  return Object.keys(SCHEMA_FILES)
}

export function resolveSchemaUrl(schemaKey) {
  const target = SCHEMA_FILES[schemaKey]
  if (!target) {
    throw new Error(`[contracts] unknown schema key: ${schemaKey}`)
  }
  return target
}

export {
  createRuntimeClient,
  createControlPlaneClient,
}
