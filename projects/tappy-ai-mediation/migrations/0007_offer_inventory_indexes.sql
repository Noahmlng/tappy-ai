-- 0007_offer_inventory_indexes.sql
-- pgvector + hybrid retrieval indexes (ANN + lexical).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS offer_inventory_embeddings (
  offer_id TEXT PRIMARY KEY REFERENCES offer_inventory_norm(offer_id) ON DELETE CASCADE ON UPDATE CASCADE,
  embedding_model TEXT NOT NULL DEFAULT 'hash-embedding-v1',
  embedding vector(512) NOT NULL,
  embedding_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_embeddings_updated
  ON offer_inventory_embeddings (embedding_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_embeddings_hnsw_cosine
  ON offer_inventory_embeddings
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_norm_lexical_fts
  ON offer_inventory_norm
  USING GIN (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(description, '')
    )
  );

CREATE INDEX IF NOT EXISTS idx_offer_inventory_norm_title_trgm
  ON offer_inventory_norm
  USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_offer_inventory_norm_description_trgm
  ON offer_inventory_norm
  USING GIN (description gin_trgm_ops);
