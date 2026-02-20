---
name: linkedin-daily-post
description: Generate and publish daily LinkedIn posts with a repeatable workflow, including topic collection, post drafting, compliance checks, scheduling, and browser/API publication. Use when the user asks to automate LinkedIn posting, create a daily posting pipeline, run scheduled social content, or publish through a controlled browser session.
---

# LinkedIn Daily Post

Use this skill to run a daily LinkedIn publishing workflow with deterministic scripts and minimal manual effort.

## Run Workflow

1. Confirm environment and publication mode.
- Read `references/configuration.md`.
- Choose one mode: `manual`, `did-cdp`, or `linkedin-api`.
- Prefer `did-cdp` when the user asks to publish through DID Browser.

2. Collect daily inputs.
- Gather target audience, topic, call to action, and banned claims.
- Default to concise professional English unless the user specifies another language.

3. Generate post content.
- Run `scripts/generate_post.mjs` to build final post text.
- Keep output under the user-defined limit; default to 800 characters.

4. Publish or stage post.
- For `did-cdp`, run `scripts/publish_via_did_cdp.mjs`.
- For `manual`, write post text to output file and open LinkedIn compose URL.
- For `linkedin-api`, run API flow only when valid OAuth tokens are configured.

5. Persist execution artifacts.
- Save generated post to `skills/linkedin-daily-post/runs/` with date-based filename.
- Save publication result status and URL when available.

## Schedule Daily Execution

1. Install daily scheduler with `scripts/install_daily_launchd.sh` on macOS.
2. Use `scripts/run_daily_job.sh` as the single entrypoint for scheduler and manual runs.
3. Keep scheduler idempotent: skip duplicate publication for the same date unless override is set.

## Operational Rules

- Validate required env vars before execution and fail with actionable messages.
- Never publish when compliance checks fail.
- Require explicit `AUTO_PUBLISH=true` to allow one-click publication.
- Keep logs append-only in `skills/linkedin-daily-post/runs/logs/`.
- Treat browser takeover as local automation only; do not claim remote account control.
