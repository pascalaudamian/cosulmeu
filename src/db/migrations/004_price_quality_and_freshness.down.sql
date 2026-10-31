-- ====================================================================
-- MIGRAȚIE 004 DOWN (REVERSIBILITATE / ROLLBACK)
-- Coșul Meu – Revert Price Quality Monitor & Freshness Score
-- ====================================================================

-- 1. Eliminare tabele de calitate
DROP TABLE IF EXISTS daily_quality_reports CASCADE;
DROP TABLE IF EXISTS quality_recollection_queue CASCADE;
DROP TABLE IF EXISTS quality_anomalies CASCADE;

-- 2. Eliminare indexuri specifice pe product_offers
DROP INDEX IF EXISTS idx_offers_freshness;
DROP INDEX IF EXISTS idx_offers_flagged;

-- 3. Eliminare coloane de audit și calitate din product_offers
ALTER TABLE product_offers DROP COLUMN IF EXISTS freshness_score;
ALTER TABLE product_offers DROP COLUMN IF EXISTS quality_score;
ALTER TABLE product_offers DROP COLUMN IF EXISTS freshness_status;
ALTER TABLE product_offers DROP COLUMN IF EXISTS last_collected_at;
ALTER TABLE product_offers DROP COLUMN IF EXISTS last_verified_at;
ALTER TABLE product_offers DROP COLUMN IF EXISTS is_flagged_anomaly;
ALTER TABLE product_offers DROP COLUMN IF EXISTS anomaly_reason;
