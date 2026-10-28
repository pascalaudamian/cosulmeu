-- ====================================================================
-- MIGRAȚIE 002: MOTOR HIBRID DE INDEXARE A PREȚURILOR (7 RETAILERI)
-- Adaugă: Proveniență avansată, prețuri separate, registru colectori, lock concurență și protecție append-only
-- ====================================================================

-- 1. Extindere tabel product_offers cu câmpuri explicite de preț și proveniență
ALTER TABLE product_offers
    ADD COLUMN IF NOT EXISTS normal_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS promo_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS loyalty_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS raw_record_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS region VARCHAR(64) DEFAULT 'Național',
    ADD COLUMN IF NOT EXISTS batch_id VARCHAR(64);

-- 2. Extindere tabel price_observations cu proveniență și prețuri distincte
ALTER TABLE price_observations
    ADD COLUMN IF NOT EXISTS normal_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS promo_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS loyalty_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS raw_record_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS region VARCHAR(64) DEFAULT 'Național',
    ADD COLUMN IF NOT EXISTS batch_id VARCHAR(64);

-- 3. Tabel: Registru Colectori Retaileri (7 Retaileri România)
CREATE TABLE IF NOT EXISTS retailer_collectors (
    retailer_id VARCHAR(64) PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    source_id VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    access_method VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'disabled',
    cron_expression VARCHAR(64) NOT NULL DEFAULT '0 4 * * *',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Bucharest',
    rate_limit_rpm INTEGER NOT NULL DEFAULT 30,
    max_batch_items INTEGER NOT NULL DEFAULT 500,
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    max_retries INTEGER NOT NULL DEFAULT 3,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error_reason TEXT,
    suspension_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabel: Lock Distribuit pentru Prevenirea Rulărilor Concurente
CREATE TABLE IF NOT EXISTS indexing_locks (
    lock_key VARCHAR(64) PRIMARY KEY,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 5. Trigger PostgreSQL pentru Protecția Absolută Append-Only pe price_observations
CREATE OR REPLACE FUNCTION prevent_price_obs_update_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Operațiile UPDATE sau DELETE sunt strict interzise pe tabelul price_observations (istoric imutabil append-only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_price_observations ON price_observations;
CREATE TRIGGER trg_protect_price_observations
BEFORE UPDATE OR DELETE ON price_observations
FOR EACH ROW EXECUTE FUNCTION prevent_price_obs_update_delete();
