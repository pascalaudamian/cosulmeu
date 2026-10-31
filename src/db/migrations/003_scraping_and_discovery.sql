-- ====================================================================
-- MIGRAȚIE 003: COȘUL MEU – MOTOR AUTOMAT DE INDEXARE PRIN WEB SCRAPING
-- Tabele: retailers, retailer_products, promotions, receipt_products,
--         product_matches, indexing_jobs, indexing_runs
-- ====================================================================

-- 1. View sau tabel alias: retailers (păstrează compatibilitatea cu stores)
CREATE OR REPLACE VIEW retailers AS 
SELECT 
    id,
    name,
    slug,
    chain,
    brand_color,
    accent_color,
    logo_url,
    store_type,
    rating,
    locations_count,
    sample_address,
    is_partner,
    created_at
FROM stores;

-- 2. Tabel: Produse specifice per Retailer (Catalog Scraped / Cartografiat)
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

CREATE INDEX IF NOT EXISTS idx_retailer_products_retailer ON retailer_products(retailer_id);
CREATE INDEX IF NOT EXISTS idx_retailer_products_product ON retailer_products(product_id);
CREATE INDEX IF NOT EXISTS idx_retailer_products_barcode ON retailer_products(barcode) WHERE barcode IS NOT NULL;

-- 3. Tabel: Promoții Active & Reduceri Colectate
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

CREATE INDEX IF NOT EXISTS idx_promotions_retailer ON promotions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_promotions_product ON promotions(product_id);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(starts_at, ends_at);

-- 4. Tabel: Produse Descoperite de pe Bonurile Fiscale ale Utilizatorilor (Discovery Candidates)
CREATE TABLE IF NOT EXISTS receipt_products (
    id VARCHAR(64) PRIMARY KEY,
    receipt_id VARCHAR(64),
    raw_name VARCHAR(255) NOT NULL,
    extracted_brand VARCHAR(128),
    extracted_price NUMERIC(10,2),
    extracted_quantity NUMERIC(10,3) DEFAULT 1,
    category VARCHAR(64),
    target_search_status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending' | 'searched' | 'matched' | 'ignored'
    matched_product_id VARCHAR(64) REFERENCES products(id) ON DELETE SET NULL,
    search_attempts INTEGER NOT NULL DEFAULT 0,
    last_searched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_products_status ON receipt_products(target_search_status);
CREATE INDEX IF NOT EXISTS idx_receipt_products_matched ON receipt_products(matched_product_id);

-- 5. Tabel: Asocieri de Produse (Audit & Validare Potriviri)
CREATE TABLE IF NOT EXISTS product_matches (
    id VARCHAR(64) PRIMARY KEY,
    candidate_id VARCHAR(64),
    raw_name VARCHAR(255) NOT NULL,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    retailer_id VARCHAR(64) REFERENCES stores(id) ON DELETE CASCADE,
    confidence NUMERIC(4,3) NOT NULL,
    match_type VARCHAR(32) NOT NULL, -- 'ean_exact' | 'name_similarity' | 'manual_review'
    status VARCHAR(32) NOT NULL DEFAULT 'approved', -- 'approved' | 'rejected' | 'pending'
    reviewed_by VARCHAR(64),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_matches_prod ON product_matches(product_id);
CREATE INDEX IF NOT EXISTS idx_product_matches_status ON product_matches(status);

-- 6. Tabel: Sarcini de Indexare / Colectare (Indexing Jobs)
CREATE TABLE IF NOT EXISTS indexing_jobs (
    id VARCHAR(64) PRIMARY KEY,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    job_type VARCHAR(32) NOT NULL DEFAULT 'daily_scrape', -- 'daily_scrape' | 'targeted_receipt_search' | 'promotions_discovery'
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed' | 'retrying'
    target_query TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexing_jobs_retailer_status ON indexing_jobs(retailer_id, status);

-- 7. Tabel: Execuții Sarcini de Indexare (Indexing Runs)
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

CREATE INDEX IF NOT EXISTS idx_indexing_runs_retailer ON indexing_runs(retailer_id, started_at DESC);
