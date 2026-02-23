# Dashboard + Simulator Vibe Coding UI Governance v1

## 1. Purpose

This document defines non-negotiable design and implementation constraints for:

- `projects/simulator-dashboard`
- `projects/simulator-chatbot`

Goal: deliver a restrained, premium, low-noise interface aligned with Exa/Panxo (Dashboard) and ChatGPT/Codex clarity (Simulator), while avoiding AI-generic visual output.

## 2. Product-Level North Star

### Dashboard

- Primary job: make API-first flow legible in under 10 seconds.
- Default visible flow: `API Key -> Request Path -> 24h Usage`.
- Max 3 top-level nav items: `Home`, `API Keys`, `Usage`.
- Anything else is legacy and must be visually deprioritized.

### Simulator

- Primary job: conversation completion with minimal cognitive load.
- Default visible modules: chat history, system prompt, message stream, composer, sources, tool card.
- Debug-only modules: turn trace, sponsored, follow-up, intent card.

## 3. Visual Contract (Hard Limits)

### Typography

- Font families:
  - UI/body: `Soehne`
  - Display accents: `Tiempos Headline` (Dashboard hero/KPI only)
  - Mono labels/status: `Soehne Mono`
- Allowed size scale:
  - Body: `14, 15, 16`
  - Small labels: `11, 12`
  - Section titles: `28, 32, 36`
  - Hero title max: `60`
- Forbidden:
  - Any ad-hoc size > `60`
  - Mixing more than 3 font families
  - Decorative letter-spacing on body text

### Spacing & Radius

- Spacing scale: `4, 6, 8, 10, 12, 14, 16, 18, 24, 32`.
- Radius scale: `8, 12, 16` only.
- Shadow: one subtle elevation token only.
- Animation duration: `140ms-220ms`; no long staged spectacle transitions.

### Color

- Light-first neutral canvas.
- Accent usage must be sparse and semantic (`primary action`, `selected state`, `link emphasis`).
- Status colors are semantic only:
  - running: amber family
  - done/success: emerald family
  - error: red family
- Forbidden:
  - Gradient-heavy panels as default surfaces
  - Neon effects, glow overlays, texture noise overlays

## 4. Information Architecture Rules

- Default view must show only essential decisions and next action.
- Any module that does not directly support next action is hidden by default.
- Empty states must include exactly one primary action.
- Dashboard and Simulator must both keep a single visual primary CTA per viewport region.

## 5. Component Strategy (shadcn-vue First)

- Use `shadcn-vue` as base primitives for interaction/a11y.
- Use custom tokens for final visual language.
- Component policy:
  - Allow: button, input/textarea, card, badge, table, dropdown, sheet/drawer, dialog.
  - Avoid introducing custom one-off component APIs unless used in 2+ places.
- Local wrappers are allowed to enforce product semantics (`PrimaryButton`, `StatusBadge`, etc.).

## 6. Vibe Coding Workflow (Required)

### Step A: Intent Lock

Before generating code, define:

1. page purpose
2. single user path
3. visible module whitelist
4. forbidden modules list

### Step B: Constraint Prompting

Every AI coding prompt must include:

1. typography scale
2. spacing scale
3. color semantic constraints
4. forbidden patterns

### Step C: Visual Gate

No UI change is accepted without:

1. build success for both apps
2. Playwright screenshots under `output/playwright/`
3. side-by-side review against last accepted baseline

## 7. Acceptance Checklist

- No dense visual clutter.
- Primary path is readable without scrolling in default desktop viewport.
- Keyboard focus states are visible and consistent.
- Status meaning is recognizable without reading details.
- Debug modules are hidden when debug is off.
- No hardcoded random colors/sizes outside token system.

## 8. Anti-Patterns (Reject Immediately)

- Large decorative hero text that crowds controls.
- Excessive side panel width that compresses main reading area.
- Multiple competing highlight colors in the same card.
- Too many controls visible by default "for completeness".
- Animations longer than content-read speed.

## 9. Delivery Discipline

- Work in incremental slices with independent commits.
- Each slice must end with:
  - passing build
  - fresh screenshot artifacts
  - concise commit message describing visual intent
