-- 0001_mediation_core_baseline.sql
-- Supabase/Postgres baseline schema for mediation MVP.

CREATE TABLE IF NOT EXISTS config_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  config_body JSONB NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_snapshots_scope ON config_snapshots (scope_type, scope_key, effective_at DESC);

CREATE TABLE IF NOT EXISTS config_publish_operations (
  id BIGSERIAL PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  publish_idempotency_key TEXT NOT NULL,
  publish_state TEXT NOT NULL,
  target_scope_type TEXT NOT NULL,
  target_scope_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  actor_id TEXT,
  reason_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_publish_scope ON config_publish_operations (target_scope_type, target_scope_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_publish_state ON config_publish_operations (publish_state, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_records (
  opportunity_key TEXT PRIMARY KEY,
  request_key TEXT NOT NULL,
  trace_key TEXT NOT NULL,
  app_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  state TEXT NOT NULL,
  version_anchor_snapshot JSONB NOT NULL,
  anchor_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_request_key ON opportunity_records (request_key);
CREATE INDEX IF NOT EXISTS idx_opportunity_trace_key ON opportunity_records (trace_key);
CREATE INDEX IF NOT EXISTS idx_opportunity_created_at ON opportunity_records (created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_records (
  response_reference TEXT NOT NULL,
  render_attempt_id TEXT NOT NULL,
  opportunity_key TEXT NOT NULL,
  app_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  no_fill_reason_code TEXT,
  error_code TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (response_reference, render_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_opportunity_key ON delivery_records (opportunity_key);
CREATE INDEX IF NOT EXISTS idx_delivery_created_at ON delivery_records (created_at DESC);

CREATE TABLE IF NOT EXISTS event_records (
  event_key TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  response_reference TEXT,
  render_attempt_id TEXT,
  event_type TEXT NOT NULL,
  event_layer TEXT NOT NULL,
  event_status TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_response_render ON event_records (response_reference, render_attempt_id);
CREATE INDEX IF NOT EXISTS idx_event_idempotency_key ON event_records (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_event_created_at ON event_records (created_at DESC);

CREATE TABLE IF NOT EXISTS archive_records (
  record_key TEXT PRIMARY KEY,
  response_reference TEXT NOT NULL,
  render_attempt_id TEXT NOT NULL,
  opportunity_key TEXT NOT NULL,
  record_status TEXT NOT NULL,
  billable BOOLEAN NOT NULL DEFAULT FALSE,
  reason_code TEXT,
  version_anchor_snapshot JSONB NOT NULL,
  anchor_hash TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archive_response_render ON archive_records (response_reference, render_attempt_id);
CREATE INDEX IF NOT EXISTS idx_archive_opportunity_key ON archive_records (opportunity_key);
CREATE INDEX IF NOT EXISTS idx_archive_created_at ON archive_records (created_at DESC);

CREATE TABLE IF NOT EXISTS audit_records (
  audit_record_id TEXT PRIMARY KEY,
  opportunity_key TEXT NOT NULL,
  trace_key TEXT NOT NULL,
  module_name TEXT NOT NULL,
  decision_point TEXT NOT NULL,
  reason_code TEXT,
  version_anchor_snapshot_ref TEXT,
  payload_digest TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_opportunity_key ON audit_records (opportunity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trace_key ON audit_records (trace_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module_name ON audit_records (module_name, created_at DESC);

CREATE TABLE IF NOT EXISTS replay_jobs (
  replay_job_id TEXT PRIMARY KEY,
  query_mode TEXT NOT NULL,
  query_payload JSONB NOT NULL,
  replay_mode TEXT NOT NULL,
  replay_status TEXT NOT NULL,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replay_status ON replay_jobs (replay_status, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_seconds INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_scope ON idempotency_keys (scope, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS dead_letter_records (
  id BIGSERIAL PRIMARY KEY,
  stream_name TEXT NOT NULL,
  message_key TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_unresolved ON dead_letter_records (stream_name, resolved_at, created_at DESC);

