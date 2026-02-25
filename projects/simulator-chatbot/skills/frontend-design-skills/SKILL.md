---
name: frontend-design-skills
description: Unified frontend design skill for implementing or reviewing ChatGPT-style UI in this project. Use when building pages, components, layout systems, or interaction details that should follow the local ChatGPT baseline spec, including spacing, typography, color tokens, button sizing, sidebar/thread/composer structure, and state behavior.
---

# Frontend Design Skills

Follow `/Users/zeming/Documents/chat-ads-main/projects/simulator-chatbot/docs/frontend-design-skills-chatgpt.md` as the source of truth.

## Workflow

1. Define tokens first. Do not hardcode one-off spacing/color/radius values.
2. Build page shell with fixed `260px` sidebar + `52px` header baseline.
3. Implement thread width rules: `40rem` default, `48rem` on large layout.
4. Implement button system with `32/36/40/44` size families.
5. Enforce interaction states: `hover`, `focus-visible`, `active`, `disabled`.
6. Run the DoD checklist from the spec before finishing.

## Hard Constraints

- Use `4px` spacing grid.
- Keep chat bubble radius at `18px`.
- Keep icon action buttons at `36x36` desktop, `40x40` touch.
- Keep sidebar items around `36px` height, `10px` radius, `14px` text.
- Ensure every interactive control has focus-visible styling and disabled semantics.

## Output Expectations

- When implementing UI, return changed files and mention which spec sections were applied.
- When reviewing UI, list mismatches against the spec with concrete pixel/token differences.
