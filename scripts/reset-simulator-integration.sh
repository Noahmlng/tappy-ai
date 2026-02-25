#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="${ROOT_DIR}/projects/ad-aggregation-platform/.local/simulator-gateway-state.json"
HOST="${MEDIATION_GATEWAY_HOST:-127.0.0.1}"
PORT="${MEDIATION_GATEWAY_PORT:-3100}"
BASE_URL="http://${HOST}:${PORT}"

printf '[sim-reset] target gateway: %s\n' "${BASE_URL}"

if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
  printf '[sim-reset] gateway online, requesting reset endpoint...\n'
  if RESET_RESP=$(curl -fsS -X POST "${BASE_URL}/api/v1/dev/reset" -H 'Content-Type: application/json' -d '{}'); then
    printf '[sim-reset] gateway reset completed.\n'
    printf '%s\n' "${RESET_RESP}"
  else
    printf '[sim-reset] reset endpoint failed; deleting persisted state file as fallback.\n' >&2
    rm -f "${STATE_FILE}"
    printf '[sim-reset] deleted %s\n' "${STATE_FILE}"
    printf '[sim-reset] restart gateway to load default state.\n' >&2
  fi
else
  printf '[sim-reset] gateway offline; deleting persisted state file.\n'
  rm -f "${STATE_FILE}"
  printf '[sim-reset] deleted %s\n' "${STATE_FILE}"
fi

cat <<'MSG'
[sim-reset] Browser-side cleanup:
1) External client app (if connected): clear cached conversation/history as needed.
2) Dashboard (http://127.0.0.1:3002): hard refresh to pull latest gateway snapshot.
MSG
