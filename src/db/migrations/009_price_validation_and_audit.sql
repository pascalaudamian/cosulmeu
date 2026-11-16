-- Migrație 009: Validare strictă preț vs cantitate, izolare anomalii și suport audit prețuri

ALTER TABLE product_offers
  ADD COLUMN IF NOT EXISTS is_flagged_anomaly BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anomaly_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS normal_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS promo_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS loyalty_price NUMERIC(10, 2);

CREATE INDEX IF NOT EXISTS idx_product_offers_verification_anomaly
  ON product_offers (verification_status, is_flagged_anomaly, price);

ALTER TABLE catalog_extracted_offers
  ADD COLUMN IF NOT EXISTS price_validation_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS price_validation_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS price_proof_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS weight NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS volume NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS package_size VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_catalog_extracted_offers_validation
  ON catalog_extracted_offers (price_validation_status, staging_status);
