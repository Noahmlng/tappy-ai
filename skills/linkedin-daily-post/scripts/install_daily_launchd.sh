#!/usr/bin/env bash
set -euo pipefail

TIME_INPUT="${1:-09:00}"
if [[ ! "${TIME_INPUT}" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]]; then
  echo "Invalid time format. Use HH:MM (24-hour), for example: 09:00"
  exit 1
fi

HOUR="${TIME_INPUT%%:*}"
MINUTE="${TIME_INPUT##*:}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_DIR="$(cd "${SKILL_DIR}/../.." && pwd)"
RUN_LOG_DIR="${SKILL_DIR}/runs/logs"

mkdir -p "${RUN_LOG_DIR}" "${HOME}/Library/LaunchAgents"

LABEL="com.zeming.linkedin.dailypost"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>cd ${WORKSPACE_DIR} && ${SCRIPT_DIR}/run_daily_job.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>${HOUR}</integer>
      <key>Minute</key>
      <integer>${MINUTE}</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${RUN_LOG_DIR}/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>${RUN_LOG_DIR}/launchd.err.log</string>
    <key>WorkingDirectory</key>
    <string>${WORKSPACE_DIR}</string>
  </dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl enable "gui/$(id -u)/${LABEL}"

echo "Installed daily launchd job: ${LABEL}"
echo "Schedule: ${TIME_INPUT} local time"
echo "Plist: ${PLIST_PATH}"
