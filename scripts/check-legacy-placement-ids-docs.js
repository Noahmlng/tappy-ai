#!/usr/bin/env node

const fs = require('node:fs/promises')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..')
const LEGACY_PLACEMENT_IDS = ['chat_inline_v1', 'chat_followup_v1']
const TARGET_PATHS = [
  path.join(REPO_ROOT, 'README.md'),
  path.join(REPO_ROOT, 'docs', 'other', 'integration'),
]
const SCAN_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])
const SKIP_DIRECTORY_NAMES = new Set(['archive', '.git', 'node_modules', '.local'])

function shouldScanFile(filePath) {
  return SCAN_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

async function collectFiles(targetPath) {
  const stats = await fs.stat(targetPath).catch(() => null)
  if (!stats) return []

  if (stats.isFile()) {
    return shouldScanFile(targetPath) ? [targetPath] : []
  }
  if (!stats.isDirectory()) {
    return []
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue
      }
      const nestedFiles = await collectFiles(fullPath)
      files.push(...nestedFiles)
      continue
    }
    if (entry.isFile() && shouldScanFile(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

function findLegacyPlacementViolations(filePath, content) {
  const violations = []
  const lines = String(content || '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const legacyPlacementId of LEGACY_PLACEMENT_IDS) {
      if (!line.includes(legacyPlacementId)) {
        continue
      }
      violations.push({
        filePath,
        lineNumber: index + 1,
        placementId: legacyPlacementId,
        line: line.trim(),
      })
    }
  }
  return violations
}

async function main() {
  const uniqueFiles = new Set()
  for (const targetPath of TARGET_PATHS) {
    const files = await collectFiles(targetPath)
    for (const filePath of files) {
      uniqueFiles.add(filePath)
    }
  }

  const sortedFiles = Array.from(uniqueFiles).sort((a, b) => a.localeCompare(b))
  const violations = []

  for (const filePath of sortedFiles) {
    const content = await fs.readFile(filePath, 'utf8')
    violations.push(...findLegacyPlacementViolations(filePath, content))
  }

  if (violations.length === 0) {
    console.log('[check:docs:placement-ids] PASS: no legacy placement IDs found in guarded docs.')
    return
  }

  console.error('[check:docs:placement-ids] FAIL: legacy placement IDs found in guarded docs:')
  for (const violation of violations) {
    const relativePath = path.relative(REPO_ROOT, violation.filePath)
    console.error(`- ${relativePath}:${violation.lineNumber} contains ${violation.placementId}`)
    if (violation.line) {
      console.error(`  ${violation.line}`)
    }
  }
  process.exit(1)
}

main().catch((error) => {
  console.error(`[check:docs:placement-ids] ERROR: ${error.message}`)
  process.exit(1)
})
