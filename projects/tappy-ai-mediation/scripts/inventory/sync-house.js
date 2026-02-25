#!/usr/bin/env node
import { syncInventoryNetworks } from '../../src/runtime/inventory-sync.js'
import { parseArgs, printJson, toPositiveInteger, withDbPool } from './common.js'

const args = parseArgs(process.argv.slice(2))

withDbPool(async (pool) => {
  const result = await syncInventoryNetworks(pool, {
    networks: ['house'],
    limit: toPositiveInteger(args.limit, 2500),
    search: String(args.search || '').trim(),
    market: String(args.market || 'US').trim() || 'US',
    language: String(args.language || 'en-US').trim() || 'en-US',
    trigger: 'script_sync_house',
  })

  printJson(result)
  if (!result.ok) {
    process.exitCode = 1
  }
}).catch((error) => {
  console.error('[sync-house] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
