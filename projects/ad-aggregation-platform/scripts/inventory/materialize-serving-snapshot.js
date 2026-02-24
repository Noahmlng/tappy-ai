#!/usr/bin/env node
import { materializeServingSnapshot } from '../../src/runtime/inventory-sync.js'
import { printJson, withDbPool } from './common.js'

withDbPool(async (pool) => {
  const result = await materializeServingSnapshot(pool)
  printJson(result)
}).catch((error) => {
  console.error('[materialize-serving-snapshot] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
