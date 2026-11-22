-- =========================================================================
-- PROPOSED ONLY — NOT EXECUTED IN PRODUCTION (FAZA 1B: SHADOW MATCHING)
-- Nu rula automat acest fișier; este o propunere aditivă, reversibilă,
-- pentru stocarea completă a dovezilor și deciziilor Shadow Matching în
-- tabelul existent `product_match_candidates` fără a crea o arhitectură paralelă.
-- =========================================================================

ALTER TABLE product_match_candidates
  ADD COLUMN IF NOT EXISTS source_product_id VARCHAR(64) REFERENCES products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_retailer VARCHAR(64),
  ADD COLUMN IF NOT EXISTS target_retailer VARCHAR(64),
  ADD COLUMN IF NOT EXISTS target_brand VARCHAR(128),
  ADD COLUMN IF NOT EXISTS target_barcode VARCHAR(64),
  ADD COLUMN IF NOT EXISTS source_packaging_structure VARCHAR(64),
  ADD COLUMN IF NOT EXISTS target_packaging_structure VARCHAR(64),
  ADD COLUMN IF NOT EXISTS variant_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS hard_guard_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS positive_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS negative_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decision_category VARCHAR(32),
  ADD COLUMN IF NOT EXISTS recommended_action VARCHAR(64),
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS normalization_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS candidate_mode VARCHAR(32) NOT NULL DEFAULT 'import_matching',
  ADD COLUMN IF NOT EXISTS different_structure_same_total BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS false_positive_risk VARCHAR(16),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_match_candidates_decision_status
  ON product_match_candidates (decision_category, status);

CREATE INDEX IF NOT EXISTS idx_match_candidates_mode_retailers
  ON product_match_candidates (candidate_mode, source_retailer, target_retailer);

CREATE UNIQUE INDEX IF NOT EXISTS idx_match_candidates_shadow_pair_unique
  ON product_match_candidates (source_product_id, matched_product_id, candidate_mode)
  WHERE source_product_id IS NOT NULL;
