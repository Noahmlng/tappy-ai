# AI Assistant Placement Product Spec

- Document Version: v1.0
- Last Updated: 2026-02-17
- Scope: Chat/Assistant placement product definition, governance, and execution alignment

## 1) Document Purpose

This document is the single source of truth for:

1. What placement products exist.
2. How each placement should be designed.
3. What global rules all placements must follow.

This is a product-spec document, not a conversation log.

## 2) Core Model

### 2.1 Placement Product Definition

A placement product is a controlled commercial intervention unit in AI task flow.

`Placement Product = Layer + Trigger Logic + Inventory Contract + Governance Policy`

### 2.2 Layer Taxonomy

| Layer | Definition | Intervention Depth |
| --- | --- | --- |
| Attach Layer | Add commercial value on top of existing answer without changing core answer logic. | Low |
| Next-Step Layer | Guide user's next action or conversation branch. | Medium-Low |
| Intervention Layer | Commercial logic intervenes in response generation or tool execution. | Medium-High |
| Takeover Layer | Move user into a brand-led task completion flow. | High |

> Naming note: if "Attention Layer" appears in internal discussion, map it to **Attach Layer**.

## 3) Placement Addressing Standard

### 3.1 Placement Key

Use stable IDs: `<layer>.<placement_type>`

Examples:
- `attach.post_answer_render`
- `next_step.guided_followup`
- `intervention.context_injection`
- `takeover.plan_based_app`

### 3.2 Product Selection Rule

Any future deep-dive should explicitly reference:

1. `layer`
2. `placement_key`
3. `target surface` (chat/follow-up/agent panel/etc.)

This allows direct spec expansion for one specific placement.

## 4) Placement Registry (Master List)

| Placement Key | Layer | One-line Positioning | Trigger Family | Inventory Family |
| --- | --- | --- | --- | --- |
| `attach.post_answer_render` | Attach | Post-answer entity enhancement (affiliate/link) | answer_completed + entity_detected | link/price/destination |
| `attach.inline_entity_annotation` | Attach | Inline sponsored annotation on entities | entity_detected + quality_pass | annotation/tag/light_offer |
| `attach.post_result_addon` | Attach | Add-on module after main answer | answer_completed + transactional_intent | card/list/action |
| `next_step.intent_card` | Next-Step | Intent-triggered card for next action | intent_threshold | card/list/form/action |
| `next_step.guided_followup` | Next-Step | Sponsored follow-up option in suggestion set | followup_generation | suggestion/branch |
| `next_step.clarification_branch` | Next-Step | Commercially eligible option in clarification | clarification_needed | choice/branch/action |
| `next_step.multimodal_prompt_block` | Next-Step | Multimodal suggestion block for next step | high_complexity_or_emotional_context | image/video/block |
| `intervention.search_parallel` | Intervention | Run Ad Search in parallel with Web Search | external_search_called | ad_search_context |
| `intervention.search_autonomous` | Intervention | Autonomous Ad Search when relevance is high | relevance_high_without_explicit_search | ad_search_context |
| `intervention.context_injection` | Intervention | Inject ad results into model context | context_assembly | retrieved_ad_context |
| `intervention.dual_answer` | Intervention | Base answer + advertiser expert answer | high_value_or_specialized_query | dual_response |
| `intervention.prompt_steering` | Intervention | Controlled response steering by ad opportunity | policy_approved_opportunity | prompt_policy_control |
| `takeover.plan_based_app` | Takeover | Generated plan app for complex tasks | high_complexity_task | mini_app/workspace |
| `takeover.branded_execution_flow` | Takeover | Brand-led multi-step execution | execution_intent_confirmed | flow/page/action_chain |
| `takeover.task_cockpit` | Takeover | Stage-based task cockpit | long_task_with_checkpoints | cockpit/modules |
| `takeover.long_horizon_workflow` | Takeover | Cross-session commercial workflow | recurring_or_long_horizon_goal | workflow/program |

## 5) Global Design System (All Placements)

## 5.1 Required Spec Blocks Per Placement

Every placement must define all blocks below:

1. `Positioning`
2. `User Value`
3. `Commercial Value`
4. `Trigger Logic`
5. `Inventory Contract`
6. `Interaction Contract`
7. `Control Owner` (user/model/advertiser/platform)
8. `Disclosure`
9. `Guardrails`
10. `Billing Event`
11. `Success Metrics`
12. `Fallback`

## 5.2 Global Hard Rules

1. User can always continue core chat path.
2. Sponsored signal must be visible and machine-auditable.
3. Sensitive topics follow platform-level block policy.
4. Frequency cap and dedup are mandatory.
5. Every impression/click/lead/conversion must be traceable.

## 5.3 Control Ownership Matrix

| Domain | Owner |
| --- | --- |
| Trigger eligibility and safety gate | Platform |
| Supply bid/offer payload | Advertiser/DSP |
| Final rendering decision | Platform/Model policy |
| User action choice | User |

## 5.4 Billing Event Standard

Allowed billing events:

1. `impression`
2. `click`
3. `qualified_lead`
4. `conversion`
5. `task_completion` (advanced placements only)

## 6) Layer-Level Design Intent

## 6.1 Attach Layer

Intent:
- Commercially enrich existing answer output with minimal disruption.

Must:
1. Run after answer completion.
2. Keep original answer semantics unchanged.
3. Keep high transparency and low intrusion.

Must Not:
1. Rewrite answer logic.
2. Force branch switch.
3. Create mandatory external flow jump.

## 6.2 Next-Step Layer

Intent:
- Provide optional next actions and branches.

Must:
1. Keep sponsored branch skippable.
2. Preserve user agency for next message.

## 6.3 Intervention Layer

Intent:
- Intervene in reasoning/tool stage under policy control.

Must:
1. Be auditable.
2. Be bounded by model and safety policy.

## 6.4 Takeover Layer

Intent:
- Handle long or complex tasks in dedicated commercial workflow.

Must:
1. Explicitly indicate flow transition.
2. Provide return path to chat.

## 7) Attach Layer Product Specs

## 7.1 `attach.post_answer_render`

- Positioning: Post-answer enhancement for commercial entities already present in response.
- Trigger Logic:
1. `answer_completed = true`
2. `entity_detected = true`
3. `entity_confidence >= threshold`
- Inventory Contract:
1. `TEXT_LINK`
2. `PRICE_HINT`
3. `MERCHANT_DESTINATION`
- Interaction Contract:
1. Click to merchant/affiliate destination.
2. Optional multi-merchant selection.
- Control Owner:
1. Platform controls render/no-render and count.
2. Advertiser provides offers only.
- Disclosure: show `Sponsored` or `Affiliate`.
- Guardrails:
1. No semantic rewrite.
2. No non-commercial entity hijack.
3. Sensitive topic block by default.
- Billing Event: default `click`; optional `conversion`.
- Primary Metrics: `attach_ctr`, `revenue_per_answer`, `satisfaction_delta`.
- Fallback: no qualified offer => no render.

## 7.2 `attach.inline_entity_annotation`

- Positioning: Lightweight sponsored annotation near detected entities.
- Trigger Logic:
1. Entity detected with high confidence.
2. Annotation content passes quality filter.
- Inventory Contract:
1. `ANNOTATION_BADGE`
2. `SOURCE_TAG`
3. `LIGHTWEIGHT_OFFER`
- Interaction Contract:
1. Click to expand details or open destination.
2. No click required to continue reading.
- Control Owner:
1. Platform controls placement and quantity.
2. Advertiser cannot write raw answer text.
- Disclosure: sponsored tag in annotation and detail panel.
- Guardrails:
1. Higher confidence threshold than `post_answer_render`.
2. Max one sponsored annotation per paragraph.
3. No mix with safety warning text block.
- Billing Event: `click` preferred; optional `impression`.
- Primary Metrics: `annotation_view_rate`, `annotation_ctr`, `negative_feedback_rate`.
- Fallback: low confidence => downgrade or no render.

## 7.3 `attach.post_result_addon`

- Positioning: One optional module after main answer for relevant next action.
- Trigger Logic:
1. `answer_completed = true`
2. `transactional_followup_intent = true` OR `execution_gap_detected = true`
- Inventory Contract:
1. `CARD`
2. `LIST`
3. `ACTION_BUTTON`
- Interaction Contract:
1. Click for details / action / continue with prompt.
2. Module is always skippable.
- Control Owner:
1. Platform decides module display and number of items.
2. Advertiser supplies candidate payload.
- Disclosure: module-level sponsored label.
- Guardrails:
1. Max one module per answer.
2. Max three items by default.
3. Enforce cooldown across turns.
- Billing Event: `click` / `qualified_lead`.
- Primary Metrics: `addon_ctr`, `lead_rate`, `chat_continuation_rate`.
- Fallback: no qualified candidates => no module.

## 8) Placement Spec Template (for Future Expansion)

Use this template when expanding any single placement product:

1. `placement_key`
2. `surface`
3. `Positioning`
4. `User Value`
5. `Commercial Value`
6. `Trigger Logic` (conditions, thresholds, cooldown)
7. `Inventory Contract`
8. `Interaction Contract`
9. `Control Owner`
10. `Disclosure`
11. `Guardrails`
12. `Billing Event`
13. `Success Metrics`
14. `Fallback`
15. `Open Questions`

## 9) Candidate Extensions (Not in MVP Commit)

1. `next_step.post_completion_reengagement`
2. `intervention.tool_selection_router`
3. `takeover.cross_session_program`

## 10) Implementation Specs Index

1. Attach Layer affiliate-link aggregator:
`/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/docs/attach-affiliate-aggregator-design.md`
