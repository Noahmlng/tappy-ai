-- 0008_control_plane_prod_only_environment.sql
-- Collapse legacy control-plane environments to prod-only for MVP production rollout.

-- Keep only one environment row per app before collapsing to avoid
-- UNIQUE(app_id, environment) conflicts when forcing all rows to prod.
WITH ranked AS (
  SELECT
    id,
    app_id,
    ROW_NUMBER() OVER (
      PARTITION BY app_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM control_plane_app_environments
)
DELETE FROM control_plane_app_environments target
USING ranked
WHERE target.id = ranked.id
  AND ranked.rn > 1;

UPDATE control_plane_app_environments
SET
  environment = 'prod',
  environment_id = 'env_' || app_id || '_prod',
  updated_at = NOW()
WHERE environment <> 'prod'
   OR environment_id <> ('env_' || app_id || '_prod');

UPDATE control_plane_api_keys
SET
  environment = 'prod',
  updated_at = NOW()
WHERE environment <> 'prod';

UPDATE control_plane_integration_tokens
SET
  environment = 'prod',
  updated_at = NOW()
WHERE environment <> 'prod';

UPDATE control_plane_agent_access_tokens
SET
  environment = 'prod',
  updated_at = NOW()
WHERE environment <> 'prod';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cp_app_env_prod_only_chk'
  ) THEN
    ALTER TABLE control_plane_app_environments
      ADD CONSTRAINT cp_app_env_prod_only_chk CHECK (environment = 'prod');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cp_api_keys_prod_only_chk'
  ) THEN
    ALTER TABLE control_plane_api_keys
      ADD CONSTRAINT cp_api_keys_prod_only_chk CHECK (environment = 'prod');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cp_integration_tokens_prod_only_chk'
  ) THEN
    ALTER TABLE control_plane_integration_tokens
      ADD CONSTRAINT cp_integration_tokens_prod_only_chk CHECK (environment = 'prod');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cp_agent_access_tokens_prod_only_chk'
  ) THEN
    ALTER TABLE control_plane_agent_access_tokens
      ADD CONSTRAINT cp_agent_access_tokens_prod_only_chk CHECK (environment = 'prod');
  END IF;
END $$;
