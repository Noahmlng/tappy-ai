---
name: frontend-design
description: Design and implement production-grade frontend interfaces with a clear and memorable visual point of view. Use when requests involve UI styling, page or component design, landing pages, dashboards, visual redesigns, animation polish, brand expression in code, or explicitly ask for bold/non-generic frontend aesthetics.
---

# Frontend Design

## Objective

Create interfaces that are functional, production-ready, and visually unforgettable.
Always convert intent into working code, not mood boards or abstract style notes.

## Workflow

1. Define context before coding.
2. Commit to one bold aesthetic direction.
3. Build a coherent visual system.
4. Implement with production-grade quality.
5. Verify accessibility and responsiveness.

### 1) Define Context Before Coding

State these four items explicitly:

- Purpose: what problem this interface solves and who uses it.
- Tone: choose one extreme direction (for example brutally minimal, retro-futuristic, luxury refined, editorial magazine, industrial utilitarian, playful toy-like, brutalist raw, organic natural).
- Constraints: framework, performance targets, accessibility requirements, and browser/device scope.
- Differentiation: define one signature detail users will remember.

If the user already provides them, restate briefly and proceed.

### 2) Commit to One Bold Direction

Execute one primary aesthetic with discipline. Do not blend conflicting styles unless the user asks for it.

Match implementation depth to style intensity:

- Maximalist direction: richer layering, stronger motion choreography, denser visual systems.
- Minimal/refined direction: restraint, precision spacing, nuanced typography, subtle motion.

### 3) Build a Visual System First

Define tokens up front (CSS variables or theme objects):

- Color system: background, surface, primary text, secondary text, accent, border, shadow.
- Typography system: one distinctive display face + one readable body face.
- Spacing scale: consistent rhythm for sections, cards, controls, and micro-gaps.
- Shape/material language: corner style, line weight, depth model, blur/noise usage.
- Motion system: one strong page-load sequence + cohesive hover/focus/press behavior.

### 4) Implement Production-Grade Frontend

Deliver real, runnable code (HTML/CSS/JS, React, Vue, etc.) with:

- Semantic HTML and keyboard-accessible interactions.
- Responsive behavior for mobile and desktop.
- Stable layout under realistic content lengths.
- Maintainable structure (componentized when applicable, clear tokens, minimal duplication).

When working inside an existing product, preserve its design system and component conventions.

### 5) Enforce Aesthetic Guardrails

Prioritize distinctive outcomes and avoid generic defaults:

- Avoid overused generic font stacks (Inter, Roboto, Arial, system fonts) unless existing project constraints require them.
- Avoid timid palettes and generic purple-gradient-on-white defaults.
- Avoid cookie-cutter component layouts and repetitive card grids without hierarchy.
- Use composition deliberately: asymmetry, overlap, diagonal flow, controlled density, or generous negative space.
- Use atmospheric backgrounds and textures that support the chosen direction (mesh gradients, grain, geometric patterns, layered transparencies, custom borders/shadows).

### Typography Rules

- Select fonts with character and context fit.
- Pair display and body fonts intentionally.
- Use scale, weight, tracking, and line-height to create hierarchy before adding decoration.

### Color Rules

- Pick a dominant color strategy with 1-2 sharp accents.
- Keep contrast strong for readability and accessibility.
- Use variables consistently to maintain coherence.

### Motion Rules

- Prefer one orchestrated reveal over scattered micro-animation noise.
- Use staggered entrances with meaningful ordering.
- Add hover/focus states that reinforce the visual identity.
- Prefer CSS-first animation in static HTML work; use motion libraries in React only when justified.

## Output Standard

For each implementation task:

1. State the design brief (purpose, tone, constraints, differentiation) before coding.
2. Implement the interface directly in project files.
3. Validate behavior (responsive layout, keyboard navigation, visual consistency).
4. Summarize concrete file changes and rationale briefly.

Never stop at design commentary when the request expects built UI.
