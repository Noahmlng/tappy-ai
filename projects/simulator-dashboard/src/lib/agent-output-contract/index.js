const FILE_SECTION_PATTERN = /(^|\n)\s*(#{1,6}\s*)?(files?\s*(changed|updated|modified|list)|changed files?)\s*:?\s*($|\n)/i

const FILE_PATH_PATTERN = /(?:^|[\s`'"])((?:\.{0,2}\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?)(?=$|[\s`'":,)\]])/g

const SMOKE_STEPS = [
  {
    id: 'tokenExchange',
    label: 'token exchange',
    markers: ['/api/v1/public/agent/token-exchange', 'token-exchange', 'token exchange'],
  },
  {
    id: 'config',
    label: 'config',
    markers: ['/api/v1/mediation/config', 'mediation/config'],
  },
  {
    id: 'evaluate',
    label: 'evaluate',
    markers: ['/api/v1/sdk/evaluate', 'sdk/evaluate'],
  },
  {
    id: 'events',
    label: 'events',
    markers: ['/api/v1/sdk/events', 'sdk/events'],
  },
]

function asText(value) {
  return String(value || '')
}

function normalizeText(text) {
  return asText(text).toLowerCase()
}

function uniq(values) {
  return [...new Set(values)]
}

function isLikelyFilePath(value) {
  if (!value) return false
  const lower = value.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false
  if (lower.startsWith('/api/')) return false
  if (lower.includes('api/v1/')) return false
  if (lower.startsWith('/tmp/')) return false
  return value.includes('/') && !value.endsWith('/')
}

function extractFilePaths(text) {
  const matches = []
  const source = asText(text)
  FILE_PATH_PATTERN.lastIndex = 0
  let match = FILE_PATH_PATTERN.exec(source)
  while (match) {
    const candidate = String(match[1] || '').trim()
    if (isLikelyFilePath(candidate)) matches.push(candidate)
    match = FILE_PATH_PATTERN.exec(source)
  }
  return uniq(matches).slice(0, 12)
}

function validateFilesSection(text) {
  const source = asText(text)
  const hasFilesSection = FILE_SECTION_PATTERN.test(source)
  const files = extractFilePaths(source)
  const ok = hasFilesSection && files.length > 0

  if (ok) {
    return {
      ok: true,
      message: `Detected ${files.length} file path(s) under files section.`,
      files,
    }
  }

  if (!hasFilesSection && files.length > 0) {
    return {
      ok: false,
      message: 'Found file paths, but missing a clear `Files changed` section.',
      files,
    }
  }

  if (hasFilesSection) {
    return {
      ok: false,
      message: 'Files section exists, but no valid file paths were detected.',
      files,
    }
  }

  return {
    ok: false,
    message: 'Missing `Files changed` section and file list.',
    files,
  }
}

function findStepIndex(normalizedText, step) {
  let bestIndex = -1
  step.markers.forEach((marker) => {
    const index = normalizedText.indexOf(marker)
    if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
    }
  })
  return bestIndex
}

function validateSmokeChain(text) {
  const normalized = normalizeText(text)
  const positions = SMOKE_STEPS.map((step) => ({
    id: step.id,
    label: step.label,
    index: findStepIndex(normalized, step),
  }))

  const missing = positions.filter((step) => step.index < 0).map((step) => step.label)
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Smoke chain missing: ${missing.join(', ')}.`,
      positions,
    }
  }

  const isOrdered = positions.every((step, index) => (
    index === 0 || step.index >= positions[index - 1].index
  ))
  if (!isOrdered) {
    return {
      ok: false,
      message: 'Smoke steps are present but order is not `token exchange -> config -> evaluate -> events`.',
      positions,
    }
  }

  return {
    ok: true,
    message: 'Detected smoke chain in required order.',
    positions,
  }
}

function extractJsonObjects(text) {
  const source = asText(text)
  const objects = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (start < 0) {
      if (char === '{') {
        start = index
        depth = 1
        inString = false
        escaped = false
      }
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        objects.push(source.slice(start, index + 1))
        start = -1
      }
    }
  }

  return objects
}

function findEvidenceObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return null

  const hasRequiredKeys = (
    Object.prototype.hasOwnProperty.call(value, 'requestId')
    && Object.prototype.hasOwnProperty.call(value, 'decisionResult')
    && Object.prototype.hasOwnProperty.call(value, 'eventsOk')
  )
  if (hasRequiredKeys) return value

  const nestedValues = Object.values(value)
  for (let index = 0; index < nestedValues.length; index += 1) {
    const nested = findEvidenceObject(nestedValues[index], depth + 1)
    if (nested) return nested
  }
  return null
}

function validateEvidence(text) {
  const candidates = extractJsonObjects(text)
  const parsedErrors = []

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    if (!/requestid|decisionresult|eventsok/i.test(candidate)) continue

    try {
      const parsed = JSON.parse(candidate)
      const evidence = findEvidenceObject(parsed)
      if (!evidence) continue

      const requestId = String(evidence.requestId || '')
      const decisionResult = String(evidence.decisionResult || '')
      const eventsOk = evidence.eventsOk

      if (!requestId) {
        return {
          ok: false,
          message: 'Evidence JSON exists, but `requestId` is empty.',
          evidence: null,
        }
      }
      if (!decisionResult) {
        return {
          ok: false,
          message: 'Evidence JSON exists, but `decisionResult` is empty.',
          evidence: null,
        }
      }
      if (typeof eventsOk !== 'boolean') {
        return {
          ok: false,
          message: 'Evidence JSON exists, but `eventsOk` must be boolean.',
          evidence: null,
        }
      }

      return {
        ok: true,
        message: 'Detected valid evidence JSON.',
        evidence: {
          requestId,
          decisionResult,
          eventsOk,
        },
      }
    } catch (error) {
      parsedErrors.push(error instanceof Error ? error.message : 'invalid json')
    }
  }

  if (parsedErrors.length > 0) {
    return {
      ok: false,
      message: 'Found JSON-like evidence block, but parsing failed.',
      evidence: null,
    }
  }

  return {
    ok: false,
    message: 'Missing evidence JSON (`requestId`, `decisionResult`, `eventsOk`).',
    evidence: null,
  }
}

export function validateAgentOutputContract(agentOutput) {
  const text = asText(agentOutput)
  const files = validateFilesSection(text)
  const smoke = validateSmokeChain(text)
  const evidence = validateEvidence(text)
  const checks = [files, smoke, evidence]
  const passed = checks.filter((item) => item.ok).length

  return {
    ok: checks.every((item) => item.ok),
    score: `${passed}/3`,
    checks: {
      files,
      smoke,
      evidence,
    },
  }
}
