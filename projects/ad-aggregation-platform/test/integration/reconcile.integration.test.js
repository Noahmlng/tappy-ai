import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DIFF_REASON_CODES,
  buildReplayRequestFromDiff,
  reconcileFactSets
} from '../../src/infra/reconcile/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const stdout = []
    const stderr = []

    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))

    child.on('error', reject)
    child.on('exit', (code) => {
      resolve({
        code: Number.isInteger(code) ? code : 1,
        stdout: stdout.join(''),
        stderr: stderr.join('')
      })
    })
  })
}

test('reconcile: detects missing and mismatch records by recordKey', () => {
  const result = reconcileFactSets(
    {
      archiveRecords: [
        {
          recordKey: 'rk_match',
          billable: true,
          amountMicros: 100000,
          anchorHash: 'a1',
          versionAnchorSnapshotRef: 'snapshot_1'
        },
        {
          recordKey: 'rk_missing_in_billing',
          billable: true,
          amountMicros: 300000,
          anchorHash: 'a2',
          versionAnchorSnapshotRef: 'snapshot_2'
        },
        {
          recordKey: 'rk_amount_mismatch',
          billable: true,
          amountMicros: 200000,
          anchorHash: 'a3',
          versionAnchorSnapshotRef: 'snapshot_3'
        }
      ],
      billingRecords: [
        {
          recordKey: 'rk_match',
          billable: true,
          amountMicros: 100000,
          anchorHash: 'a1',
          versionAnchorSnapshotRef: 'snapshot_1'
        },
        {
          recordKey: 'rk_amount_mismatch',
          billable: true,
          amountMicros: 250000,
          anchorHash: 'a3',
          versionAnchorSnapshotRef: 'snapshot_3'
        },
        {
          recordKey: 'rk_missing_in_archive',
          billable: true,
          amountMicros: 110000,
          anchorHash: 'a4',
          versionAnchorSnapshotRef: 'snapshot_4'
        }
      ]
    },
    {
      amountToleranceMicros: 1000
    }
  )

  assert.equal(result.pass, false)
  assert.equal(result.matchedCount, 1)
  assert.equal(result.diffCount, 3)

  const reasonCodes = new Set(result.diffs.map((item) => item.reasonCode))
  assert.equal(reasonCodes.has(DIFF_REASON_CODES.BILLING_MISSING), true)
  assert.equal(reasonCodes.has(DIFF_REASON_CODES.ARCHIVE_MISSING), true)
  assert.equal(reasonCodes.has(DIFF_REASON_CODES.AMOUNT_MISMATCH), true)
})

test('reconcile: replay job binds to version anchor from diff', () => {
  const replayJob = buildReplayRequestFromDiff({
    reasonCode: DIFF_REASON_CODES.ANCHOR_MISMATCH,
    recordKey: 'rk_123',
    responseReference: 'resp_1',
    renderAttemptId: 'ra_1',
    versionAnchorSnapshotRef: 'snapshot_20260221',
    anchorHash: 'hash_abc'
  })

  assert.equal(replayJob.queryPayload.recordKey, 'rk_123')
  assert.equal(replayJob.queryPayload.versionAnchorSnapshotRef, 'snapshot_20260221')
  assert.equal(replayJob.queryPayload.anchorHash, 'hash_abc')
})

test('reconcile: daily report and replay scripts produce runnable artifacts', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-test-'))
  const archiveFile = path.join(tempDir, 'archive.json')
  const billingFile = path.join(tempDir, 'billing.json')
  const reportFile = path.join(tempDir, 'report.json')
  const jobsFile = path.join(tempDir, 'jobs.json')

  await fs.writeFile(
    archiveFile,
    JSON.stringify([
      {
        recordKey: 'rk_a',
        billable: true,
        amountMicros: 100,
        anchorHash: 'h1',
        versionAnchorSnapshotRef: 'snapshot_a'
      }
    ]),
    'utf8'
  )

  await fs.writeFile(
    billingFile,
    JSON.stringify([
      {
        recordKey: 'rk_a',
        billable: true,
        amountMicros: 101,
        anchorHash: 'h1',
        versionAnchorSnapshotRef: 'snapshot_a'
      }
    ]),
    'utf8'
  )

  const reconcileProcess = await runCommand(process.execPath, [
    './scripts/reconcile-daily.js',
    `--archive-file=${archiveFile}`,
    `--billing-file=${billingFile}`,
    `--output-file=${reportFile}`,
    '--amount-tolerance-micros=0'
  ])

  assert.equal(reconcileProcess.code, 0, reconcileProcess.stderr || reconcileProcess.stdout)

  const report = JSON.parse(await fs.readFile(reportFile, 'utf8'))
  assert.equal(report.summary.pass, false)
  assert.equal(report.summary.diffCount, 1)

  const replayProcess = await runCommand(process.execPath, [
    './scripts/reconcile-replay.js',
    `--diff-file=${reportFile}`,
    `--output-file=${jobsFile}`
  ])

  assert.equal(replayProcess.code, 0, replayProcess.stderr || replayProcess.stdout)

  const jobs = JSON.parse(await fs.readFile(jobsFile, 'utf8'))
  assert.equal(jobs.generatedJobs, 1)
  assert.equal(jobs.jobs[0].queryPayload.recordKey, 'rk_a')
})
