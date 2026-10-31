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
    freshness_score NUMERIC(5,2),
    quality_score NUMERIC(5,2),
    freshness_status VARCHAR(32) DEFAULT 'very_recent',
    last_collected_at TIMESTAMPTZ DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ,
    is_flagged_anomaly BOOLEAN NOT NULL DEFAULT FALSE,
    anomaly_reason TEXT,
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

-- 11. View / Alias: retailers
CREATE OR REPLACE VIEW retailers AS 
SELECT 
    id, name, slug, chain, brand_color, accent_color, logo_url, store_type, rating, locations_count, sample_address, is_partner, created_at
FROM stores;

-- 12. Tabel: Produse per Retailer (Cartografiere Scraping)
CREATE TABLE IF NOT EXISTS retailer_products (
    id VARCHAR(64) PRIMARY KEY,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id VARCHAR(64) REFERENCES products(id) ON DELETE SET NULL,
    external_sku VARCHAR(128),
    url TEXT,
    scraped_name VARCHAR(255) NOT NULL,
    scraped_brand VARCHAR(128),
    scraped_package_weight_or_volume NUMERIC(10,3),
    scraped_package_unit VARCHAR(16),
    barcode VARCHAR(64),
    last_scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Tabel: Promoții Colectate
CREATE TABLE IF NOT EXISTS promotions (
    id VARCHAR(64) PRIMARY KEY,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id VARCHAR(64) REFERENCES products(id) ON DELETE SET NULL,
    retailer_product_id VARCHAR(64) REFERENCES retailer_products(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    normal_price NUMERIC(10,2),
    promo_price NUMERIC(10,2) NOT NULL CHECK (promo_price > 0),
    loyalty_price NUMERIC(10,2),
    loyalty_card_name VARCHAR(64),
    starts_at DATE,
    ends_at DATE,
    conditions TEXT,
    source_url TEXT,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Tabel: Produse Descoperite de pe Bonurile Utilizatorilor
CREATE TABLE IF NOT EXISTS receipt_products (
    id VARCHAR(64) PRIMARY KEY,
    receipt_id VARCHAR(64),
    raw_name VARCHAR(255) NOT NULL,
    extracted_brand VARCHAR(128),
    extracted_price NUMERIC(10,2),
    extracted_quantity NUMERIC(10,3) DEFAULT 1,
    category VARCHAR(64),
    target_search_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    matched_product_id VARCHAR(64) REFERENCES products(id) ON DELETE SET NULL,
    search_attempts INTEGER NOT NULL DEFAULT 0,
    last_searched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Tabel: Asocieri Produse (product_matches)
CREATE TABLE IF NOT EXISTS product_matches (
    id VARCHAR(64) PRIMARY KEY,
    candidate_id VARCHAR(64),
    raw_name VARCHAR(255) NOT NULL,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    retailer_id VARCHAR(64) REFERENCES stores(id) ON DELETE CASCADE,
    confidence NUMERIC(4,3) NOT NULL,
    match_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'approved',
    reviewed_by VARCHAR(64),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Tabel: Sarcini de Indexare (indexing_jobs)
CREATE TABLE IF NOT EXISTS indexing_jobs (
    id VARCHAR(64) PRIMARY KEY,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    job_type VARCHAR(32) NOT NULL DEFAULT 'daily_scrape',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    target_query TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. Tabel: Execuții Indexare (indexing_runs)
CREATE TABLE IF NOT EXISTS indexing_runs (
    id VARCHAR(64) PRIMARY KEY,
    job_id VARCHAR(64) REFERENCES indexing_jobs(id) ON DELETE SET NULL,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    products_collected INTEGER NOT NULL DEFAULT 0,
    promotions_collected INTEGER NOT NULL DEFAULT 0,
    errors_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. Tabel: Anomalii Detectate de Calitate (quality_anomalies)
CREATE TABLE IF NOT EXISTS quality_anomalies (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    offer_id VARCHAR(64),
    anomaly_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'medium',
    current_price NUMERIC(10,2) NOT NULL,
    previous_price NUMERIC(10,2),
    baseline_price NUMERIC(10,2),
    deviation_percentage NUMERIC(6,2),
    details TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. Tabel: Coadă de Recolectare și Reverificare (quality_recollection_queue)
CREATE TABLE IF NOT EXISTS quality_recollection_queue (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    priority SMALLINT NOT NULL DEFAULT 3,
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20. Tabel: Rapoarte Zilnice de Calitate (daily_quality_reports)
CREATE TABLE IF NOT EXISTS daily_quality_reports (
    id VARCHAR(64) PRIMARY KEY,
    report_date DATE NOT NULL UNIQUE,
    total_tracked_products INTEGER NOT NULL DEFAULT 0,
    total_new_prices INTEGER NOT NULL DEFAULT 0,
    total_updated_prices INTEGER NOT NULL DEFAULT 0,
    total_new_promotions INTEGER NOT NULL DEFAULT 0,
    total_expired_prices INTEGER NOT NULL DEFAULT 0,
    total_unmatched_products INTEGER NOT NULL DEFAULT 0,
    total_anomalies_count INTEGER NOT NULL DEFAULT 0,
    total_collection_errors INTEGER NOT NULL DEFAULT 0,
    overall_avg_quality_score NUMERIC(5,2) NOT NULL DEFAULT 0,
    overall_avg_freshness_score NUMERIC(5,2) NOT NULL DEFAULT 0,
    freshness_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
    retailers_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



