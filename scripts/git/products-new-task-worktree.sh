#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <ticket> [yyyymmdd] [base-branch]"
  exit 1
fi

TICKET_RAW="${1}"
DATE_TAG="${2:-$(date +%Y%m%d)}"
BASE_BRANCH="${3:-codex/products}"

TICKET_SLUG="$(echo "${TICKET_RAW}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [ "${TICKET_SLUG}" = "" ]; then
  echo "Invalid ticket value: ${TICKET_RAW}"
  exit 1
fi

TMP_BRANCH="codex/tmp-products-${TICKET_SLUG}-${DATE_TAG}"
WORKTREE_PATH="../tappy-products-${TICKET_SLUG}-${DATE_TAG}"

git fetch --all --prune || true

if ! git show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  echo "Missing base branch: ${BASE_BRANCH}"
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${TMP_BRANCH}"; then
  echo "Temp branch already exists: ${TMP_BRANCH}"
  exit 1
fi

if [ -d "${WORKTREE_PATH}/.git" ] || [ -f "${WORKTREE_PATH}/.git" ]; then
  echo "Target worktree path already exists: ${WORKTREE_PATH}"
  exit 1
fi

git worktree add "${WORKTREE_PATH}" -b "${TMP_BRANCH}" "${BASE_BRANCH}"

echo
echo "Created temp branch: ${TMP_BRANCH}"
echo "Created task worktree: ${WORKTREE_PATH}"
echo "Next:"
echo "  cd ${WORKTREE_PATH}"
echo "  git add -A && git commit -m \"feat(products): <short-message>\""
