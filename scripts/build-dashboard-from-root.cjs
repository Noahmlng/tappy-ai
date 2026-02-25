#!/usr/bin/env node

const { execSync } = require('node:child_process')
const { cpSync, existsSync, rmSync } = require('node:fs')
const path = require('node:path')

const repoRoot = process.cwd()
const dashboardDist = path.resolve(repoRoot, 'projects/simulator-dashboard/dist')
const rootDist = path.resolve(repoRoot, 'dist')

execSync('npm run build --workspace @ai-network/dashboard', { stdio: 'inherit' })

if (!existsSync(dashboardDist)) {
  throw new Error(`Dashboard dist not found: ${dashboardDist}`)
}

rmSync(rootDist, { recursive: true, force: true })
cpSync(dashboardDist, rootDist, { recursive: true })

console.log(`[build-dashboard-from-root] copied ${dashboardDist} -> ${rootDist}`)
