#!/usr/bin/env node
import { buildInventoryEmbeddings } from '../../src/runtime/inventory-sync.js'
import { parseArgs, printJson, toPositiveInteger, withDbPool } from './common.js'

const args = parseArgs(process.argv.slice(2))

withDbPool(async (pool) => {
  const result = await buildInventoryEmbeddings(pool, {
    limit: toPositiveInteger(args.limit, 6000),
  })
  printJson(result)
}).catch((error) => {
  console.error('[build-embeddings] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
