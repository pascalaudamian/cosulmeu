-- =========================================================================
-- PROPOSED MIGRATION (UNAPPLIED IN PRODUCTION) — FAZA 2: HUMAN REVIEW PANEL
-- =========================================================================
-- ATENȚIE: Această migrare NU este executată automat în producție.
-- Ea documentează structura aditivă recomandată pentru stocarea deciziilor
-- de Human Review asupra candidaților Shadow Matching, fără a suprascrie
-- rândurile existente din `product_match_candidates` și fără a modifica
-- `products`, `canonical_product_id`, `product_offers` sau `price_observations`.
-- =========================================================================

CREATE TABLE IF NOT EXISTS shadow_match_reviews (
  candidate_id VARCHAR(64) PRIMARY KEY,
  source_product_id VARCHAR(64) NOT NULL,
  target_product_id VARCHAR(64) NOT NULL,
  source_retailer VARCHAR(64) NOT NULL,
  target_retailer VARCHAR(64) NOT NULL,
  decision_category_snapshot VARCHAR(32) NOT NULL
    CHECK (decision_category_snapshot IN ('HIGH_CONFIDENCE', 'REVIEW', 'BLOCKED', 'LOW_CONFIDENCE')),
  matching_score_snapshot NUMERIC(5, 4) NOT NULL,
  review_status VARCHAR(40) NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN (
      'pending_review',
      'confirmed_same_product',
      'confirmed_different_product',
      'needs_more_information',
      'dismissed'
    )),
  reviewer_id VARCHAR(128) NOT NULL,
  reviewer_email VARCHAR(255) NOT NULL,
  auth_source VARCHAR(48) NOT NULL DEFAULT 'admin_bearer_token',
  review_reason TEXT NOT NULL DEFAULT '',
  review_notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  candidate_evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shadow_match_reviews_pair UNIQUE (source_product_id, target_product_id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_match_reviews_status
  ON shadow_match_reviews (review_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_shadow_match_reviews_retailers
  ON shadow_match_reviews (source_retailer, target_retailer);

CREATE TABLE IF NOT EXISTS shadow_match_review_audit (
  id VARCHAR(80) PRIMARY KEY,
  candidate_id VARCHAR(64) NOT NULL REFERENCES shadow_match_reviews(candidate_id) ON DELETE RESTRICT,
  previous_status VARCHAR(40) NOT NULL,
  new_status VARCHAR(40) NOT NULL,
  reviewer_id VARCHAR(128) NOT NULL,
  reviewer_email VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shadow_match_review_audit_candidate
  ON shadow_match_review_audit (candidate_id, created_at DESC);
