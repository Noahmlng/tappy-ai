#!/usr/bin/env node
import { syncInventoryNetworks } from '../../src/runtime/inventory-sync.js'
import { parseArgs, printJson, toPositiveInteger, withDbPool } from './common.js'

const args = parseArgs(process.argv.slice(2))

withDbPool(async (pool) => {
  const result = await syncInventoryNetworks(pool, {
    networks: ['partnerstack'],
    limit: toPositiveInteger(args.limit, 240),
    search: String(args.search || '').trim(),
    trigger: 'script_sync_partnerstack',
  })

  printJson(result)
  if (!result.ok) {
    process.exitCode = 1
  }
}).catch((error) => {
  console.error('[sync-partnerstack] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
