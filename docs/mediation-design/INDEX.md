# Mediation Docs Index

## Global Entry
- Main entry: `docs/mediation-module-design.md`
- Canonical folder: `docs/mediation-design/`

## Core
- Metadata and linked docs: `docs/mediation-design/core/00-metadata.md`
- Mission and context: `docs/mediation-design/core/01-mission-and-context.md`
- Execution graph and full flow: `docs/mediation-design/core/02-execution-graph.md`

## Modules (A-H)
- Module A (Ingress & Sensing): `docs/mediation-design/modules/module-a-sdk-ingress-opportunity-sensing.md`
- Module B (Schema & Normalization): `docs/mediation-design/modules/module-b-schema-translation-signal-normalization.md`
- Module C (Policy & Safety): `docs/mediation-design/modules/module-c-policy-safety-governor.md`
- Module D (Supply & Adapters): `docs/mediation-design/modules/module-d-supply-orchestrator-adapter-layer.md`
- Module E (Delivery Composer): `docs/mediation-design/modules/module-e-delivery-composer.md`
- Module F (Event & Attribution): `docs/mediation-design/modules/module-f-event-attribution-processor.md`
- Module G (Audit & Replay): `docs/mediation-design/modules/module-g-audit-replay-controller.md`
- Module H (Config & Version Governance): `docs/mediation-design/modules/module-h-config-version-governance.md`

## Operations and Planning
- Closed loop model: `docs/mediation-design/operations/01-closed-loop-model.md`
- SDK integration guide: `docs/mediation-design/operations/02-sdk-integration-guide-and-minimal-checklist.md`
- Agent plan split: `docs/mediation-design/operations/03-agent-plan-split.md`
- MVP deliverables: `docs/mediation-design/operations/04-mvp-deliverables.md`
- Optimization and SSP transition: `docs/mediation-design/operations/05-optimization-and-ssp-transition.md`

## Fast Edit Map (Agent-Friendly)
- Change request envelope / sensing behavior: update Module A.
- Change schema, mapping, conflict priority: update Module B.
- Change policy, short-circuit, reason codes: update Module C.
- Change adapters, route plan, fallback: update Module D.
- Change render plan, delivery, render errors: update Module E.
- Change event ingest, dedup, attribution, billing facts: update Module F.
- Change replay / auditing format: update Module G.
- Change version lines / rollback policy: update Module H.
- Any cross-cutting status or response linkage: update both involved modules + `operations/01-closed-loop-model.md`.

## Versioning Rule
- Content changes in any subfile must append one entry to `docs/mediation-design/CHANGELOG.md`.
