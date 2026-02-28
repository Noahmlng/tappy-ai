#!/usr/bin/env node
import { buildInventoryEmbeddings } from '../../src/runtime/inventory-sync.js'
import { parseArgs, printJson, toPositiveInteger, withDbPool } from './common.js'

const args = parseArgs(process.argv.slice(2))

withDbPool(async (pool) => {
  const result = await buildInventoryEmbeddings(pool, {
    fullRebuild: true,
    batchSize: toPositiveInteger(args.batchSize || args['batch-size'], 5000),
  })
  printJson(result)
}).catch((error) => {
  console.error('[rebuild-embeddings-full] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
