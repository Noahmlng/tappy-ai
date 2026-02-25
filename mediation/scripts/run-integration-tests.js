import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const INTEGRATION_TEST_DIR = path.join(PROJECT_ROOT, 'test', 'integration')

async function findIntegrationTests() {
  try {
    const entries = await fs.readdir(INTEGRATION_TEST_DIR, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
      .map((entry) => path.join(INTEGRATION_TEST_DIR, entry.name))
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    return []
  }
}

function normalizeKeyword(rawArgs = []) {
  return String(rawArgs.join(' ') || '')
    .trim()
    .toLowerCase()
}

function runNodeTests(files = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', ...files], {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
      env: process.env
    })

    child.on('exit', (code) => {
      resolve(Number.isInteger(code) ? code : 1)
    })
  })
}

async function main() {
  const allTests = await findIntegrationTests()
  if (allTests.length === 0) {
    console.error('[test:integration] no integration test files were found.')
    process.exit(1)
  }

  const keyword = normalizeKeyword(process.argv.slice(2))
  const selectedTests = keyword
    ? allTests.filter((filePath) => path.basename(filePath).toLowerCase().includes(keyword))
    : allTests

  if (selectedTests.length === 0) {
    console.error(`[test:integration] no tests matched keyword="${keyword}".`)
    process.exit(1)
  }

  console.log(`[test:integration] running ${selectedTests.length} file(s).`)
  for (const filePath of selectedTests) {
    console.log(`  - ${path.relative(PROJECT_ROOT, filePath)}`)
  }

  const exitCode = await runNodeTests(selectedTests)
  process.exit(exitCode)
}

main().catch((error) => {
  console.error(`[test:integration] failed: ${error.message}`)
  process.exit(1)
})
