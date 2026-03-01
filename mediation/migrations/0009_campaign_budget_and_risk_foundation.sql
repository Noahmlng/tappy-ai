-- 0009_campaign_budget_and_risk_foundation.sql
-- Introduce campaign budget controls for CPC serving/settlement.

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT '',
  app_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_account_app
  ON campaigns (account_id, app_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_budget_limits (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(campaign_id) ON DELETE CASCADE ON UPDATE CASCADE,
  daily_budget_usd NUMERIC(18, 4),
  lifetime_budget_usd NUMERIC(18, 4) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lifetime_budget_usd > 0),
  CHECK (daily_budget_usd IS NULL OR daily_budget_usd > 0)
);

CREATE TABLE IF NOT EXISTS budget_reservations (
  reservation_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE ON UPDATE CASCADE,
  account_id TEXT NOT NULL DEFAULT '',
  app_id TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL,
  ad_id TEXT NOT NULL DEFAULT '',
  reserved_cpc_usd NUMERIC(18, 4) NOT NULL,
  pricing_semantics_version TEXT NOT NULL DEFAULT 'cpc_v1',
  status TEXT NOT NULL DEFAULT 'reserved',
  reason_code TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  settled_fact_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('reserved', 'settled', 'released', 'expired')),
  CHECK (reserved_cpc_usd > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_reservation_request_campaign_ad
  ON budget_reservations (request_id, campaign_id, ad_id);

CREATE INDEX IF NOT EXISTS idx_budget_reservation_campaign_status
  ON budget_reservations (campaign_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS budget_ledger (
  ledger_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE ON UPDATE CASCADE,
  reservation_id TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  fact_id TEXT NOT NULL DEFAULT '',
  entry_type TEXT NOT NULL,
  amount_usd NUMERIC(18, 4) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (entry_type IN ('reserve', 'release', 'settle')),
  CHECK (amount_usd >= 0)
);

CREATE INDEX IF NOT EXISTS idx_budget_ledger_campaign_created
  ON budget_ledger (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_budget_ledger_request
  ON budget_ledger (request_id, created_at DESC);
