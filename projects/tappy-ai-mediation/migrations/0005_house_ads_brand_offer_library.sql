-- 0005_house_ads_brand_offer_library.sql
-- Supabase House Ads brand + offer library baseline.

CREATE TABLE IF NOT EXISTS house_ads_brands (
  brand_id TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  canonical_brand_name TEXT NOT NULL DEFAULT '',
  official_domain TEXT NOT NULL,
  vertical_l1 TEXT NOT NULL,
  vertical_l2 TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'US',
  status TEXT NOT NULL DEFAULT 'active',
  source_confidence NUMERIC(6, 4) NOT NULL DEFAULT 0,
  alignment_status TEXT NOT NULL DEFAULT '',
  alignment_source TEXT NOT NULL DEFAULT '',
  strict_admitted BOOLEAN NOT NULL DEFAULT FALSE,
  strong_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  clean_score NUMERIC(6, 4) NOT NULL DEFAULT 0,
  canonical_source TEXT NOT NULL DEFAULT '',
  checked_at TIMESTAMPTZ,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'paused', 'archived', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_house_ads_brands_status_vertical
  ON house_ads_brands (status, vertical_l1, vertical_l2);

CREATE INDEX IF NOT EXISTS idx_house_ads_brands_domain
  ON house_ads_brands (official_domain);

CREATE TABLE IF NOT EXISTS house_ads_offers (
  offer_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  brand_id TEXT NOT NULL REFERENCES house_ads_brands(brand_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  offer_type TEXT NOT NULL,
  vertical_l1 TEXT NOT NULL,
  vertical_l2 TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'US',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  cta_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  language TEXT NOT NULL DEFAULT 'en-US',
  disclosure TEXT NOT NULL DEFAULT 'Sponsored',
  source_type TEXT NOT NULL,
  confidence_score NUMERIC(6, 4) NOT NULL DEFAULT 0,
  freshness_ttl_hours INTEGER NOT NULL DEFAULT 48,
  last_verified_at TIMESTAMPTZ,
  product_id TEXT NOT NULL DEFAULT '',
  merchant TEXT NOT NULL DEFAULT '',
  price NUMERIC(12, 2),
  original_price NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT '',
  discount_pct NUMERIC(6, 2),
  availability TEXT NOT NULL DEFAULT '',
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (offer_type IN ('link', 'product')),
  CHECK (status IN ('active', 'paused', 'archived')),
  CHECK (source_type IN ('real', 'partner', 'synthetic'))
);

CREATE INDEX IF NOT EXISTS idx_house_ads_offers_runtime
  ON house_ads_offers (status, offer_type, market, language, confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_house_ads_offers_brand
  ON house_ads_offers (brand_id, offer_type, status);

CREATE INDEX IF NOT EXISTS idx_house_ads_offers_vertical
  ON house_ads_offers (vertical_l1, vertical_l2, offer_type, status);
