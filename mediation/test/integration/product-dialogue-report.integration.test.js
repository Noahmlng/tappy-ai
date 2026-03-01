import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  runProductDialogueReport,
  __productDialogueInternal,
} from '../../scripts/pilot/generate-product-dialogue-report.js'

test('product dialogue report: predictDialogueOutcome respects coverage hits and non-commercial intent', () => {
  const served = __productDialogueInternal.predictDialogueOutcome({
    query: 'best DeepAI pricing plan',
    answerText: 'compare monthly costs',
    brandHits: 2,
  })
  assert.equal(served.predicted_result, 'served')

  const noFill = __productDialogueInternal.predictDialogueOutcome({
    query: 'best DeepAI pricing plan',
    answerText: 'compare monthly costs',
    brandHits: 0,
  })
  assert.equal(noFill.predicted_result, 'no_fill')

  const blocked = __productDialogueInternal.predictDialogueOutcome({
    query: 'how transformer attention works',
    answerText: 'attention weights model token relations',
    brandHits: 10,
  })
  assert.equal(blocked.predicted_result, 'blocked')
})

test('product dialogue report: generates per-product served/no_fill/blocked summary', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'product-dialogue-report-'))
  const coveragePath = path.join(tmpDir, 'coverage.json')
  const meykaPath = path.join(tmpDir, 'meyka.json')
  const deepaiPath = path.join(tmpDir, 'deepai.json')
  const outputPath = path.join(tmpDir, 'report.json')

  await fs.writeFile(coveragePath, `${JSON.stringify({
    summary: {
      brand_hits_by_product: {
        meyka: 3,
        deepai: 0,
      },
    },
  }, null, 2)}\n`, 'utf8')

  await fs.writeFile(meykaPath, `${JSON.stringify({
    scenarios: [
      {
        key: 'meyka_case_1',
        query: 'best Meyka finance assistant pricing',
        answerText: 'compare features and fees',
      },
    ],
  }, null, 2)}\n`, 'utf8')

  await fs.writeFile(deepaiPath, `${JSON.stringify({
    scenarios: [
      {
        key: 'deepai_case_1',
        query: 'best DeepAI API plan',
        answerText: 'compare quality and monthly limits',
      },
      {
        key: 'deepai_case_2',
        query: 'how transformers work',
        answerText: 'self attention helps contextual modeling',
      },
    ],
  }, null, 2)}\n`, 'utf8')

  const report = await runProductDialogueReport({
    'coverage-report': coveragePath,
    'meyka-scenarios': meykaPath,
    'deepai-scenarios': deepaiPath,
    'output-file': outputPath,
    'sample-size': '20',
  })

  assert.equal(report.summary.total_scenarios, 3)
  assert.equal(report.summary.by_product.meyka.outcomes.served, 1)
  assert.equal(report.summary.by_product.deepai.outcomes.no_fill, 1)
  assert.equal(report.summary.by_product.deepai.outcomes.blocked, 1)

  const saved = JSON.parse(await fs.readFile(outputPath, 'utf8'))
  assert.equal(saved.summary.total_scenarios, 3)
})

