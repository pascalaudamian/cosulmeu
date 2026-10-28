-- ====================================================================
-- SCHEMA COȘUL MEU - PERSISTENȚĂ CENTRALIZATĂ POSTGRESQL (MULTI-USER)
-- Suportă: Cloud SQL PostgreSQL, Supabase, Neon și PostgreSQL Standard
-- ====================================================================

-- 1. Tabel: Magazine (Supermarketuri & Discounters)
CREATE TABLE IF NOT EXISTS stores (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(64) NOT NULL UNIQUE,
    chain VARCHAR(128) NOT NULL,
    brand_color VARCHAR(32) NOT NULL,
    accent_color VARCHAR(32) NOT NULL,
    logo_url TEXT,
    store_type VARCHAR(32) NOT NULL DEFAULT 'supermarket',
    rating NUMERIC(3,2) NOT NULL DEFAULT 4.0,
    locations_count INTEGER NOT NULL DEFAULT 1,
    sample_address TEXT NOT NULL,
    is_partner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabel: Produse de Referință (Catalog Unificat)
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    default_unit VARCHAR(16) NOT NULL,
    package_weight_or_volume NUMERIC(10,3) NOT NULL,
    package_unit VARCHAR(16) NOT NULL,
    normalized_unit VARCHAR(16) NOT NULL,
    barcode VARCHAR(64),
    image_url TEXT,
    is_bio BOOLEAN NOT NULL DEFAULT FALSE,
    is_romanian_product BOOLEAN NOT NULL DEFAULT FALSE,
    base_reference_price NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);

-- 3. Tabel: Surse de Date (Adaptoare & Feed-uri)
CREATE TABLE IF NOT EXISTS data_sources (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'configured_manual',
    store_id VARCHAR(64) REFERENCES stores(id) ON DELETE SET NULL,
    format VARCHAR(16) DEFAULT 'csv',
    last_sync_at TIMESTAMPTZ,
    imported_offers_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    requires_auth BOOLEAN NOT NULL DEFAULT FALSE,
    auth_documentation TEXT,
    endpoint_url TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabel: Oferte Curente Magazin (Stare Curentă / Upsert)
-- Garanție unicitate: Un produs are maximum o ofertă activă per magazin
CREATE TABLE IF NOT EXISTS product_offers (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    source_id VARCHAR(64) REFERENCES data_sources(id) ON DELETE SET NULL,
    price NUMERIC(10,2) NOT NULL CHECK (price > 0),
    original_price NUMERIC(10,2),
    normal_price NUMERIC(10,2),
    promo_price NUMERIC(10,2),
    loyalty_price NUMERIC(10,2),
    raw_record_id VARCHAR(128),
    region VARCHAR(64) DEFAULT 'Național',
    batch_id VARCHAR(64),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),
    unit_price_measure VARCHAR(32) NOT NULL,
    is_promo BOOLEAN NOT NULL DEFAULT FALSE,
    promo_details TEXT,
    loyalty_card_required BOOLEAN NOT NULL DEFAULT FALSE,
    loyalty_card_name VARCHAR(64),
    valid_until DATE,
    observation_date DATE NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'verified',
    confidence_level VARCHAR(16) NOT NULL DEFAULT 'high',
    verification_status VARCHAR(32) NOT NULL DEFAULT 'verified',
    last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_sponsored BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_store UNIQUE (product_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_offers_product_store ON product_offers(product_id, store_id);
CREATE INDEX IF NOT EXISTS idx_offers_store_promo ON product_offers(store_id, is_promo);
CREATE INDEX IF NOT EXISTS idx_offers_valid_until ON product_offers(valid_until);

-- 5. Tabel: Observații Istorice de Preț (APPEND-ONLY / IMUTABIL)
-- Niciun UPDATE sau DELETE nu este permis pe acest tabel în operare normală.
-- Fiecare modificare de preț sau bon verificat adaugă o înregistrare istorică.
CREATE TABLE IF NOT EXISTS price_observations (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    source_id VARCHAR(64) REFERENCES data_sources(id) ON DELETE SET NULL,
    price NUMERIC(10,2) NOT NULL CHECK (price > 0),
    normal_price NUMERIC(10,2),
    promo_price NUMERIC(10,2),
    loyalty_price NUMERIC(10,2),
    raw_record_id VARCHAR(128),
    region VARCHAR(64) DEFAULT 'Național',
    batch_id VARCHAR(64),
    date DATE NOT NULL,
    receipt_id VARCHAR(64),
    loyalty_card_used BOOLEAN NOT NULL DEFAULT FALSE,
    source VARCHAR(32) NOT NULL DEFAULT 'official_feed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Garanție de idempotență: se evită dublurile identice în aceeași zi pentru același produs, magazin și preț
    CONSTRAINT uq_daily_price_obs UNIQUE (product_id, store_id, date, price)
);

CREATE INDEX IF NOT EXISTS idx_price_obs_product_date ON price_observations(product_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_price_obs_store_date ON price_observations(store_id, date DESC);

-- 6. Tabel: Candidați de Potrivire (Recenzare Asocieri Produse fără GTIN)
CREATE TABLE IF NOT EXISTS product_match_candidates (
    id VARCHAR(64) PRIMARY KEY,
    source_raw_name VARCHAR(255) NOT NULL,
    source_barcode VARCHAR(64),
    source_brand VARCHAR(128),
    source_package_weight_or_volume NUMERIC(10,3),
    source_package_unit VARCHAR(16),
    matched_product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    matched_product_name VARCHAR(255) NOT NULL,
    confidence_score NUMERIC(4,3) NOT NULL,
    match_method VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_confirmation',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_candidates_status ON product_match_candidates(status);

-- 7. Tabel: Jurnal Sincronizări & Importuri (Audit Trail)
CREATE TABLE IF NOT EXISTS source_sync_runs (
    id VARCHAR(64) PRIMARY KEY,
    source_id VARCHAR(64) NOT NULL,
    source_name VARCHAR(128) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL,
    records_processed INTEGER NOT NULL DEFAULT 0,
    records_imported INTEGER NOT NULL DEFAULT 0,
    duplicates_found INTEGER NOT NULL DEFAULT 0,
    invalid_records INTEGER NOT NULL DEFAULT 0,
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT NOT NULL,
    persistence_mode VARCHAR(32) NOT NULL DEFAULT 'postgresql',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_source_date ON source_sync_runs(source_id, started_at DESC);

-- 8. Tabel: Registru Colectori Retaileri (7 Retaileri România)
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

-- 9. Tabel: Lock Distribuit pentru Prevenirea Rulărilor Concurente
CREATE TABLE IF NOT EXISTS indexing_locks (
    lock_key VARCHAR(64) PRIMARY KEY,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 10. Trigger PostgreSQL pentru Protecția Absolută Append-Only pe price_observations
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

