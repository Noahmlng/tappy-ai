import { B_GATING_SEMANTIC_SLOTS } from './canonical-dict.js'

export const B_CONFLICT_REASON_CODES = Object.freeze({
  OVERRIDE_BY_PRIORITY: 'b_conflict_override_by_priority',
  OVERRIDE_BY_TIE_BREAK: 'b_conflict_override_by_tie_break',
  MERGE_UNION: 'b_conflict_merge_union',
  REJECT_GATING_HARD: 'b_conflict_reject_gating_hard',
  REJECT_UNMERGEABLE: 'b_conflict_reject_unmergeable'
})

const DEFAULT_SOURCE_PRIORITY = Object.freeze({
  appExplicit: 1,
  placementConfig: 2,
  defaultPolicy: 3
})

const DEFAULT_SET_LIKE_WHITELIST = new Set([
  'restrictedCategoryFlags',
  'experimentTags'
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').trim()
}

function parseTimeMs(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function canonicalKey(value) {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].map((item) => normalizeText(item)).sort((a, b) => a.localeCompare(b)))
  }
  return normalizeText(value)
}

function isUnknownValue(value) {
  return normalizeText(value).startsWith('unknown_')
}

function normalizeCandidate(rawCandidate, index, sourcePriorityMap) {
  const candidate = isPlainObject(rawCandidate) ? rawCandidate : {}
  const source = normalizeText(candidate.source) || 'unknown'
  const priority = Number.isFinite(candidate.sourcePriority)
    ? Number(candidate.sourcePriority)
    : (sourcePriorityMap[source] ?? 999)

  const normalizedValue = candidate.normalizedValue
  return {
    source,
    rawValue: candidate.rawValue,
    normalizedValue,
    sourcePriority: priority,
    inputUpdatedAt: normalizeText(candidate.inputUpdatedAt),
    sourceSequence: Number.isFinite(candidate.sourceSequence) ? Number(candidate.sourceSequence) : index,
    _canonicalKey: canonicalKey(normalizedValue)
  }
}

function deduplicateSetValues(values = []) {
  return [...new Set(values.map((item) => normalizeText(item)).filter(Boolean))]
}

function unionSetCandidates(candidates = []) {
  const unionValues = []
  for (const candidate of candidates) {
    const value = candidate.normalizedValue
    if (Array.isArray(value)) {
      unionValues.push(...value)
      continue
    }
    if (typeof value === 'string') {
      unionValues.push(value)
      continue
    }
    return null
  }
  return deduplicateSetValues(unionValues).sort((a, b) => a.localeCompare(b))
}

function buildSnapshotBase(semanticSlot, candidates, conflictPolicyVersion) {
  return {
    semanticSlot,
    candidates: candidates.map((candidate) => ({
      source: candidate.source,
      rawValue: candidate.rawValue,
      normalizedValue: candidate.normalizedValue,
      sourcePriority: candidate.sourcePriority
    })),
    conflictAction: 'none',
    selectedValue: '',
    reasonCode: '',
    tieBreakRule: '',
    conflictPolicyVersion
  }
}

function tieBreakSamePriority(candidates = []) {
  let working = [...candidates]

  const nonUnknown = working.filter((candidate) => !isUnknownValue(candidate.normalizedValue))
  if (nonUnknown.length === 1) {
    return { winner: nonUnknown[0], tieBreakRule: 'prefer_non_unknown' }
  }
  if (nonUnknown.length > 1) {
    working = nonUnknown
  }

  const maxUpdatedAt = Math.max(...working.map((candidate) => parseTimeMs(candidate.inputUpdatedAt)))
  const latest = working.filter((candidate) => parseTimeMs(candidate.inputUpdatedAt) === maxUpdatedAt)
  if (latest.length === 1) {
    return { winner: latest[0], tieBreakRule: 'prefer_later_input_updated_at' }
  }
  working = latest

  const maxSourceSequence = Math.max(...working.map((candidate) => candidate.sourceSequence))
  const latestSequence = working.filter((candidate) => candidate.sourceSequence === maxSourceSequence)
  if (latestSequence.length === 1) {
    return { winner: latestSequence[0], tieBreakRule: 'prefer_larger_source_sequence' }
  }
  working = latestSequence

  const sortedByCanonical = [...working].sort((a, b) => a._canonicalKey.localeCompare(b._canonicalKey))
  return {
    winner: sortedByCanonical[0],
    tieBreakRule: 'prefer_lexicographically_smallest_normalized_value'
  }
}

export function createConflictResolver(options = {}) {
  const sourcePriorityMap = {
    ...DEFAULT_SOURCE_PRIORITY,
    ...(isPlainObject(options.sourcePriorityMap) ? options.sourcePriorityMap : {})
  }
  const conflictPolicyVersion = normalizeText(options.conflictPolicyVersion) || 'b_conflict_policy_v1'
  const setLikeWhitelist = new Set(DEFAULT_SET_LIKE_WHITELIST)
  if (Array.isArray(options.setLikeSemanticSlots)) {
    for (const slot of options.setLikeSemanticSlots) {
      const normalized = normalizeText(slot)
      if (normalized) setLikeWhitelist.add(normalized)
    }
  }

  function resolveFieldConflict(input) {
    const request = isPlainObject(input) ? input : {}
    const semanticSlot = normalizeText(request.semanticSlot)
    const rawCandidates = Array.isArray(request.candidates) ? request.candidates : []
    const fieldStrategy = normalizeText(request.fieldStrategy) || (setLikeWhitelist.has(semanticSlot) ? 'set_like' : 'scalar')
    const isGating = B_GATING_SEMANTIC_SLOTS.includes(semanticSlot)

    const candidates = rawCandidates.map((candidate, index) => normalizeCandidate(candidate, index, sourcePriorityMap))
    const snapshot = buildSnapshotBase(semanticSlot, candidates, conflictPolicyVersion)

    if (!semanticSlot || candidates.length === 0) {
      snapshot.conflictAction = 'reject'
      snapshot.reasonCode = B_CONFLICT_REASON_CODES.REJECT_UNMERGEABLE
      snapshot.selectedValue = null
      return snapshot
    }

    const uniqueValueKeys = [...new Set(candidates.map((candidate) => candidate._canonicalKey))]
    if (uniqueValueKeys.length <= 1) {
      snapshot.conflictAction = 'none'
      snapshot.selectedValue = candidates[0].normalizedValue
      return snapshot
    }

    if (isGating) {
      snapshot.conflictAction = 'reject'
      snapshot.reasonCode = B_CONFLICT_REASON_CODES.REJECT_GATING_HARD
      snapshot.selectedValue = null
      return snapshot
    }

    if (fieldStrategy === 'set_like') {
      const merged = unionSetCandidates(candidates)
      if (!merged) {
        snapshot.conflictAction = 'reject'
        snapshot.reasonCode = B_CONFLICT_REASON_CODES.REJECT_UNMERGEABLE
        snapshot.selectedValue = null
        return snapshot
      }
      snapshot.conflictAction = 'merge'
      snapshot.selectedValue = merged
      snapshot.reasonCode = B_CONFLICT_REASON_CODES.MERGE_UNION
      return snapshot
    }

    if (fieldStrategy !== 'scalar') {
      snapshot.conflictAction = 'reject'
      snapshot.reasonCode = B_CONFLICT_REASON_CODES.REJECT_UNMERGEABLE
      snapshot.selectedValue = null
      return snapshot
    }

    const sortedByPriority = [...candidates].sort((a, b) => a.sourcePriority - b.sourcePriority)
    const highestPriority = sortedByPriority[0].sourcePriority
    const samePriorityCandidates = sortedByPriority.filter((candidate) => candidate.sourcePriority === highestPriority)

    if (samePriorityCandidates.length === 1) {
      snapshot.conflictAction = 'override'
      snapshot.selectedValue = samePriorityCandidates[0].normalizedValue
      snapshot.reasonCode = B_CONFLICT_REASON_CODES.OVERRIDE_BY_PRIORITY
      return snapshot
    }

    const tieBreak = tieBreakSamePriority(samePriorityCandidates)
    snapshot.conflictAction = 'override'
    snapshot.selectedValue = tieBreak.winner.normalizedValue
    snapshot.reasonCode = B_CONFLICT_REASON_CODES.OVERRIDE_BY_TIE_BREAK
    snapshot.tieBreakRule = tieBreak.tieBreakRule
    return snapshot
  }

  return {
    resolveFieldConflict
  }
}
