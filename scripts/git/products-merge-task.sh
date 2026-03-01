#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ] || [ "${2:-}" = "" ]; then
  echo "Usage: $0 <temp-branch> <summary> [base-branch]"
  exit 1
fi

TMP_BRANCH="${1}"
SUMMARY="${2}"
BASE_BRANCH="${3:-codex/products}"

if ! git show-ref --verify --quiet "refs/heads/${TMP_BRANCH}"; then
  echo "Temp branch not found: ${TMP_BRANCH}"
  exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  echo "Base branch not found: ${BASE_BRANCH}"
  exit 1
fi

git checkout "${BASE_BRANCH}"
git pull --ff-only origin "${BASE_BRANCH}"

git merge --squash "${TMP_BRANCH}"

if git diff --cached --quiet; then
  echo "No staged changes after squash merge from ${TMP_BRANCH}"
  exit 1
fi

git commit -m "feat(products): ${SUMMARY}"
git push origin "${BASE_BRANCH}"

echo
echo "Squash merged into ${BASE_BRANCH} and pushed."
echo "Optional cleanup:"
echo "  git branch -D ${TMP_BRANCH}"
echo "  git worktree list"
