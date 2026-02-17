# AI Assistant Placement Product Spec

- Document Version: v1.2
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
| `next_step.intent_card` | Next-Step | Intent-triggered recommendation card in related-product section | intent_threshold + semantic_match | card/list/form/action |
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
- Provide optional next actions and branches based on interpreted user intent.

Must:
1. Keep sponsored branch skippable.
2. Preserve user agency for next message.
3. Render as an independent recommendation surface (for example, an Intent Card), not as a mandatory step in core answer flow.
4. Use current-turn + session-context signals for recommendation relevance.
5. Keep fail-open behavior: recommendation failure cannot block chat continuation.

Must Not:
1. Rewrite main answer content.
2. Force user into sponsored flow before they continue chat.
3. Trigger recommendation without minimum intent confidence.

### 6.2.1 Next-Step Standard Decision Pipeline

1. Intent understanding:
- Parse purchase/exploration intent and preference constraints from current turn and recent turns.
2. Eligibility gate:
- Check intent confidence, safety policy, frequency cap, and cooldown.
3. Candidate retrieval:
- Run semantic retrieval over ad inventory using intent + preference embedding.
4. Ranking:
- Score by relevance, policy pass, expected utility, and monetization signal.
5. Render decision:
- If score threshold is met, render Intent Card in Next-Step surface; otherwise no render.

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

## 8) Next-Step Layer Product Specs

## 8.1 `next_step.intent_card` (Related Product Recommendation)

- Surface: `related_product_recommendation` block below answer and before follow-up suggestions.
- Positioning: Intent-triggered sponsored recommendation card for "what to do/buy next".
- User Value:
1. Reduces search effort by turning intent and preference signals into concrete recommendations.
2. Preserves chat continuity because the card is optional and non-blocking.
- Commercial Value:
1. Captures high-intent traffic at decision moment.
2. Improves recommendation quality via semantic matching instead of keyword-only matching.
- Trigger Logic:
1. `answer_completed = true`
2. `next_step_slot_available = true`
3. `intent_class in {shopping, purchase_intent, gifting, product_exploration}`
4. `intent_score >= next_step_intent_threshold`
5. `semantic_match_score >= semantic_retrieval_threshold`
6. `safety_pass = true` and `frequency_cap_pass = true`
- Inventory Source (MVP):
1. Use affiliate `list all links` result as full product corpus for Intent Card.
2. Connector mapping:
- `PartnerStack`: `listLinksByPartnership` output.
- `CJ`: `listLinks` output (merged with products/offers fallback if needed).
3. Normalize all links into one `IntentCardCatalog` with a stable `item_id`.
4. If feed metadata is sparse, enrich using title/url path/network metadata and lightweight LLM extraction.
- Semantic Retrieval Contract:
1. Query input: current turn + recent turns + extracted preference facets.
2. Retrieval method: vector/semantic search over `IntentCardCatalog` (affiliate links index).
3. Match evidence: each candidate must include at least one relevance reason tied to user intent or preference.
4. Top-k candidate retrieval should be deterministic under same input + same index snapshot.
- Ranking Strategy:
1. v1 (current): rules-weighted score = relevance + policy pass + quality + monetization signal.
2. Relevance remains primary objective; monetization cannot override policy/safety constraints.
- Item Contract (for UI render):
1. `item_id`
2. `title`
3. `snippet` (optional)
4. `target_url`
5. `merchant_or_network`
6. `price_hint` (optional)
7. `match_reasons[]`
8. `disclosure`
- Interaction Contract:
1. Max one card module per turn; max three items per module.
2. Each item supports `view_detail` and/or `open_destination`.
3. User can skip, ignore, or dismiss without affecting main chat flow.
- Control Owner:
1. Platform controls trigger gate, ranking policy, and render/no-render.
2. Advertiser provides candidate inventory payload only.
- Disclosure:
1. Module-level `Sponsored` label.
2. Item-level attribution to source/merchant.
- Guardrails:
1. No render in blocked sensitive categories.
2. No duplicate merchant/item within cooldown window.
3. Recommendation copy cannot impersonate assistant core answer.
4. If semantic confidence is low, do not render.
- Billing Event: `impression` (optional), `click` (default), `qualified_lead` (optional by vertical).
- Primary Metrics:
1. `intent_card_impression_rate`
2. `intent_card_ctr`
3. `semantic_relevance_feedback_rate`
4. `chat_continuation_rate_after_card`
5. `revenue_per_intent_card`
- Fallback:
1. No qualified semantic candidate => no card.
2. Retrieval timeout/error => skip card and continue chat (fail-open).
- Example Scenarios:
1. User says "我现在想买点东西": classify purchase intent and recommend relevant product cards.
2. User says "我女朋友喜欢材质鲜艳的": extract preference facets and run semantic retrieval for matching products (for example, style-aligned items such as "采气花" in inventory).

## 8.2 `next_step.intent_inference` Module Spec

- Positioning: Dedicated module for intent understanding and preference extraction used by `next_step.intent_card`.
- Why a separate module:
1. Trigger accuracy and recommendation quality depend on stable intent signals.
2. Decoupling allows independent tuning of inference quality without changing SDK rendering logic.
- Module Inputs:
1. `query` (current user turn)
2. `recent_turns` (session window)
3. `locale`
4. Optional profile/context hints (if available and policy-allowed)
- Module Outputs:
1. `intent_class` (`shopping|gifting|exploration|non_commercial|...`)
2. `intent_score` (`0-1`)
3. `preference_facets` (color/material/style/brand/price/use_case/recipient)
4. `constraints` (must-have / must-not)
5. `inference_trace` (short reason code set for observability)

### 8.2.1 Data Collection (MVP -> Growth)

1. Log every evaluate request with:
- `query`, `intent_class`, `intent_score`, `preference_facets`, `decision.result`, `decision.reason`.
2. Log user feedback signals:
- `impression`, `click`, `dismiss`, `hide_similar` (if supported), `post-card continuation`.
3. Build weekly labeled sample set:
- false trigger, missed trigger, bad relevance, good relevance.
4. Use human review + offline replay to calibrate thresholds before major rollout.

### 8.2.2 Inference Strategy

1. Current phase (required now):
- Use simple LLM inference with structured JSON output for `intent_class`, `intent_score`, and `preference_facets`.
- Add deterministic post-rules (threshold, blocked topics, confidence floor).
2. Mid phase:
- Add lightweight classifier/reranker trained on collected logs to stabilize latency and cost.
3. Long phase:
- Evolve toward larger recommendation model for joint intent understanding + retrieval/ranking optimization.

### 8.2.3 Reliability Targets for Intent Module

1. P95 inference latency within Next-Step budget.
2. Parsing failure rate below agreed threshold (fallback to `non_commercial`).
3. Low-confidence outputs must degrade safely to no-render.

## 9) Intent Card Module Definition (MVP)

Define `next_step.intent_card` implementation with explicit modules:

1. SDK Orchestrator Module
- Responsibilities:
1. Trigger `evaluate` at `followup_generation` phase.
2. Pass structured context (`intent_class`, `intent_score`, `preference_facets`, `query`, `recent_turns`).
3. Render card slot and report interaction events.
4. Enforce fail-open (timeout/error => no card, chat continues).
- Boundaries:
1. No recommendation logic hard-coded in UI.
2. No direct dependence on specific affiliate connector internals.

2. Intent Inference Module
- Responsibilities:
1. Infer `intent_class` and `intent_score`.
2. Extract `preference_facets` and hard constraints.
3. Output structured machine-auditable inference trace.
- Boundaries:
1. Only inference and extraction; no final ranking decision.
2. Must output safe fallback (`non_commercial`) on low confidence.

3. Catalog & Index Module
- Responsibilities:
1. Ingest affiliate `list all links` from supported connectors.
2. Normalize to unified `IntentCardCatalog`.
3. Build and refresh semantic retrieval index.
- Boundaries:
1. Catalog stores normalized inventory, not UI state.
2. Connector failures degrade to last valid snapshot.

4. Retrieval & Ranking Module
- Responsibilities:
1. Retrieve candidates by semantic query using inferred intent/facets.
2. Apply safety/eligibility/frequency filters.
3. Rank by relevance-first policy and output top candidates with reasons.
- Boundaries:
1. Policy/safety rules are mandatory and non-overridable by bid signal.
2. Ranking output must be reproducible under same snapshot and inputs.

5. Observability & Governance Module
- Responsibilities:
1. Log decision path (`served/no_fill/blocked/error`) with `requestId`.
2. Track exposure and interaction metrics.
3. Support audit and threshold calibration workflows.
- Boundaries:
1. Logging must not block online serving path.
2. Sensitive-topic policy actions must be explicitly traceable.

## 10) Placement Spec Template (for Future Expansion)

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

## 11) Candidate Extensions (Not in MVP Commit)

1. `next_step.post_completion_reengagement`
2. `intervention.tool_selection_router`
3. `takeover.cross_session_program`

## 12) Implementation Specs Index

1. Attach Layer affiliate-link aggregator:
`/Users/zeming/Documents/chat-ads-main/projects/ad-aggregation-platform/docs/attach-affiliate-aggregator-design.md`
