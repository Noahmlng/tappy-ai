#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose.mediation.yml"
ACTION="${1:-up}"

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[infra] missing required binary: $1" >&2
    exit 1
  fi
}

require_bin docker

run_compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

wait_for_redis() {
  local retries=20
  local count=0
  until run_compose exec -T redis redis-cli ping >/dev/null 2>&1; do
    count=$((count + 1))
    if [[ "${count}" -ge "${retries}" ]]; then
      echo "[infra] redis health check failed after ${retries} retries" >&2
      return 1
    fi
    sleep 1
  done
  echo "[infra] redis healthy"
}

wait_for_nats() {
  local retries=20
  local count=0
  until curl -fsS "http://127.0.0.1:8222/healthz" >/dev/null 2>&1; do
    count=$((count + 1))
    if [[ "${count}" -ge "${retries}" ]]; then
      echo "[infra] nats health check failed after ${retries} retries" >&2
      return 1
    fi
    sleep 1
  done
  echo "[infra] nats healthy"
}

print_summary() {
  cat <<'EOF'
[infra] mediation dependencies are ready.

Redis:
  REDIS_URL=redis://127.0.0.1:6379/0

NATS (JetStream enabled):
  NATS_URL=nats://127.0.0.1:4222
  NATS_MONITOR_URL=http://127.0.0.1:8222

Supabase Postgres (primary DB backend):
  Set SUPABASE_DB_URL in your environment.
  Optional alias: DATABASE_URL (fallback).
EOF
}

case "${ACTION}" in
  up)
    run_compose up -d
    wait_for_redis
    wait_for_nats
    print_summary
    ;;
  down)
    run_compose down
    ;;
  restart)
    run_compose down
    run_compose up -d
    wait_for_redis
    wait_for_nats
    print_summary
    ;;
  status)
    run_compose ps
    ;;
  logs)
    run_compose logs --tail=200
    ;;
  *)
    echo "Usage: $0 [up|down|restart|status|logs]" >&2
    exit 1
    ;;
esac

