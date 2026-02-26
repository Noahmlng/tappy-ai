#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[mediation-reset] reset endpoint is removed in prod-only mode."
echo "[mediation-reset] running Supabase test DB cleanup instead..."

SUPABASE_DB_URL_TEST="${SUPABASE_DB_URL_TEST:-${SUPABASE_DB_URL:-}}"
if [[ -z "${SUPABASE_DB_URL_TEST}" ]]; then
  echo "[mediation-reset] SUPABASE_DB_URL_TEST (or SUPABASE_DB_URL) is required." >&2
  exit 1
fi

(
  cd "${ROOT_DIR}/mediation"
  SUPABASE_DB_URL_TEST="${SUPABASE_DB_URL_TEST}" node ./scripts/test-db-cleanup.js
)

cat <<'MSG'
[mediation-reset] Browser-side cleanup:
1) External client app (if connected): clear cached conversation/history as needed.
2) Dashboard: hard refresh to pull latest gateway snapshot.
MSG
