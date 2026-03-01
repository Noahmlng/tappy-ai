#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${1:-codex/products}"
MAIN_BRANCH="${2:-main}"
WORKTREE_PATH="${3:-../tappy-ai-mediation-products}"

git checkout "${MAIN_BRANCH}"
git pull --ff-only origin "${MAIN_BRANCH}"

if git show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  echo "branch already exists: ${BASE_BRANCH}"
else
  git branch "${BASE_BRANCH}" "${MAIN_BRANCH}"
  echo "created branch: ${BASE_BRANCH}"
fi

if git ls-remote --exit-code --heads origin "${BASE_BRANCH}" >/dev/null 2>&1; then
  echo "remote already exists: origin/${BASE_BRANCH}"
else
  git push -u origin "${BASE_BRANCH}"
  echo "pushed branch: origin/${BASE_BRANCH}"
fi

if [ -d "${WORKTREE_PATH}/.git" ] || [ -f "${WORKTREE_PATH}/.git" ]; then
  echo "worktree already exists: ${WORKTREE_PATH}"
else
  git worktree add "${WORKTREE_PATH}" "${BASE_BRANCH}"
  echo "created worktree: ${WORKTREE_PATH}"
fi

echo
git worktree list
