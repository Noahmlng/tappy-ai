-- 0003_settlement_conversion_facts.sql
-- Durable CPA settlement facts store for simulator gateway/dashboard settlement metrics.

CREATE TABLE IF NOT EXISTS simulator_settlement_conversion_facts (
  fact_id TEXT PRIMARY KEY,
  fact_type TEXT NOT NULL,
  app_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  turn_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  placement_id TEXT NOT NULL DEFAULT '',
  placement_key TEXT NOT NULL DEFAULT '',
  ad_id TEXT NOT NULL DEFAULT '',
  postback_type TEXT NOT NULL,
  postback_status TEXT NOT NULL,
  conversion_id TEXT NOT NULL,
  event_seq TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  cpa_usd NUMERIC(18, 4) NOT NULL DEFAULT 0,
  revenue_usd NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_settlement_facts_account_app_time
  ON simulator_settlement_conversion_facts (account_id, app_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_facts_request
  ON simulator_settlement_conversion_facts (request_id);

CREATE INDEX IF NOT EXISTS idx_settlement_facts_placement_time
  ON simulator_settlement_conversion_facts (placement_id, occurred_at DESC);
