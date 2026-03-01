# Products Git Workflow (Worktree + Temp Branch)

This repository uses one long-lived branch for each business line and isolated task worktrees.

## Branch policy

- Long-lived branch: `codex/products`
- Temp task branch pattern: `codex/tmp-products-<ticket>-<yyyymmdd>`
- Integration target: squash merge temp branches back into `codex/products`
- Release target: merge milestones from `codex/products` into `main`

## One-time setup (Day 0)

```bash
bash ./scripts/git/products-init.sh
```

Defaults:

- base branch: `codex/products`
- main branch: `main`
- integration worktree path: `../tappy-ai-mediation-products`

## Start a new task

```bash
bash ./scripts/git/products-new-task-worktree.sh <ticket> [yyyymmdd]
```

Example:

```bash
bash ./scripts/git/products-new-task-worktree.sh pricing-widget 20260301
```

This creates:

- temp branch: `codex/tmp-products-pricing-widget-20260301`
- task worktree: `../tappy-products-pricing-widget-20260301`

## Finish and integrate a task

```bash
bash ./scripts/git/products-merge-task.sh <temp-branch> "<summary>"
```

Example:

```bash
bash ./scripts/git/products-merge-task.sh \
  codex/tmp-products-pricing-widget-20260301 \
  "add dynamic pricing widget"
```

This performs:

1. checkout/pull `codex/products`
2. `git merge --squash <temp-branch>`
3. commit and push `codex/products`

## Cleanup (manual)

After successful integration:

```bash
git branch -D <temp-branch>
git worktree remove <task-worktree-path>
```

## Release milestone to main

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff codex/products -m "merge(products): <milestone>"
git push origin main
```

## Conflict and push policy

- Resolve business conflicts only in temp branches (not in `main`)
- If push is rejected:
  - `git pull --no-rebase origin <branch>`
  - resolve if needed, then push again
- Never force push to `main` or `codex/products`
