-- 0002_control_plane_app_env_key_baseline.sql
-- Minimal control-plane data model for dashboard onboarding:
-- app -> environment -> api_key

CREATE TABLE IF NOT EXISTS control_plane_apps (
  id BIGSERIAL PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'disabled', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_control_plane_apps_org_status
  ON control_plane_apps (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS control_plane_app_environments (
  id BIGSERIAL PRIMARY KEY,
  environment_id TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL REFERENCES control_plane_apps(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
  environment TEXT NOT NULL,
  api_base_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, environment),
  CHECK (environment IN ('sandbox', 'staging', 'prod')),
  CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_control_plane_env_app_env
  ON control_plane_app_environments (app_id, environment);

CREATE INDEX IF NOT EXISTS idx_control_plane_env_status
  ON control_plane_app_environments (status, created_at DESC);

CREATE TABLE IF NOT EXISTS control_plane_api_keys (
  id BIGSERIAL PRIMARY KEY,
  key_id TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL REFERENCES control_plane_apps(app_id) ON DELETE CASCADE ON UPDATE CASCADE,
  environment TEXT NOT NULL,
  key_name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (environment IN ('sandbox', 'staging', 'prod')),
  CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_control_plane_api_keys_app_env_status
  ON control_plane_api_keys (app_id, environment, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_plane_api_keys_prefix
  ON control_plane_api_keys (key_prefix);

CREATE INDEX IF NOT EXISTS idx_control_plane_api_keys_last_used
  ON control_plane_api_keys (last_used_at DESC);
