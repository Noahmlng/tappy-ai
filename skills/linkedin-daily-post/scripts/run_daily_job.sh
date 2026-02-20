#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNS_DIR="${SKILL_DIR}/runs"
LOG_DIR="${RUNS_DIR}/logs"
DATE="${RUN_DATE:-$(date +%F)}"
POST_FILE="${RUNS_DIR}/${DATE}.post.txt"
RESULT_FILE="${RUNS_DIR}/${DATE}.result.json"
LOG_FILE="${LOG_DIR}/daily.log"

mkdir -p "${RUNS_DIR}" "${LOG_DIR}"

if [[ -f "${SKILL_DIR}/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${SKILL_DIR}/.env"
  set +a
fi

if [[ -f "${RESULT_FILE}" && "${FORCE_RUN:-false}" != "true" ]]; then
  printf '[%s] Skip %s: result file already exists at %s\n' "$(date -u +%FT%TZ)" "${DATE}" "${RESULT_FILE}" | tee -a "${LOG_FILE}"
  exit 0
fi

printf '[%s] Daily LinkedIn run started for %s\n' "$(date -u +%FT%TZ)" "${DATE}" | tee -a "${LOG_FILE}"

POST_TEXT="$(node "${SCRIPT_DIR}/generate_post.mjs" --date "${DATE}" --out "${POST_FILE}")"
printf '[%s] Generated post at %s\n' "$(date -u +%FT%TZ)" "${POST_FILE}" | tee -a "${LOG_FILE}"

AUTO_PUBLISH="${AUTO_PUBLISH:-false}"
PUBLISH_MODE="${PUBLISH_MODE:-manual}"

if [[ "${AUTO_PUBLISH}" != "true" ]]; then
  cat > "${RESULT_FILE}" <<JSON
{
  "status": "generated",
  "mode": "none",
  "date": "${DATE}",
  "post_file": "${POST_FILE}",
  "updated_at": "$(date -u +%FT%TZ)"
}
JSON
  printf '[%s] AUTO_PUBLISH=false, saved draft only\n' "$(date -u +%FT%TZ)" | tee -a "${LOG_FILE}"
  exit 0
fi

case "${PUBLISH_MODE}" in
  did-cdp)
    RESULT_JSON="$(node "${SCRIPT_DIR}/publish_via_did_cdp.mjs" --input "${POST_FILE}")"
    printf '%s\n' "${RESULT_JSON}" > "${RESULT_FILE}"
    ;;
  linkedin-api)
    RESULT_JSON="$(node "${SCRIPT_DIR}/publish_via_linkedin_api.mjs" --input "${POST_FILE}")"
    printf '%s\n' "${RESULT_JSON}" > "${RESULT_FILE}"
    ;;
  manual)
    if command -v pbcopy >/dev/null 2>&1; then
      printf '%s' "${POST_TEXT}" | pbcopy
    fi
    if command -v open >/dev/null 2>&1; then
      open -a "${DID_BROWSER_APP_NAME:-DID Browser}" "https://www.linkedin.com/post/new/" || true
    fi
    cat > "${RESULT_FILE}" <<JSON
{
  "status": "staged-manual",
  "mode": "manual",
  "date": "${DATE}",
  "post_file": "${POST_FILE}",
  "updated_at": "$(date -u +%FT%TZ)"
}
JSON
    ;;
  *)
    printf '[%s] Unsupported PUBLISH_MODE=%s\n' "$(date -u +%FT%TZ)" "${PUBLISH_MODE}" | tee -a "${LOG_FILE}"
    exit 1
    ;;
esac

printf '[%s] Publish flow completed with mode=%s\n' "$(date -u +%FT%TZ)" "${PUBLISH_MODE}" | tee -a "${LOG_FILE}"
