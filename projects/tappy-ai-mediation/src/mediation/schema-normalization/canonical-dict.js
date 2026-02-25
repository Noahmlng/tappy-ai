export const B_ENUM_DICT_VERSION = 'b_enum_dict_v1'

const TRIGGER_DECISION_VALUES = Object.freeze([
  'opportunity_eligible',
  'opportunity_ineligible',
  'opportunity_blocked_by_policy',
  'unknown_trigger_decision'
])

const DECISION_OUTCOME_VALUES = Object.freeze([
  'opportunity_eligible',
  'opportunity_ineligible',
  'opportunity_blocked_by_policy',
  'unknown_decision_outcome'
])

const HIT_TYPE_VALUES = Object.freeze([
  'explicit_hit',
  'workflow_hit',
  'contextual_hit',
  'scheduled_hit',
  'policy_forced_hit',
  'no_hit',
  'unknown_hit_type'
])

const PLACEMENT_TYPE_VALUES = Object.freeze([
  'chat_inline',
  'tool_result',
  'workflow_checkpoint',
  'agent_handoff',
  'unknown_placement_type'
])

const ACTOR_TYPE_VALUES = Object.freeze([
  'human',
  'agent',
  'agent_chain',
  'system',
  'unknown_actor_type'
])

const CHANNEL_TYPE_VALUES = Object.freeze([
  'sdk_server',
  'sdk_client',
  'webhook',
  'batch',
  'unknown_channel_type'
])

const SLOT_DEFINITIONS = Object.freeze({
  triggerDecision: Object.freeze({
    unknownValue: 'unknown_trigger_decision',
    gating: true,
    canonicalValues: TRIGGER_DECISION_VALUES,
    aliases: Object.freeze({
      eligible: 'opportunity_eligible',
      ineligible: 'opportunity_ineligible',
      blocked_by_policy: 'opportunity_blocked_by_policy',
      policy_blocked: 'opportunity_blocked_by_policy'
    })
  }),
  decisionOutcome: Object.freeze({
    unknownValue: 'unknown_decision_outcome',
    gating: true,
    canonicalValues: DECISION_OUTCOME_VALUES,
    aliases: Object.freeze({
      eligible: 'opportunity_eligible',
      ineligible: 'opportunity_ineligible',
      blocked_by_policy: 'opportunity_blocked_by_policy',
      policy_blocked: 'opportunity_blocked_by_policy'
    })
  }),
  hitType: Object.freeze({
    unknownValue: 'unknown_hit_type',
    gating: true,
    canonicalValues: HIT_TYPE_VALUES,
    aliases: Object.freeze({
      explicit_intent: 'explicit_hit',
      intent_hit: 'explicit_hit',
      workflow: 'workflow_hit',
      contextual: 'contextual_hit',
      scheduled: 'scheduled_hit',
      policy_forced: 'policy_forced_hit'
    })
  }),
  placementType: Object.freeze({
    unknownValue: 'unknown_placement_type',
    gating: false,
    canonicalValues: PLACEMENT_TYPE_VALUES,
    aliases: Object.freeze({
      chat_inline_v1: 'chat_inline',
      chat_from_answer_v1: 'chat_inline',
      chat_followup_v1: 'next_step',
      chat_intent_recommendation_v1: 'next_step',
      chat_inline_slot: 'chat_inline',
      chat_inline_message: 'chat_inline',
      chat_inline_card: 'chat_inline',
      chat_inline_unit: 'chat_inline',
      chat_inline_banner: 'chat_inline',
      chat_inline_surface: 'chat_inline',
      chat_inline_placement: 'chat_inline',
      chat_inline_widget: 'chat_inline',
      chat_inline_module: 'chat_inline',
      chat_inline_panel: 'chat_inline',
      chat_inline_block: 'chat_inline',
      chat_inline_row: 'chat_inline',
      chat_inline_entry: 'chat_inline',
      chat_inline_feed: 'chat_inline',
      chat_inline_embed: 'chat_inline',
      chat_inline_component: 'chat_inline',
      chat_inline_area: 'chat_inline',
      chat_inline_zone: 'chat_inline',
      chat_inline_view: 'chat_inline',
      chat_inline_container: 'chat_inline',
      chat_inline_segment: 'chat_inline',
      chat_inline_layout: 'chat_inline',
      in_message: 'chat_inline',
      chat_inline_message_slot: 'chat_inline',
      tool_output: 'tool_result',
      function_result: 'tool_result',
      workflow_step: 'workflow_checkpoint',
      agent_transfer: 'agent_handoff'
    })
  }),
  actorType: Object.freeze({
    unknownValue: 'unknown_actor_type',
    gating: false,
    canonicalValues: ACTOR_TYPE_VALUES,
    aliases: Object.freeze({
      end_user: 'human',
      human_user: 'human',
      assistant_agent: 'agent',
      auto_agent: 'agent',
      orchestrator_chain: 'agent_chain',
      backend_system: 'system'
    })
  }),
  channelType: Object.freeze({
    unknownValue: 'unknown_channel_type',
    gating: false,
    canonicalValues: CHANNEL_TYPE_VALUES,
    aliases: Object.freeze({
      sdk_http: 'sdk_server',
      rest: 'sdk_server',
      sdk_mobile: 'sdk_client',
      client_sdk: 'sdk_client',
      web_hook: 'webhook',
      job_batch: 'batch'
    })
  })
})

export const B_GATING_SEMANTIC_SLOTS = Object.freeze([
  'triggerDecision',
  'decisionOutcome',
  'hitType'
])

export const B_CANONICAL_ENUM_DICTIONARY = Object.freeze({
  enumDictVersion: B_ENUM_DICT_VERSION,
  semanticSlots: SLOT_DEFINITIONS
})

export function normalizeEnumToken(rawValue) {
  return String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
}

export function resolveCanonicalEnum(semanticSlot, rawValue) {
  const slotDefinition = SLOT_DEFINITIONS[semanticSlot]
  if (!slotDefinition) {
    return {
      ok: false,
      semanticSlot,
      normalizedRawValue: normalizeEnumToken(rawValue),
      canonicalValue: '',
      unknownValue: '',
      mappingAction: 'reject',
      isUnknown: false,
      gating: false
    }
  }

  const normalizedRawValue = normalizeEnumToken(rawValue)
  const canonicalSet = new Set(slotDefinition.canonicalValues)

  if (canonicalSet.has(normalizedRawValue)) {
    return {
      ok: true,
      semanticSlot,
      normalizedRawValue,
      canonicalValue: normalizedRawValue,
      unknownValue: slotDefinition.unknownValue,
      mappingAction: 'exact_match',
      isUnknown: normalizedRawValue === slotDefinition.unknownValue,
      gating: slotDefinition.gating
    }
  }

  if (normalizedRawValue && slotDefinition.aliases[normalizedRawValue]) {
    const canonicalValue = slotDefinition.aliases[normalizedRawValue]
    return {
      ok: true,
      semanticSlot,
      normalizedRawValue,
      canonicalValue,
      unknownValue: slotDefinition.unknownValue,
      mappingAction: 'alias_map',
      isUnknown: canonicalValue === slotDefinition.unknownValue,
      gating: slotDefinition.gating
    }
  }

  return {
    ok: true,
    semanticSlot,
    normalizedRawValue,
    canonicalValue: slotDefinition.unknownValue,
    unknownValue: slotDefinition.unknownValue,
    mappingAction: 'unknown_fallback',
    isUnknown: true,
    gating: slotDefinition.gating
  }
}
