# Agent Guide for Mediation Design Docs

## Objective
Keep design docs deterministic for implementation agents: clear boundaries, minimal ambiguity, stable contracts.

## Editing Workflow
1. Locate target module file via `INDEX.md`.
2. Modify only the smallest relevant file.
3. If contracts cross modules, update both sides in the same change.
4. Update `CHANGELOG.md` with a concise, traceable entry.

## Required Update Checklist
1. Contract boundary: input/output required vs optional.
2. State transition impact: `received/routed/served/no_fill/error` consistency.
3. Reason code impact: canonical mapping and conflict rules.
4. Version anchors impacted: schema/route/placement or module-specific versions.
5. Replay/audit impact: trace keys and response linkage continuity.

## Naming and Structure Rules
1. Keep file names stable; avoid frequent renames.
2. Preserve module-centric separation (A-H).
3. Put optimization items in operations/backlog docs, not in MVP core contracts.
4. Prefer additive updates; avoid deleting historical rationale unless obsolete and documented.

## Merge Safety Rules
1. Do not move MVP rules into backlog sections silently.
2. Do not add cross-module behavior without explicit linkage.
3. Never introduce a new event/status without defining terminal behavior and dedup semantics.
