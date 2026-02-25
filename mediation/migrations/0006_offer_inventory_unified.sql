-- 0006_offer_inventory_unified.sql
-- Unified inventory source-of-truth tables for PartnerStack/CJ/House snapshots.

CREATE TABLE IF NOT EXISTS offer_inventory_raw (
  id BIGSERIAL PRIMARY KEY,
  raw_record_id TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  upstream_offer_id TEXT NOT NULL DEFAULT '',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_digest TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (network IN ('partnerstack', 'cj', 'house'))
);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_raw_network_fetched
  ON offer_inventory_raw (network, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_raw_upstream
  ON offer_inventory_raw (network, upstream_offer_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS offer_inventory_norm (
  offer_id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  upstream_offer_id TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'offer',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'US',
  language TEXT NOT NULL DEFAULT 'en-US',
  availability TEXT NOT NULL DEFAULT 'active',
  quality NUMERIC(8, 4) NOT NULL DEFAULT 0,
  bid_hint NUMERIC(12, 6) NOT NULL DEFAULT 0,
  policy_weight NUMERIC(8, 4) NOT NULL DEFAULT 0,
  freshness_at TIMESTAMPTZ,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (network IN ('partnerstack', 'cj', 'house'))
);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_norm_runtime
  ON offer_inventory_norm (availability, network, market, language, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_norm_network_upstream
  ON offer_inventory_norm (network, upstream_offer_id);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_norm_tags
  ON offer_inventory_norm USING GIN (tags);

CREATE TABLE IF NOT EXISTS offer_inventory_sync_runs (
  run_id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  status TEXT NOT NULL,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  upserted_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (network IN ('partnerstack', 'cj', 'house', 'all')),
  CHECK (status IN ('running', 'success', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_sync_runs_lookup
  ON offer_inventory_sync_runs (network, started_at DESC);
