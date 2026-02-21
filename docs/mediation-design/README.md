# Mediation Design Docs (Structured)

- Scope: Mediation layer design for Chat Ads network.
- Goal: Keep docs modular, searchable, and agent-friendly.
- Source of truth: This folder is the canonical design set.

## Read Order
1. `core/00-metadata.md`
2. `core/01-mission-and-context.md`
3. `core/02-execution-graph.md`
4. `modules/module-a-sdk-ingress-opportunity-sensing.md` to `modules/module-h-config-version-governance.md`
5. `operations/01-closed-loop-model.md` and `operations/02-sdk-integration-guide-and-minimal-checklist.md`
6. `operations/04-mvp-deliverables.md` and `operations/05-optimization-and-ssp-transition.md`
7. `CHANGELOG.md`

## Folder Layout
- `core/`: positioning, strategy context, end-to-end graph.
- `modules/`: A-H module contracts and MVP boundaries.
- `operations/`: closed loop, integration guide, deliverables, optimization roadmap.
- `CHANGELOG.md`: full historical version record migrated from monolithic doc.
- `INDEX.md`: quick navigation + editing map.
- `AGENT_GUIDE.md`: how to modify docs safely and consistently.

## Principles
1. Single responsibility per file.
2. Contract-first updates (input/output/reason codes/version anchors).
3. Keep MVP and optimization separated.
4. Cross-module changes must update both sides and changelog.
