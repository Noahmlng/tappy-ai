-- 0004_control_plane_auth_tokens.sql
-- Supabase control-plane auth + token persistence for dashboard and agent flows.

CREATE TABLE IF NOT EXISTS control_plane_dashboard_users (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  app_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  last_login_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_cp_dashboard_users_account
  ON control_plane_dashboard_users (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cp_dashboard_users_app
  ON control_plane_dashboard_users (app_id, created_at DESC);

CREATE TABLE IF NOT EXISTS control_plane_dashboard_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES control_plane_dashboard_users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  email TEXT NOT NULL,
  account_id TEXT NOT NULL,
  app_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_cp_dashboard_sessions_user
  ON control_plane_dashboard_sessions (user_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_cp_dashboard_sessions_account
  ON control_plane_dashboard_sessions (account_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_cp_dashboard_sessions_status
  ON control_plane_dashboard_sessions (status, expires_at DESC);

CREATE TABLE IF NOT EXISTS control_plane_integration_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_id TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL REFERENCES control_plane_apps(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
  account_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  placement_id TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  token_type TEXT NOT NULL DEFAULT 'integration_token',
  one_time BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active',
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (environment IN ('sandbox', 'staging', 'prod')),
  CHECK (status IN ('active', 'used', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_cp_integration_tokens_account
  ON control_plane_integration_tokens (account_id, app_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_cp_integration_tokens_status
  ON control_plane_integration_tokens (status, expires_at DESC);

CREATE TABLE IF NOT EXISTS control_plane_agent_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_id TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL REFERENCES control_plane_apps(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
  account_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  placement_id TEXT NOT NULL DEFAULT '',
  source_token_id TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  token_type TEXT NOT NULL DEFAULT 'agent_access_token',
  status TEXT NOT NULL DEFAULT 'active',
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (environment IN ('sandbox', 'staging', 'prod')),
  CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_cp_agent_access_tokens_account
  ON control_plane_agent_access_tokens (account_id, app_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_cp_agent_access_tokens_status
  ON control_plane_agent_access_tokens (status, expires_at DESC);

