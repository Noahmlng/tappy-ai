# Mediation Docs Index

## Global Entry
- Main entry: `docs/design/mediation-module-design.md`
- Canonical folder: `docs/design/mediation/`

## Core
- Metadata and linked docs: `docs/design/mediation/core/00-metadata.md`
- Mission and context: `docs/design/mediation/core/01-mission-and-context.md`
- Execution graph and full flow: `docs/design/mediation/core/02-execution-graph.md`

## Modules (A-H)
- Module A (Ingress & Sensing): `docs/design/mediation/modules/module-a-sdk-ingress-opportunity-sensing.md`
- Module B (Schema & Normalization): `docs/design/mediation/modules/module-b-schema-translation-signal-normalization.md`
- Module C (Policy & Safety): `docs/design/mediation/modules/module-c-policy-safety-governor.md`
- Module D (Supply & Adapters): `docs/design/mediation/modules/module-d-supply-orchestrator-adapter-layer.md`
- Module E (Delivery Composer): `docs/design/mediation/modules/module-e-delivery-composer.md`
- Module F (Event & Attribution): `docs/design/mediation/modules/module-f-event-attribution-processor.md`
- Module G (Audit & Replay): `docs/design/mediation/modules/module-g-audit-replay-controller.md`
- Module H (Config & Version Governance): `docs/design/mediation/modules/module-h-config-version-governance.md`

## Operations and Planning
- Closed loop model: `docs/design/mediation/operations/01-closed-loop-model.md`
- SDK integration guide: `docs/design/mediation/operations/02-sdk-integration-guide-and-minimal-checklist.md`
- Agent plan split: `docs/design/mediation/operations/03-agent-plan-split.md`
- MVP deliverables: `docs/design/mediation/operations/04-mvp-deliverables.md`
- Optimization and SSP transition: `docs/design/mediation/operations/05-optimization-and-ssp-transition.md`
- Production readiness and infra: `docs/design/mediation/operations/06-production-readiness-and-infra.md`

## Fast Edit Map (Agent-Friendly)
- Change request envelope / sensing behavior: update Module A.
- Change schema, mapping, conflict priority: update Module B.
- Change policy, short-circuit, reason codes: update Module C.
- Change adapters, route plan, fallback: update Module D.
- Change render plan, delivery, render errors: update Module E.
- Change event ingest, dedup, attribution, billing facts: update Module F.
- Change replay / auditing format: update Module G.
- Change version lines / rollback policy: update Module H.
- Change production infra / security / SLO / release gate: update `operations/06-production-readiness-and-infra.md`.
- Any cross-cutting status or response linkage: update both involved modules + `operations/01-closed-loop-model.md`.

## Versioning Rule
- Content changes in any subfile must append one entry to `docs/design/mediation/CHANGELOG.md`.
